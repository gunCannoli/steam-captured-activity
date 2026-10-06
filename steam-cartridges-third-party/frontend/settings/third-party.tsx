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

/** "3 installed, 2 in your library" */
function installedText(list: InstalledStoreGame[] | undefined): string {
    if (!list) return "Looking for installed games...";
    if (list.length === 0) return "No installed games found on this PC.";
    const inLibrary = list.filter((g) => g.inLibrary).length;
    return `${list.length} installed, ${inLibrary} in your library.`;
}

export function ThirdPartySection() {
    const [services, setServices] = useSetting("services");
    const activeServices = services || DEFAULTS.services;
    const [autoEpic, setAutoEpic] = useSetting("autoAddEpicGames");
    const [autoXbox, setAutoXbox] = useSetting("autoAddXboxGames");
    const [epicOverlay, setEpicOverlay] = useSetting("epicOverlayWorkaround");
    const [accounts, setAccounts] = useState<Accounts | null>(null);
    const [installed, setInstalled] = useState<Installed | null>(null);

    // Xbox sign-in popup state.
    const [signInOpen, setSignInOpen] = useState(false);
    const [code, setCode] = useState<{ user_code: string; verification_uri: string } | null>(null);
    const [signInMsg, setSignInMsg] = useState("");
    const polling = useRef(0);

    const refresh = () => {
        backend.storeAccounts().then((a) => setAccounts(a as Accounts)).catch(() => {});
        backend
            .storeInstalledGames(activeServices.xboxEnabled !== false)
            .then((r) => setInstalled({ epic: r.epic ?? [], xbox: r.xbox ?? [], epicLauncher: r.epicLauncher === true }))
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
        ? "Looking for the Epic Games Launcher's account..."
        : !accounts.epic.found
          ? "No account found: sign in to the Epic Games Launcher on this PC. Game Info works without one."
          : accounts.epic.private
            ? "Your Epic profile hides its achievements. In your Epic account, set Privacy > Achievements to Everyone."
            : "Found on this PC. Your unlocks are read from your public Epic profile; no sign-in here.";

    return (
        <PanelSection title="Third-party">
            <Blocks>
                <>
                    <ToggleRow
                        label="Epic Games Store"
                        description="Epic games on this PC: the store's Game Info and screenshots when the game is not on Steam, and your Epic achievements."
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
                                    ? "The Epic Games Launcher was not found, so games cannot be added."
                                    : `Add every installed Epic game to your library, in an "Epic Games" collection. ${installedText(installed?.epic)}`
                            }
                            value={autoEpic}
                            disabled={!!installed && !installed.epicLauncher}
                            onChange={setAutoEpic}
                        />
                    )}
                    {epicOn && (
                        <ToggleRow
                            label="Epic Steam Overlay Workaround"
                            description="Steam's overlay reaches an Epic game only when Steam starts the Epic Games Launcher. When you press Play, a running launcher is closed first (never during a download), and it is closed again after the game, once Epic's cloud sync is done, so Steam stops showing the game as running. Your Epic store and friends windows close with it. A game started from a desktop shortcut is not covered: close the launcher yourself first."
                            value={epicOverlay}
                            onChange={setEpicOverlay}
                        />
                    )}
                </>
                <>
                    <ToggleRow
                        label="Xbox"
                        description="Xbox PC games on this PC: the store's Game Info and screenshots when the game is not on Steam, and your Xbox achievements."
                        value={xboxOn}
                        onChange={(on: boolean) => setServices({ ...activeServices, xboxEnabled: on })}
                    />
                    {xboxOn &&
                        (accounts?.xbox.signed_in ? (
                            <ButtonRow
                                label="Xbox account"
                                description={`Signed in as ${accounts.xbox.gamertag || "your Xbox account"}. Your unlocks sync when a game's page opens and when the game quits.`}
                                buttonLabel="Sign out"
                                onClick={signOut}
                            />
                        ) : (
                            <ButtonRow
                                label="Xbox account"
                                description="Sign in once to sync your Xbox achievements. Game Info works without it."
                                buttonLabel="Sign in"
                                onClick={startSignIn}
                            />
                        ))}
                    {xboxOn && (
                        <ToggleRow
                            label="Auto-add installed games"
                            description={`Add every installed Xbox game to your library, in an "Xbox" collection. ${installedText(installed?.xbox)}`}
                            value={autoXbox}
                            onChange={setAutoXbox}
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
                                                On any device, open <ExternalLink url={code.verification_uri} /> and type this code (click it to copy), then sign in with
                                                your Xbox account.
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
