// Settings: Library Audit (migration plan M8c; reads the app through the panel context and the backend port).
import { useCallback, useEffect, useRef, useState } from "react";
import { DialogButton, Dropdown, Field, PanelSection } from "@steambrew/client";
import {
    onSettingChange,
    setSetting,
    useSetting,
    type ControllerOverride,
} from "../settings";
import { backend } from "../../ports/backend";
import type { AutoRoutingProfile } from "../../domain/routing/policy";
import { type GameMetadata } from "../../kernel/record";
import { lookupStored } from "../../kernel/appid";
import { usePanelContext } from "../context";
import {
    Blocks,
    ButtonRow,
    FullWidthRows,
    ItemRow,
    SettingsModal,
} from "../components";
import { GameDataEditor } from "../game-editor/modal";
import { useSyncProgress } from "../sync-progress";

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
    { data: "none", label: "Keyboard & Mouse" },
];

let cachedMetadataLib: Record<string, GameMetadata> | null = null;
let cachedAutoProfiles: Record<string, AutoRoutingProfile> | null = null;
let cachedControllerInference: Record<string, boolean> | null = null;

export function RevisionSection() {
    const ctx = usePanelContext();
    const [controllerOverrides] = useSetting("controllerOverrides");
    // Re-render when the rules or Auto Mode change (ctx.routing.serviceAllowed reads them).
    useSetting("routingRules");
    useSetting("autoRoutingMode");
    const [autoProfiles, setAutoProfiles] = useState<
        Record<string, AutoRoutingProfile>
    >(() => cachedAutoProfiles || {});
    const [metadataLib, setMetadataLib] = useState<
        Record<string, GameMetadata>
    >(() => cachedMetadataLib || {});
    const [controllerInference, setControllerInference] = useState<
        Record<string, boolean>
    >(() => cachedControllerInference || {});
    const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
    const [isGameDataOpen, setIsGameDataOpen] = useState(false);
    const [filter, setFilter] = useState<
        "all" | "controller" | "achievements" | "not_scraped"
    >("all");
    const [targetAppId, setTargetAppId] = useState<number | null>(null);
    const [steamIdInput, setSteamIdInput] = useState("");
    const [fixMsg, setFixMsg] = useState("");
    const syncProgress = useSyncProgress();
    const prevSyncingRef = useRef(syncProgress.isSyncing);

    const shortcuts = ctx.routing.listShortcuts();
    const shortcutName = (appid: number): string =>
        shortcuts.find((s) => s.appid === appid)?.name ?? String(appid);

    const refreshAuditData = useCallback(async () => {
        await ctx.controller.load();
        try {
            await ctx.routing.reloadProfiles();
            const profiles: Record<string, AutoRoutingProfile> = {};
            const inference: Record<string, boolean> = {};
            for (const sc of ctx.routing.listShortcuts()) {
                const profile = ctx.routing.getAutoRoutingProfile(sc.appid);
                if (profile) profiles[String(sc.appid)] = profile;
                const inferred = ctx.controller.inferredFor(sc.appid);
                if (typeof inferred === "boolean")
                    inference[String(sc.appid)] = inferred;
            }
            cachedAutoProfiles = profiles;
            setAutoProfiles(profiles);
            cachedControllerInference = inference;
            setControllerInference(inference);
        } catch {
            // ignore
        }
        try {
            const res = await backend.getAllRecords();
            const library: Record<string, GameMetadata> = {};
            for (const [key, recordParts] of Object.entries(
                res?.records ?? {},
            )) {
                const data = recordParts?.metadata?.data as
                    | GameMetadata
                    | undefined;
                if (data) library[key] = data;
            }
            cachedMetadataLib = library;
            setMetadataLib(library);
        } catch {
            // ignore
        }
    }, [ctx]);

    useEffect(() => {
        refreshAuditData();
        // Rules or Auto Mode changed (the settings store's own events), or a sync made progress (every 4 games).
        const offSettings = onSettingChange((key) => {
            if (key === "routingRules" || key === "autoRoutingMode")
                void refreshAuditData();
        });
        const offProgress = ctx.ingest.onProgress((p) => {
            if (p.isSyncing && p.current > 0 && p.current % 4 === 0)
                void refreshAuditData();
        });
        return () => {
            offSettings();
            offProgress();
        };
    }, [refreshAuditData, ctx]);

    useEffect(() => {
        if (prevSyncingRef.current && !syncProgress.isSyncing) {
            void refreshAuditData();
        }
        prevSyncingRef.current = syncProgress.isSyncing;
    }, [syncProgress.isSyncing, refreshAuditData]);

    const flagged: FlaggedShortcut[] = [];
    const notScraped: {
        appid: number;
        name: string;
        profile?: AutoRoutingProfile;
    }[] = [];

    for (const sc of shortcuts) {
        const profile = lookupStored(autoProfiles, sc.appid);

        // Excluded by routing rules or auto mode (app/routing, the one evaluation)
        const isAllowed = ctx.routing.serviceAllowed("all", sc.appid);
        if (!isAllowed) {
            continue; // Excluded by rule / auto mode: do not count in issues or not-scraped
        }

        const meta = lookupStored(metadataLib, sc.appid);
        const achievements = ctx.records.achievementsOf(sc.appid);
        const isScraped = !!meta || (achievements && achievements.nTotal > 0);

        if (!isScraped) {
            notScraped.push({ appid: sc.appid, name: sc.name, profile });
            continue; // Do NOT count unscraped games as issues!
        }

        const override = lookupStored(controllerOverrides, sc.appid);
        const inferred =
            lookupStored(controllerInference, sc.appid) ??
            (profile?.category === "retroarch" ||
            profile?.category === "console_emulator"
                ? true
                : undefined) ??
            ctx.controller.inferredFor(sc.appid);
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
        // The setting is written before Game Info re-derives the badges, so a change made here shows at once.
        void setSetting("controllerOverrides", {
            ...controllerOverrides,
            [String(appid)]: val,
        }).then(() => ctx.controller.refresh(appid));
        setFixMsg(`Updated controller support for ${shortcutName(appid)}`);
        setTimeout(() => setFixMsg(""), 2500);
    };

    const handleLinkSteamApp = async (
        shortcutAppId: number,
        steamAppId: number,
    ) => {
        setFixMsg("Linking to Steam Store...");
        const res = await ctx.steamStore.setMapping(shortcutAppId, steamAppId);
        if (res.mapping) {
            setFixMsg("Mapped successfully!");
            setTimeout(() => setFixMsg(""), 2500);
        } else {
            setFixMsg(res.error || "Failed to map Steam App");
        }
    };

    const handleScanSingle = async (appid: number, name: string) => {
        setFixMsg(`Scanning ${name}...`);
        await ctx.ingest
            .start({ forceAll: true, onlyAppids: [appid] })
            .catch(() => {});
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
                <Blocks>
                    <>
                        <ItemRow>
                            <Field
                                label="Not scraped"
                                description="Games awaiting initial metadata & achievement fetch"
                                bottomSeparator="none"
                            >
                                <span
                                    style={{
                                        color:
                                            notScraped.length > 0
                                                ? "#66c0f4"
                                                : "#8ba5b7",
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
                                label="Issues detected"
                                description="Number of games that require complete information"
                                bottomSeparator="none"
                            >
                                <span
                                    style={{
                                        color:
                                            flagged.length > 0
                                                ? "#e5a00d"
                                                : "#a4d007",
                                        fontWeight: 700,
                                        fontSize: "14px",
                                    }}
                                >
                                    {flagged.length}
                                </span>
                            </Field>
                        </ItemRow>
                        <ButtonRow
                            label="Review"
                            description="Fix controller support and Steam links game by game"
                            buttonLabel="Review"
                            onClick={() => setIsAuditModalOpen(true)}
                        />
                    </>
                    {/* Three rows: label, description, then the button across the full row. */}
                    <FullWidthRows
                        label="Edit Game MetaData"
                        description="Correct a game's Game Info by hand (description, credits, player tags, controller support) or link it to a Steam game."
                    >
                        <DialogButton
                            onClick={() => setIsGameDataOpen(true)}
                            style={{
                                padding: "0 16px",
                                minWidth: 0,
                                width: "100%",
                            }}
                        >
                            Manual Edit
                        </DialogButton>
                    </FullWidthRows>
                    {fixMsg && !isAuditModalOpen && (
                        <ItemRow>
                            <div style={{ color: "#66c0f4", fontSize: "12px" }}>
                                {fixMsg}
                            </div>
                        </ItemRow>
                    )}
                </Blocks>
                <GameDataEditor
                    isOpen={isGameDataOpen}
                    onClose={() => setIsGameDataOpen(false)}
                />

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
                                color:
                                    filter === "controller"
                                        ? "#66c0f4"
                                        : "#fff",
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
                                    filter === "not_scraped"
                                        ? "#66c0f4"
                                        : "#fff",
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
                                scraping (automatically scraped in the
                                background).
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
                                            background:
                                                "rgba(255, 255, 255, 0.03)",
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
                                                        : item.profile
                                                                .category ===
                                                            "console_emulator"
                                                          ? item.profile
                                                                .program ||
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
                                            background:
                                                "rgba(255, 255, 255, 0.03)",
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
                                                                    : item
                                                                            .profile
                                                                            .category ===
                                                                        "console_emulator"
                                                                      ? "rgba(163, 112, 247, 0.15)"
                                                                      : "rgba(255, 255, 255, 0.08)",
                                                            color:
                                                                item.profile
                                                                    .category ===
                                                                "retroarch"
                                                                    ? "#66c0f4"
                                                                    : item
                                                                            .profile
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
                                                        {item.profile
                                                            .category ===
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
                                                            background:
                                                                "#e5a00d",
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
                                                    selectedOption={
                                                        currentOverride
                                                    }
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
                                                        (Detected: Full
                                                        Controller)
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
                                                        targetAppId ===
                                                        item.appid
                                                            ? steamIdInput
                                                            : ""
                                                    }
                                                    onChange={(e) => {
                                                        setTargetAppId(
                                                            item.appid,
                                                        );
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
