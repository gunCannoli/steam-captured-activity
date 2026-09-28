import { evalIn } from "./cdp.mjs";
const expr = process.argv[2];
const target = process.argv[3] || "SharedJSContext";
const v = await evalIn(target, expr);
console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1));
process.exit(0);
