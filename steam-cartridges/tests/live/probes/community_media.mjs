// Community media (features plan F2): open a shortcut with no Steam match, then check that Steam's own Community
// Content section shows our cards. Read-only apart from the navigation.
//   node tests/live/probes/community_media.mjs [appid=4263274102] [settleMs=10000]
// PASS lines: F2 feed, F2 loader, F2 cards (and F2 video when the feed has one). Needs the desktop window.
import { pick, session } from "../cdp.mjs";
const appid = Number(process.argv[2] ?? 4263274102);
const settle = Number(process.argv[3] ?? 10000);
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl);
await s.ready;
const run = async (expression) =>
    (await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

// Steam loads the Community section only when its window is visible and in desktop mode (its on-screen signal never
// arrives in a hidden window), so make sure of both first (steam-debug.md Trap 6/7; BringToFront is Steam's own call).
if ((await run(`SteamClient.UI.GetUIMode()`)) !== 7) {
    await run(`SteamClient.UI.SetUIMode(7), 1`);
    await new Promise((r) => setTimeout(r, 8000));
}
await run(`(SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.BrowserWindow?.SteamClient?.Window?.BringToFront?.(), 1)`);
await new Promise((r) => setTimeout(r, 1000));
await run(`SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator.App(${appid}),1`);
await new Promise((r) => setTimeout(r, settle));

const out = JSON.parse(await run(`(async () => {
  const P = (PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges']);
  if (!P?.communityDiagnostics) return JSON.stringify({ abort: 'the plugin does not export communityDiagnostics (not deployed?)' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const docs = [document, ...(SteamUIStore.WindowStore.SteamUIWindows || []).map((w) => w?.m_BrowserWindow?.document || w?.BrowserWindow?.document).filter(Boolean)];
  let section = 0;
  for (const d of docs) {
    const el = d.querySelector('[class*="CommunityContentContainer"]');
    if (el) { section++; el.scrollIntoView(); }
  }
  await wait(4000); // Steam loads the first page >= 1 s after the section is on screen
  let cards = 0, videos = 0, stockCards = 0;
  for (const d of docs) {
    for (const c of d.querySelectorAll('[class*="CommunityContentContainer"] [data-id]')) {
      const id = c.getAttribute('data-id') || '';
      if (/^9\\d{14}$/.test(id)) { cards++; if (c.getAttribute('data-size') === '8') videos++; } else stockCards++;
    }
  }
  const diag = P.communityDiagnostics();
  return JSON.stringify({ section, cards, videos, stockCards, diag });
})()`) ?? '{"abort":"no answer"}');

if (out.abort) {
    console.log("FAIL F2 probe: " + out.abort);
    process.exit(1);
}
const feed = out.diag.feeds?.[appid] ?? 0;
const lines = [
    [feed > 0, `F2 feed: ${feed} cards ready for ${appid}`],
    [out.diag.patched === true && out.diag.served > 0, `F2 loader: Steam's loader patched, served ${out.diag.served} time(s)`],
    [out.section > 0 && out.cards > 0 && out.stockCards === 0, `F2 cards: ${out.cards} of our cards in ${out.section} Community section(s), ${out.stockCards} stock cards`],
];
for (const [ok, text] of lines) console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
if (out.videos > 0) console.log(`PASS F2 video: ${out.videos} YouTube card(s)`);
else console.log("INFO F2 video: no video card (the IGDB game has no video, or trailers are off)");
process.exit(lines.every(([ok]) => ok) ? 0 : 1);
