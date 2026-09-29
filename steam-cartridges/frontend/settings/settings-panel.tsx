import { useCallback, useEffect, useRef, useState } from "react";
import {
    DialogButton,
    Dropdown,
    Field,
    PanelSection,
    PanelSectionRow,
    TextField,
    Toggle as SteamToggle,
} from "@steambrew/client";
import { useSetting, getAchievementsSource, getRouting, type ControllerOverride } from "./settings";
import { rpc, type ProviderStatus, type RetroStatusResponse } from "../rpc";
import {
    type RoutingRule,
    type ServiceTarget,
    type RuleAction,
    type ConditionType,
    type AutoRoutingProfile,
    isServiceAllowed,
} from "../domain/routing/policy";
import { type ConsolidatedMetadata } from "../rpc";

import {
    loadControllerInference,
    getInferredControllerSupport,
} from "../features/game-info/controller";
import { useSyncProgress, triggerSync } from "../features/scraper/sync-manager";

/**
 * Compact row wrapper to reduce inter-item vertical spacing and
 * preserve card separation across all control types (reference: enhanced-achievements).
 */
const ITEM_ROW_STYLE: React.CSSProperties = {
    margin: "0",
    padding: "0",
};

function ItemRow({ children }: { children: React.ReactNode }) {
    return (
        <PanelSectionRow>
            <div style={ITEM_ROW_STYLE}>{children}</div>
        </PanelSectionRow>
    );
}

function ToggleRow({
    label,
    description,
    value,
    onChange,
    disabled,
}: {
    label: string;
    description?: string;
    value: boolean;
    onChange: (val: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <ItemRow>
            <Field label={label} description={description} disabled={disabled}>
                <SteamToggle
                    value={value}
                    disabled={disabled}
                    onChange={onChange}
                />
            </Field>
        </ItemRow>
    );
}

/**
 * Clean Steam-themed modal dialog for popups.
 */
interface SettingsModalProps {
    title: string;
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    width?: string;
    maxHeight?: string;
}

function SettingsModal({
    title,
    isOpen,
    onClose,
    children,
    width = "520px",
    maxHeight = "85vh",
}: SettingsModalProps) {
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.75)",
                backdropFilter: "blur(3px)",
                zIndex: 10000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: "#1b2838",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "6px",
                    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.85)",
                    width,
                    maxWidth: "94vw",
                    maxHeight,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    style={{
                        padding: "12px 18px",
                        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "rgba(0, 0, 0, 0.25)",
                    }}
                >
                    <span
                        style={{
                            fontSize: "14px",
                            fontWeight: 700,
                            color: "#fff",
                        }}
                    >
                        {title}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: "#8b929a",
                            fontSize: "18px",
                            cursor: "pointer",
                            padding: "0 4px",
                            lineHeight: 1,
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div
                    style={{
                        padding: "16px 18px",
                        overflowY: "auto",
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                    }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}

// ===========================================================================
// 1. {Metadata} Services Section
// ===========================================================================

type MetadataServiceId = "steam_store" | "screenscraper" | "igdb" | "steamgriddb";

interface MetadataServiceDef {
    id: MetadataServiceId;
    label: string;
}

const ALL_METADATA_SERVICES: MetadataServiceDef[] = [
    { id: "steam_store", label: "Steam Store Mirror" },
    { id: "screenscraper", label: "ScreenScraper" },
    { id: "igdb", label: "IGDB" },
    { id: "steamgriddb", label: "SteamGridDB (artwork)" },
];

function MetadataSection() {
    const [services, setServices] = useSetting("services");
    const [status, setStatus] = useState<ProviderStatus | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);

    // Form inputs in modal
    const [selectedService, setSelectedService] =
        useState<MetadataServiceId>("steam_store");
    const [ssUser, setSsUser] = useState("");
    const [ssPass, setSsPass] = useState("");
    const [ssDevUser, setSsDevUser] = useState("");
    const [ssDevPw, setSsDevPw] = useState("");
    const [igdbId, setIgdbId] = useState("");
    const [igdbSecret, setIgdbSecret] = useState("");
    const [sgdbKey, setSgdbKey] = useState("");

    const [statusMsg, setStatusMsg] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const refresh = () => {
        rpc.getStatus()
            .then(setStatus)
            .catch(() => {});
    };

    useEffect(() => {
        refresh();
    }, []);

    // Determine active services
    const activeServices: MetadataServiceDef[] = [];
    const [steamStoreService, ssService, igdbService, sgdbService] = ALL_METADATA_SERVICES;
    if (steamStoreService && services.steamStoreEnabled !== false) {
        activeServices.push(steamStoreService);
    }
    if (
        ssService &&
        services.screenscraperEnabled !== false &&
        status?.has_screenscraper
    ) {
        activeServices.push(ssService);
    }
    if (igdbService && services.igdbEnabled !== false && status?.has_twitch) {
        activeServices.push(igdbService);
    }
    if (sgdbService && services.steamgriddbEnabled !== false && status?.has_sgdb) {
        activeServices.push(sgdbService);
    }

    const availableToAdd = ALL_METADATA_SERVICES.filter(
        (s) => !activeServices.some((active) => active.id === s.id),
    );

    const handleRemoveService = (id: MetadataServiceId) => {
        if (id === "steam_store") {
            setServices({ ...services, steamStoreEnabled: false });
        } else if (id === "screenscraper") {
            setServices({ ...services, screenscraperEnabled: false });
        } else if (id === "igdb") {
            setServices({ ...services, igdbEnabled: false });
        } else if (id === "steamgriddb") {
            setServices({ ...services, steamgriddbEnabled: false });
        }
        triggerSync(250);
    };

    const handleOpenAddModal = () => {
        const first = availableToAdd[0];
        if (first) {
            setSelectedService(first.id);
            setStatusMsg("");
            setShowAddModal(true);
        }
    };

    const handleRegisterService = async () => {
        setIsSaving(true);
        setStatusMsg("Checking API connection...");

        if (selectedService === "steam_store") {
            setServices({ ...services, steamStoreEnabled: true });
            triggerSync(250);
            setStatusMsg("✓ Steam Store Mirror enabled!");
            setTimeout(() => {
                setShowAddModal(false);
                setIsSaving(false);
                setStatusMsg("");
            }, 1000);
            return;
        }

        if (selectedService === "screenscraper") {
            if (!ssUser.trim() || !ssPass.trim()) {
                setStatusMsg("Username and password are required.");
                setIsSaving(false);
                return;
            }
            const res = await rpc.saveServiceCredentials({
                screenscraper_user: ssUser.trim(),
                screenscraper_pass: ssPass.trim(),
                screenscraper_dev_user: ssDevUser.trim(),
                screenscraper_dev_pw: ssDevPw.trim(),
            });
            if (res.success) {
                setServices({ ...services, screenscraperEnabled: true });
                triggerSync(250);
                refresh();
                setStatusMsg("✓ ScreenScraper registered & verified!");
                setTimeout(() => {
                    setShowAddModal(false);
                    setIsSaving(false);
                    setStatusMsg("");
                    setSsPass("");
                }, 1200);
            } else {
                setStatusMsg("Failed to save credentials.");
                setIsSaving(false);
            }
            return;
        }

        if (selectedService === "igdb") {
            if (!igdbId.trim() || !igdbSecret.trim()) {
                setStatusMsg("Client ID and Secret are required.");
                setIsSaving(false);
                return;
            }
            const res = await rpc.saveServiceCredentials({
                twitch_client_id: igdbId.trim(),
                twitch_client_secret: igdbSecret.trim(),
            });
            if (res.success) {
                setServices({ ...services, igdbEnabled: true });
                triggerSync(250);
                refresh();
                setStatusMsg("✓ IGDB registered & verified!");
                setTimeout(() => {
                    setShowAddModal(false);
                    setIsSaving(false);
                    setStatusMsg("");
                    setIgdbSecret("");
                }, 1200);
            } else {
                setStatusMsg("Failed to save credentials.");
                setIsSaving(false);
            }
            return;
        }

        if (selectedService === "steamgriddb") {
            if (!sgdbKey.trim()) {
                setStatusMsg("An API key is required.");
                setIsSaving(false);
                return;
            }
            const res = await rpc.saveServiceCredentials({
                steamgriddb_api: sgdbKey.trim(),
            });
            if (res.success) {
                setServices({ ...services, steamgriddbEnabled: true });
                refresh();
                setStatusMsg("✓ SteamGridDB key saved!");
                setTimeout(() => {
                    setShowAddModal(false);
                    setIsSaving(false);
                    setStatusMsg("");
                    setSgdbKey("");
                }, 1200);
            } else {
                setStatusMsg("Failed to save credentials.");
                setIsSaving(false);
            }
            return;
        }
    };

    return (
        <PanelSection title="Metadata">
            {activeServices.length === 0 && (
                <ItemRow>
                    <div
                        style={{
                            opacity: 0.6,
                            fontSize: "12px",
                            padding: "4px 0",
                            fontStyle: "italic",
                        }}
                    >
                        No metadata services active.
                    </div>
                </ItemRow>
            )}

            {/* List of Active Services */}
            {activeServices.map((svc) => (
                <ItemRow key={svc.id}>
                    <Field label={svc.label}>
                        <DialogButton
                            onClick={() => handleRemoveService(svc.id)}
                            style={{
                                padding: "0 8px",
                                minWidth: 0,
                                width: "auto",
                                fontSize: "12px",
                            }}
                        >
                            🗑️
                        </DialogButton>
                    </Field>
                </ItemRow>
            ))}

            {/* Only show Add Service button if unadded services remain */}
            {availableToAdd.length > 0 && (
                <ItemRow>
                    <div style={{ marginTop: "4px" }}>
                        <DialogButton
                            onClick={handleOpenAddModal}
                            style={{
                                padding: "0 14px",
                                minWidth: 0,
                                width: "auto",
                            }}
                        >
                            + Add Service
                        </DialogButton>
                    </div>
                </ItemRow>
            )}

            {/* Add Service Modal */}
            <SettingsModal
                title="Register Metadata Service"
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Service
                    </span>
                    <Dropdown
                        rgOptions={availableToAdd.map((s) => ({
                            data: s.id,
                            label: s.label,
                        }))}
                        selectedOption={selectedService}
                        onChange={(o) => setSelectedService(o.data as any)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </div>

                {selectedService === "steam_store" && (
                    <div
                        style={{
                            fontSize: "12px",
                            opacity: 0.8,
                            padding: "4px 0",
                        }}
                    >
                        Steam Store Mirror extracts Game Info, descriptions,
                        genres, and release dates directly from Steam Store
                        matching. No API key required.
                    </div>
                )}

                {selectedService === "screenscraper" && (
                    <>
                        <TextField
                            label="Account Username"
                            value={ssUser}
                            onChange={(e) => setSsUser(e.target.value)}
                        />
                        <TextField
                            label="Account Password"
                            bIsPassword
                            value={ssPass}
                            onChange={(e) => setSsPass(e.target.value)}
                        />
                        <TextField
                            label="Dev ID (Optional)"
                            value={ssDevUser}
                            onChange={(e) => setSsDevUser(e.target.value)}
                        />
                        <TextField
                            label="Dev Password (Optional)"
                            bIsPassword
                            value={ssDevPw}
                            onChange={(e) => setSsDevPw(e.target.value)}
                        />
                    </>
                )}

                {selectedService === "igdb" && (
                    <>
                        <TextField
                            label="Twitch Client ID"
                            value={igdbId}
                            onChange={(e) => setIgdbId(e.target.value)}
                        />
                        <TextField
                            label="Twitch Client Secret"
                            bIsPassword
                            value={igdbSecret}
                            onChange={(e) => setIgdbSecret(e.target.value)}
                        />
                    </>
                )}

                {selectedService === "steamgriddb" && (
                    <>
                        <div
                            style={{
                                fontSize: "12px",
                                opacity: 0.8,
                                padding: "4px 0",
                            }}
                        >
                            Fills empty artwork slots (capsule, hero, logo,
                            wide) for shortcuts with no Steam match. Art you
                            set yourself is never replaced. Get a free key in
                            your SteamGridDB profile preferences.
                        </div>
                        <TextField
                            label="SteamGridDB API Key"
                            bIsPassword
                            value={sgdbKey}
                            onChange={(e) => setSgdbKey(e.target.value)}
                        />
                    </>
                )}

                {statusMsg && (
                    <div
                        style={{
                            fontSize: "12px",
                            color: statusMsg.startsWith("✓")
                                ? "#a4d007"
                                : "#eb4b4b",
                        }}
                    >
                        {statusMsg}
                    </div>
                )}

                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    <DialogButton
                        disabled={isSaving}
                        onClick={handleRegisterService}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Register
                    </DialogButton>
                    <DialogButton
                        onClick={() => setShowAddModal(false)}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Cancel
                    </DialogButton>
                </div>
            </SettingsModal>
        </PanelSection>
    );
}

// ===========================================================================
// 2. {Achievements} Sources Section
// ===========================================================================

interface AchievementSourceDef {
    id: "steam_store" | "retroachievements" | "console_emulators";
    label: string;
}

const ALL_ACHIEVEMENT_SOURCES: AchievementSourceDef[] = [
    { id: "steam_store", label: "Steam Store Mirror" },
    { id: "retroachievements", label: "RetroAchievements" },
    { id: "console_emulators", label: "Emulators" },
];

function AchievementsSection() {
    const [services, setServices] = useSetting("services");
    const [retroStatus, setRetroStatus] = useState<RetroStatusResponse | null>(
        null,
    );

    const [showAddModal, setShowAddModal] = useState(false);
    const [showEmuModal, setShowEmuModal] = useState(false);
    const [sourceToRegister, setSourceToRegister] = useState<
        "steam_store" | "retroachievements" | "console_emulators"
    >("retroachievements");

    // RA credentials input
    const [raUser, setRaUser] = useState("");
    const [raToken, setRaToken] = useState("");
    const [raMsg, setRaMsg] = useState("");
    const [isSavingRa, setIsSavingRa] = useState(false);

    const refreshRetro = () => {
        rpc.cartridgesAchievementsGetRetroStatus()
            .then(setRetroStatus)
            .catch(() => {});
    };

    useEffect(() => {
        refreshRetro();
    }, []);

    const activeRaUser =
        retroStatus?.emulators?.find((e) => e.authenticated && e.username)
            ?.username ||
        (retroStatus?.env_fallback
            ? retroStatus.env_username || "Configured in .env"
            : null);

    // Active sources calculation
    const activeSources: AchievementSourceDef[] = [];
    const [steamStoreSrc, raSrc, emuSrc] = ALL_ACHIEVEMENT_SOURCES;
    if (steamStoreSrc && services.steamStoreEnabled !== false) {
        activeSources.push(steamStoreSrc);
    }
    if (raSrc && services.retroachievementsEnabled !== false && activeRaUser) {
        activeSources.push(raSrc);
    }
    if (
        emuSrc &&
        services.emulatorsEnabled !== false &&
        services.rpcs3Enabled !== false
    ) {
        activeSources.push(emuSrc);
    }

    const availableToAdd = ALL_ACHIEVEMENT_SOURCES.filter(
        (s) => !activeSources.some((active) => active.id === s.id),
    );

    const handleRemoveSource = (
        id: "steam_store" | "retroachievements" | "console_emulators",
    ) => {
        if (id === "steam_store") {
            setServices({ ...services, steamStoreEnabled: false });
        } else if (id === "retroachievements") {
            setServices({ ...services, retroachievementsEnabled: false });
        } else if (id === "console_emulators") {
            setServices({
                ...services,
                emulatorsEnabled: false,
                rpcs3Enabled: false,
            });
        }
        triggerSync(250);
    };

    const handleOpenAddModal = () => {
        const first = availableToAdd[0];
        if (first) {
            setSourceToRegister(first.id);
            setRaMsg("");
            setShowAddModal(true);
        }
    };

    const handleRegisterSource = async () => {
        setIsSavingRa(true);
        setRaMsg("Checking API connection...");

        if (sourceToRegister === "steam_store") {
            setServices({ ...services, steamStoreEnabled: true });
            triggerSync(250);
            setRaMsg("✓ Steam Store Mirror enabled!");
            setTimeout(() => {
                setShowAddModal(false);
                setIsSavingRa(false);
                setRaMsg("");
            }, 1000);
            return;
        }

        if (sourceToRegister === "console_emulators") {
            setServices({
                ...services,
                emulatorsEnabled: true,
                rpcs3Enabled: true,
            });
            triggerSync(250);
            setRaMsg("✓ Console Emulators enabled!");
            setTimeout(() => {
                setShowAddModal(false);
                setIsSavingRa(false);
                setRaMsg("");
            }, 1000);
            return;
        }

        if (sourceToRegister === "retroachievements") {
            if (!raUser.trim() || !raToken.trim()) {
                setRaMsg("Username and API token are required.");
                setIsSavingRa(false);
                return;
            }
            const res = await rpc.saveServiceCredentials({
                retroachievements_user: raUser.trim(),
                retroachievements_api: raToken.trim(),
            });
            if (res.success) {
                setServices({ ...services, retroachievementsEnabled: true });
                triggerSync(250);
                refreshRetro();
                setRaMsg("✓ RetroAchievements verified & connected!");
                setTimeout(() => {
                    setShowAddModal(false);
                    setIsSavingRa(false);
                    setRaMsg("");
                    setRaToken("");
                }, 1200);
            } else {
                setRaMsg("Failed to save credentials.");
                setIsSavingRa(false);
            }
            return;
        }
    };

    return (
        <PanelSection title="Achievements">
            {activeSources.length === 0 && (
                <ItemRow>
                    <div
                        style={{
                            opacity: 0.6,
                            fontSize: "12px",
                            padding: "4px 0",
                            fontStyle: "italic",
                        }}
                    >
                        No achievement sources active.
                    </div>
                </ItemRow>
            )}

            {/* List of Active Achievement Sources */}
            {activeSources.map((src) => (
                <ItemRow key={src.id}>
                    <Field label={src.label}>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}
                        >
                            {src.id === "console_emulators" && (
                                <DialogButton
                                    onClick={() => setShowEmuModal(true)}
                                    title="Console Emulators Status"
                                    style={{
                                        padding: "0 8px",
                                        minWidth: 0,
                                        width: "auto",
                                        fontSize: "13px",
                                        lineHeight: "20px",
                                    }}
                                >
                                    ⓘ
                                </DialogButton>
                            )}
                            <DialogButton
                                onClick={() => handleRemoveSource(src.id)}
                                style={{
                                    padding: "0 8px",
                                    minWidth: 0,
                                    width: "auto",
                                    fontSize: "12px",
                                }}
                            >
                                🗑️
                            </DialogButton>
                        </div>
                    </Field>
                </ItemRow>
            ))}

            {/* Only show Add Source button if unadded sources remain */}
            {availableToAdd.length > 0 && (
                <ItemRow>
                    <div style={{ marginTop: "4px" }}>
                        <DialogButton
                            onClick={handleOpenAddModal}
                            style={{
                                padding: "0 14px",
                                minWidth: 0,
                                width: "auto",
                            }}
                        >
                            + Add Source
                        </DialogButton>
                    </div>
                </ItemRow>
            )}

            {/* Add Source Modal */}
            <SettingsModal
                title="Add Achievements Source"
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Source
                    </span>
                    <Dropdown
                        rgOptions={availableToAdd.map((s) => ({
                            data: s.id,
                            label: s.label,
                        }))}
                        selectedOption={sourceToRegister}
                        onChange={(o) => setSourceToRegister(o.data as any)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </div>

                {sourceToRegister === "retroachievements" && (
                    <>
                        <TextField
                            label="Username"
                            value={raUser}
                            onChange={(e) => setRaUser(e.target.value)}
                        />
                        <TextField
                            label="Web API Key / Token"
                            bIsPassword
                            value={raToken}
                            onChange={(e) => setRaToken(e.target.value)}
                        />
                    </>
                )}

                {sourceToRegister === "steam_store" && (
                    <div style={{ fontSize: "12px", opacity: 0.8 }}>
                        Passively scans local emulator saves (Goldberg, CODEX,
                        RUNE, GSE) and engine runtime logs (Unity, Godot,
                        Unreal).
                    </div>
                )}

                {sourceToRegister === "console_emulators" && (
                    <div style={{ fontSize: "12px", opacity: 0.8 }}>
                        Parses offline PS3 / PS4 trophies (RPCS3, shadPS4) and
                        tails DuckStation, PCSX2, Dolphin, PPSSPP, and RPCS3
                        emulator logs.
                    </div>
                )}

                {raMsg && (
                    <div
                        style={{
                            fontSize: "12px",
                            color: raMsg.startsWith("✓")
                                ? "#a4d007"
                                : "#eb4b4b",
                        }}
                    >
                        {raMsg}
                    </div>
                )}

                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    <DialogButton
                        disabled={isSavingRa}
                        onClick={handleRegisterSource}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Register
                    </DialogButton>
                    <DialogButton
                        onClick={() => setShowAddModal(false)}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Cancel
                    </DialogButton>
                </div>
            </SettingsModal>

            {/* Emulators Status Modal */}
            <SettingsModal
                title="Emulator Status & Integration"
                isOpen={showEmuModal}
                onClose={() => setShowEmuModal(false)}
                width="480px"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        fontSize: "12px",
                    }}
                >
                    {retroStatus?.emulators?.map((emu) => (
                        <div
                            key={emu.name}
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "6px 10px",
                                background: "rgba(255, 255, 255, 0.03)",
                                borderRadius: "4px",
                            }}
                        >
                            <span
                                style={{
                                    color: emu.detected ? "#a4d007" : "#888",
                                    fontWeight: 600,
                                }}
                            >
                                {emu.detected ? "✓" : "✗"} {emu.name}
                            </span>
                            <span
                                style={{
                                    color: emu.authenticated
                                        ? "#66c0f4"
                                        : "#aaa",
                                }}
                            >
                                {emu.authenticated
                                    ? `Logged in (${emu.username})`
                                    : emu.detected
                                      ? "Local / Unauthenticated"
                                      : "Not Detected"}
                            </span>
                        </div>
                    ))}
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: "8px",
                    }}
                >
                    <DialogButton
                        onClick={() => setShowEmuModal(false)}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Close
                    </DialogButton>
                </div>
            </SettingsModal>
        </PanelSection>
    );
}

// ===========================================================================
// 3. {Notifications} Section
// ===========================================================================

const LAUNCH_NOTIFY_OPTIONS = [
    { data: "all_runs", label: "Always" },
    { data: "first_run", label: "First run" },
    { data: "off", label: "Off" },
];

function NotificationsSection() {
    const [policy, setPolicy] = useSetting("localAchievementsNotifyOnLaunch");

    return (
        <PanelSection title="Notifications">
            {/* 3-Row layout matching theme section */}
            <ItemRow>
                <Field
                    label="Achievement Support"
                    description="Shows a notification on startup of games with supported achievements."
                    bottomSeparator="none"
                />
            </ItemRow>
            <ItemRow>
                <Field childrenContainerWidth="max">
                    <Dropdown
                        rgOptions={LAUNCH_NOTIFY_OPTIONS}
                        selectedOption={policy}
                        onChange={(o) => setPolicy(o.data as any)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </Field>
            </ItemRow>
        </PanelSection>
    );
}

// ===========================================================================
// 4. {Activity} Feed Section
// ===========================================================================

function ActivitySection() {
    const [showAdded, setShowAdded] = useSetting("activityShowAddedToLibrary");
    const [showFirstPlayed, setShowFirstPlayed] = useSetting(
        "activityShowFirstPlayed",
    );

    return (
        <PanelSection title="Activity Feed">
            <ToggleRow
                label="Added to Library"
                description="Card when game is added to library"
                value={showAdded}
                onChange={setShowAdded}
            />
            <ToggleRow
                label="First Time Played"
                description="Card when game is played for first time"
                value={showFirstPlayed}
                onChange={setShowFirstPlayed}
            />
        </PanelSection>
    );
}

// ===========================================================================
// Community & Media Section
// ===========================================================================

function CommunitySection() {
    const [showTrailers, setShowTrailers] = useSetting("communityShowTrailers");
    const [showArtworks, setShowArtworks] = useSetting("communityShowArtworks");
    const [showManuals, setShowManuals] = useSetting("communityShowManuals");
    const [showLinks, setShowLinks] = useSetting("communityShowExternalLinks");

    return (
        <PanelSection title="Community & Media">
            <ToggleRow
                label="Gameplay Trailers"
                description="Show video trailers and gameplay previews in the Community tab"
                value={showTrailers}
                onChange={setShowTrailers}
            />
            <ToggleRow
                label="Fanart & Screenshots"
                description="Show promotional artworks, title screens, and fanart galleries"
                value={showArtworks}
                onChange={setShowArtworks}
            />
            <ToggleRow
                label="Digital Game Manuals"
                description="Show original retro game manuals viewer modal when available"
                value={showManuals}
                onChange={setShowManuals}
            />
            <ToggleRow
                label="Community Hub Links"
                description="Display quick action links to Wikipedia, Speedrun leaderboards, Discord, and wikis"
                value={showLinks}
                onChange={setShowLinks}
            />
        </PanelSection>
    );
}

// ===========================================================================
// 4. {Rules} Routing Engine Section
// ===========================================================================

const SERVICE_OPTIONS = [
    { data: "all", label: "All Services" },
    { data: "steam_store", label: "Steam Store Mirror" },
    { data: "retroachievements", label: "RetroAchievements" },
    { data: "console_emulators", label: "Console Emulators" },
    { data: "screenscraper", label: "ScreenScraper" },
    { data: "igdb", label: "IGDB" },
    { data: "steamgriddb", label: "SteamGridDB" },
];

const ACTION_OPTIONS = [
    { data: "include", label: "Inclusion" },
    { data: "exclude", label: "Exclusion" },
];

const CONDITION_OPTIONS = [
    { data: "collection", label: "Collection" },
    { data: "game_name", label: "Game Title" },
    { data: "regex", label: "Regex Pattern" },
];

const REGEX_EXAMPLES = [
    { pattern: "^Mario.*", desc: "Starts with Mario" },
    { pattern: ".*(Remake|Remaster).*", desc: "Remakes & Remasters" },
    { pattern: ".*(Demo|Beta|Trial).*", desc: "Demos & Betas" },
    { pattern: ".*(Disc|CD)\\s*\\d+.*", desc: "Multi-disc games" },
    { pattern: ".*\\[.*\\].*", desc: "Bracket tags [USA, En...]" },
    { pattern: "CUSA\\d{5}", desc: "PS4 Title IDs (shadPS4)" },
];

function RulesSection() {
    const [rules, setRules] = useSetting("routingRules");
    const [autoMode, setAutoMode] = useSetting("autoRoutingMode");
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    // Rule builder state
    const [name, setName] = useState("");
    const [selectedServices, setSelectedServices] = useState<string[]>(["all"]);
    const [action, setAction] = useState<RuleAction>("include");
    const [conditionType, setConditionType] =
        useState<ConditionType>("collection");
    const [pattern, setPattern] = useState("");
    const [suggestionFilter, setSuggestionFilter] = useState("");

    // Collections & Shortcuts for suggestions
    const collections = getRouting().listCollections();
    const shortcuts = getRouting().listShortcuts();
    const seenShortcutNames = new Set<string>();
    const uniqueShortcuts = shortcuts.filter((s) => {
        if (!s.name || seenShortcutNames.has(s.name)) return false;
        seenShortcutNames.add(s.name);
        return true;
    });

    const filteredCollections = collections.filter((c) =>
        c.name.toLowerCase().includes(suggestionFilter.toLowerCase()),
    );
    const filteredShortcuts = uniqueShortcuts.filter((s) =>
        s.name.toLowerCase().includes(suggestionFilter.toLowerCase()),
    );

    const selectedParts = new Set(
        pattern
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    );

    const toggleSuggestion = (itemName: string) => {
        const parts = pattern
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (parts.includes(itemName)) {
            setPattern(parts.filter((p) => p !== itemName).join(", "));
        } else {
            setPattern([...parts, itemName].join(", "));
        }
    };

    const toggleService = (svcKey: string) => {
        if (svcKey === "all") {
            setSelectedServices(["all"]);
            return;
        }
        let next = selectedServices.filter((s) => s !== "all");
        if (next.includes(svcKey)) {
            next = next.filter((s) => s !== svcKey);
        } else {
            next.push(svcKey);
        }
        if (next.length === 0 || next.length === SERVICE_OPTIONS.length - 1) {
            setSelectedServices(["all"]);
        } else {
            setSelectedServices(next);
        }
    };

    const handleOpenAdd = () => {
        setEditingIndex(null);
        setName("");
        setSelectedServices(["all"]);
        setAction("include");
        setConditionType("collection");
        setPattern("");
        setSuggestionFilter("");
        setShowAddModal(true);
    };

    const handleOpenEdit = (idx: number) => {
        const r = rules[idx];
        if (!r) return;
        setEditingIndex(idx);
        setName(r.name || "");
        if (!r.service || r.service === "all") {
            setSelectedServices(["all"]);
        } else {
            const split = r.service
                .split(",")
                .map((s) =>
                    s.trim() === "rpcs3" ? "console_emulators" : s.trim(),
                )
                .filter(Boolean);
            setSelectedServices(split.length > 0 ? split : ["all"]);
        }
        setAction(r.action);
        setConditionType(r.conditionType);
        setPattern(r.pattern);
        setSuggestionFilter("");
        setShowAddModal(true);
    };

    const handleSaveRule = async () => {
        if (!name.trim() || !pattern.trim()) return;
        const chosenService = selectedServices.includes("all")
            ? "all"
            : selectedServices.join(",");
        const ruleData: RoutingRule = {
            id:
                editingIndex !== null && rules[editingIndex]
                    ? rules[editingIndex].id
                    : "rule_" + Date.now(),
            name: name.trim(),
            service: chosenService as ServiceTarget,
            action,
            conditionType,
            pattern: pattern.trim(),
            enabled: true,
        };

        const copy = [...rules];
        if (editingIndex !== null) {
            copy[editingIndex] = ruleData;
        } else {
            copy.push(ruleData);
        }
        setRules(copy);
        setShowAddModal(false);

        window.dispatchEvent(new CustomEvent("steam-cartridges:rule-updated"));
        triggerSync(100);
    };

    const handleDelete = (index: number) => {
        const copy = [...rules];
        copy.splice(index, 1);
        setRules(copy);
        window.dispatchEvent(new CustomEvent("steam-cartridges:rule-updated"));
        triggerSync(100);
    };

    return (
        <PanelSection title="Routing Rules">
            <ToggleRow
                label="Auto Mode"
                description="Auto fetches metadata and achievements of the enabled services"
                value={autoMode}
                onChange={(val) => {
                    setAutoMode(val);
                    window.dispatchEvent(
                        new CustomEvent("steam-cartridges:rule-updated"),
                    );
                    if (val) {
                        triggerSync(100);
                    }
                }}
            />

            {rules.length === 0 && (
                <ItemRow>
                    <div
                        style={{
                            opacity: 0.6,
                            fontSize: "12px",
                            padding: "4px 0",
                            fontStyle: "italic",
                        }}
                    >
                        No custom routing rules defined.
                    </div>
                </ItemRow>
            )}

            {/* Compact Rule Rows: Col 1 Name, Col 2 [ ✏️ ] [ 🗑️ ] */}
            {rules.map((rule, idx) => (
                <ItemRow key={rule.id}>
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "6px 10px",
                            background: "rgba(255, 255, 255, 0.03)",
                            border: "1px solid rgba(255, 255, 255, 0.06)",
                            borderRadius: "4px",
                            fontSize: "12px",
                        }}
                    >
                        <span
                            style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                marginRight: "8px",
                                fontWeight: 500,
                                color: "#e1e7ee",
                            }}
                            title={rule.name}
                        >
                            {rule.name}
                        </span>
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                flexShrink: 0,
                            }}
                        >
                            <DialogButton
                                onClick={() => handleOpenEdit(idx)}
                                style={{
                                    padding: "0 8px",
                                    minWidth: 0,
                                    width: "auto",
                                    fontSize: "12px",
                                }}
                            >
                                ✏️
                            </DialogButton>
                            <DialogButton
                                onClick={() => handleDelete(idx)}
                                style={{
                                    padding: "0 8px",
                                    minWidth: 0,
                                    width: "auto",
                                    fontSize: "12px",
                                }}
                            >
                                🗑️
                            </DialogButton>
                        </div>
                    </div>
                </ItemRow>
            ))}

            <ItemRow>
                <div
                    style={{
                        marginTop: "4px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                    }}
                >
                    <DialogButton
                        onClick={handleOpenAdd}
                        style={{
                            padding: "0 14px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        + Add Rule
                    </DialogButton>
                </div>
            </ItemRow>

            {/* Add / Edit Rule Modal */}
            <SettingsModal
                title={
                    editingIndex !== null
                        ? "Edit Routing Rule"
                        : "Add Routing Rule"
                }
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
            >
                <TextField
                    label="Rule Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Services
                    </span>
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                        }}
                    >
                        {SERVICE_OPTIONS.map((opt) => {
                            const isSel =
                                opt.data === "all"
                                    ? selectedServices.includes("all")
                                    : !selectedServices.includes("all") &&
                                      selectedServices.includes(opt.data);
                            return (
                                <button
                                    key={opt.data}
                                    type="button"
                                    onClick={() => toggleService(opt.data)}
                                    style={{
                                        background: isSel
                                            ? "rgba(102, 192, 244, 0.3)"
                                            : "rgba(255, 255, 255, 0.08)",
                                        border: isSel
                                            ? "1px solid #66c0f4"
                                            : "1px solid rgba(255, 255, 255, 0.1)",
                                        color: isSel ? "#66c0f4" : "#fff",
                                        borderRadius: "4px",
                                        padding: "3px 8px",
                                        fontSize: "11px",
                                        cursor: "pointer",
                                        fontWeight: isSel ? 600 : 400,
                                    }}
                                >
                                    {isSel ? "✓ " : ""}
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Action
                    </span>
                    <div
                        style={{
                            fontSize: "11px",
                            opacity: 0.7,
                            marginTop: "-2px",
                        }}
                    >
                        {action === "include"
                            ? "Only apply to matches"
                            : "Never apply to matches"}
                    </div>
                    <Dropdown
                        rgOptions={ACTION_OPTIONS}
                        selectedOption={action}
                        onChange={(o) => setAction(o.data as RuleAction)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Condition
                    </span>
                    <Dropdown
                        rgOptions={CONDITION_OPTIONS}
                        selectedOption={conditionType}
                        onChange={(o) =>
                            setConditionType(o.data as ConditionType)
                        }
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Pattern
                    </span>
                    <textarea
                        rows={Math.min(
                            6,
                            Math.max(2, Math.ceil((pattern.length || 1) / 36)),
                        )}
                        value={pattern}
                        onChange={(e) => setPattern(e.target.value)}
                        placeholder={
                            conditionType === "regex"
                                ? "^Mario.*"
                                : "e.g. Mario, Sonic, Zelda"
                        }
                        style={{
                            width: "100%",
                            boxSizing: "border-box",
                            background: "rgba(0, 0, 0, 0.4)",
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                            borderRadius: "4px",
                            color: "#fff",
                            padding: "6px 10px",
                            fontSize: "12px",
                            fontFamily: "inherit",
                            resize: "vertical",
                        }}
                    />
                </div>
                <div
                    style={{
                        fontSize: "11px",
                        opacity: 0.7,
                        marginTop: "-4px",
                        marginBottom: "4px",
                    }}
                >
                    {conditionType === "regex"
                        ? "Regular expression pattern matched against game titles."
                        : "Separate multiple items with commas (e.g. Mario, Sonic, Zelda)."}
                </div>

                {conditionType === "regex" && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                        }}
                    >
                        <span style={{ fontSize: "11px", opacity: 0.7 }}>
                            Regex Examples (click to apply):
                        </span>
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                                maxHeight: "130px",
                                overflowY: "auto",
                                padding: "2px 0",
                            }}
                        >
                            {REGEX_EXAMPLES.map((ex) => (
                                <button
                                    key={ex.pattern}
                                    type="button"
                                    onClick={() => setPattern(ex.pattern)}
                                    style={{
                                        background:
                                            pattern === ex.pattern
                                                ? "rgba(102, 192, 244, 0.3)"
                                                : "rgba(255, 255, 255, 0.08)",
                                        border:
                                            pattern === ex.pattern
                                                ? "1px solid #66c0f4"
                                                : "1px solid rgba(255, 255, 255, 0.1)",
                                        color:
                                            pattern === ex.pattern
                                                ? "#66c0f4"
                                                : "#fff",
                                        borderRadius: "4px",
                                        padding: "3px 8px",
                                        fontSize: "11px",
                                        cursor: "pointer",
                                        textAlign: "left",
                                    }}
                                    title={ex.desc}
                                >
                                    <code>{ex.pattern}</code>
                                    <span
                                        style={{
                                            opacity: 0.6,
                                            marginLeft: "6px",
                                            fontSize: "10px",
                                        }}
                                    >
                                        ({ex.desc})
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {(conditionType === "collection" ||
                    conditionType === "game_name") && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                        }}
                    >
                        <TextField
                            label={
                                conditionType === "collection"
                                    ? "Filter Collections"
                                    : "Filter Games"
                            }
                            value={suggestionFilter}
                            onChange={(e) =>
                                setSuggestionFilter(e.target.value)
                            }
                        />
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                                maxHeight: "130px",
                                overflowY: "auto",
                                padding: "2px 0",
                            }}
                        >
                            {conditionType === "collection" ? (
                                filteredCollections.length > 0 ? (
                                    filteredCollections.map((c) => {
                                        const isSel = selectedParts.has(c.name);
                                        return (
                                            <button
                                                key={c.id}
                                                type="button"
                                                onClick={() =>
                                                    toggleSuggestion(c.name)
                                                }
                                                style={{
                                                    background: isSel
                                                        ? "rgba(102, 192, 244, 0.3)"
                                                        : "rgba(255, 255, 255, 0.08)",
                                                    border: isSel
                                                        ? "1px solid #66c0f4"
                                                        : "1px solid rgba(255, 255, 255, 0.1)",
                                                    color: isSel
                                                        ? "#66c0f4"
                                                        : "#fff",
                                                    borderRadius: "4px",
                                                    padding: "2px 8px",
                                                    fontSize: "11px",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                {c.name}
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div
                                        style={{
                                            fontSize: "11px",
                                            opacity: 0.6,
                                            fontStyle: "italic",
                                        }}
                                    >
                                        No matching collections
                                    </div>
                                )
                            ) : filteredShortcuts.length > 0 ? (
                                filteredShortcuts.map((s) => {
                                    const isSel = selectedParts.has(s.name);
                                    return (
                                        <button
                                            key={s.appid}
                                            type="button"
                                            onClick={() =>
                                                toggleSuggestion(s.name)
                                            }
                                            style={{
                                                background: isSel
                                                    ? "rgba(102, 192, 244, 0.3)"
                                                    : "rgba(255, 255, 255, 0.08)",
                                                border: isSel
                                                    ? "1px solid #66c0f4"
                                                    : "1px solid rgba(255, 255, 255, 0.1)",
                                                color: isSel
                                                    ? "#66c0f4"
                                                    : "#fff",
                                                borderRadius: "4px",
                                                padding: "2px 8px",
                                                fontSize: "11px",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {s.name}
                                        </button>
                                    );
                                })
                            ) : (
                                <div
                                    style={{
                                        fontSize: "11px",
                                        opacity: 0.6,
                                        fontStyle: "italic",
                                    }}
                                >
                                    No matching games
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <DialogButton
                        onClick={handleSaveRule}
                        disabled={!name.trim() || !pattern.trim()}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Save Rule
                    </DialogButton>
                    <DialogButton
                        onClick={() => setShowAddModal(false)}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Cancel
                    </DialogButton>
                </div>
            </SettingsModal>
        </PanelSection>
    );
}

// ===========================================================================
// 5. {Revision} & Game Audit Center Section
// ===========================================================================

interface FlaggedShortcut {
    appid: number;
    name: string;
    missingController: boolean;
    noAchievements: boolean;
    inferred?: boolean;
    profile?: AutoRoutingProfile;
}

const CONTROLLER_OVERRIDE_OPTIONS = [
    { data: "auto", label: "Default / Auto" },
    { data: "full", label: "Full Controller Support" },
    { data: "partial", label: "Partial Controller Support" },
    { data: "none", label: "Keyboard & Mouse Only" },
];

let cachedMetadataLib: Record<string, ConsolidatedMetadata> | null = null;
let cachedAutoProfiles: Record<string, AutoRoutingProfile> | null = null;
let cachedControllerInference: Record<string, boolean> | null = null;

function RevisionSection() {
    const [controllerOverrides, setControllerOverrides] = useSetting(
        "controllerOverrides",
    );
    const [rules] = useSetting("routingRules");
    const [autoModeEnabled] = useSetting("autoRoutingMode");
    const [autoProfiles, setAutoProfiles] = useState<
        Record<string, AutoRoutingProfile>
    >(() => cachedAutoProfiles || {});
    const [metadataLib, setMetadataLib] = useState<
        Record<string, ConsolidatedMetadata>
    >(() => cachedMetadataLib || {});
    const [controllerInference, setControllerInference] = useState<
        Record<string, boolean>
    >(() => cachedControllerInference || {});
    const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
    const [filter, setFilter] = useState<
        "all" | "controller" | "achievements" | "not_scraped"
    >("all");
    const [targetAppId, setTargetAppId] = useState<number | null>(null);
    const [steamIdInput, setSteamIdInput] = useState("");
    const [fixMsg, setFixMsg] = useState("");
    const syncProgress = useSyncProgress();
    const prevSyncingRef = useRef(syncProgress.isSyncing);

    const shortcuts = getRouting().listShortcuts();
    const shortcutName = (appid: number): string => shortcuts.find((s) => s.appid === appid)?.name ?? String(appid);

    const refreshAuditData = useCallback(async () => {
        await loadControllerInference();
        try {
            const profRes = await rpc.getAutoRoutingProfiles();
            if (profRes?.profiles) {
                cachedAutoProfiles = profRes.profiles;
                setAutoProfiles(profRes.profiles);
            }
        } catch {
            // ignore
        }
        try {
            const infRes = await rpc.getControllerInference();
            if (infRes?.games) {
                cachedControllerInference = infRes.games;
                setControllerInference(infRes.games);
            }
        } catch {
            // ignore
        }
        try {
            const res = await rpc.getAllMetadata();
            if (res?.library) {
                cachedMetadataLib = res.library;
                setMetadataLib(res.library);
            }
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        refreshAuditData();
        const onRuleUpdated = () => refreshAuditData();
        window.addEventListener("steam-cartridges:rule-updated", onRuleUpdated);
        return () =>
            window.removeEventListener(
                "steam-cartridges:rule-updated",
                onRuleUpdated,
            );
    }, [refreshAuditData]);

    useEffect(() => {
        if (prevSyncingRef.current && !syncProgress.isSyncing) {
            void refreshAuditData();
        }
        prevSyncingRef.current = syncProgress.isSyncing;
    }, [syncProgress.isSyncing, refreshAuditData]);

    const collections = getRouting().listCollections();
    const collMap: Record<number, string[]> = {};
    for (const c of collections) {
        const members = getRouting().membersOf(c.id);
        if (members) {
            for (const appid of members) {
                if (!collMap[appid]) collMap[appid] = [];
                collMap[appid].push(c.name);
            }
        }
    }

    const flagged: FlaggedShortcut[] = [];
    const notScraped: {
        appid: number;
        name: string;
        profile?: AutoRoutingProfile;
    }[] = [];

    for (const sc of shortcuts) {
        const collNames = collMap[sc.appid] || [];
        const profile =
            autoProfiles[String(sc.appid)] ||
            autoProfiles[String(sc.appid >>> 0)] ||
            autoProfiles[String(sc.appid | 0)];

        // Check if excluded by routing rules or auto mode
        const isAllowed = isServiceAllowed(
            "all",
            sc.appid,
            sc.name,
            collNames,
            rules,
            autoModeEnabled,
            profile,
        );
        if (!isAllowed) {
            continue; // Excluded by rule / auto mode: do not count in issues or not-scraped
        }

        const meta =
            metadataLib[String(sc.appid)] ||
            metadataLib[String(sc.appid >>> 0)] ||
            metadataLib[String(sc.appid | 0)];
        const { getLocalAchievements } = getAchievementsSource();
        const achievements =
            getLocalAchievements(sc.appid) ||
            getLocalAchievements(sc.appid >>> 0) ||
            getLocalAchievements(sc.appid | 0);
        const isScraped = !!meta || (achievements && achievements.nTotal > 0);

        if (!isScraped) {
            notScraped.push({ appid: sc.appid, name: sc.name, profile });
            continue; // Do NOT count unscraped games as issues!
        }

        const override =
            controllerOverrides[String(sc.appid)] ||
            controllerOverrides[String(sc.appid >>> 0)] ||
            controllerOverrides[String(sc.appid | 0)];
        const inferred =
            controllerInference[String(sc.appid)] ??
            controllerInference[String(sc.appid >>> 0)] ??
            controllerInference[String(sc.appid | 0)] ??
            (profile?.category === "retroarch" ||
            profile?.category === "console_emulator"
                ? true
                : undefined) ??
            getInferredControllerSupport(sc.appid);
        const hasControllerSupport =
            override === "full" ||
            override === "partial" ||
            (override !== "none" && inferred === true) ||
            meta?.categories?.full_controller === true ||
            meta?.categories?.partial_controller === true;
        const missingController =
            !hasControllerSupport && (!override || override === "auto");

        // Actionable issues: unknown controller input
        if (missingController) {
            flagged.push({
                appid: sc.appid,
                name: sc.name,
                missingController,
                noAchievements: false,
                inferred,
                profile,
            });
        }
    }

    const filteredIssues = flagged.filter((f) => {
        if (filter === "controller") return f.missingController;
        return true;
    });

    const handleSetController = (appid: number, val: ControllerOverride) => {
        setControllerOverrides({
            ...controllerOverrides,
            [String(appid)]: val,
        });
        setFixMsg(`Updated controller support for ${shortcutName(appid)}`);
        setTimeout(() => setFixMsg(""), 2500);
    };

    const handleLinkSteamApp = async (
        shortcutAppId: number,
        steamAppId: number,
    ) => {
        setFixMsg("Linking to Steam Store...");
        const res = await rpc.steamStoreSetMapping(shortcutAppId, steamAppId);
        if (res.mapping) {
            setFixMsg("Mapped successfully!");
            setTimeout(() => setFixMsg(""), 2500);
        } else {
            setFixMsg(res.error || "Failed to map Steam App");
        }
    };

    const handleScanSingle = async (appid: number, name: string) => {
        setFixMsg(`Scanning ${name}...`);
        await rpc.refreshGameMetadata(appid, name).catch(() => {});
        await rpc.cartridgesAchievementsGet(appid, 0).catch(() => {});
        await refreshAuditData();
        setFixMsg(`Scanned ${name}`);
        setTimeout(() => setFixMsg(""), 2000);
    };

    return (
        <div
            style={{
                display:
                    syncProgress.isSyncing && !isAuditModalOpen
                        ? "none"
                        : "block",
            }}
        >
            <PanelSection title="Library Audit">
                {/* 3-Row Layout matching theme */}
                <ItemRow>
                    <Field
                        label="Not scraped:"
                        description="Games awaiting initial metadata & achievement fetch"
                        bottomSeparator="none"
                    >
                        <span
                            style={{
                                color:
                                    notScraped.length > 0 ? "#66c0f4" : "#8ba5b7",
                                fontWeight: 700,
                                fontSize: "14px",
                            }}
                        >
                            {notScraped.length}
                        </span>
                    </Field>
                </ItemRow>
                <ItemRow>
                    <Field
                        label="Issues detected:"
                        description="Number of games that require complete information"
                        bottomSeparator="none"
                    >
                        <span
                            style={{
                                color: flagged.length > 0 ? "#e5a00d" : "#a4d007",
                                fontWeight: 700,
                                fontSize: "14px",
                            }}
                        >
                            {flagged.length}
                        </span>
                    </Field>
                </ItemRow>
                <ItemRow>
                    <div style={{ marginTop: "4px" }}>
                        <DialogButton
                            onClick={() => setIsAuditModalOpen(true)}
                            style={{
                                padding: "0 14px",
                                minWidth: 0,
                                width: "auto",
                            }}
                        >
                            Review
                        </DialogButton>
                    </div>
                </ItemRow>
                {fixMsg && !isAuditModalOpen && (
                    <ItemRow>
                        <div
                            style={{
                                color: "#66c0f4",
                                fontSize: "12px",
                                padding: "2px 0",
                            }}
                        >
                            {fixMsg}
                        </div>
                    </ItemRow>
                )}

                {/* Audit & Fix Modal */}
                <SettingsModal
                    title={`Library Audit (${flagged.length} issue${flagged.length === 1 ? "" : "s"}, ${notScraped.length} unscraped)`}
                    isOpen={isAuditModalOpen}
                    onClose={() => setIsAuditModalOpen(false)}
                    width="620px"
                    maxHeight="85vh"
                >
                    {/* Filter Tabs */}
                    <div
                        style={{
                            display: "flex",
                            gap: "6px",
                            flexWrap: "wrap",
                            marginBottom: "12px",
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setFilter("all")}
                            style={{
                                background:
                                    filter === "all"
                                        ? "rgba(102, 192, 244, 0.25)"
                                        : "rgba(0, 0, 0, 0.25)",
                                border:
                                    filter === "all"
                                        ? "1px solid #66c0f4"
                                        : "none",
                                color: filter === "all" ? "#66c0f4" : "#fff",
                                borderRadius: "4px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                cursor: "pointer",
                            }}
                        >
                            Issues ({flagged.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter("controller")}
                            style={{
                                background:
                                    filter === "controller"
                                        ? "rgba(102, 192, 244, 0.25)"
                                        : "rgba(0, 0, 0, 0.25)",
                                border:
                                    filter === "controller"
                                        ? "1px solid #66c0f4"
                                        : "none",
                                color: filter === "controller" ? "#66c0f4" : "#fff",
                                borderRadius: "4px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                cursor: "pointer",
                            }}
                        >
                            Unknown Input (
                            {flagged.filter((f) => f.missingController).length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter("not_scraped")}
                            style={{
                                background:
                                    filter === "not_scraped"
                                        ? "rgba(102, 192, 244, 0.25)"
                                        : "rgba(0, 0, 0, 0.25)",
                                border:
                                    filter === "not_scraped"
                                        ? "1px solid #66c0f4"
                                        : "none",
                                color:
                                    filter === "not_scraped" ? "#66c0f4" : "#fff",
                                borderRadius: "4px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                cursor: "pointer",
                            }}
                        >
                            Not Scraped ({notScraped.length})
                        </button>
                    </div>

                    {filter === "not_scraped" && (
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "4px 0",
                                marginBottom: "8px",
                            }}
                        >
                            <span style={{ fontSize: "11px", opacity: 0.7 }}>
                                {notScraped.length} game(s) awaiting initial
                                scraping (automatically scraped in the background).
                            </span>
                        </div>
                    )}

                {fixMsg && (
                    <div
                        style={{
                            color: "#66c0f4",
                            fontSize: "12px",
                            padding: "2px 0",
                        }}
                    >
                        {fixMsg}
                    </div>
                )}

                {/* Filtered Items */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        maxHeight: "55vh",
                        overflowY: "auto",
                    }}
                >
                    {filter === "not_scraped" ? (
                        notScraped.length === 0 ? (
                            <div
                                style={{
                                    fontSize: "12px",
                                    opacity: 0.6,
                                    padding: "8px 0",
                                    fontStyle: "italic",
                                }}
                            >
                                All games in your library have been scraped.
                            </div>
                        ) : (
                            notScraped.map((item) => (
                                <div
                                    key={item.appid}
                                    style={{
                                        background: "rgba(255, 255, 255, 0.03)",
                                        border: "1px solid rgba(255, 255, 255, 0.06)",
                                        borderRadius: "4px",
                                        padding: "8px 10px",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                    }}
                                >
                                    <div>
                                        <span
                                            style={{
                                                fontWeight: 600,
                                                fontSize: "13px",
                                            }}
                                        >
                                            {item.name}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: "11px",
                                                opacity: 0.6,
                                                marginLeft: "6px",
                                            }}
                                        >
                                            ({item.appid})
                                        </span>
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            gap: "6px",
                                            alignItems: "center",
                                        }}
                                    >
                                        {item.profile && (
                                            <span
                                                style={{
                                                    background:
                                                        item.profile
                                                            .category ===
                                                        "retroarch"
                                                            ? "rgba(102, 192, 244, 0.15)"
                                                            : item.profile
                                                                    .category ===
                                                                "console_emulator"
                                                              ? "rgba(163, 112, 247, 0.15)"
                                                              : "rgba(255, 255, 255, 0.08)",
                                                    color:
                                                        item.profile
                                                            .category ===
                                                        "retroarch"
                                                            ? "#66c0f4"
                                                            : item.profile
                                                                    .category ===
                                                                "console_emulator"
                                                              ? "#a370f7"
                                                              : "#bbb",
                                                    fontSize: "10px",
                                                    padding: "1px 5px",
                                                    borderRadius: "3px",
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {item.profile.category ===
                                                "retroarch"
                                                    ? "Retro"
                                                    : item.profile.category ===
                                                        "console_emulator"
                                                      ? item.profile.program ||
                                                        "Emulator"
                                                      : "PC"}
                                            </span>
                                        )}
                                        <span
                                            style={{
                                                background:
                                                    "rgba(102, 192, 244, 0.2)",
                                                color: "#66c0f4",
                                                fontSize: "10px",
                                                padding: "1px 5px",
                                                borderRadius: "3px",
                                                fontWeight: 600,
                                            }}
                                        >
                                            Not Scraped
                                        </span>
                                        <DialogButton
                                            onClick={() =>
                                                handleScanSingle(
                                                    item.appid,
                                                    item.name,
                                                )
                                            }
                                            style={{
                                                padding: "0 8px",
                                                minWidth: 0,
                                                width: "auto",
                                                fontSize: "11px",
                                            }}
                                        >
                                            Scrape
                                        </DialogButton>
                                    </div>
                                </div>
                            ))
                        )
                    ) : filteredIssues.length === 0 ? (
                        <div
                            style={{
                                fontSize: "12px",
                                opacity: 0.6,
                                padding: "8px 0",
                                fontStyle: "italic",
                            }}
                        >
                            No issues detected for this filter.
                        </div>
                    ) : (
                        filteredIssues.map((item) => {
                            const currentOverride =
                                controllerOverrides[String(item.appid)] ||
                                "auto";
                            return (
                                <div
                                    key={item.appid}
                                    style={{
                                        background: "rgba(255, 255, 255, 0.03)",
                                        border: "1px solid rgba(255, 255, 255, 0.06)",
                                        borderRadius: "4px",
                                        padding: "8px 10px",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                        }}
                                    >
                                        <div>
                                            <span
                                                style={{
                                                    fontWeight: 600,
                                                    fontSize: "13px",
                                                }}
                                            >
                                                {item.name}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: "11px",
                                                    opacity: 0.6,
                                                    marginLeft: "6px",
                                                }}
                                            >
                                                ({item.appid})
                                            </span>
                                        </div>
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: "4px",
                                                alignItems: "center",
                                            }}
                                        >
                                            {item.profile && (
                                                <span
                                                    style={{
                                                        background:
                                                            item.profile
                                                                .category ===
                                                            "retroarch"
                                                                ? "rgba(102, 192, 244, 0.15)"
                                                                : item.profile
                                                                        .category ===
                                                                    "console_emulator"
                                                                  ? "rgba(163, 112, 247, 0.15)"
                                                                  : "rgba(255, 255, 255, 0.08)",
                                                        color:
                                                            item.profile
                                                                .category ===
                                                            "retroarch"
                                                                ? "#66c0f4"
                                                                : item.profile
                                                                        .category ===
                                                                    "console_emulator"
                                                                  ? "#a370f7"
                                                                  : "#bbb",
                                                        fontSize: "10px",
                                                        padding: "1px 5px",
                                                        borderRadius: "3px",
                                                        fontWeight: 600,
                                                    }}
                                                >
                                                    {item.profile.category ===
                                                    "retroarch"
                                                        ? "Retro"
                                                        : item.profile
                                                                .category ===
                                                            "console_emulator"
                                                          ? item.profile
                                                                .program ||
                                                            "Emulator"
                                                          : "PC"}
                                                </span>
                                            )}
                                            {item.missingController && (
                                                <span
                                                    style={{
                                                        background: "#e5a00d",
                                                        color: "#000",
                                                        fontSize: "10px",
                                                        padding: "1px 5px",
                                                        borderRadius: "3px",
                                                        fontWeight: 600,
                                                    }}
                                                >
                                                    Missing Input
                                                </span>
                                            )}
                                            {item.noAchievements && (
                                                <span
                                                    style={{
                                                        background:
                                                            "rgba(255, 255, 255, 0.1)",
                                                        color: "#aaa",
                                                        fontSize: "10px",
                                                        padding: "1px 5px",
                                                        borderRadius: "3px",
                                                    }}
                                                >
                                                    No Achievements
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            gap: "12px",
                                            marginTop: "6px",
                                            alignItems: "center",
                                            flexWrap: "wrap",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontSize: "11px",
                                                    opacity: 0.75,
                                                }}
                                            >
                                                Input:
                                            </span>
                                            <Dropdown
                                                rgOptions={
                                                    CONTROLLER_OVERRIDE_OPTIONS
                                                }
                                                selectedOption={currentOverride}
                                                onChange={(o) =>
                                                    handleSetController(
                                                        item.appid,
                                                        o.data as ControllerOverride,
                                                    )
                                                }
                                                contextMenuPositionOptions={{
                                                    bMatchWidth: true,
                                                }}
                                            />
                                            {item.inferred === true && (
                                                <span
                                                    style={{
                                                        fontSize: "11px",
                                                        color: "#66c0f4",
                                                        marginLeft: "4px",
                                                    }}
                                                >
                                                    (Detected: Full Controller)
                                                </span>
                                            )}
                                            {item.inferred === false && (
                                                <span
                                                    style={{
                                                        fontSize: "11px",
                                                        color: "#8ba5b7",
                                                        marginLeft: "4px",
                                                    }}
                                                >
                                                    (Detected: K&M)
                                                </span>
                                            )}
                                        </div>

                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontSize: "11px",
                                                    opacity: 0.75,
                                                }}
                                            >
                                                Link Steam AppID:
                                            </span>
                                            <input
                                                type="text"
                                                placeholder="e.g. 2820820"
                                                value={
                                                    targetAppId === item.appid
                                                        ? steamIdInput
                                                        : ""
                                                }
                                                onChange={(e) => {
                                                    setTargetAppId(item.appid);
                                                    setSteamIdInput(
                                                        e.target.value,
                                                    );
                                                }}
                                                style={{
                                                    background:
                                                        "rgba(0, 0, 0, 0.4)",
                                                    border: "1px solid rgba(255, 255, 255, 0.15)",
                                                    color: "#fff",
                                                    borderRadius: "3px",
                                                    padding: "3px 6px",
                                                    fontSize: "11px",
                                                    width: "90px",
                                                }}
                                            />
                                            <DialogButton
                                                onClick={() => {
                                                    const num = parseInt(
                                                        steamIdInput,
                                                        10,
                                                    );
                                                    if (num > 0)
                                                        handleLinkSteamApp(
                                                            item.appid,
                                                            num,
                                                        );
                                                }}
                                                style={{
                                                    padding: "0 8px",
                                                    minWidth: 0,
                                                    width: "auto",
                                                    fontSize: "11px",
                                                }}
                                            >
                                                Link
                                            </DialogButton>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: "8px",
                    }}
                >
                    <DialogButton
                        onClick={() => setIsAuditModalOpen(false)}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Done
                    </DialogButton>
                </div>
            </SettingsModal>
        </PanelSection>
        </div>
    );
}

// ===========================================================================
// Main SettingsPanel Export
// ===========================================================================

function SyncProgressBar() {
    const progress = useSyncProgress();

    if (!progress.isSyncing && progress.phase !== "complete") {
        return null;
    }

    const percent = Math.min(
        100,
        Math.round((progress.current / Math.max(1, progress.total)) * 100),
    );

    return (
        <div
            style={{
                position: "sticky",
                bottom: 0,
                left: 0,
                right: 0,
                background:
                    progress.phase === "complete"
                        ? "rgba(16, 34, 24, 0.96)"
                        : "rgba(16, 24, 34, 0.96)",
                backdropFilter: "blur(8px)",
                borderTop:
                    progress.phase === "complete"
                        ? "1px solid rgba(164, 208, 7, 0.4)"
                        : "1px solid rgba(102, 192, 244, 0.3)",
                padding: "10px 14px",
                zIndex: 100,
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                marginTop: "16px",
                borderRadius: "4px",
                boxShadow: "0 -4px 16px rgba(0, 0, 0, 0.4)",
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                }}
            >
                <span
                    style={{
                        fontWeight: 600,
                        fontSize: "12px",
                        color:
                            progress.phase === "complete"
                                ? "#a4d007"
                                : "#66c0f4",
                    }}
                >
                    {progress.phase === "complete"
                        ? `✓ Scrape & mirror complete (${progress.total} games)`
                        : `🔄 Scraping & Mirroring: ${progress.current} / ${progress.total} games (${percent}%)`}
                </span>
                {progress.isSyncing && progress.currentGame ? (
                    <span
                        style={{
                            color: "#8ba5b7",
                            fontSize: "11px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {progress.currentGame}
                    </span>
                ) : null}
            </div>
            {progress.isSyncing && (
                <div
                    style={{
                        width: "100%",
                        height: "6px",
                        background: "rgba(255, 255, 255, 0.1)",
                        borderRadius: "3px",
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            width: `${percent}%`,
                            height: "100%",
                            background:
                                "linear-gradient(90deg, #1a9fff, #66c0f4)",
                            transition: "width 0.25s ease-out",
                        }}
                    />
                </div>
            )}
        </div>
    );
}

export function SettingsPanel() {
    const [, tick] = useState(0);

    // Periodic refresh so live collections and shortcuts remain synced
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 3000);
        return () => clearInterval(t);
    }, []);

    return (
        <div style={{ paddingBottom: "70px", position: "relative" }}>
            <MetadataSection />
            <AchievementsSection />
            <NotificationsSection />
            <ActivitySection />
            <CommunitySection />
            <RulesSection />
            <RevisionSection />
            <SyncProgressBar />
        </div>
    );
}
