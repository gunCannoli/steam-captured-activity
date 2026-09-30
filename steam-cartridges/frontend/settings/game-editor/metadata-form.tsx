// Game Data editor: one input per editable field, then the player badges (features plan F1).
import { DialogButton } from "@steambrew/client";
import { EDITABLE_FIELDS, PLAYER_FLAGS, type MetadataDraft } from "../../domain/metadata-edit";
import { BLOCK_STYLE, INPUT_STYLE, LABEL_STYLE, NOTE_STYLE } from "./styles";

export function MetadataForm({
    draft,
    onChange,
    errors,
    dirty,
    custom,
    hasMetadata,
    busy,
    onSave,
    onRevert,
}: {
    draft: MetadataDraft;
    onChange: (next: MetadataDraft) => void;
    errors: string[];
    dirty: boolean;
    custom: boolean;
    hasMetadata: boolean;
    busy: boolean;
    onSave: () => void;
    onRevert: () => void;
}) {
    return (
        <div style={BLOCK_STYLE}>
            {!hasMetadata && <span style={NOTE_STYLE}>No data yet for this game. Open its page once to fetch some, or fill it in by hand.</span>}
            {EDITABLE_FIELDS.map((f) => (
                <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    <span style={LABEL_STYLE}>
                        {f.label}
                        {f.kind === "list" ? " (separate with ;)" : f.kind === "date" ? " (YYYY-MM-DD, empty = unknown)" : ""}
                    </span>
                    {f.kind === "textarea" ? (
                        <textarea rows={5} value={draft[f.key]} onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })} style={{ ...INPUT_STYLE, resize: "vertical" }} />
                    ) : (
                        <input type="text" value={draft[f.key]} onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })} style={INPUT_STYLE} />
                    )}
                </label>
            ))}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                {PLAYER_FLAGS.map((p) => (
                    <label key={p.flag} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px" }}>
                        <input
                            type="checkbox"
                            checked={draft.players[p.flag]}
                            onChange={(e) => onChange({ ...draft, players: { ...draft.players, [p.flag]: e.target.checked } })}
                        />
                        {p.label}
                    </label>
                ))}
            </div>
            <span style={NOTE_STYLE}>Controller support follows Settings → Metadata and the Library Audit, not this form.</span>
            {errors.map((e) => (
                <span key={e} style={{ fontSize: "12px", color: "#e57373" }}>
                    {e}
                </span>
            ))}
            <div style={{ display: "flex", gap: "8px" }}>
                <DialogButton onClick={onSave} disabled={busy || !dirty || errors.length > 0} style={{ padding: "0 14px", minWidth: 0, width: "auto" }}>
                    Save
                </DialogButton>
                <DialogButton onClick={onRevert} disabled={busy || !custom} style={{ padding: "0 14px", minWidth: 0, width: "auto" }}>
                    Revert to fetched data
                </DialogButton>
            </div>
            {custom && <span style={NOTE_STYLE}>This game has a manual edit: refreshes never overwrite it.</span>}
        </div>
    );
}
