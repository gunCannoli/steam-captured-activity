// The settings panel: which games' Activity feeds show their captures. Layout: docs/plugins.md guardrail 18 (Steam's
// own rows; the two toggles read as one block, so they touch).
import { Children } from "react";
import { Field, PanelSection, PanelSectionRow, Toggle } from "@steambrew/client";
import { useSetting } from "./settings";

/** Blocks of one section, 22 px apart (guardrail 18.4: padding, not margin). */
const BLOCK_GAP = 22;

function Blocks({ children }: { children: React.ReactNode }) {
    return (
        <>
            {Children.toArray(children).map((block, i) => (
                <div key={i} style={{ paddingTop: i === 0 ? 0 : BLOCK_GAP }}>
                    {block}
                </div>
            ))}
        </>
    );
}

function ToggleRow({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <PanelSectionRow>
            <div style={{ margin: 0, padding: 0 }}>
                <Field label={label} description={description}>
                    <Toggle value={value} onChange={onChange} />
                </Field>
            </div>
        </PanelSectionRow>
    );
}

export function SettingsPanel() {
    const [steamGames, setSteamGames] = useSetting("steamGames");
    const [nonSteamGames, setNonSteamGames] = useSetting("nonSteamGames");
    return (
        <PanelSection title="Activity Feed">
            <Blocks>
                <>
                    <ToggleRow
                        label="Steam games support"
                        description="Your screenshots and recordings in a Steam game's Activity feed"
                        value={steamGames}
                        onChange={setSteamGames}
                    />
                    <ToggleRow
                        label="Non-Steam games support"
                        description="Your screenshots and recordings in a non-Steam game's Activity feed"
                        value={nonSteamGames}
                        onChange={setNonSteamGames}
                    />
                </>
            </Blocks>
        </PanelSection>
    );
}
