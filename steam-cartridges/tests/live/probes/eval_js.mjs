// Read-only helper: evaluate a JS expression in SharedJSContext and print the result.
//   node tests/live/probes/eval_js.mjs "<expression>"
import { pick, session } from "../cdp.mjs";
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const r = await s.send("Runtime.evaluate", { expression: process.argv[2], awaitPromise: true, returnByValue: true });
console.log(r.result?.result?.value ?? JSON.stringify(r.result ?? r).slice(0, 600));
process.exit(0);
