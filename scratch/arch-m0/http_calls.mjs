// Read-only: the backend's outgoing request counters and paused sources (GetDiagnostics, M7a).
//   node scratch/arch-m0/http_calls.mjs
import { pick, session } from "./cdp.mjs";
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const r = await s.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => { const r = JSON.parse(await Millennium.callServerMethod('steam-cartridges-dev', 'GetDiagnostics', {})); return JSON.stringify({ http_calls: r.http_calls, paused: r.paused }); })()` });
console.log(r.result?.result?.value ?? JSON.stringify(r));
process.exit(0);
