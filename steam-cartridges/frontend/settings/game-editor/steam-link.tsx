// Game Data editor: the Steam link block (features plan F1). A manual link replaces the old
// "reject this suggestion" button: linking clears the game's suggestions, and "never suggest again" is a choice on Unlink.
import { useState } from "react";
import { DialogButton } from "@steambrew/client";
import { usePanelContext, type EditorSnapshot } from "../context";
import type { StoreCandidate } from "../../ports/backend";
import { BLOCK_STYLE, INPUT_STYLE, LABEL_STYLE, NOTE_STYLE } from "./styles";

const BUTTON = { padding: "0 14px", minWidth: 0, width: "auto" } as const;

export function SteamLink({ snapshot, busy, run }: { snapshot: EditorSnapshot; busy: boolean; run: (work: () => Promise<{ error?: string } | void>, done: string) => void }) {
    const editor = usePanelContext().editor;
    const [term, setTerm] = useState("");
    const [results, setResults] = useState<StoreCandidate[] | undefined>();
    const [searchError, setSearchError] = useState<string | undefined>();

    async function search() {
        setSearchError(undefined);
        const res = await editor.search(term);
        setResults(res.candidates);
        if (res.error) setSearchError(res.error);
    }

    return (
        <div style={BLOCK_STYLE}>
            <span style={LABEL_STYLE}>Steam link</span>
            <span style={{ fontSize: "12px" }}>
                {snapshot.link ? `Linked to ${snapshot.link.name || "app"} (${snapshot.link.steam_appid}, ${snapshot.link.source})` : "Not linked to a Steam game."}
            </span>
            {snapshot.link && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <DialogButton style={BUTTON} disabled={busy} onClick={() => run(() => editor.unlink(snapshot.appid, false), "Unlinked.")}>
                        Unlink
                    </DialogButton>
                    <DialogButton style={BUTTON} disabled={busy} onClick={() => run(() => editor.unlink(snapshot.appid, true), "Unlinked; this game will not be suggested again.")}>
                        Unlink and never suggest it again
                    </DialogButton>
                </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
                <input
                    type="text"
                    placeholder="Search Steam's games…"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void search()}
                    style={INPUT_STYLE}
                />
                <DialogButton style={BUTTON} disabled={busy || term.trim().length < 2} onClick={() => void search()}>
                    Search
                </DialogButton>
            </div>
            {searchError && <span style={{ fontSize: "12px", color: "#e57373" }}>Search failed: {searchError}</span>}
            {results && results.length === 0 && !searchError && <span style={NOTE_STYLE}>No Steam games found.</span>}
            {results?.map((c) => (
                <div key={c.steam_appid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "12px" }}>
                    <span>
                        {c.name} <span style={{ opacity: 0.6 }}>({c.steam_appid})</span>
                    </span>
                    <DialogButton
                        style={BUTTON}
                        disabled={busy || snapshot.link?.steam_appid === c.steam_appid}
                        onClick={() =>
                            run(() => editor.link(snapshot.appid, c.steam_appid, c.name), `Linked to ${c.name}.`)
                        }
                    >
                        Link
                    </DialogButton>
                </div>
            ))}
            {snapshot.custom && snapshot.link && (
                <span style={NOTE_STYLE}>Your manual edit is kept after linking. Use "Revert to fetched data" to show Steam's data instead.</span>
            )}
        </div>
    );
}
