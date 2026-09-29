// app/identity: resolves whether a shortcut has a native Steam match, through
// one EnsureFresh call instead of up to three round trips (migration plan M4c).
import { logger } from "../logger.ts";
import type { ShortcutId } from "../kernel/appid";
import type { Identity, Part, RecordStore } from "../kernel/record";
import type { backend as Backend, OwnedCandidate } from "../ports/backend";

export interface IdentityRoute {
    bucket: "steam-store" | "web-scraping" | "none";
    via: string;
}

/** A resolution failure (status "error") is retried on a view after this long. */
const RETRY_MS = 5 * 60_000;

export interface IdentityDeps {
    backend: Pick<typeof Backend, "ensureFresh">;
    records: RecordStore;
    owned(): OwnedCandidate[];
    titleOf(appid: number): string | undefined;
    now(): number;
}

export interface IdentityResolver {
    ensure(appid: ShortcutId, route: IdentityRoute): Promise<Part<Identity>>;
    invalidate(appid: ShortcutId): void;
}

export function createIdentity(deps: IdentityDeps): IdentityResolver {
    /** One resolution per appid per session; `pending` is never memoised. */
    const resolved = new Set<ShortcutId>();
    /** A resolution in flight, so a second view while it runs awaits the same call. */
    const inflight = new Map<ShortcutId, Promise<Part<Identity>>>();
    /** appid -> ms after which an "error" result may be retried. */
    const retryAt = new Map<ShortcutId, number>();

    async function resolve(appid: ShortcutId, route: IdentityRoute): Promise<Part<Identity>> {
        if (route.bucket !== "steam-store") {
            const part: Part<Identity> = { status: "unsupported" };
            deps.records.update(appid, { identity: part });
            return part;
        }

        const title = deps.titleOf(appid) ?? "";
        const res = await deps.backend.ensureFresh(appid, ["identity"], {
            title,
            route,
            owned: deps.owned(),
        });

        const raw = res.error ? undefined : (res.parts.identity as Part<Identity> | undefined);
        const part: Part<Identity> = raw ?? { status: "error", message: res.error ?? "no identity part" };

        if (part.status === "ok") {
            resolved.add(appid);
            retryAt.delete(appid);
        } else if (part.status === "error") {
            resolved.add(appid);
            retryAt.set(appid, deps.now() + RETRY_MS);
        } else if (part.status !== "pending") {
            // unsupported: resolved for the session too (no point retrying without a bucket change)
            resolved.add(appid);
        }

        logger.info(`Identity ${appid}: ${part.status} ${part.data?.native ? part.data.native.appid : "-"}`);
        deps.records.update(appid, { identity: part });
        return part;
    }

    return {
        async ensure(appid, route) {
            if (resolved.has(appid)) {
                const at = retryAt.get(appid);
                if (at === undefined || deps.now() < at) {
                    const rec = deps.records.get(appid);
                    return rec?.identity ?? { status: "pending" };
                }
                retryAt.delete(appid);
                resolved.delete(appid);
            }
            const existing = inflight.get(appid);
            if (existing) return existing;

            const promise = resolve(appid, route).finally(() => inflight.delete(appid));
            inflight.set(appid, promise);
            return promise;
        },
        invalidate(appid) {
            resolved.delete(appid);
            retryAt.delete(appid);
            inflight.delete(appid);
        },
    };
}
