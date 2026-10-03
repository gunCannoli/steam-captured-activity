// app/store-copy: is this shortcut an Epic or Xbox copy? (ADR-0056). One EnsureFresh(["store"]) per shortcut per
// session: the backend finds the copy from the store's install data on this PC (no typing, decision 1) and names the
// game in the store's API once per game. Metadata, media and achievements then read the copy (the backend from disk,
// the frontend from the record).
import { logger } from "../logger.ts";
import type { ShortcutId } from "../kernel/appid";
import type { Part, RecordStore, Route, StoreCopy } from "../kernel/record";
import type { backend as Backend } from "../ports/backend";
import { createSessionMemo } from "./session-memo.ts";

export interface StoreCopyDeps {
    backend: Pick<typeof Backend, "ensureFresh">;
    records: RecordStore;
    /** Creates the base record if the appid has none yet (app/records.ts ensureBase). */
    ensureBase(appid: ShortcutId): void;
    titleOf(appid: number): string | undefined;
    /** Settings services.epicEnabled / xboxEnabled: may each store's API be asked. */
    stores(): { epic: boolean; xbox: boolean };
}

export interface StoreCopyResolver {
    ensure(appid: ShortcutId, route: Route): Promise<Part<StoreCopy>>;
    /** Is the shortcut a known store copy? (record only, O(1)) */
    isCopy(appid: ShortcutId): boolean;
}

export function createStoreCopy(deps: StoreCopyDeps): StoreCopyResolver {
    const memo = createSessionMemo<StoreCopy>();

    async function resolve(appid: ShortcutId, route: Route): Promise<Part<StoreCopy>> {
        deps.ensureBase(appid);
        const stores = deps.stores();
        const res = await deps.backend.ensureFresh(appid, ["store"], {
            title: deps.titleOf(appid) ?? "",
            route,
            allowEpic: stores.epic,
            allowXbox: stores.xbox,
        });
        const raw = res.error ? undefined : (res.parts.store as Part<StoreCopy> | undefined);
        const part: Part<StoreCopy> = raw ?? { status: "error", message: res.error ?? "no store part" };
        const changed = deps.records.update(appid, { store: part });
        if (changed.length > 0 && part.status === "ok") logger.info(`Store copy ${appid}: ${part.data?.kind} (${part.data?.via})`);
        return part;
    }

    return {
        ensure(appid, route) {
            return memo.run(appid, () => resolve(appid, route), () => deps.records.get(appid)?.store);
        },
        isCopy(appid) {
            const part = deps.records.get(appid)?.store;
            return part?.status === "ok" && !!part.data;
        },
    };
}
