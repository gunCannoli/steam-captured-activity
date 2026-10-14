import { Component, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { ConfirmModal, DialogButton, Field, PanelSection, TextField } from "@steambrew/client";
import { logger } from "../../logger";
import { rpc, type SoundLibraryManifest, type ThemeEntry } from "../../rpc";
import { clearDraft, loadDraft, reloadTheme } from "../../theme/active-theme";
import { TIERS, type Tier } from "../../theme/achievements";
import {
    assetPathsOf, copyPlan, createHistory, isAbsolutePath, modePath, NAME_PATTERN, push, redo, setAt, undo, unsetAt, type CreatorDraft, type History, type Path,
} from "../../theme/draft";
import { parseJsonc } from "../../theme/jsonc";
import { STEAM_DEFAULT_THEME } from "../../theme/schema";
import { resolveTheme, themeForMode, type ThemeMode } from "../../theme/theme";
import { showDialog } from "../../steam/modal";
import { setSetting, setting } from "../settings";
import { ActionRow, Blocks, BUTTON_STYLE, ButtonRow, ControlledToggleRow, IconButton, ItemRow, STEAM_TRAILING } from "../rows";
import { CreatorContext, type CreatorApi } from "./controls";
import { freeName, type PreviewItem } from "./model";
import { AchievementsPage, CardPage, CodePage, IconsPage, PlacementPage, TextPage, TierPage, TIER_NAMES } from "./pages";
import { PreviewColumn, type CreatorBannerProps, type SampleGame } from "./preview";
import { releaseClips, SoundPage } from "./sounds";

/**
 * The Theme Creator modal (theme creator plan § 4): navigation left, preview middle (it never remounts when the page
 * changes), editor right, and one action row. It edits a draft (theme/draft.ts) and writes only through the backend's
 * SaveTheme / DeleteTheme (the user folder) and, for Test on screen, active-theme's loadDraft (memory, bounded).
 */

/** Everything the creator needs from a surface or from start-up, injected by index.tsx (the panel never imports a surface). */
export interface CreatorDeps {
    BannerCard: ComponentType<CreatorBannerProps>;
    previewOptions: { id: string; label: string }[];
    preview: (id: string) => Promise<unknown>;
    previewTier: (tier: Tier) => Promise<void> | void;
    sampleGame: () => SampleGame | null;
    /** Steam's toasts on and the preview surface installed. */
    canTest: () => boolean;
}

const STORAGE_KEY = "enhanced-notifications.creator.draft";
const PAGES: { id: string; label: string; group?: string }[] = [
    { id: "start", label: "Start" },
    { id: "placement", label: "Placement", group: "Look" },
    { id: "card", label: "Card" },
    { id: "text", label: "Text" },
    { id: "icons", label: "Icons" },
    { id: "sound", label: "Sound" },
    { id: "achievements", label: "Achievements", group: "Achievements" },
    ...TIERS.map((t) => ({ id: `tier:${t}`, label: `  ${TIER_NAMES[t]}` })),
    { id: "code", label: "Code", group: "File" },
];

function freshDraft(): CreatorDraft {
    return { name: "my_theme", origin: { kind: "fresh" }, raw: {}, pendingCopies: {} };
}

function stored(): { draft: CreatorDraft; at: number } | null {
    try {
        const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
        return v && v.draft && typeof v.at === "number" ? v : null;
    } catch {
        return null;
    }
}
function store(draft: CreatorDraft | null): void {
    try {
        if (draft) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ draft, at: Date.now() }));
        else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* storage unavailable: the draft just is not kept */
    }
}

/** A column that fails shows the error instead of blanking the modal (plan § 4.2). */
class ColumnBoundary extends Component<{ name: string; children: ReactNode }, { error: string | null }> {
    override state = { error: null as string | null };
    static getDerivedStateFromError(error: unknown) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
    override componentDidCatch(error: Error, info: ErrorInfo) {
        logger.error(`Theme Creator: the ${this.props.name} failed.`, error, info.componentStack);
    }
    override render() {
        if (this.state.error) {
            return (
                <PanelSection title={this.props.name}>
                    <ItemRow>
                        <Field label="This section failed" description={this.state.error} />
                    </ItemRow>
                    <ButtonRow label="Try again" buttonLabel="Retry" onClick={() => this.setState({ error: null })} />
                </PanelSection>
            );
        }
        return this.props.children;
    }
}

export function ThemeCreator({ deps, closeModal }: { deps: CreatorDeps; closeModal?: () => void }) {
    const [history, setHistory] = useState<History<CreatorDraft>>(() => createHistory(freshDraft()));
    const draft = history.present;
    const [savedJson, setSavedJson] = useState(() => JSON.stringify(freshDraft().raw));
    const dirty = JSON.stringify(draft.raw) !== savedJson;
    const [mode, setMode] = useState<ThemeMode>("desktop");
    const [page, setPage] = useState("start");
    const [status, setStatus] = useState("");
    const [themes, setThemes] = useState<ThemeEntry[]>([]);
    const [userDir, setUserDir] = useState("");
    const [library, setLibrary] = useState<{ dir: string; manifest: SoundLibraryManifest } | null>(null);
    const [files, setFiles] = useState<{ images: string[]; sounds: string[] }>({ images: [], sounds: [] });
    const [assets, setAssets] = useState<ReadonlyMap<string, string>>(new Map());
    const [restorable] = useState(stored);
    const cache = useRef(new Map<string, string | null>());
    const game = useMemo(() => deps.sampleGame(), [deps]);

    const dirOf = useCallback((d: CreatorDraft) => (d.origin.kind === "fresh" ? userDir : d.origin.dir), [userDir]);

    const refreshThemes = useCallback(async () => {
        try {
            const r = await rpc.listThemes();
            setThemes(r.themes);
            setUserDir(r.userDir);
        } catch (error) {
            logger.warn("Theme Creator: could not list themes.", error);
        }
    }, []);

    useEffect(() => {
        void refreshThemes();
        rpc.soundLibrary().then(setLibrary, (error) => logger.warn("Theme Creator: no sound library.", error));
        return () => {
            void clearDraft();
            releaseClips();
        };
    }, []);

    const refreshFiles = useCallback(() => {
        const dir = dirOf(draft);
        if (!dir) return;
        rpc.listThemeAssets(dir).then(
            (r) => setFiles({ images: r.files.filter((f) => f.kind === "image").map((f) => f.path), sounds: r.files.filter((f) => f.kind === "sound").map((f) => f.path) }),
            () => setFiles({ images: [], sounds: [] }),
        );
    }, [draft.origin, dirOf]);
    useEffect(refreshFiles, [draft.origin, userDir]);

    const loadAsset = useCallback(
        async (path: string): Promise<string | null> => {
            const pick = draft.pendingCopies[path];
            const dir = pick ? (library?.dir ?? "") : isAbsolutePath(path) ? "" : dirOf(draft);
            const rel = pick ? `${pick.pack}/${pick.cue}.wav` : path;
            const key = `${dir}|${rel}`;
            if (cache.current.has(key)) return cache.current.get(key)!;
            try {
                const r = await rpc.loadAssets(dir, [rel]);
                const url = r[rel] || null;
                cache.current.set(key, url);
                return url;
            } catch {
                return null;
            }
        },
        [draft.pendingCopies, draft.origin, library, dirOf],
    );

    // The preview's assets: loaded in an effect (never in render), debounced, cached by folder and path.
    const assetKey = assetPathsOf(draft.raw).join("|");
    useEffect(() => {
        const t = setTimeout(async () => {
            const next = new Map<string, string>();
            for (const p of assetPathsOf(draft.raw)) {
                const url = await loadAsset(p);
                if (url) next.set(p, url);
            }
            setAssets(next);
        }, 250);
        return () => clearTimeout(t);
    }, [assetKey, loadAsset]);

    // Unsaved work survives the window's own X (plan D12).
    useEffect(() => {
        const t = setTimeout(() => store(dirty ? draft : null), 400);
        return () => clearTimeout(t);
    }, [draft, dirty]);

    const commit = (next: CreatorDraft) => setHistory((h) => push(h, next));
    const api: CreatorApi = {
        draft,
        mode,
        set: (path: Path, value: unknown) => commit({ ...draft, raw: setAt(draft.raw, modePath(mode, path), value) }),
        unset: (path: Path) => commit({ ...draft, raw: unsetAt(draft.raw, modePath(mode, path)) }),
        replace: commit,
        go: setPage,
        loadAsset,
        library: library?.manifest ?? null,
        files,
        refreshFiles,
        openFolder: () => void rpc.openThemesFolder(),
    };

    const resolved = useMemo(() => {
        try {
            return { theme: resolveTheme(draft.raw), error: null as string | null };
        } catch (error) {
            return { theme: null, error: error instanceof Error ? error.message : String(error) };
        }
    }, [draft.raw]);
    const view = resolved.theme ? themeForMode(resolved.theme, mode) : null;
    const warnings = resolved.error ? [resolved.error] : (resolved.theme?.warnings ?? []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.ctrlKey || (e.target as HTMLElement | null)?.tagName === "TEXTAREA") return;
            if (e.key === "z") setHistory(undo);
            else if (e.key === "y") setHistory(redo);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // --- opening, saving, deleting ------------------------------------------------------------------

    const open = (next: CreatorDraft, savedRaw: Record<string, unknown> | null) => {
        cache.current.clear();
        setHistory(createHistory(next));
        setSavedJson(JSON.stringify(savedRaw ?? {}));
        setStatus("");
        setPage("card");
    };

    const openTheme = async (entry: ThemeEntry) => {
        try {
            const file = await rpc.loadTheme(entry.id);
            let raw: Record<string, unknown>;
            try {
                raw = parseJsonc(file.text) as Record<string, unknown>;
            } catch (error) {
                setStatus(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
            const hadComments = /\/\/|\/\*/.test(file.text);
            if (entry.source === "bundled") {
                const name = freeName(`${entry.name}_custom`, themes.map((t) => t.name));
                open({ name, origin: { kind: "template", id: entry.id, dir: file.dir, hadComments }, raw, pendingCopies: {} }, null);
                setStatus(`● Template ${entry.name}: Save as to keep your copy`);
            } else {
                open({ name: entry.name, origin: { kind: "user", id: entry.id, dir: file.dir, hadComments }, raw, pendingCopies: {} }, raw);
                if (hadComments) setStatus("● Saving rewrites this file; its comments are not kept (a .bak copy is made first)");
            }
        } catch (error) {
            setStatus(`Could not open ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const save = async (name: string, opts: { overwrite: boolean; useNow: boolean }): Promise<"ok" | "exists" | string> => {
        if (!NAME_PATTERN.test(name)) return "Use letters, digits, _ and - only (at most 40)";
        const plan = copyPlan({ ...draft, name });
        const sameFile = draft.origin.kind === "user" && draft.origin.id === name;
        setStatus("Saving...");
        try {
            const res = await rpc.saveTheme({
                name,
                text: (await import("../../theme/draft")).serialize(plan.raw),
                overwrite: opts.overwrite || sameFile,
                backup: sameFile && draft.origin.kind === "user" && draft.origin.hadComments,
                copies: plan.copies,
            });
            const next: CreatorDraft = { name, origin: { kind: "user", id: res.id, dir: userDir, hadComments: false }, raw: plan.raw, pendingCopies: {} };
            cache.current.clear();
            setHistory((h) => ({ ...h, present: next }));
            setSavedJson(JSON.stringify(plan.raw));
            store(null);
            await refreshThemes();
            if (opts.useNow) await setSetting("theme", res.id);
            else if (setting("theme") === res.id) await reloadTheme();
            setStatus(`✓ Saved as ${name}${opts.useNow ? " and in use" : ""}`);
            return "ok";
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(message === "exists" ? "" : `Not saved: ${message}`);
            return message === "exists" ? "exists" : message;
        }
    };

    const saveAs = () =>
        showDialog(<SaveAsDialog initial={draft.name} bundled={themes.filter((t) => t.source === "bundled").map((t) => t.name)} onSave={save} />, {
            strTitle: "Save theme as",
            popupWidth: 480,
            popupHeight: 400,
        });

    const remove = (entry: ThemeEntry) =>
        showDialog(
            <DeleteDialog
                entry={entry}
                onDelete={async (assetsToo) => {
                    try {
                        await rpc.deleteTheme(entry.id, assetsToo);
                        if (setting("theme") === entry.id) await setSetting("theme", STEAM_DEFAULT_THEME);
                        await refreshThemes();
                        setStatus(`✓ Deleted ${entry.name}`);
                    } catch (error) {
                        setStatus(`Not deleted: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }}
            />,
            { strTitle: "Delete theme", popupWidth: 460, popupHeight: 300 },
        );

    const close = () => {
        if (!dirty) return closeModal?.();
        showDialog(
            <ConfirmModal
                strTitle="Discard changes?"
                strDescription={`Your changes to ${draft.name} are not saved. They stay offered on the Start page next time.`}
                strOKButtonText="Discard"
                strCancelButtonText="Keep editing"
                onOK={() => closeModal?.()}
            />,
            { strTitle: "Theme Creator", popupWidth: 440, popupHeight: 240 },
        );
    };

    const test = async (items: PreviewItem[]) => {
        if (!resolved.theme) return;
        const each = (resolved.theme.displayTimeMs ?? 5000) + 1500;
        try {
            await loadDraft(draft.raw, assets, items.length * each + 2000);
            for (const item of items) {
                if (item.kind === "achievement") await deps.previewTier(item.tier);
                else await deps.preview(item.id);
            }
            setStatus("● Testing on screen; your theme comes back after the last toast");
        } catch (error) {
            setStatus(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
            void clearDraft();
        }
    };

    // --- layout ----------------------------------------------------------------------------------

    const isUser = draft.origin.kind === "user";
    const tierPage = page.startsWith("tier:") ? (page.slice(5) as Tier) : null;
    const editor = (() => {
        switch (page) {
            case "start":
                return (
                    <StartPage
                        themes={themes}
                        restorable={restorable}
                        onFresh={() => open(freshDraft(), null)}
                        onOpen={(t) => void openTheme(t)}
                        onDelete={remove}
                        onRestore={(d) => open(d, null)}
                    />
                );
            case "placement":
                return <PlacementPage />;
            case "card":
                return <CardPage />;
            case "text":
                return <TextPage />;
            case "icons":
                return <IconsPage />;
            case "sound":
                return <SoundPage />;
            case "achievements":
                return <AchievementsPage />;
            case "code":
                return <CodePage onStatus={setStatus} />;
            default:
                return tierPage ? <TierPage tier={tierPage} images={files.images} /> : null;
        }
    })();

    const column: React.CSSProperties = { overflowY: "auto", height: "100%", boxSizing: "border-box" };
    return (
        <CreatorContext.Provider value={api}>
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 16px)", minHeight: 560, background: "#1b1e24", color: "#dcdedf" }}>
                <div style={{ display: "grid", gridTemplateColumns: "190px minmax(420px, 1fr) minmax(400px, 480px)", flex: 1, minHeight: 0 }}>
                    <nav style={{ ...column, borderRight: "1px solid rgba(255,255,255,.08)", padding: "8px 0" }}>
                        <div style={{ padding: "4px 14px 10px", fontSize: 12, color: "#8f98a0" }}>{draft.name}{dirty ? " •" : ""}</div>
                        {PAGES.map((p) => (
                            <div key={p.id}>
                                {p.group && <div style={{ margin: "10px 14px 4px", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#67707b" }}>{p.group}</div>}
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setPage(p.id)}
                                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPage(p.id)}
                                    style={{
                                        padding: "7px 14px",
                                        cursor: "pointer",
                                        whiteSpace: "pre",
                                        fontSize: 13,
                                        color: page === p.id ? "#fff" : "#b8bcbf",
                                        background: page === p.id ? "rgba(26,159,255,.18)" : "transparent",
                                        borderLeft: `3px solid ${page === p.id ? "#1a9fff" : "transparent"}`,
                                    }}
                                >
                                    {p.label}
                                </div>
                            </div>
                        ))}
                    </nav>
                    <section style={{ ...column, borderRight: "1px solid rgba(255,255,255,.08)" }}>
                        <ColumnBoundary name="Preview">
                            <PreviewColumn
                                theme={view}
                                warnings={warnings}
                                assets={assets}
                                BannerCard={deps.BannerCard}
                                game={game}
                                previewIds={deps.previewOptions.map((o) => o.id)}
                                previewLabels={Object.fromEntries(deps.previewOptions.map((o) => [o.id, o.label]))}
                                onModeChange={setMode}
                                onTest={(items) => void test(items)}
                                testDisabled={!deps.canTest() || !resolved.theme}
                            />
                        </ColumnBoundary>
                    </section>
                    <section style={{ ...column, padding: "0 4px" }}>
                        <ColumnBoundary name="Editor">{editor}</ColumnBoundary>
                    </section>
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", padding: "0 12px" }}>
                    <ActionRow message={status || (dirty ? "● Unsaved changes" : undefined)}>
                        <IconButton title="Undo (Ctrl+Z)" disabled={!history.past.length} onClick={() => setHistory(undo)}>
                            ↶
                        </IconButton>
                        <IconButton title="Redo (Ctrl+Y)" disabled={!history.future.length} onClick={() => setHistory(redo)}>
                            ↷
                        </IconButton>
                        <DialogButton style={BUTTON_STYLE} onClick={saveAs}>
                            Save as...
                        </DialogButton>
                        {isUser && (
                            <DialogButton style={BUTTON_STYLE} disabled={!dirty} onClick={() => void save(draft.name, { overwrite: true, useNow: false })}>
                                Save
                            </DialogButton>
                        )}
                        <DialogButton style={BUTTON_STYLE} onClick={close}>
                            Close
                        </DialogButton>
                    </ActionRow>
                </div>
            </div>
        </CreatorContext.Provider>
    );
}

function StartPage({
    themes,
    restorable,
    onFresh,
    onOpen,
    onDelete,
    onRestore,
}: {
    themes: ThemeEntry[];
    restorable: { draft: CreatorDraft; at: number } | null;
    onFresh: () => void;
    onOpen: (t: ThemeEntry) => void;
    onDelete: (t: ThemeEntry) => void;
    onRestore: (d: CreatorDraft) => void;
}) {
    const [restore, setRestore] = useState(restorable);
    const templates = themes.filter((t) => t.source === "bundled");
    const mine = themes.filter((t) => t.source === "user");
    const minutes = restore ? Math.max(1, Math.round((Date.now() - restore.at) / 60000)) : 0;
    return (
        <>
            {restore && (
                <PanelSection title="Unsaved">
                    <ItemRow>
                        <Field label={`Unsaved theme: ${restore.draft.name}`} description={`Edited ${minutes} min ago`} bottomSeparator="none">
                            <div style={{ display: "flex", gap: 8 }}>
                                <DialogButton style={BUTTON_STYLE} onClick={() => onRestore(restore.draft)}>
                                    Restore
                                </DialogButton>
                                <DialogButton
                                    style={BUTTON_STYLE}
                                    onClick={() => {
                                        store(null);
                                        setRestore(null);
                                    }}
                                >
                                    Forget
                                </DialogButton>
                            </div>
                        </Field>
                    </ItemRow>
                </PanelSection>
            )}
            <PanelSection title="New">
                <ButtonRow label="Start fresh" description="Steam's own look; change what you want" buttonLabel="Start" onClick={onFresh} />
            </PanelSection>
            {templates.length > 0 && (
                <PanelSection title="Templates">
                    {templates.map((t) => (
                        <ButtonRow key={t.id} label={t.name} description="Bundled; saved as your own copy" buttonLabel="Use" onClick={() => onOpen(t)} />
                    ))}
                </PanelSection>
            )}
            {mine.length > 0 && (
                <PanelSection title="My themes">
                    {mine.map((t) => (
                        <ItemRow key={t.id}>
                            <Field label={t.ext === ".jsonc" ? t.name : `${t.name} (json)`} description="Yours" bottomSeparator="none">
                                <div style={{ display: "flex", gap: 8 }}>
                                    <DialogButton style={BUTTON_STYLE} onClick={() => onOpen(t)}>
                                        Edit
                                    </DialogButton>
                                    <IconButton title="Delete" onClick={() => onDelete(t)}>
                                        🗑
                                    </IconButton>
                                </div>
                            </Field>
                        </ItemRow>
                    ))}
                </PanelSection>
            )}
        </>
    );
}

function SaveAsDialog({
    initial,
    bundled,
    onSave,
    closeModal,
}: {
    initial: string;
    bundled: string[];
    onSave: (name: string, opts: { overwrite: boolean; useNow: boolean }) => Promise<"ok" | "exists" | string>;
    closeModal?: () => void;
}) {
    const [name, setName] = useState(initial);
    const [useNow, setUseNow] = useState(true);
    const [message, setMessage] = useState("");
    const [confirmOverwrite, setConfirmOverwrite] = useState(false);
    const [busy, setBusy] = useState(false);
    const hides = bundled.some((b) => b.toLowerCase() === name.toLowerCase());
    const go = async () => {
        setBusy(true);
        const r = await onSave(name, { overwrite: confirmOverwrite, useNow });
        setBusy(false);
        if (r === "ok") return closeModal?.();
        if (r === "exists") {
            setConfirmOverwrite(true);
            setMessage(`${name} exists: Save again to replace it`);
        } else setMessage(r);
    };
    return (
        <ConfirmModal
            strTitle="Save theme as"
            strOKButtonText={confirmOverwrite ? "Replace" : "Save"}
            bOKDisabled={busy || !NAME_PATTERN.test(name)}
            onOK={() => void go()}
            closeModal={closeModal}
            strDescription={
                <PanelSection>
                    <Blocks>
                        <ItemRow trailing>
                            <div style={{ marginBottom: -STEAM_TRAILING + 22 }}>
                                <TextField
                                    label="Name"
                                    description="Letters, digits, _ and -"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        setConfirmOverwrite(false);
                                        setMessage("");
                                    }}
                                />
                            </div>
                        </ItemRow>
                        <ControlledToggleRow label="Use it now" description="Make it the active theme after saving" value={useNow} onChange={setUseNow} />
                        {hides && (
                            <ItemRow>
                                <Field label="Hides a bundled theme" description={`Your ${name} will be used instead of the bundled ${name}`} />
                            </ItemRow>
                        )}
                        {message && <ActionRow message={message} />}
                    </Blocks>
                </PanelSection>
            }
        />
    );
}

function DeleteDialog({ entry, onDelete, closeModal }: { entry: ThemeEntry; onDelete: (assets: boolean) => Promise<void>; closeModal?: () => void }) {
    const [assetsToo, setAssetsToo] = useState(true);
    return (
        <ConfirmModal
            strTitle={`Delete ${entry.name}?`}
            strOKButtonText="Delete"
            bDestructiveWarning
            closeModal={closeModal}
            onOK={() => void onDelete(assetsToo)}
            strDescription={
                <PanelSection>
                    <ControlledToggleRow label="Also delete its assets folder" description={`The ${entry.name} folder next to the theme, if any`} value={assetsToo} onChange={setAssetsToo} />
                </PanelSection>
            }
        />
    );
}
