// Community crash investigation (git show 6ece444:docs/plans/steam-cartridges-community-crash-and-speed-investigation.md): call the backend's
// RPCs directly, the way the frontend does, one step at a time, and say after each step whether the backend still answers.
// Needs the Steam lock (a crash takes the backend down until Steam restarts). Never prints a payload, only sizes.
//   node tests/live/probes/rpc_repro.mjs <steps> [appid=2710585679]
// steps: comma list of  cover | chunk0 | chunks | images | ping   e.g. "cover,ping,chunk0,ping"
import { pick, session } from "../cdp.mjs";
const steps = (process.argv[2] ?? "cover,ping,chunk0,ping").split(",");
const appid = Number(process.argv[3] ?? 2710585679);
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl);
await s.ready;
const run = async (expression) =>
    (await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const call = (name, payload) => run(`(async () => {
  const t = Date.now();
  try {
    const raw = await Millennium.callServerMethod('steam-cartridges-dev', ${JSON.stringify(name)}, { payload: ${JSON.stringify(JSON.stringify(payload))} });
    let j = null; try { j = JSON.parse(raw); } catch {}
    return JSON.stringify({ ms: Date.now() - t, size: String(raw).length, error: j?.error, chunks: j?.chunks, keys: j ? Object.keys(j) : null, j: j && !j.base64 && String(raw).length < 200000 ? j : undefined });
  } catch (e) { return JSON.stringify({ ms: Date.now() - t, threw: String(e).slice(0, 200) }); }
})()`).then((v) => JSON.parse(v));

const fresh = await call("EnsureFresh", { appid, parts: ["media"] });
const items = fresh.j?.parts?.media?.data?.items ?? fresh.j?.media?.data?.items ?? [];
const manual = items.find((i) => i.kind === "manual");
const images = items.filter((i) => i.source === "screenscraper" && i.kind !== "manual" && i.key);
console.log(`EnsureFresh: ${fresh.ms} ms, ${items.length} items, manual key ${manual?.key ?? "none"}, ${images.length} ScreenScraper images`);
if (!manual && steps.some((x) => x.startsWith("c"))) {
    console.log("INFO no manual item; record shape: " + JSON.stringify(fresh.keys) + " " + JSON.stringify(fresh.j).slice(0, 300));
}
for (const step of steps) {
    let r;
    if (step === "cover") r = await call("GetManualCover", { appid, key: manual?.key });
    else if (step === "chunk0") r = await call("GetManualChunk", { appid, key: manual?.key, index: 0 });
    else if (step === "chunks") {
        let total = 1;
        for (let i = 0; i < total; i++) {
            r = await call("GetManualChunk", { appid, key: manual?.key, index: i });
            if (r.threw || r.error) break;
            total = r.chunks ?? total;
            console.log(`  chunk ${i}: ${r.ms} ms, ${r.size} chars`);
            if (!r.keys?.includes("chunks")) break;
        }
    } else if (step === "images") {
        for (const img of images) {
            r = await call("GetMediaImage", { appid, key: img.key });
            console.log(`  image ${img.key}: ${r.ms} ms, ${r.size} chars${r.error ? ", error " + r.error : ""}${r.threw ? ", THREW " + r.threw : ""}`);
            if (r.threw) break;
        }
    } else if (step === "ping") r = await call("GetStatus", {});
    console.log(`${step}: ${JSON.stringify({ ms: r.ms, size: r.size, error: r.error, threw: r.threw, keys: r.keys })}`);
    if (r.threw) break;
}
process.exit(0);
