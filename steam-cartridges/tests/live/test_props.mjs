// M0a verification: open Properties for an appid and report whether SharedJSContext stays
// responsive. Prints "appid <n> page=true: OK" or "HUNG after ~Ns".
//   node tests/live/test_props.mjs <appid> [--page] [--pre "<js to eval in SJC before opening>"]
import { pick, session, targets } from "./cdp.mjs";
const APPID = Number(process.argv[2]);
// Without an appid it would open Properties for NaN, which leaves the client on an empty
// /routes/app/NaN/properties page (seen 2026-10-01: Big Picture showed only MENU / BACK).
if (!Number.isInteger(APPID) || APPID <= 0) {
  console.log("usage: node tests/live/test_props.mjs <appid> [--page] [--pre \"<js>\"]");
  process.exit(2);
}
const withPage = process.argv.includes("--page");
const preIdx = process.argv.indexOf("--pre");
const pre = preIdx > 0 ? process.argv[preIdx + 1] : null;
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const ev = (expression, ms = 5000) => Promise.race([
  s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    .then((r) => r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description?.slice(0, 600) } : r.result?.result?.value),
  new Promise((r) => setTimeout(() => r("__TIMEOUT__"), ms))]);
const nav = `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator`;
if (pre) console.log("pre:", JSON.stringify(await ev(pre)));
if (withPage) { await ev(`${nav}.App(${APPID})`); await new Promise((r) => setTimeout(r, 4000)); }
const before = (await targets()).map((x) => x.id);
await ev(`(${nav}.AppProperties(${APPID}), 1)`, 3000);
let verdict = "OK";
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if ((await ev("1+1", 3000)) === "__TIMEOUT__") { verdict = `HUNG after ~${i + 1}s`; break; }
}
const fresh = (await targets()).filter((x) => !before.includes(x.id));
console.log(`appid ${APPID} page=${withPage}: ${verdict}; popup=${JSON.stringify(fresh.map((f) => f.title))}`);
if (verdict === "OK") {
  const v = await (await fetch("http://127.0.0.1:8080/json/version")).json();
  const b = session(v.webSocketDebuggerUrl); await b.ready;
  for (const f of fresh) await b.send("Target.closeTarget", { targetId: f.id });
  b.close();
}
s.close();
process.exit(0);
