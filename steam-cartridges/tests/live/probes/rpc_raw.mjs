// Community crash investigation: call one backend RPC with a raw payload, then ping. Never prints a payload.
//   node tests/live/probes/rpc_raw.mjs <Method> '<json payload>' [<Method2> '<json2>' ...]
import { pick, session } from "../cdp.mjs";
const s = session((await pick("SharedJSContext")).webSocketDebuggerUrl);
await s.ready;
const run = async (expression) =>
    (await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
    const [name, payload] = [args[i], args[i + 1] ?? "{}"];
    const out = await run(`(async () => { const t = Date.now(); try {
      const raw = await Millennium.callServerMethod('steam-cartridges-dev', ${JSON.stringify(name)}, { payload: ${JSON.stringify(payload)} });
      return Date.now() - t + ' ms, ' + String(raw).length + ' chars: ' + String(raw).slice(0, 120); } catch (e) { return 'THREW ' + String(e).slice(0, 150); } })()`);
    console.log(`${name}: ${out}`);
    const ping = await run(`Millennium.callServerMethod('steam-cartridges-dev','GetStatus',{payload:'{}'}).then(()=> 'alive', e => 'DEAD ' + String(e).slice(0,100))`);
    console.log(`  then: ${ping}`);
    if (ping !== "alive") break;
}
process.exit(0);
