import { connect } from './cdp.mjs'; const c=await connect();
console.log(JSON.stringify(await c.evaluate(`Object.keys(window.PLUGIN_LIST)`))); c.close();
