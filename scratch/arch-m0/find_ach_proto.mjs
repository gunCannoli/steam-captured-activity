// K17 debugging (read-only): find Steam's achievement-notification protobuf module signatures live.
// Reports, for each module whose source mentions the given needles, which needles it has and what it exports.
//   node scratch/arch-m0/find_ach_proto.mjs
import { pick, session } from "./cdp.mjs";
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const r = await s.send("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => {
    const chunks = globalThis.webpackChunksteamui; let req;
    const key = "__probe_" + Date.now();
    chunks.push([[key], { [key]: (m, e, r) => (req = r) }, (r) => { r((r.s = key)); }]);
    const out = [];
    for (const [id, f] of Object.entries(req.m)) {
      const src = String(f);
      const a = src.includes("achievement_id"), b = src.includes("global_achieved_pct"), c = src.includes("CClientNotificationAchievement"), d = src.includes("set_achievement_id");
      if (a || c) out.push({ id, achievement_id: a, global_achieved_pct: b, CClientNotificationAchievement: c, set_achievement_id: d, len: src.length });
    }
    return JSON.stringify(out.slice(0, 20));
  })()`,
});
console.log(r.result?.result?.value ?? JSON.stringify(r).slice(0, 500));
process.exit(0);
