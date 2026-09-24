import { connect } from './cdp.mjs'; const c=await connect();
console.log(await c.evaluate(`Millennium.callServerMethod('sc-probe-dev','Probe',{}).then(r=>typeof r==='string'?r:JSON.stringify(r))`)); c.close();
