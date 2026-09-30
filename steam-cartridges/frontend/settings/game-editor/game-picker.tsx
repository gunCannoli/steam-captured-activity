// Game Data editor: the text filter and the dropdown of every non-Steam shortcut (features plan F1).
import { Dropdown } from "@steambrew/client";
import { usePanelContext } from "../context";
import { INPUT_STYLE, LABEL_STYLE } from "./styles";

export function GamePicker({ filter, onFilter, appid, onPick }: { filter: string; onFilter: (text: string) => void; appid: number | undefined; onPick: (appid: number) => void }) {
    const shortcuts = usePanelContext().routing.listShortcuts();
    const needle = filter.trim().toLowerCase();
    const shown = needle ? shortcuts.filter((s) => s.name.toLowerCase().includes(needle)) : shortcuts;
    // Keep the chosen game selectable even when the filter hides it.
    const chosen = appid === undefined ? undefined : shortcuts.find((s) => s.appid === appid);
    const options = (chosen && !shown.includes(chosen) ? [chosen, ...shown] : shown).map((s) => ({ data: s.appid, label: s.name }));

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={LABEL_STYLE}>Game ({shown.length} of {shortcuts.length})</span>
            <input type="text" placeholder="Type to filter…" value={filter} onChange={(e) => onFilter(e.target.value)} style={INPUT_STYLE} />
            <Dropdown
                rgOptions={options}
                selectedOption={appid}
                onChange={(o) => onPick(o.data as number)}
                contextMenuPositionOptions={{ bMatchWidth: true }}
                strDefaultLabel="Choose a game…"
            />
        </div>
    );
}
