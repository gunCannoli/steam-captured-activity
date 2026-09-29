// M0a: reproduce the Properties crash for WUCHANG (3135033888) and capture every
// exception / console error in SharedJSContext while it happens.
//   node repro_properties.mjs [appid] [--no-page]
import { pick, session, targets } from "../cdp.mjs";
const APPID = Number(process.argv[2] || 3135033888);
const skipPage = process.argv.includes("--no-page");
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const events = [];
const t0 = Date.now();
s.on((m) => {
    if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        events.push({ t: Date.now() - t0, kind: "exception",
            text: (d.exception?.description || d.text || "").slice(0, 2500) });
    } else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
        const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 2500);
        events.push({ t: Date.now() - t0, kind: "console." + m.params.type, text,
            stack: (m.params.stackTrace?.callFrames || []).slice(0, 8).map((f) => `${f.functionName}@${f.url.split("/").pop()}:${f.lineNumber}`) });
    }
});
await s.send("Runtime.enable");
// Trap 5: drop replayed old logs.
await new Promise((r) => setTimeout(r, 1500));
events.length = 0;
const ev = (expression) => s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    .then((r) => r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description?.slice(0, 800) } : r.result?.result?.value);
const before = (await targets()).map((x) => x.id);
const nav = `SteamUIStore.WindowStore.SteamUIWindows.find(w=>w.Navigator?.AppProperties)?.Navigator`;
if (!skipPage) {
    console.log("open page:", JSON.stringify(await ev(`(()=>{const n=${nav};n.App(${APPID});return !!n})()`)));
    await new Promise((r) => setTimeout(r, 4000));
    events.push({ t: Date.now() - t0, kind: "marker", text: "---- page opened, now opening Properties ----" });
}
console.log("open properties:", JSON.stringify(await ev(`(()=>{const n=${nav};n.AppProperties(${APPID});return 'called'})()`)));
await new Promise((r) => setTimeout(r, 6000));
const after = await targets();
const fresh = after.filter((x) => !before.includes(x.id)).map((x) => ({ title: x.title, url: x.url.slice(0, 90) }));
console.log("new targets:", JSON.stringify(fresh));
console.log("events:", events.length);
for (const e of events) console.log(JSON.stringify(e));
s.close();
process.exit(0);
