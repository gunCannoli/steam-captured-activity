// Stress: the ADR-0059 run (large RetroAchievements schemas through Millennium's Lua host, now without the hot-patch of
// D3). For each game: a forced EnsureFresh of every part (the heavy path: schema download and parse, atomic save), then its
// page opened; after each, the backend must still answer, no crash folder may appear, no surface may trip its error
// budget. Ends with the timing per game.
//   node tests/live/probes/stress_ra.mjs [appid,appid,...]     (default: the three crash cases plus seven others)
// Needs the Steam lock (it navigates). Network: RetroAchievements, IGDB, ScreenScraper (the plugin's own sources).
import { readdirSync } from "node:fs";
import { evalIn } from "../cdp.mjs";

const DEFAULT = [2301220798, 4274469458, 3840266850, 2862521621, 2679328649, 2706292992, 2957503506, 2890139989, 4155033785, 3804743745];
const apps = process.argv[2] ? process.argv[2].split(",").map(Number) : DEFAULT;
const CRASHES = "C:/game/steam/millennium/crashes";
const crashCount = () => readdirSync(CRASHES).length;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) failed = true;
};

const crashesBefore = crashCount();
const rows = [];
for (const appid of apps) {
    const t0 = Date.now();
    const res = await evalIn(
        "SharedJSContext",
        `Millennium.callServerMethod("steam-cartridges-dev", "EnsureFresh", { payload: JSON.stringify({ appid: ${appid}, parts: ["identity", "metadata", "artwork", "media", "achievements"], context: { force: true } }) }).then((raw) => { const r = JSON.parse(raw); const a = r?.parts?.achievements; return JSON.stringify({ ach: a?.status, total: a?.data?.schema?.total ?? null, error: r?.error ?? null }); }).catch((e) => JSON.stringify({ error: String(e) }))`,
    ).catch((e) => JSON.stringify({ error: String(e) }));
    const fresh = JSON.parse(res || "{}");
    const ms = Date.now() - t0;
    await evalIn("SharedJSContext", `(SteamUIStore.WindowStore.SteamUIWindows.find((w) => w.Navigator?.AppProperties)?.Navigator.App(${appid}), 1)`).catch(() => 0);
    await wait(6000);
    const ping = await evalIn("SharedJSContext", `Millennium.callServerMethod("steam-cartridges-dev", "EnsureFresh", { payload: JSON.stringify({ appid: ${appid}, parts: ["identity"] }) }).then(() => "ok").catch((e) => "fail: " + e)`).catch((e) => "fail: " + e);
    const name = await evalIn("SharedJSContext", `appStore.GetAppOverviewByAppID(${appid})?.display_name ?? "?"`).catch(() => "?");
    rows.push({ appid, name, ms, ...fresh, ping });
    check(`${name}: forced refresh and page, backend still answers`, ping === "ok" && !fresh.error, `achievements ${fresh.ach}, ${fresh.total ?? "-"} in schema, ${ms} ms`);
    check(`${name}: no crash folder`, crashCount() === crashesBefore, `${crashCount() - crashesBefore} new`);
    if (crashCount() !== crashesBefore) break;
}
const safety = await evalIn("SharedJSContext", `JSON.stringify(window.PLUGIN_LIST?.["steam-cartridges-dev"]?.safetyDiagnostics?.() ?? null)`).catch(() => "null");
const diag = JSON.parse(safety || "null");
check("no surface tripped its error budget", !diag || !(diag.tripped ?? []).length, safety);
console.log("\nappid       ms     achievements  schema  name");
for (const r of rows) console.log(`${String(r.appid).padEnd(11)} ${String(r.ms).padEnd(6)} ${String(r.ach).padEnd(13)} ${String(r.total ?? "-").padEnd(7)} ${r.name}`);
console.log(failed ? "\nFAIL  stress" : "\nPASS  stress");
process.exit(failed ? 1 : 0);
