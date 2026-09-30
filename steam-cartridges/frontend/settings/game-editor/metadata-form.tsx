// Game Data editor: one text field per editable field, then the player tags and the controller support (features plan F1).
// Layout rules: docs/plugins.md § Settings panel layout (a row has two columns at most; a dropdown gets the full row).
import { Dropdown, Field, TextField } from "@steambrew/client";
import { EDITABLE_FIELDS, PLAYER_FLAGS, type MetadataDraft } from "../../domain/metadata-edit";
import { setSetting, useSetting, type ControllerOverride } from "../settings";
import { usePanelContext } from "../context";
import { Blocks, ButtonRow, FullWidthRows, STEAM_TRAILING, ToggleRow } from "../components";
import { ERROR_STYLE, TEXTAREA_STYLE } from "./styles";

const CONTROLLER_OPTIONS: { data: ControllerOverride; label: string }[] = [
    { data: "auto", label: "Default / Auto" },
    { data: "full", label: "Full Controller Support" },
    { data: "partial", label: "Partial Controller Support" },
    { data: "none", label: "Keyboard & Mouse Only" },
];

const HINTS = { list: "Separate entries with ;", date: "YYYY-MM-DD, empty if unknown" } as const;

export function MetadataForm({
    appid,
    draft,
    onChange,
    errors,
    dirty,
    custom,
    hasMetadata,
    busy,
    onSave,
    onRevert,
    onNotice,
}: {
    appid: number;
    draft: MetadataDraft;
    onChange: (next: MetadataDraft) => void;
    errors: string[];
    dirty: boolean;
    custom: boolean;
    hasMetadata: boolean;
    busy: boolean;
    onSave: () => void;
    onRevert: () => void;
    onNotice: (text: string) => void;
}) {
    const ctx = usePanelContext();
    const [overrides] = useSetting("controllerOverrides");
    const override = overrides[String(appid)] ?? "auto";
    const detected = ctx.controller.inferredFor(appid);

    const setController = (next: ControllerOverride) => {
        // Written before Game Info re-derives its badges, so the change shows at once.
        void setSetting("controllerOverrides", { ...overrides, [String(appid)]: next }).then(() => {
            ctx.controller.refresh(appid);
            onNotice("Controller support updated.");
        });
    };

    return (
        <Blocks>
            <>
                {!hasMetadata && (
                    <Field label="No data yet" description="Open this game's page once to fetch some, or fill it in by hand." bottomSeparator="none" />
                )}
                {EDITABLE_FIELDS.map((f) =>
                    f.kind === "textarea" ? (
                        <Field key={f.key} label={f.label} childrenLayout="below" childrenContainerWidth="max">
                            <textarea rows={5} value={draft[f.key]} onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })} style={TEXTAREA_STYLE} />
                        </Field>
                    ) : (
                        <TextField
                            key={f.key}
                            label={f.kind === "list" || f.kind === "date" ? `${f.label} (${HINTS[f.kind]})` : f.label}
                            value={draft[f.key]}
                            onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })}
                        />
                    ),
                )}
                {errors.map((e) => (
                    <div key={e} style={{ ...ERROR_STYLE, marginTop: -STEAM_TRAILING / 2 }}>
                        {e}
                    </div>
                ))}
            </>
            <>
                {PLAYER_FLAGS.map((p) => (
                    <ToggleRow
                        key={p.flag}
                        label={p.label}
                        description={p.flag === "single_player" ? "Player tags Steam shows on Game Info" : undefined}
                        value={draft.players[p.flag]}
                        onChange={(on) => onChange({ ...draft, players: { ...draft.players, [p.flag]: on } })}
                    />
                ))}
            </>
            <FullWidthRows
                label="Controller support"
                description={`Applies at once, no Save needed. ${
                    detected === true ? "Detected from the emulator: full controller." : detected === false ? "Detected from the emulator: keyboard & mouse." : "Not detected for this game."
                }`}
            >
                <Dropdown
                    rgOptions={CONTROLLER_OPTIONS}
                    selectedOption={override}
                    contextMenuPositionOptions={{ bMatchWidth: true }}
                    onChange={(o) => setController(o.data as ControllerOverride)}
                />
            </FullWidthRows>
            <>
                <ButtonRow label="Save" description="Stored as a manual edit: refreshes never overwrite it" buttonLabel="Save" disabled={busy || !dirty || errors.length > 0} onClick={onSave} />
                <ButtonRow
                    label="Revert to fetched data"
                    description={custom ? "Drop the manual edit and show the fetched data again" : "This game has no manual edit"}
                    buttonLabel="Revert"
                    disabled={busy || !custom}
                    onClick={onRevert}
                />
            </>
        </Blocks>
    );
}
