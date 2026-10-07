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

export function ThirdPartySection() {
    const [services, setServices] = useSetting("services");
    const activeServices = services || DEFAULTS.services;
    const [autoEpic, setAutoEpic] = useSetting("autoAddEpicGames");
    const [autoXbox, setAutoXbox] = useSetting("autoAddXboxGames");
    const [epicOverlay, setEpicOverlay] = useSetting("epicOverlayWorkaround");
    const [xboxOverlay, setXboxOverlay] = useSetting("xboxOverlayWorkaround");
    const [accounts, setAccounts] = useState<Accounts | null>(null);
    const [installed, setInstalled] = useState<Installed | null>(null);

    // Xbox sign-in popup state.
    const [signInOpen, setSignInOpen] = useState(false);
    const [code, setCode] = useState<{ user_code: string; verification_uri: string } | null>(null);
    const [signInMsg, setSignInMsg] = useState("");
    const polling = useRef(0);

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

    const epicOn = activeServices.epicEnabled !== false;
    const xboxOn = activeServices.xboxEnabled !== false;

    const epicAccount = !accounts
        ? "Detecting account..."
        : !accounts.epic.found
          ? "Not signed in on this PC. Sign in via Epic Games Launcher."
          : accounts.epic.private
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
                            onChange={setAutoEpic}
                        />
                    )}
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
                        (accounts?.xbox.signed_in ? (
                            <ButtonRow
                                label="Xbox account"
                                description={`Signed in as ${accounts.xbox.gamertag || "Xbox account"}. Unlocks sync automatically.`}
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
                            onChange={setAutoXbox}
                        />
                    )}
                    {xboxOn && (
                        <ToggleRow
                            label="Xbox Steam Overlay Workaround"
                            description="Uses a zero-copy presentation wrapper (Windows.Graphics.Capture) to enable the Steam Overlay, in-game achievement banners, and Game Recording for UWP games."
                            value={xboxOverlay}
                            onChange={setXboxOverlay}
                        />
                    )}
                </>
            </Blocks>

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
