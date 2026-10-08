// The extension's block in steam-cartridges' settings (guardrails 18 and 22): one toggle, Steam's own components.
import { Field, PanelSection, Toggle } from "@steambrew/client";
import { useSetting } from "./settings";

export function LocalSection() {
    const [watch, setWatch] = useSetting("watchWhilePlaying");
    return (
        <PanelSection title="Local achievements">
            <Field
                label="Watch while a game runs"
                description="Reads the game's emulator achievement files and engine logs as you play, so an unlock shows at once."
            >
                <Toggle value={watch !== false} onChange={(v: boolean) => setWatch(v)} />
            </Field>
        </PanelSection>
    );
}
