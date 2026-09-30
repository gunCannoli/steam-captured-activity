// Game Data editor: the Steam link block (features plan F1). A manual link replaces the old
// "reject this suggestion" button: linking clears the game's suggestions, and "never suggest again" is a choice on Unlink.
import { useState } from "react";
import { DialogButton, Field, TextField } from "@steambrew/client";
import { usePanelContext, type EditorSnapshot } from "../context";
import type { StoreCandidate } from "../../ports/backend";
import { Blocks, ButtonRow, ItemRow, STEAM_TRAILING } from "../components";
import { ERROR_STYLE } from "./styles";

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
        <Blocks>
            <>
                <ItemRow>
                    <Field
                        label="Steam link"
                        description={
                            snapshot.link
                                ? `Linked to ${snapshot.link.name || "app"} (${snapshot.link.steam_appid}, ${snapshot.link.source})`
                                : "Not linked to a Steam game."
                        }
                        bottomSeparator="none"
                    />
                </ItemRow>
                {snapshot.link && (
                    <>
                        <ButtonRow
                            label="Unlink"
                            description="The game may be matched by its title again"
                            buttonLabel="Unlink"
                            disabled={busy}
                            onClick={() => run(() => editor.unlink(snapshot.appid, false), "Unlinked.")}
                        />
                        <ButtonRow
                            label="Unlink for good"
                            description="Also never suggest this Steam game again"
                            buttonLabel="Unlink"
                            disabled={busy}
                            onClick={() => run(() => editor.unlink(snapshot.appid, true), "Unlinked; this game will not be suggested again.")}
                        />
                    </>
                )}
                {snapshot.custom && snapshot.link && (
                    <ItemRow>
                        <Field label="Manual edit kept" description="Linking does not replace it. Use Revert to fetched data to show Steam's data instead." bottomSeparator="none" />
                    </ItemRow>
                )}
            </>
            <>
                <ItemRow trailing>
                    <TextField label="Search Steam's games" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
                </ItemRow>
                <ButtonRow label="Search" description="Finds Steam games; nothing is linked until you choose one" buttonLabel="Search" disabled={busy || term.trim().length < 2} onClick={() => void search()} />
                {searchError && <div style={{ ...ERROR_STYLE, marginTop: -STEAM_TRAILING / 2 }}>Search failed: {searchError}</div>}
                {results && results.length === 0 && !searchError && (
                    <ItemRow>
                        <Field label="No Steam games found" bottomSeparator="none" />
                    </ItemRow>
                )}
                {results?.map((c) => (
                    <ItemRow key={c.steam_appid}>
                        <Field label={c.name} description={`Steam app ${c.steam_appid}`}>
                            <DialogButton
                                style={{ padding: "0 16px", minWidth: 0, width: "auto" }}
                                disabled={busy || snapshot.link?.steam_appid === c.steam_appid}
                                onClick={() => run(() => editor.link(snapshot.appid, c.steam_appid, c.name), `Linked to ${c.name}.`)}
                            >
                                Link
                            </DialogButton>
                        </Field>
                    </ItemRow>
                ))}
            </>
        </Blocks>
    );
}
