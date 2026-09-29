// Read-only: Steam's activity-store state for native apps, without triggering a fetch.
//   node tests/live/probes/native_news_state.mjs [appid ...]   (default 2820820 2277560)
import { pick, session } from "../cdp.mjs";
const ids = process.argv.slice(2).map(Number);
if (!ids.length) ids.push(2820820, 2277560);
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const r = await s.send("Runtime.evaluate", {
  returnByValue: true,
  expression: `JSON.stringify(${JSON.stringify(ids)}.map((n) => { const st = appActivityStore; const e = st.m_mapAppActivity.get(n); const d = [...(e?.m_mapActivityByDay?.values() ?? [])]; return { n, entry: !!e, events: d.reduce((a, x) => a + (x.m_rgEvents?.length ?? 0), 0), requested: !!st.m_setAppFetchRequested?.has(n), loading: !!st.m_setAppsLoading?.has(n) }; }))`,
});
console.log(r.result?.result?.value ?? r.result?.value ?? JSON.stringify(r));
process.exit(0);
