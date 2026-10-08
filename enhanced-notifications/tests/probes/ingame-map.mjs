// Consistency plan A2: launch / stop AM2R (shortcut 4263274102) and map toast views and placeholders. Usage: node tests/probes/ingame-map.mjs [launch|stop|map]
// A2 discovery: launch AM2R from Big Picture, then map toast targets and placeholders.
import { connect } from "../cdp.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const APPID = 4263274102n;
const gid = ((APPID << 32n) | 0x02000000n).toString();
const s = await connect();
const mode = process.argv[2] ?? "map";
if (mode === "launch") {
  console.log(await s.evaluate(`(() => { SteamClient.Apps.RunGame('${gid}', '', -1, 100); return 'asked'; })()`));
  for (let i = 0; i < 40; i++) { await wait(1000); const r = await s.evaluate(`JSON.stringify([...(window.NotificationStore.m_mapAppOverlayToasts?.keys?.() ?? [])])`); if (r !== "[]") { console.log("overlay contexts:", r, "after", i + 1, "s"); break; } }
}
if (mode === "stop") console.log(await s.evaluate(`(() => { SteamClient.Apps.TerminateApp('${gid}', false); return 'asked'; })()`));
const t = await (await fetch("http://127.0.0.1:8080/json")).json();
console.log("targets:", t.map((x) => x.title).filter(Boolean).join(" | "));
console.log(await s.evaluate(`(() => {
  const out = { overlay: [...(window.NotificationStore.m_mapAppOverlayToasts?.keys?.() ?? [])].map(String), docs: [] };
  for (const p of (window.g_PopupManager?.GetPopups?.() ?? [])) { const d = p.window?.document; if (!d) continue;
    const ph = d.querySelectorAll('[class*="GamepadToastPlaceholder"]');
    if (ph.length) out.docs.push({ name: p.m_strName, title: d.title, placeholders: [...ph].map(e => e.className + " @ " + JSON.stringify(e.getBoundingClientRect())), placementStyle: !!d.getElementById("enhanced-notifications-placement") }); }
  out.uiMode = SteamClient.UI.GetUIMode();
  return JSON.stringify(out);
})()`));
s.close();
