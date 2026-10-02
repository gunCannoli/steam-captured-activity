// Settings: Library Audit (migration plan M8c; reads the app through the panel context and the backend port).
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { DialogButton, Dropdown, Field, PanelSection, TextField } from "@steambrew/client";
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
    ActionRow,
    Blocks,
    BUTTON_STYLE,
    ButtonRow,
    FullWidthRows,
    ItemRow,
    SettingsModal,
    StatRow,
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
        "all" | "not_scraped"
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
    let ignored = 0;
    let matched = 0;

    for (const sc of shortcuts) {
        const profile = lookupStored(autoProfiles, sc.appid);

        // Excluded by routing rules or auto mode (app/routing, the one evaluation)
        const isAllowed = ctx.routing.serviceAllowed("all", sc.appid);
        if (!isAllowed) {
            ignored++;
            continue; // Excluded by rule / auto mode: do not count in issues or not-scraped
        }

        const meta = lookupStored(metadataLib, sc.appid);
        if (meta) matched++;
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

    const handleSetController = (appid: number, val: ControllerOverride) => {
        // The setting is written before Game Info re-derives the badges, so a change made here shows at once.
        void setSetting("controllerOverrides", {
            ...controllerOverrides,
            [String(appid)]: val,
        }).then(() => ctx.controller.refresh(appid));
        setFixMsg(`✓ Updated controller support for ${shortcutName(appid)}`);
        setTimeout(() => setFixMsg(""), 2500);
    };

    const handleLinkSteamApp = async (
        shortcutAppId: number,
        steamAppId: number,
    ) => {
        setFixMsg("Linking to Steam Store...");
        const res = await ctx.steamStore.setMapping(shortcutAppId, steamAppId);
        if (res.mapping) {
            setFixMsg("✓ Linked to Steam");
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
        setFixMsg(`✓ Scanned ${name}`);
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
            <PanelSection title="Library Analytics">
                <Blocks>
                    <>
                        <StatRow label="Non-Steam Games" value={shortcuts.length} />
                        <StatRow label="Metadata Matched" value={matched} />
                        <StatRow label="Ignored" value={ignored} />
                        <StatRow label="Issues detected" value={flagged.length} warn />
                    </>
                    {/* Three rows: label, description, then the button across the full row. */}
                    <FullWidthRows label="Review" description="Fix controller support and Steam links game by game">
                        <DialogButton
                            onClick={() => {
                                // Open on the view that has something in it.
                                setFilter(flagged.length === 0 && notScraped.length > 0 ? "not_scraped" : "all");
                                setIsAuditModalOpen(true);
                            }}
                            style={{ ...BUTTON_STYLE, width: "100%" }}
                        >
                            Review
                        </DialogButton>
                    </FullWidthRows>
                    <FullWidthRows
                        label="Edit Game MetaData"
                        description="Correct a game's Game Info by hand or link it to a Steam game"
                    >
                        <DialogButton onClick={() => setIsGameDataOpen(true)} style={{ ...BUTTON_STYLE, width: "100%" }}>
                            Manual Edit
                        </DialogButton>
                    </FullWidthRows>
                    {fixMsg && !isAuditModalOpen && <ActionRow message={fixMsg} />}
                </Blocks>
                <GameDataEditor
                    isOpen={isGameDataOpen}
                    onClose={() => setIsGameDataOpen(false)}
                />

                {/* Review popup: the same rows and spacing as the panel, one block per game. */}
                <SettingsModal
                    title="Review"
                    isOpen={isAuditModalOpen}
                    onClose={() => setIsAuditModalOpen(false)}
                    width="620px"
                    maxHeight="85vh"
                >
                    <PanelSection>
                        <Blocks>
                            <FullWidthRows
                                label="Show"
                                description={
                                    filter === "not_scraped"
                                        ? "Games still waiting for their first fetch; they are fetched in the background"
                                        : "Games with no known controller support"
                                }
                            >
                                <Dropdown
                                    rgOptions={[
                                        { data: "all", label: `Issues (${flagged.length})` },
                                        { data: "not_scraped", label: `Not scraped (${notScraped.length})` },
                                    ]}
                                    selectedOption={filter}
                                    onChange={(o) => setFilter(o.data as "all" | "not_scraped")}
                                    contextMenuPositionOptions={{ bMatchWidth: true }}
                                />
                            </FullWidthRows>
                            {fixMsg && <ActionRow message={fixMsg} />}
                            {filter === "not_scraped" ? (
                                <>
                                    {notScraped.length === 0 && (
                                        <ItemRow>
                                            <Field label="Every game has been fetched" bottomSeparator="none" />
                                        </ItemRow>
                                    )}
                                    {notScraped.map((item) => (
                                        <ItemRow key={item.appid}>
                                            <Field label={item.name} description={gameLine(item.appid, item.profile)}>
                                                <DialogButton onClick={() => handleScanSingle(item.appid, item.name)} style={BUTTON_STYLE}>
                                                    Scrape
                                                </DialogButton>
                                            </Field>
                                        </ItemRow>
                                    ))}
                                </>
                            ) : flagged.length === 0 ? (
                                <ItemRow>
                                    <Field label="No issues found" bottomSeparator="none" />
                                </ItemRow>
                            ) : (
                                flagged.map((item) => (
                                    <Fragment key={item.appid}>
                                        <ItemRow>
                                            <Field
                                                label={item.name}
                                                description={[
                                                    gameLine(item.appid, item.profile),
                                                    item.inferred === true
                                                        ? "Detected: full controller"
                                                        : item.inferred === false
                                                          ? "Detected: keyboard & mouse"
                                                          : null,
                                                ]
                                                    .filter(Boolean)
                                                    .join(" · ")}
                                                bottomSeparator="none"
                                            />
                                        </ItemRow>
                                        <ItemRow>
                                            <Field childrenContainerWidth="max" bottomSeparator="none">
                                                <Dropdown
                                                    rgOptions={CONTROLLER_OVERRIDE_OPTIONS}
                                                    selectedOption={controllerOverrides[String(item.appid)] || "auto"}
                                                    onChange={(o) => handleSetController(item.appid, o.data as ControllerOverride)}
                                                    contextMenuPositionOptions={{ bMatchWidth: true }}
                                                />
                                            </Field>
                                        </ItemRow>
                                        <ItemRow trailing>
                                            <TextField
                                                label="Steam app id"
                                                value={targetAppId === item.appid ? steamIdInput : ""}
                                                onChange={(e) => {
                                                    setTargetAppId(item.appid);
                                                    setSteamIdInput(e.target.value);
                                                }}
                                            />
                                        </ItemRow>
                                        <ButtonRow
                                            label="Link to Steam"
                                            description="Use that Steam game's page data"
                                            buttonLabel="Link"
                                            disabled={targetAppId !== item.appid || !(parseInt(steamIdInput, 10) > 0)}
                                            onClick={() => handleLinkSteamApp(item.appid, parseInt(steamIdInput, 10))}
                                        />
                                    </Fragment>
                                ))
                            )}
                            <ActionRow>
                                <DialogButton onClick={() => setIsAuditModalOpen(false)} style={BUTTON_STYLE}>
                                    Done
                                </DialogButton>
                            </ActionRow>
                        </Blocks>
                    </PanelSection>
                </SettingsModal>
            </PanelSection>
        </div>
    );
}

/** A game's second line in the Review popup: what kind of game it is, and its app id. */
function gameLine(appid: number, profile?: AutoRoutingProfile): string {
    const kind =
        profile?.category === "retroarch"
            ? "Retro"
            : profile?.category === "console_emulator"
              ? profile.program || "Emulator"
              : profile
                ? "PC"
                : null;
    return kind ? `${kind} · ${appid}` : String(appid);
}
