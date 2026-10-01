// app/manuals: a ScreenScraper manual's pages for Steam's image viewer (features plan F2c, ADR-0048). The community
// surface reports that it showed a manual's viewer (`community.manual-opened`); this reads the PDF from the backend in
// chunks (ports/backend GetManualChunk), renders its pages one by one through the injected renderer (ports/pdf) and puts
// them on the manual shelf (kernel/manual-shelf), which the viewer reads. Nothing is written to disk and no URL of
// ScreenScraper reaches the frontend. A failure marks the manual failed and nothing else (ADR-0014).
import type { ShortcutId } from "../kernel/appid";
import type { EventBus } from "../kernel/events";
import type { ManualPage, ManualShelf } from "../kernel/manual-shelf";
import type { backend as Backend } from "../ports/backend";
import type { PdfDocument, PdfRenderer } from "../ports/pdf";

/** Pages rendered at most (a longer PDF shows its first pages only). */
export const MAX_MANUAL_PAGES = 200;
/** Chunks read at most: 48 x 1 MiB, the backend's own size cap (screenscraper_media.MAX_MANUAL_BYTES). */
export const MAX_MANUAL_CHUNKS = 48;
/** A page's rendered width in pixels: the Big Picture viewer's width at its device pixel ratio, rounded up. */
export const PAGE_WIDTH = 1400;

export interface ManualsDeps {
    backend: Pick<typeof Backend, "getManualChunk">;
    bus: Pick<EventBus, "on">;
    shelf: ManualShelf;
    renderer: PdfRenderer;
    titleOf(appid: number): string | undefined;
}

export interface Manuals {
    /** Subscribe to `community.manual-opened`. */
    install(): void;
    /** Read, render and shelve one manual. A manual already rendered or rendering is not read again. */
    open(appid: ShortcutId, key: string): Promise<void>;
}

export function createManuals(deps: ManualsDeps): Manuals {
    const busy = new Set<string>();

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

    async function open(appid: ShortcutId, key: string): Promise<void> {
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

    return {
        install() {
            deps.bus.on("community.manual-opened", ({ appid, key }) => void open(appid, key));
        },
        open,
    };
}
