import { useEffect, useState } from "react";
import {
    DialogButton,
    Dropdown,
    Field,
    PanelSection,
    PanelSectionRow,
    TextField,
    Toggle as SteamToggle,
} from "@steambrew/client";
import { useSetting, type ControllerOverride } from "./settings";
import { rpc, type ProviderStatus, type RetroStatusResponse } from "../rpc";
import {
    listCollections,
    listShortcuts,
    shortcutName,
} from "../features/buckets";
import {
    type RoutingRule,
    type ServiceTarget,
    type RuleAction,
    type ConditionType,
} from "../features/buckets/resolve";
import { getLocalAchievements } from "../features/achievements";
import { getInferredControllerSupport } from "../features/game-info/controller";

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

interface MetadataServiceDef {
    id: "steam_store" | "screenscraper" | "igdb";
    label: string;
}

const ALL_METADATA_SERVICES: MetadataServiceDef[] = [
    { id: "steam_store", label: "Steam Store Mirror" },
    { id: "screenscraper", label: "ScreenScraper" },
    { id: "igdb", label: "IGDB" },
];

function MetadataSection() {
    const [services, setServices] = useSetting("services");
    const [status, setStatus] = useState<ProviderStatus | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);

    // Form inputs in modal
    const [selectedService, setSelectedService] = useState<
        "steam_store" | "screenscraper" | "igdb"
    >("steam_store");
    const [ssUser, setSsUser] = useState("");
    const [ssPass, setSsPass] = useState("");
    const [ssDevUser, setSsDevUser] = useState("");
    const [ssDevPw, setSsDevPw] = useState("");
    const [igdbId, setIgdbId] = useState("");
    const [igdbSecret, setIgdbSecret] = useState("");

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
    const [steamStoreService, ssService, igdbService] = ALL_METADATA_SERVICES;
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

    const availableToAdd = ALL_METADATA_SERVICES.filter(
        (s) => !activeServices.some((active) => active.id === s.id),
    );

    const handleRemoveService = (
        id: "steam_store" | "screenscraper" | "igdb",
    ) => {
        if (id === "steam_store") {
            setServices({ ...services, steamStoreEnabled: false });
        } else if (id === "screenscraper") {
            setServices({ ...services, screenscraperEnabled: false });
        } else if (id === "igdb") {
            setServices({ ...services, igdbEnabled: false });
        }
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
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#e1e7ee", fontWeight: 600 }}>
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
    id: "steam_store" | "retroachievements" | "rpcs3";
    label: string;
}

const ALL_ACHIEVEMENT_SOURCES: AchievementSourceDef[] = [
    { id: "steam_store", label: "Steam Store Mirror & PC Saves" },
    { id: "retroachievements", label: "RetroAchievements" },
    { id: "rpcs3", label: "Console Emulators & RPCS3" },
];

function AchievementsSection() {
    const [services, setServices] = useSetting("services");
    const [retroStatus, setRetroStatus] = useState<RetroStatusResponse | null>(
        null,
    );

    const [showAddModal, setShowAddModal] = useState(false);
    const [showEmuModal, setShowEmuModal] = useState(false);
    const [sourceToRegister, setSourceToRegister] = useState<
        "steam_store" | "retroachievements" | "rpcs3"
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
    const [steamStoreSrc, raSrc, rpcs3Src] = ALL_ACHIEVEMENT_SOURCES;
    if (steamStoreSrc && services.steamStoreEnabled !== false) {
        activeSources.push(steamStoreSrc);
    }
    if (raSrc && services.retroachievementsEnabled !== false && activeRaUser) {
        activeSources.push(raSrc);
    }
    if (rpcs3Src && services.rpcs3Enabled !== false) {
        activeSources.push(rpcs3Src);
    }

    const availableToAdd = ALL_ACHIEVEMENT_SOURCES.filter(
        (s) => !activeSources.some((active) => active.id === s.id),
    );

    const handleRemoveSource = (
        id: "steam_store" | "retroachievements" | "rpcs3",
    ) => {
        if (id === "steam_store") {
            setServices({ ...services, steamStoreEnabled: false });
        } else if (id === "retroachievements") {
            setServices({ ...services, retroachievementsEnabled: false });
        } else if (id === "rpcs3") {
            setServices({ ...services, rpcs3Enabled: false });
        }
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
            setRaMsg("✓ Steam Store & PC saves enabled!");
            setTimeout(() => {
                setShowAddModal(false);
                setIsSavingRa(false);
                setRaMsg("");
            }, 1000);
            return;
        }

        if (sourceToRegister === "rpcs3") {
            setServices({ ...services, rpcs3Enabled: true });
            setRaMsg("✓ Console Emulators & RPCS3 enabled!");
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
                            {src.id === "rpcs3" && (
                                <DialogButton
                                    onClick={() => setShowEmuModal(true)}
                                    style={{
                                        padding: "0 10px",
                                        minWidth: 0,
                                        width: "auto",
                                        fontSize: "11px",
                                    }}
                                >
                                    Status
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
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#e1e7ee", fontWeight: 600 }}>
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

                {sourceToRegister === "rpcs3" && (
                    <div style={{ fontSize: "12px", opacity: 0.8 }}>
                        Parses offline PS3 TROPCONF/TROPUSR trophies and tails
                        DuckStation, PCSX2, Dolphin, PPSSPP, and RPCS3 emulator
                        logs.
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
    { data: "all_runs", label: "All game runs (default)" },
    { data: "first_run", label: "First run only" },
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
// 4. {Rules} Routing Engine Section
// ===========================================================================

const SERVICE_OPTIONS = [
    { data: "all", label: "All Services" },
    { data: "steam-store", label: "Steam Store Mirror" },
    { data: "retroachievements", label: "RetroAchievements" },
    { data: "screenscraper", label: "ScreenScraper" },
    { data: "igdb", label: "IGDB / Web Metadata" },
    { data: "rpcs3", label: "RPCS3 Local Trophies" },
    { data: "none", label: "None (Disable Fetching)" },
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

function RulesSection() {
    const [rules, setRules] = useSetting("routingRules");
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    // Rule builder state
    const [name, setName] = useState("");
    const [service, setService] = useState<ServiceTarget>("all");
    const [action, setAction] = useState<RuleAction>("include");
    const [conditionType, setConditionType] =
        useState<ConditionType>("collection");
    const [pattern, setPattern] = useState("");
    const [suggestionFilter, setSuggestionFilter] = useState("");

    // Collections & Shortcuts for suggestions
    const collections = listCollections();
    const shortcuts = listShortcuts();
    const seenShortcutNames = new Set<string>();
    const uniqueShortcuts = shortcuts.filter((s) => {
        if (!s.name || seenShortcutNames.has(s.name)) return false;
        seenShortcutNames.add(s.name);
        return true;
    });

    const filteredCollections = collections.filter((c) =>
        c.name.toLowerCase().includes(suggestionFilter.toLowerCase())
    );
    const filteredShortcuts = uniqueShortcuts.filter((s) =>
        s.name.toLowerCase().includes(suggestionFilter.toLowerCase())
    );

    const selectedParts = new Set(
        pattern
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
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

    const handleOpenAdd = () => {
        setEditingIndex(null);
        setName("");
        setService("all");
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
        setService(r.service);
        setAction(r.action);
        setConditionType(r.conditionType);
        setPattern(r.pattern);
        setSuggestionFilter("");
        setShowAddModal(true);
    };

    const handleSaveRule = () => {
        if (!name.trim() || !pattern.trim()) return;
        const ruleData: RoutingRule = {
            id:
                editingIndex !== null && rules[editingIndex]
                    ? rules[editingIndex].id
                    : "rule_" + Date.now(),
            name: name.trim(),
            service,
            action,
            conditionType,
            pattern: pattern.trim(),
            enabled: true,
        };

        if (editingIndex !== null) {
            const copy = [...rules];
            copy[editingIndex] = ruleData;
            setRules(copy);
        } else {
            setRules([...rules, ruleData]);
        }
        setShowAddModal(false);
    };

    const handleDelete = (index: number) => {
        const copy = [...rules];
        copy.splice(index, 1);
        setRules(copy);
    };

    return (
        <PanelSection title="Routing Rules">
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
                        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
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
                <div style={{ marginTop: "4px" }}>
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
                title={editingIndex !== null ? "Edit Routing Rule" : "Add Routing Rule"}
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
            >
                <TextField
                    label="Rule Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#e1e7ee", fontWeight: 600 }}>
                        Service
                    </span>
                    <Dropdown
                        rgOptions={SERVICE_OPTIONS}
                        selectedOption={service}
                        onChange={(o) => setService(o.data as ServiceTarget)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#e1e7ee", fontWeight: 600 }}>
                        Action
                    </span>
                    <div style={{ fontSize: "11px", opacity: 0.7, marginTop: "-2px" }}>
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

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#e1e7ee", fontWeight: 600 }}>
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

                <TextField
                    label="Pattern"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                />
                <div
                    style={{
                        fontSize: "11px",
                        opacity: 0.7,
                        marginTop: "-4px",
                        marginBottom: "4px",
                    }}
                >
                    Separate multiple items with commas (e.g. Mario, Sonic, Zelda).
                </div>

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
                            onChange={(e) => setSuggestionFilter(e.target.value)}
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
                                                onClick={() => toggleSuggestion(c.name)}
                                                style={{
                                                    background: isSel
                                                        ? "rgba(102, 192, 244, 0.3)"
                                                        : "rgba(255, 255, 255, 0.08)",
                                                    border: isSel
                                                        ? "1px solid #66c0f4"
                                                        : "1px solid rgba(255, 255, 255, 0.1)",
                                                    color: isSel ? "#66c0f4" : "#fff",
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
                                            onClick={() => toggleSuggestion(s.name)}
                                            style={{
                                                background: isSel
                                                    ? "rgba(102, 192, 244, 0.3)"
                                                    : "rgba(255, 255, 255, 0.08)",
                                                border: isSel
                                                    ? "1px solid #66c0f4"
                                                    : "1px solid rgba(255, 255, 255, 0.1)",
                                                color: isSel ? "#66c0f4" : "#fff",
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
}

const CONTROLLER_OVERRIDE_OPTIONS = [
    { data: "auto", label: "Default / Auto" },
    { data: "full", label: "Full Controller Support" },
    { data: "partial", label: "Partial Controller Support" },
    { data: "none", label: "Keyboard & Mouse Only" },
];

function RevisionSection() {
    const [controllerOverrides, setControllerOverrides] = useSetting(
        "controllerOverrides",
    );
    const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
    const [filter, setFilter] = useState<"all" | "controller" | "achievements">(
        "all",
    );
    const [targetAppId, setTargetAppId] = useState<number | null>(null);
    const [steamIdInput, setSteamIdInput] = useState("");
    const [fixMsg, setFixMsg] = useState("");

    const shortcuts = listShortcuts();

    // Inspect each shortcut for missing info
    const flagged: FlaggedShortcut[] = [];
    for (const sc of shortcuts) {
        const override = controllerOverrides[String(sc.appid)];
        const achievements = getLocalAchievements(sc.appid);
        const inferred = getInferredControllerSupport(sc.appid);

        const hasWeirdName = /\[.*?\]|\(.*?\)/.test(sc.name);
        // Only mark missing controller if user hasn't explicitly set full/none/partial AND emulator hasn't inferred support
        const missingController = (!override || override === "auto") && inferred !== true;
        const noAchievements = !achievements || achievements.nTotal === 0;

        if (missingController || hasWeirdName || noAchievements) {
            flagged.push({
                appid: sc.appid,
                name: sc.name,
                missingController,
                noAchievements,
            });
        }
    }

    const filtered = flagged.filter((f) => {
        if (filter === "controller") return f.missingController;
        if (filter === "achievements") return f.noAchievements;
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

    return (
        <PanelSection title="Library Audit">
            {/* 3-Row Layout matching theme */}
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
                <Field childrenContainerWidth="max">
                    <DialogButton
                        onClick={() => setIsAuditModalOpen(true)}
                        style={{
                            width: "100%",
                        }}
                    >
                        Review
                    </DialogButton>
                </Field>
            </ItemRow>

            {/* Audit & Fix Modal */}
            <SettingsModal
                title={`Library Audit (${flagged.length} issues)`}
                isOpen={isAuditModalOpen}
                onClose={() => setIsAuditModalOpen(false)}
                width="620px"
                maxHeight="85vh"
            >
                {/* Filter Tabs */}
                <div style={{ display: "flex", gap: "6px" }}>
                    <button
                        type="button"
                        onClick={() => setFilter("all")}
                        style={{
                            background:
                                filter === "all"
                                    ? "rgba(255, 255, 255, 0.15)"
                                    : "rgba(0, 0, 0, 0.25)",
                            border: "none",
                            color: "#fff",
                            borderRadius: "4px",
                            padding: "4px 10px",
                            fontSize: "12px",
                            cursor: "pointer",
                        }}
                    >
                        All ({flagged.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter("controller")}
                        style={{
                            background:
                                filter === "controller"
                                    ? "rgba(255, 255, 255, 0.15)"
                                    : "rgba(0, 0, 0, 0.25)",
                            border: "none",
                            color: "#fff",
                            borderRadius: "4px",
                            padding: "4px 10px",
                            fontSize: "12px",
                            cursor: "pointer",
                        }}
                    >
                        Unknown Input
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter("achievements")}
                        style={{
                            background:
                                filter === "achievements"
                                    ? "rgba(255, 255, 255, 0.15)"
                                    : "rgba(0, 0, 0, 0.25)",
                            border: "none",
                            color: "#fff",
                            borderRadius: "4px",
                            padding: "4px 10px",
                            fontSize: "12px",
                            cursor: "pointer",
                        }}
                    >
                        No Achievements
                    </button>
                </div>

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
                    {filtered.map((item) => {
                        const currentOverride =
                            controllerOverrides[String(item.appid)] || "auto";
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
                                        style={{ display: "flex", gap: "4px" }}
                                    >
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
                                                setSteamIdInput(e.target.value);
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
                    })}
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
    );
}

// ===========================================================================
// Main SettingsPanel Export
// ===========================================================================

export function SettingsPanel() {
    const [, tick] = useState(0);

    // Periodic refresh so live collections and shortcuts remain synced
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 3000);
        return () => clearInterval(t);
    }, []);

    return (
        <>
            <MetadataSection />
            <AchievementsSection />
            <NotificationsSection />
            <ActivitySection />
            <RulesSection />
            <RevisionSection />
        </>
    );
}
