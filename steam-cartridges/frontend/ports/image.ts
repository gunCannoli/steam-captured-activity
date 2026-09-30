// Port: fetch an image over HTTP for app/ to put in a plan (icon plan). Read-only network I/O; it
// never touches Steam. The backend cannot do this: Millennium's Lua http.get cuts a binary body at
// its first NUL byte (icon plan § 11).

/** Bytes of one image URL as base64, or null. SteamGridDB's CDN blocks cross-origin fetches: retry through wsrv.nl. */
export async function fetchImage(url: string): Promise<{ base64: string; ext: string } | null> {
    const attempt = async (target: string): Promise<Blob | null> => {
        try {
            const resp = await fetch(target);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            return blob.size >= 100 ? blob : null;
        } catch {
            return null;
        }
    };
    let blob = await attempt(url);
    if (!blob && url.includes('steamgriddb.com')) blob = await attempt('https://wsrv.nl/?url=' + url.replace(/^https?:\/\//, ''));
    if (!blob) return null;
    const found = blob;
    const base64 = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result ? result.substring(result.indexOf(',') + 1) : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(found);
    });
    if (!base64) return null;
    const lower = url.toLowerCase();
    const ext = found.type === 'image/jpeg' || lower.includes('.jpg') || lower.includes('.jpeg') ? 'jpg' : found.type === 'image/x-icon' || lower.includes('.ico') ? 'ico' : 'png';
    return { base64, ext };
}
