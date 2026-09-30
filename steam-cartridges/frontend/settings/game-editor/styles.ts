// Game Data editor: the few inline styles its parts share (features plan F1).
import type { CSSProperties } from "react";

export const INPUT_STYLE: CSSProperties = {
    background: "rgba(0, 0, 0, 0.4)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    color: "#fff",
    borderRadius: "3px",
    padding: "5px 8px",
    fontSize: "12px",
    width: "100%",
    boxSizing: "border-box",
};

export const LABEL_STYLE: CSSProperties = { fontSize: "11px", opacity: 0.75, fontWeight: 600 };

export const BLOCK_STYLE: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 0",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
};

export const NOTE_STYLE: CSSProperties = { fontSize: "11px", opacity: 0.7 };
