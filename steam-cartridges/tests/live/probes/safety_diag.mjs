// Read-only: the plugin's kill-switch / error-budget diagnostics.
import { pick, session } from "../cdp.mjs";
const t = await pick("SharedJSContext");
const s = session(t.webSocketDebuggerUrl);
await s.ready;
const r = await s.send("Runtime.evaluate", { returnByValue: true, expression: `JSON.stringify((PLUGIN_LIST['steam-cartridges-dev'] ?? PLUGIN_LIST['steam-cartridges']).safetyDiagnostics())` });
console.log(r.result?.result?.value ?? JSON.stringify(r));
process.exit(0);
