import { rpc } from './rpc';

/**
 * In-memory cache for capture images.
 *
 * Images arrive as base64 data URIs rather than URLs (ADR-0017:
 * `steamloopback.host` is jailed to `<Steam>/steamui/` and cannot reach
 * `userdata/`). The browser cannot cache a data URI the way it caches a URL, so
 * re-rendering a page would otherwise re-fetch and re-encode every image.
 *
 * Thumbnails are ~11 KB, so holding a library's worth is cheap. Full-size
 * images are ~1 MB, so they are capped and evicted.
 */

const thumbnails = new Map<string, string>();

/** Full images are large; keep only the few most recently opened. */
const FULL_IMAGE_LIMIT = 8;
const fullImages = new Map<string, string>();

/** In-flight requests, so concurrent callers share one round trip. */
const pending = new Map<string, Promise<string | undefined>>();

function rememberFull(path: string, uri: string): void {
  // Map preserves insertion order, so the first key is the oldest.
  if (fullImages.size >= FULL_IMAGE_LIMIT) {
    const oldest = fullImages.keys().next().value;
    if (oldest !== undefined) fullImages.delete(oldest);
  }
  fullImages.set(path, uri);
}

/**
 * Fetch thumbnails in bulk, returning only those that resolved.
 *
 * Paths already cached are not re-requested. A path that fails (deleted file,
 * budget exhausted) is simply absent from the result — callers render a
 * placeholder rather than treating it as an error.
 */
export async function loadThumbnails(paths: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p) => p && !thumbnails.has(p)))];

  if (wanted.length > 0) {
    const results = await rpc.getAssets(wanted);
    for (const [path, result] of Object.entries(results)) {
      if (result.ok && result.uri) thumbnails.set(path, result.uri);
    }
  }

  const out = new Map<string, string>();
  for (const path of paths) {
    const uri = thumbnails.get(path);
    if (uri) out.set(path, uri);
  }
  return out;
}

/** Fetch one full-size image, on demand. */
export async function loadFullImage(path: string): Promise<string | undefined> {
  const cached = fullImages.get(path);
  if (cached) return cached;

  const inFlight = pending.get(path);
  if (inFlight) return inFlight;

  const request = rpc
    .getAsset(path)
    .then((result) => {
      if (!result.ok || !result.uri) return undefined;
      rememberFull(path, result.uri);
      return result.uri;
    })
    .finally(() => pending.delete(path));

  pending.set(path, request);
  return request;
}

/** Cached thumbnail, if one has already been loaded. */
export function peekThumbnail(path: string | undefined): string | undefined {
  return path ? thumbnails.get(path) : undefined;
}

/** Drop everything. Called when a game quits and its media may have changed. */
export function clearAssetCache(): void {
  thumbnails.clear();
  fullImages.clear();
}
