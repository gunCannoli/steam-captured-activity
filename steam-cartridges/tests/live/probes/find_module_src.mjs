// Read-only: list webpack modules whose source contains every given substring, with a context excerpt around the first.
//   node tests/live/probes/find_module_src.mjs "MarkAsPrivate" [more substrings...]
import { pick, session } from "../cdp.mjs";
const needles = process.argv.slice(2);
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl); await s.ready;
const expression = `(() => {
  const needles = ${JSON.stringify(needles)};
  let req; const key = '__probe_' + Date.now();
  webpackChunksteamui.push([[key], { [key]: (m, e, r) => { req = r; } }, (r) => { r(r.s = key); }]);
  const out = [];
  for (const id of Object.keys(req.m)) {
    let src = ''; try { src = req.m[id].toString(); } catch {}
    if (needles.every((n) => src.includes(n))) { const i = src.indexOf(needles[0]); out.push({ id, len: src.length, excerpt: src.slice(Math.max(0, i - 600), i + 600) }); }
  }
  return JSON.stringify(out);
})()`;
const r = await s.send("Runtime.evaluate", { expression, returnByValue: true });
for (const m of JSON.parse(r.result?.result?.value ?? "[]")) console.log(`--- module ${m.id} (${m.len} chars)\n${m.excerpt}\n`);
process.exit(0);
