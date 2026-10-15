// Settings: Third-party stores (ADR-0056). Per store: use it or not (its Game Info, screenshots and the player's unlocks),
// the account, and "Auto-add installed games". Layout: guardrail 18 (Steam's rows, one block per meaning). The panel calls
// the backend port only; the auto-add itself runs in app/store-sync when a toggle changes (index.tsx).
import { useEffect, useRef, useState } from "react";
import { DialogButton, Field, PanelSection } from "@steambrew/client";
import { DEFAULTS, useSetting } from "./settings";
import { backend, type InstalledStoreGame } from "../backend";
import { ActionRow, Blocks, BUTTON_STYLE, ButtonRow, CopyCode, CredentialsNote, ExternalLink, ItemRow, SettingsModal, ToggleRow } from "./components";

interface Accounts {
    epic: { found: boolean; private: boolean };
    xbox: { signed_in: boolean; gamertag?: string };
}

interface Installed {
    epic: InstalledStoreGame[];
    xbox: InstalledStoreGame[];
    epicLauncher: boolean;
}

function asArray<T>(val: unknown): T[] {
    return Array.isArray(val) ? (val as T[]) : [];
}

/** "(3 installed, 2 in library)" */
function installedText(list: InstalledStoreGame[] | undefined): string {
    if (!list) return "(Scanning...)";
    const arr = asArray<InstalledStoreGame>(list);
    if (arr.length === 0) return "(0 installed)";
    const inLibrary = arr.filter((g) => g.inLibrary).length;
    return `(${arr.length} installed, ${inLibrary} in library)`;
}

/** What the panel may do beyond the backend, injected by index.tsx (store-sync): add one game, file shortcuts in a collection. */
export interface ThirdPartyActions {
    addGame(kind: "epic" | "xbox", game: InstalledStoreGame): Promise<boolean>;
    fileInCollection(kind: "epic" | "xbox", appids: number[]): Promise<number>;
}

/**
 * One store's installed games (ADR-0070, option B): each row says whether the library has it ("In library", or "In
 * library as <name>" for a shortcut matched by name) and offers Add when it does not, plus "Add all missing" and "File
 * in collection". One block (guardrail 18.5); nothing shown with no games installed (18.7).
 */
function StoreGames({ kind, games, collection, actions, onChanged }: { kind: "epic" | "xbox"; games: InstalledStoreGame[] | undefined; collection: string; actions: ThirdPartyActions; onChanged: () => void }) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const list = asArray<InstalledStoreGame>(games);
    if (!list.length) return null;
    const missing = list.filter((g) => !g.inLibrary && g.launch);
    const inLibrary = list.filter((g) => typeof g.inLibrary === "number").map((g) => g.inLibrary as number);
    const run = async (work: () => Promise<string>) => {
        setBusy(true);
        setMessage("Working...");
        try {
            setMessage(await work());
        } finally {
            setBusy(false);
            onChanged();
        }
    };
    return (
        <>
            {list.map((g) => (
                <ItemRow key={g.key}>
                    <Field
                        label={g.title}
                        description={g.inLibrary ? (g.inLibraryAs ? `In library as ${g.inLibraryAs}` : "In library") : g.autoAdded ? "Not in library (auto-add leaves it out: removed or left out; Add brings it back)" : "Not in library"}
                        bottomSeparator="none"
                    >
                        {!g.inLibrary && g.launch && (
                            <DialogButton style={BUTTON_STYLE} disabled={busy} onClick={() => void run(async () => ((await actions.addGame(kind, g)) ? `✓ Added ${g.title}` : `${g.title} was not added (see the log)`))}>
                                Add
                            </DialogButton>
                        )}
                    </Field>
                </ItemRow>
            ))}
            {missing.length > 1 && (
                <ButtonRow
                    label="Add all missing"
                    description={`${missing.length} games without a shortcut`}
                    buttonLabel="Add all"
                    onClick={() =>
                        void run(async () => {
                            let n = 0;
                            for (const g of missing) if (await actions.addGame(kind, g)) n++;
                            return `✓ Added ${n} of ${missing.length}`;
                        })
                    }
                />
            )}
            {inLibrary.length > 0 && (
                <ButtonRow
                    label="File in collection"
                    description={`Put these games' shortcuts in the "${collection}" collection`}
                    buttonLabel="File"
                    onClick={() => void run(async () => `✓ Filed ${await actions.fileInCollection(kind, inLibrary)} in "${collection}"`)}
                />
            )}
            {message && <ActionRow message={message} />}
        </>
    );
}

/** Turning auto-add on asks first (ADR-0070): the games it would add, each with a toggle; unticked ones are left out for good. */
interface EnableAsk {
    kind: "epic" | "xbox";
    games: InstalledStoreGame[];
    picked: Set<string>;
}

export function ThirdPartySection({ actions }: { actions: ThirdPartyActions }) {
    const [services, setServices] = useSetting("services");
    const activeServices = services || DEFAULTS.services;
    const [autoEpic, setAutoEpic] = useSetting("autoAddEpicGames");
    const [autoXbox, setAutoXbox] = useSetting("autoAddXboxGames");
    const [epicOverlay, setEpicOverlay] = useSetting("epicOverlayWorkaround");
    const [muteXbox, setMuteXbox] = useSetting("muteXboxNotifications");
    const [accounts, setAccounts] = useState<Accounts | null>(null);
    const [installed, setInstalled] = useState<Installed | null>(null);

    // Xbox sign-in popup state.
    const [signInOpen, setSignInOpen] = useState(false);
    const [code, setCode] = useState<{ user_code: string; verification_uri: string } | null>(null);
    const [signInMsg, setSignInMsg] = useState("");
    const polling = useRef(0);

    const [ask, setAsk] = useState<EnableAsk | null>(null);
    const [askBusy, setAskBusy] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [logLines, setLogLines] = useState<string[]>([]);

    const fetchLogs = () => {
        backend
            .storeSensorLogs(100)
            .then((r) => {
                if (r && Array.isArray(r.lines)) setLogLines(r.lines);
            })
            .catch(() => {});
    };

    const openLogsModal = () => {
        fetchLogs();
        setLogsOpen(true);
    };

    const refresh = () => {
        // A failed call answers { error }: keep "Detecting" rather than render a reply without `epic`.
        backend
            .storeAccounts()
            .then((a) => {
                if (a && typeof a === "object" && a.epic && a.xbox) setAccounts(a as Accounts);
            })
            .catch(() => {});
        backend
            .storeInstalledGames(activeServices.xboxEnabled !== false)
            .then((r) => setInstalled({
                epic: asArray(r?.epic),
                xbox: asArray(r?.xbox),
                epicLauncher: r?.epicLauncher === true,
            }))
            .catch(() => {});
    };

    useEffect(() => {
        refresh();
        return () => {
            polling.current++; // stops a poll loop when the panel closes
        };
    }, []);

    const startSignIn = async () => {
        setSignInOpen(true);
        setCode(null);
        setSignInMsg("Asking Microsoft for a code...");
        const start = await backend.xboxSignInStart().catch(() => ({ error: "Could not reach Microsoft's sign-in." }) as any);
        if (!start.device_code) {
            setSignInMsg(start.error ?? "Could not start the sign-in.");
            return;
        }
        setCode({ user_code: start.user_code, verification_uri: start.verification_uri });
        setSignInMsg("Waiting for you to sign in...");
        const run = ++polling.current;
        const deadline = Date.now() + (start.expires_in ?? 900) * 1000;
        while (run === polling.current && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, Math.max(5, start.interval ?? 5) * 1000));
            if (run !== polling.current) return;
            const res = await backend.xboxSignInPoll(start.device_code).catch(() => ({ pending: true }) as any);
            if (res.ok) {
                setSignInMsg(`✓ Signed in as ${res.gamertag ?? "your Xbox account"}`);
                refresh();
                setTimeout(() => setSignInOpen(false), 1200);
                return;
            }
            if (res.error) {
                setSignInMsg(res.error);
                return;
            }
        }
        if (run === polling.current) setSignInMsg("The code expired. Close this and sign in again.");
    };

    const closeSignIn = () => {
        polling.current++;
        setSignInOpen(false);
    };

    const signOut = async () => {
        await backend.xboxSignOut().catch(() => {});
        refresh();
    };

    /** The auto-add toggle: on with games to add asks first; off is immediate. */
    const toggleAutoAdd = (kind: "epic" | "xbox", on: boolean, set: (v: boolean) => void) => {
        const missing = asArray<InstalledStoreGame>(installed?.[kind]).filter((g) => !g.inLibrary && !g.autoAdded && g.launch);
        if (!on || missing.length === 0) return set(on);
        setAsk({ kind, games: missing, picked: new Set(missing.map((g) => g.key)) });
    };

    const confirmAsk = async () => {
        if (!ask) return;
        setAskBusy(true);
        try {
            // Left out first, so the auto-add that starts with the toggle never adds them.
            for (const g of ask.games) if (!ask.picked.has(g.key)) await backend.storeAutoAdded(ask.kind, g.key, 0, g.title).catch(() => undefined);
            for (const g of ask.games) if (ask.picked.has(g.key)) await actions.addGame(ask.kind, g);
            (ask.kind === "epic" ? setAutoEpic : setAutoXbox)(true);
        } finally {
            setAskBusy(false);
            setAsk(null);
            refresh();
        }
    };

    const epicOn = activeServices.epicEnabled !== false;
    const xboxOn = activeServices.xboxEnabled !== false;

    const epicAccount = !accounts
        ? "Detecting account..."
        : !accounts.epic?.found
          ? "Not signed in on this PC. Sign in via Epic Games Launcher."
          : accounts.epic?.private
            ? "Profile is private. Set Privacy > Achievements to Public in Epic account."
            : "Connected via local Epic Games Launcher.";

    return (
        <PanelSection title="Third-party">
            <Blocks>
                <>
                    <ToggleRow
                        label="Epic Games Store"
                        description="Game info, screenshots, and achievements for installed Epic games."
                        value={epicOn}
                        onChange={(on: boolean) => setServices({ ...activeServices, epicEnabled: on })}
                    />
                    {epicOn && (
                        <ItemRow>
                            <Field label="Epic account" description={epicAccount} />
                        </ItemRow>
                    )}
                    {epicOn && (
                        <ToggleRow
                            label="Auto-add installed games"
                            description={
                                installed && !installed.epicLauncher
                                    ? "Epic Games Launcher not found."
                                    : `Sync installed games to an "Epic Games" collection; removes uninstalled games. ${installedText(installed?.epic)}`
                            }
                            value={autoEpic}
                            disabled={!!installed && !installed.epicLauncher}
                            onChange={(on: boolean) => toggleAutoAdd("epic", on, setAutoEpic)}
                        />
                    )}
                    {epicOn && <StoreGames kind="epic" games={installed?.epic} collection="Epic Games" actions={actions} onChanged={refresh} />}
                    {epicOn && (
                        <ToggleRow
                            label="Epic Steam Overlay Workaround"
                            description="Restarts the launcher on play to attach Steam's overlay, and closes it after cloud sync so playtime stops."
                            value={epicOverlay}
                            onChange={setEpicOverlay}
                        />
                    )}
                </>
                <>
                    <ToggleRow
                        label="Xbox"
                        description="Game info, screenshots, and achievements for installed Xbox PC games."
                        value={xboxOn}
                        onChange={(on: boolean) => setServices({ ...activeServices, xboxEnabled: on })}
                    />
                    {xboxOn &&
                        (accounts?.xbox?.signed_in ? (
                            <ButtonRow
                                label="Xbox account"
                                description={`Signed in as ${accounts.xbox?.gamertag || "Xbox account"}. Unlocks sync automatically.`}
                                buttonLabel="Sign out"
                                onClick={signOut}
                            />
                        ) : (
                            <ButtonRow
                                label="Xbox account"
                                description="Sign in once to sync Xbox achievements."
                                buttonLabel="Sign in"
                                onClick={startSignIn}
                            />
                        ))}
                    {xboxOn && (
                        <ToggleRow
                            label="Auto-add installed games"
                            description={`Sync installed games to an "Xbox" collection; removes uninstalled games. ${installedText(installed?.xbox)}`}
                            value={autoXbox}
                            onChange={(on: boolean) => toggleAutoAdd("xbox", on, setAutoXbox)}
                        />
                    )}
                    {xboxOn && <StoreGames kind="xbox" games={installed?.xbox} collection="Xbox" actions={actions} onChanged={refresh} />}
                    {xboxOn && (
                        <ToggleRow
                            label="Mute Steam notifications while playing"
                            description="Xbox games have no Steam overlay, so Steam's pop-ups land on top of the game. They still collect in Steam's notification list."
                            value={muteXbox}
                            onChange={setMuteXbox}
                        />
                    )}
                    <ButtonRow
                        label="Diagnostics & Sensor Telemetry"
                        description="View recent telemetry and debug events recorded in third_party.log."
                        buttonLabel="View Logs"
                        onClick={openLogsModal}
                    />
                </>
            </Blocks>

            {/* Turning auto-add on: which installed games to add now (ADR-0070). */}
            <SettingsModal title="Auto-add installed games" isOpen={!!ask} onClose={() => setAsk(null)} width="520px">
                <PanelSection>
                    <Blocks>
                        <>
                            {ask?.games.map((g) => (
                                <ToggleRow
                                    key={g.key}
                                    label={g.title}
                                    description={ask.picked.has(g.key) ? "Added now" : "Left out (you can still Add it in Settings)"}
                                    value={ask.picked.has(g.key)}
                                    onChange={(on: boolean) => {
                                        const picked = new Set(ask.picked);
                                        if (on) picked.add(g.key);
                                        else picked.delete(g.key);
                                        setAsk({ ...ask, picked });
                                    }}
                                />
                            ))}
                        </>
                        <ActionRow message={askBusy ? "Adding..." : `${ask?.picked.size ?? 0} of ${ask?.games.length ?? 0} games will be added; later installs are added by themselves`}>
                            <DialogButton onClick={() => void confirmAsk()} disabled={askBusy} style={BUTTON_STYLE}>
                                Turn on
                            </DialogButton>
                            <DialogButton onClick={() => setAsk(null)} disabled={askBusy} style={BUTTON_STYLE}>
                                Cancel
                            </DialogButton>
                        </ActionRow>
                    </Blocks>
                </PanelSection>
            </SettingsModal>

            {/* Diagnostics & Sensor Logs Modal */}
            <SettingsModal title="Diagnostics & Sensor Telemetry" isOpen={logsOpen} onClose={() => setLogsOpen(false)} width="720px">
                <PanelSection>
                    <Blocks>
                        <ItemRow>
                            <div style={{ maxHeight: "350px", overflowY: "auto", background: "rgba(0,0,0,0.5)", padding: "10px", borderRadius: "4px", fontFamily: "monospace", fontSize: "11px", whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#ddd" }}>
                                {logLines.length > 0 ? logLines.join("\n") : "No recent logs recorded yet. Logs write to <Steam>/millennium/config/steam-cartridges/third_party.log."}
                            </div>
                        </ItemRow>
                        <ActionRow message="Telemetry writes to config/steam-cartridges/third_party.log">
                            <DialogButton onClick={fetchLogs} style={BUTTON_STYLE}>
                                Refresh
                            </DialogButton>
                            <DialogButton onClick={() => setLogsOpen(false)} style={BUTTON_STYLE}>
                                Close
                            </DialogButton>
                        </ActionRow>
                    </Blocks>
                </PanelSection>
            </SettingsModal>

            {/* Xbox sign-in popup: the code to type at Microsoft's address. */}
            <SettingsModal title="Sign in to Xbox" isOpen={signInOpen} onClose={closeSignIn} width="480px">
                <PanelSection>
                    <Blocks>
                        <>
                            <ItemRow>
                                <Field
                                    label={code ? <CopyCode text={code.user_code} /> : "..."}
                                    description={
                                        code ? (
                                            <>
                                                Open <ExternalLink url={code.verification_uri} />, enter this code, and sign in with your Xbox account.
                                            </>
                                        ) : (
                                            "Getting a code..."
                                        )
                                    }
                                />
                            </ItemRow>
                            <CredentialsNote service="Microsoft and Xbox Live" />
                        </>
                        <ActionRow message={signInMsg}>
                            <DialogButton onClick={closeSignIn} style={BUTTON_STYLE}>
                                Close
                            </DialogButton>
                        </ActionRow>
                    </Blocks>
                </PanelSection>
            </SettingsModal>
        </PanelSection>
    );
}
