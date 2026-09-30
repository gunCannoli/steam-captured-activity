// Icon plan live check: open a shortcut's page, then decode the library icon Steam holds for it
// (AppOverview icon_data, the data URL GetIconURLForApp returns) and report its format and size.
//   node tests/live/probes/shortcut_icon.mjs <appid> [sharp|exe]
//   sharp (default): opens the page first; PASS when the icon is not the exe's BMP and at least 128 px on each side
//   exe:             read only (opening the page could re-match the game); PASS when the icon is the exe's BMP again
import { pick, session } from "../cdp.mjs";
const appid = Number(process.argv[2] ?? "3135033888");
const expect = process.argv[3] ?? "sharp";
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl); await s.ready;
const r = await s.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const ov = () => appStore.GetAppOverviewByAppID(${appid});
  if (${JSON.stringify(expect)} !== "exe") {
    (SteamUIStore.ActiveWindowInstance ?? SteamUIStore.WindowStore.MainWindowInstance).Navigator.App(${appid});
    await wait(8000); // the page view resolves the artwork part and the surface writes the icon
  }
  if (ov().icon_data === undefined) { SteamClient.Apps.RequestIconDataForApp(${appid}); await wait(1500); }
  return JSON.stringify({ name: ov().display_name, format: ov().icon_data_format ?? null, data: ov().icon_data ?? null });
})()` });
const o = JSON.parse(r.result?.result?.value ?? "{}");

/** Width and height from the image header (PNG, JPEG, BMP, ICO), or null. */
function size(format, b64) {
    if (!b64) return null;
    const b = Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64");
    if (b.subarray(1, 4).toString("latin1") === "PNG") return [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (b[0] === 0x42 && b[1] === 0x4d) return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))];
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return [b[6] || 256, b[7] || 256];
    if (b[0] === 0xff && b[1] === 0xd8) {
        for (let i = 2; i + 9 < b.length; ) {
            if (b[i] !== 0xff) { i++; continue; }
            const m = b[i + 1];
            if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
            i += 2 + b.readUInt16BE(i + 2);
        }
    }
    return null;
}

const dims = size(o.format, o.data);
console.log(JSON.stringify({ appid, name: o.name, format: o.format, size: dims }));
const ok = expect === "exe"
    ? o.format === "bmp"
    : o.format !== null && o.format !== "bmp" && dims !== null && Math.min(...dims) >= 128;
console.log(ok ? `PASS icon ${expect}: ${o.name} shows a ${dims?.join("x")} ${o.format}` : `FAIL icon ${expect}: ${o.name} (${o.format} ${dims?.join("x")})`);
process.exit(ok ? 0 : 1);
