// app/manuals: a ScreenScraper manual's pages for Steam's image viewer (features plan F2c, ADR-0048). The community
// surface reports that it showed a manual's viewer (`community.manual-opened`); this reads the PDF from the backend in
// chunks (ports/backend GetManualChunk), renders its pages one by one through the injected renderer (ports/pdf) and puts
// them on the manual shelf (kernel/manual-shelf), which the viewer reads. Nothing is written to disk and no URL of
// ScreenScraper reaches the frontend. A failure marks the manual failed and nothing else (ADR-0014).
// The card's cover is the manual's first page: when a shortcut's media names a manual (`record.updated`), the first
// page is rendered once per session onto a 16:9 cover and shelved, and the record is announced as updated so the
// community surface shows it. Cover and pages never read the PDF at the same time (one document in the backend).
import type { ShortcutId } from "../kernel/appid";
import type { EventBus } from "../kernel/events";
import type { ManualPage, ManualShelf } from "../kernel/manual-shelf";
import type { RecordPart } from "../kernel/record";
import type { backend as Backend } from "../ports/backend";
import type { PdfDocument, PdfRenderer } from "../ports/pdf";

/** Pages rendered at most (a longer PDF shows its first pages only). */
export const MAX_MANUAL_PAGES = 200;
/** Chunks read at most: 48 x 1 MiB, the backend's own size cap (screenscraper_media.MAX_MANUAL_BYTES). */
export const MAX_MANUAL_CHUNKS = 48;
/** A page's rendered width in pixels: the Big Picture viewer's width at its device pixel ratio, rounded up. */
export const PAGE_WIDTH = 1400;
/** The card cover's size in pixels: 16:9, drawn at twice the card's layout size (core.MANUAL_CARD_WIDTH). */
export const COVER_WIDTH = 1280;
export const COVER_HEIGHT = 720;

export interface ManualsDeps {
    backend: Pick<typeof Backend, "getManualChunk">;
    bus: Pick<EventBus, "on" | "emit">;
    shelf: ManualShelf;
    renderer: PdfRenderer;
    titleOf(appid: number): string | undefined;
    /** The key of the manual item the shortcut's media shows (the toggle applied), if any. */
    manualKeyOf(appid: number): string | undefined;
}

export interface Manuals {
    /** Subscribe to `community.manual-opened` and `record.updated`. */
    install(): void;
    /** Read, render and shelve one manual. A manual already rendered or rendering is not read again. */
    open(appid: ShortcutId, key: string): Promise<void>;
    /** Render the manual's first page as its card cover, once per session. */
    cover(appid: ShortcutId, key: string): Promise<void>;
}

export function createManuals(deps: ManualsDeps): Manuals {
    const busy = new Set<string>();
    /** Manuals whose cover was tried this session (a failure is not retried on every record update). */
    const covered = new Set<string>();
    /** One manual is read at a time: the backend keeps a single downloaded copy. */
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(task: () => Promise<T>): Promise<T> => {
        const next = queue.then(task, task);
        queue = next.catch(() => {});
        return next;
    };

    /** The PDF as base64 chunks in order, or null (an error answer, a gap, or more than MAX_MANUAL_CHUNKS). */
    async function download(appid: ShortcutId, key: string): Promise<string[] | null> {
        const chunks: string[] = [];
        let total = 1;
        for (let index = 0; index < total; index++) {
            const res = await deps.backend.getManualChunk(appid, key, index, deps.titleOf(appid));
            if (!res.base64 || res.index !== index || typeof res.chunks !== "number" || res.chunks > MAX_MANUAL_CHUNKS) return null;
            total = res.chunks;
            chunks.push(res.base64);
        }
        return chunks;
    }

    async function openNow(appid: ShortcutId, key: string): Promise<void> {
        const id = `${appid}:${key}`;
        if (busy.has(id) || deps.shelf.get(appid, key)?.status === "ready") return;
        busy.add(id);
        let doc: PdfDocument | null = null;
        try {
            deps.shelf.set(appid, key, { status: "loading", pages: [] });
            const chunks = await download(appid, key);
            doc = chunks ? await deps.renderer.open(chunks) : null;
            if (!doc || doc.pageCount < 1) {
                deps.shelf.set(appid, key, { status: "failed", pages: [] });
                return;
            }
            const count = Math.min(doc.pageCount, MAX_MANUAL_PAGES);
            let pages: ManualPage[] = Array.from({ length: count }, () => ({ width: doc!.pageWidth, height: doc!.pageHeight }));
            deps.shelf.set(appid, key, { status: "loading", pages });
            // One page at a time, in reading order: the viewer shows each as soon as it is ready.
            for (let n = 1; n <= count; n++) {
                const url = await doc.renderPage(n, PAGE_WIDTH);
                if (!url) continue;
                pages = pages.slice();
                pages[n - 1] = { ...pages[n - 1]!, url };
                deps.shelf.set(appid, key, { status: "loading", pages });
            }
            deps.shelf.set(appid, key, { status: "ready", pages });
        } catch {
            deps.shelf.set(appid, key, { status: "failed", pages: [] }); // ADR-0014: the viewer says so, nothing else
        } finally {
            doc?.destroy();
            busy.delete(id);
        }
    }

    const open = (appid: ShortcutId, key: string): Promise<void> => {
        const id = `${appid}:${key}`;
        if (busy.has(id)) return Promise.resolve();
        busy.add(id); // set here too: a second open queued behind the first must not read the PDF again
        return serial(async () => {
            busy.delete(id);
            await openNow(appid, key);
        });
    };

    async function coverNow(appid: ShortcutId, key: string): Promise<void> {
        let doc: PdfDocument | null = null;
        try {
            const chunks = await download(appid, key);
            doc = chunks ? await deps.renderer.open(chunks) : null;
            const url = doc ? await doc.renderCover(COVER_WIDTH, COVER_HEIGHT) : null;
            if (!url) return; // the placeholder cover stays (ADR-0014)
            deps.shelf.setCover(appid, key, url);
            deps.bus.emit("record.updated", { appid, parts: ["media"] as RecordPart[] }); // the community surface re-reads the cover
        } catch {
            /* the placeholder cover stays */
        } finally {
            doc?.destroy();
        }
    }

    const cover = (appid: ShortcutId, key: string): Promise<void> => {
        const id = `${appid}:${key}`;
        if (covered.has(id) || deps.shelf.cover(appid, key)) return Promise.resolve();
        covered.add(id);
        return serial(() => coverNow(appid, key));
    };

    return {
        install() {
            deps.bus.on("community.manual-opened", ({ appid, key }) => void open(appid, key));
            deps.bus.on("record.updated", ({ appid, parts }) => {
                if (!parts.includes("media")) return;
                const key = deps.manualKeyOf(appid);
                if (key) void cover(appid, key);
            });
        },
        open,
        cover,
    };
}
