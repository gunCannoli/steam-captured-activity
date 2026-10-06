// Game Data editor: the IGDB link block.
// Allows searching IGDB by title or entering an IGDB ID / URL directly to fetch and link full metadata.
import { useState } from "react";
import { DialogButton, Field, TextField } from "@steambrew/client";
import { usePanelContext, type EditorSnapshot } from "../context";
import type { IgdbCandidate } from "../../ports/backend";
import { Blocks, ButtonRow, ItemRow, STEAM_TRAILING } from "../components";
import { ERROR_STYLE } from "./styles";

export function IgdbLink({
    snapshot,
    busy,
    run,
}: {
    snapshot: EditorSnapshot;
    busy: boolean;
    run: (work: () => Promise<{ error?: string } | void>, done: string) => void;
}) {
    const editor = usePanelContext().editor;
    const [term, setTerm] = useState("");
    const [idInput, setIdInput] = useState("");
    const [results, setResults] = useState<IgdbCandidate[] | undefined>();
    const [searchError, setSearchError] = useState<string | undefined>();

    async function search() {
        setSearchError(undefined);
        const res = await editor.searchIgdb(term.trim());
        setResults(res.candidates);
        if (res.error) setSearchError(res.error);
    }

    function parseIgdbId(input: string): number | undefined {
        const cleaned = input.trim();
        const num = parseInt(cleaned, 10);
        if (!isNaN(num) && num > 0 && String(num) === cleaned) {
            return num;
        }
        return undefined;
    }

    const parsedDirectId = parseIgdbId(idInput);

    return (
        <Blocks>
            <>
                <ItemRow>
                    <Field
                        label="IGDB link"
                        description={
                            snapshot.metadata.igdb_id
                                ? `Linked to IGDB game #${snapshot.metadata.igdb_id}${
                                      snapshot.metadata.matched_title ? ` (${snapshot.metadata.matched_title})` : ""
                                  }`
                                : "Not linked to an IGDB entry."
                        }
                        bottomSeparator="none"
                    />
                </ItemRow>
                <ItemRow trailing>
                    <TextField
                        label="IGDB ID"
                        value={idInput}
                        onChange={(e) => setIdInput(e.target.value)}
                    />
                </ItemRow>
                <ButtonRow
                    label="Link ID"
                    description="Fetch metadata by numeric ID"
                    buttonLabel="Link IGDB"
                    disabled={busy || !parsedDirectId}
                    onClick={() => {
                        if (parsedDirectId) {
                            run(() => editor.linkIgdb(snapshot.appid, parsedDirectId), `Linked to IGDB game #${parsedDirectId}.`);
                        }
                    }}
                />
            </>
            <>
                <ItemRow trailing>
                    <TextField
                        label="Search IGDB games"
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void search()}
                    />
                </ItemRow>
                <ButtonRow
                    label="Search IGDB"
                    description="Search IGDB by title"
                    buttonLabel="Search"
                    disabled={busy || term.trim().length < 2}
                    onClick={() => void search()}
                />
                {searchError && <div style={{ ...ERROR_STYLE, marginTop: -STEAM_TRAILING / 2 }}>Search failed: {searchError}</div>}
                {results && results.length === 0 && !searchError && (
                    <ItemRow>
                        <Field label="No IGDB games found" bottomSeparator="none" />
                    </ItemRow>
                )}
                {results?.map((c) => {
                    const subtitle = [
                        c.year ? String(c.year) : null,
                        c.platforms && c.platforms.length > 0 ? c.platforms.slice(0, 3).join(", ") : null,
                        `ID: ${c.id}`,
                    ]
                        .filter(Boolean)
                        .join(" · ");

                    return (
                        <ItemRow key={c.id}>
                            <Field
                                label={c.name}
                                description={
                                    c.summary
                                        ? `${subtitle} — ${c.summary.length > 80 ? c.summary.slice(0, 80) + "..." : c.summary}`
                                        : subtitle
                                }
                            >
                                <DialogButton
                                    style={{ padding: "0 16px", minWidth: 0, width: "auto" }}
                                    disabled={busy || snapshot.metadata.igdb_id === c.id}
                                    onClick={() => run(() => editor.linkIgdb(snapshot.appid, c.id, c.name), `Linked to ${c.name}.`)}
                                >
                                    Link
                                </DialogButton>
                            </Field>
                        </ItemRow>
                    );
                })}
            </>
        </Blocks>
    );
}
