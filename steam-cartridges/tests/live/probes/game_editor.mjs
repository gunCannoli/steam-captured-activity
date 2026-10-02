// Game Data editor (features plan F1) end to end through the plugin's `gameData` hook, no clicks:
// save a description, read it back from Steam's own app details, revert, read it again; search Steam's games.
// Changes one game's stored metadata for a few seconds and puts it back (also on failure). A game the user edited by
// hand is never touched: the probe moves on to the first shortcut with fetched metadata and no manual edit.
//   node tests/live/probes/game_editor.mjs [appid=4263274102]
import { pick, session } from "../cdp.mjs";
const preferred = Number(process.argv[2] ?? 4263274102);
const shared = session((await pick("SharedJSContext")).webSocketDebuggerUrl); await shared.ready;
const marker = `F1 probe ${Date.now()}`;
const expression = `(async () => {
  const P = (PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges']);
  const ed = P.gameData;
  if (!ed) return JSON.stringify({ abort: 'the plugin does not export gameData (not deployed?)' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // The game: the preferred one, else the first shortcut with fetched metadata, Steam app details and no manual edit.
  const usable = async (id) => { const s = await ed.load(id); return !s.custom && s.hasMetadata && !!appDetailsStore.GetAppData(id) ? s : null; };
  let appid = ${preferred}, s0 = await usable(appid);
  if (!s0) {
    for (const a of appStore.allApps.filter((a) => a.app_type === 1073741824)) {
      if (a.appid === ${preferred}) continue;
      s0 = await usable(a.appid);
      if (s0) { appid = a.appid; break; }
    }
  }
  if (!s0) return JSON.stringify({ abort: 'no shortcut with fetched metadata and no manual edit' });
  const desc = () => appDetailsStore.GetAppData(appid)?.descriptionsData?.strFullDescription ?? '';
  const list = (v) => (Array.isArray(v) ? v : []).join('; ');
  const date = (n) => (n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : '');
  const draftOf = (m, description) => {
    const ids = Array.isArray(m.store_category_ids) ? m.store_category_ids : null;
    const on = (flag, id) => (ids ? ids.includes(id) : m.categories?.[flag] === true);
    return {
      title: m.title, description, developers: list(m.developers), publishers: list(m.publishers),
      franchises: list(m.franchises), genres: list(m.genres), release_date: date(m.release_date),
      original_release_date: date(m.original_release_date),
      players: { single_player: on('single_player', 2), multiplayer: on('multiplayer', 1), coop: on('coop', 9), split_screen: on('split_screen', 24) },
    };
  };
  const out = { appid };
  out.before = { hasMetadata: s0.hasMetadata, link: s0.link?.steam_appid ?? null };
  try {
    await ed.save(appid, draftOf(s0.metadata, ${JSON.stringify(marker)}));
    await wait(3000);
    out.saved = { inGameInfo: desc().includes(${JSON.stringify(marker)}), custom: (await ed.load(appid)).custom };
  } finally {
    await ed.revert(appid);
    await wait(3000);
  }
  out.reverted = { gone: !desc().includes(${JSON.stringify(marker)}), custom: (await ed.load(appid)).custom };
  const found = await ed.search('Jotunnslayer');
  out.search = { count: found.candidates.length, hasJotunnslayer: found.candidates.some((c) => c.steam_appid === 2820820), error: found.error ?? null };
  return JSON.stringify(out);
})()`;
const r = await shared.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
shared.close();
const raw = r.result?.result?.value;
if (!raw) { console.log("FAIL evaluate", JSON.stringify(r.result).slice(0, 400)); process.exit(1); }
const out = JSON.parse(raw);
if (out.abort) { console.log("FAIL", out.abort); process.exit(1); }
console.log(JSON.stringify(out));
let bad = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) bad++; };
check("F1 save: the new description reaches Steam's Game Info and the game is custom", out.saved?.inGameInfo === true && out.saved?.custom === true);
check("F1 revert: the marker is gone and the game is no longer custom", out.reverted?.gone === true && out.reverted?.custom === false);
check("F1 search: Steam's games are found without linking anything", out.search?.hasJotunnslayer === true && !out.search?.error);
process.exit(bad ? 1 : 0);
