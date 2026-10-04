// One-time conversion (ADR-0058, the user's decision E): point the user's Xbox UWP shortcuts at the game's own exe.
// Each target is checked by name before it is changed; the appid stays (SetShortcutExe / SetShortcutStartDir).
//   node convert_u0.mjs            -> dry run (prints what would change)
//   node convert_u0.mjs --apply
import { pick, session } from "../../cdp.mjs";
const WA = String.raw`C:\Program Files\WindowsApps`;
const TARGETS = [
    { appid: 2663546656, name: /Minesweeper/, root: String.raw`${WA}\Microsoft.MicrosoftMinesweeper_4.7.9021.0_x64__8wekyb3d8bbwe`, exe: "Minesweeper.exe" },
    { appid: 2527215573, name: /Sudoku/, root: String.raw`${WA}\Microsoft.MicrosoftSudoku_2.13.7281.0_x64__8wekyb3d8bbwe`, exe: "Microsoft Sudoku.exe" },
    { appid: 2426089520, name: /Word Games|Wordament/, root: String.raw`${WA}\Microsoft.Studios.Wordament_4.7.7281.0_x64__8wekyb3d8bbwe`, exe: "Microsoft Ultimate Word Games.exe" },
];
const apply = process.argv.includes("--apply");
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl);
await s.ready;
const ev = async (expression) => (await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
for (const t of TARGETS) {
    const name = await ev(`appStore.GetAppOverviewByAppID(${t.appid})?.display_name || ""`);
    if (!t.name.test(name)) { console.log(`skip ${t.appid}: name is "${name}"`); continue; }
    const exe = `"${t.root}\\${t.exe}"`, dir = `"${t.root}\\"`;
    console.log(`${apply ? "set" : "would set"} ${t.appid} "${name}": exe=${exe} dir=${dir} options=""`);
    if (apply) await ev(`(() => { const A = SteamClient.Apps; A.SetShortcutExe(${t.appid}, ${JSON.stringify(exe)}); A.SetShortcutStartDir(${t.appid}, ${JSON.stringify(dir)}); A.SetShortcutLaunchOptions(${t.appid}, ""); return 1; })()`);
}
process.exit(0);
