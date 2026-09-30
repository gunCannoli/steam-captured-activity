// Settings: Game Data (features plan F1): the button that opens the Game Data editor popup.
import { useState } from "react";
import { DialogButton, PanelSection } from "@steambrew/client";
import { ItemRow } from "../components";
import { GameDataEditor } from "../game-editor/modal";

export function GameDataSection() {
    const [open, setOpen] = useState(false);
    return (
        <PanelSection title="Game Data">
            <ItemRow>
                <div style={{ fontSize: "12px", opacity: 0.7, padding: "0 0 6px" }}>
                    Correct a game's Game Info by hand, or link it to a Steam game. Manual edits are never overwritten by a refresh.
                </div>
            </ItemRow>
            <ItemRow>
                <DialogButton onClick={() => setOpen(true)} style={{ padding: "0 14px", minWidth: 0, width: "auto" }}>
                    Edit game data…
                </DialogButton>
            </ItemRow>
            <GameDataEditor isOpen={open} onClose={() => setOpen(false)} />
        </PanelSection>
    );
}
