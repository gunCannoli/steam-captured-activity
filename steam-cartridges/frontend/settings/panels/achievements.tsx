// Settings: Achievement sources (migration plan M8c, moved verbatim).
import { useEffect, useState } from "react";
import { DialogButton, Dropdown, Field, PanelSection, TextField } from "@steambrew/client";
import { useSetting } from "../settings";
import { backend, type RetroStatusResponse } from "../../ports/backend";
import { usePanelContext } from "../context";
import { ItemRow, SettingsModal } from "../components";

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

export function AchievementsSection() {
    const ctx = usePanelContext();
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
        backend.getRetroStatus()
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
        ctx.ingest.trigger(250);
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
            ctx.ingest.trigger(250);
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
            ctx.ingest.trigger(250);
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
            const res = await backend.saveServiceCredentials({
                retroachievements_user: raUser.trim(),
                retroachievements_api: raToken.trim(),
            });
            if (res.success) {
                setServices({ ...services, retroachievementsEnabled: true });
                ctx.ingest.trigger(250);
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
