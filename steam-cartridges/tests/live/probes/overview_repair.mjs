// K6 live check: clear the release date Game Info wrote onto AM2R's overview, let Steam "update" the overview
// (the OnAppOverviewChange call UpdateAppOverview makes), and expect the repair to come from the trigger (viaTrigger +1), not a render.
//   node tests/live/probes/overview_repair.mjs [appid=4263274102]
import { pick, session } from "../cdp.mjs";
const appid = process.argv[2] ?? "4263274102";
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl); await s.ready;
const r = await s.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const P = PLUGIN_LIST['steam-cartridges-dev'];
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const ov = () => appStore.GetAppOverviewByAppID(${appid});
  (SteamUIStore.ActiveWindowInstance ?? SteamUIStore.WindowStore.MainWindowInstance).Navigator.App(${appid});
  await wait(6000); // the page view makes the plugin enrich the overview
  const before = P.gameInfoRepairDiagnostics();
  const date = ov().rt_original_release_date;
  ov().rt_original_release_date = 1;            // what a Steam rebuild does to our field
  let err = null; try { collectionStore.OnAppOverviewChange([ov()], []); } catch (e) { err = String(e); } // the call UpdateAppOverview makes after replacing an overview
  await wait(1500);
  const after = P.gameInfoRepairDiagnostics();
  return JSON.stringify({ dateBefore: date, dateAfter: ov().rt_original_release_date, err, before, after });
})()` });
const o = JSON.parse(r.result?.result?.value ?? "{}");
console.log(JSON.stringify(o));
const ok = o.dateBefore > 1 && o.dateAfter === o.dateBefore && o.after.viaTrigger === o.before.viaTrigger + 1 && o.after.viaRender === o.before.viaRender;
console.log(ok ? "PASS K6 repair comes from the overview-rebuild trigger" : "FAIL K6");
process.exit(ok ? 0 : 1);
