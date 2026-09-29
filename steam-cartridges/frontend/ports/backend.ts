// The record facade RPC client (migration plan M4b/M4c; M5a extends it with
// metadata and GetAllRecords). Imports kernel types only; transport from
// ports/transport.ts.
import type { ArtworkUrls, GameMetadata, Identity, Part, RecordPart } from "../kernel/record";
import { call } from "./transport";

export interface OwnedCandidate {
    appid: number;
    name: string;
}

export interface FreshContext {
    /** The shortcut's display name (""  when unknown). */
    title: string;
    /** The frontend's evaluated routing policy (ADR-0040). */
    route: { bucket: "steam-store" | "web-scraping" | "none"; via: string };
    /** Identity only: natives Steam already knows (sensors/owned-apps). */
    owned?: OwnedCandidate[];
    /** Metadata only (M5): StoreItemCache data for identity.native. */
    storeItem?: GameMetadata | null;
    /** Metadata only (M5): igdb enabled and allowed by routing. */
    allowWeb?: boolean;
    /** Metadata and artwork: the identity the frontend already knows. An "ok" result with no
     *  native match is never persisted, so the backend cannot recover it from disk. */
    identity?: Part<Identity>;
    /** Artwork only (M5c): hashed StoreItemCache URLs for the mapped native app. */
    artUrls?: ArtworkUrls;
    /** Artwork only (M5c): services.steamgriddbEnabled and routing allow SteamGridDB. */
    allowSgdb?: boolean;
    /** true = disk and context only (bulk re-evaluation). */
    noNetwork?: boolean;
    /** Achievements only (M6a): setting raHardcoreMode. */
    hardcore?: boolean;
    /** M7a: ignore TTLs, never a custom_override record. */
    force?: boolean;
}

export interface RecordResponse {
    appid: number;
    parts: Partial<Record<RecordPart, Part<unknown>>>;
    /** Set instead of parts when the call failed. */
    error?: string;
}

export const backend = {
    /** Disk only. */
    getGameRecord(appid: number): Promise<RecordResponse> {
        return call<RecordResponse>("GetGameRecord", { appid });
    },
    ensureFresh(appid: number, parts: RecordPart[], ctx: FreshContext): Promise<RecordResponse> {
        return call<RecordResponse>("EnsureFresh", { appid, parts, context: ctx });
    },
    /** Disk only: every DB record and every saved mapping (M5a). */
    getAllRecords(): Promise<{ records: Record<string, RecordResponse["parts"]> }> {
        return call<{ records: Record<string, RecordResponse["parts"]> }>("GetAllRecords", {});
    },
};
