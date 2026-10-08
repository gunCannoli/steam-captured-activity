// Consistency plan A2: which element of the game-overlay toast view is still opaque after our exit (the card). Usage: node tests/probes/ingame-card.mjs [TestCall()]
// A2: what is still opaque in the game-overlay toast view after our exit fade (the top-left frame shows it).
import { connect } from "../cdp.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await connect();
const fire = process.argv[2] ?? "TestDownloadComplete(435150)";
const probe = `(() => {
  let view = null;
  for (const p of g_PopupManager.GetPopups()) {
    const d = p.window?.document;
    if (!/Overlay/.test(d?.title ?? "")) continue;
    const el = d.querySelector("[class*=GamepadToastPlaceholder]");
    const k = Object.keys(el).find((x) => x.startsWith("__reactFiber"));
    for (let f = el[k], i = 0; f && i < 4 && !view; f = f.return, i++)
      for (let h = f.memoizedState, j = 0; h && j < 16; h = h.next, j++)
        if (h.memoizedState?.GetViewWindow) { view = h.memoizedState.GetViewWindow(); break; }
  }
  if (!view) return ["no view"];
  const name = (e) => String(e.className || e.tagName).split(" ").filter((c) => !c.startsWith("_")).slice(0, 3).join(".");
  const out = [];
  const tpl = view.document.querySelector("[class*=GamepadToastPopup] > *");
  if (!tpl) out.push("no toast element");
  for (let e = tpl; e; e = e.parentElement) {
    const cs = view.getComputedStyle(e);
    out.push(name(e) + " bg=" + cs.backgroundColor + (cs.backgroundImage !== "none" ? " img=" + cs.backgroundImage.slice(0, 90) : "") + " op=" + cs.opacity + " anim=" + cs.animationName);
  }
  if (tpl) for (const c of tpl.querySelectorAll("*")) {
    const cs = view.getComputedStyle(c);
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none") out.push("  inside " + name(c) + " bg=" + cs.backgroundColor + " op=" + cs.opacity);
    if (out.length > 16) break;
  }
  return out;
})()`;
await s.evaluate(`(NotificationStore.${fire}, true)`);
for (const at of [1500, 4500]) {
  await wait(at === 1500 ? 1500 : 3000);
  console.log(`== ${at} ms`);
  for (const line of await s.evaluate(probe)) console.log(line);
}
s.close();
