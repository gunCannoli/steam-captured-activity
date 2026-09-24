import { connect } from './cdp.mjs';
const c = await connect();
const U=2820820;
console.log(JSON.stringify(await c.evaluate(`(()=>{const o=window.appStore.GetAppOverviewByAppID(${U}); const s=window.StoreItemCache; s.QueueAppRequest(${U},{include_assets:true,include_basic_info:true,include_release:true,include_full_description:true}); return {owned:o?o.display_name:null}})()`)));
await new Promise(r=>setTimeout(r,4000));
console.log(JSON.stringify(await c.evaluate(`(()=>{const s=window.StoreItemCache; const has=s.BHasApp(${U}); const it=has?s.GetApp(${U}):null; if(!it) return {has}; const out={has, keys:Object.keys(it).slice(0,30)}; const d=it.GetStoreItemData?it.GetStoreItemData():it; out.dk=Object.keys(d).slice(0,40); out.name=d.name; out.basic=JSON.stringify(d.basic_info||null).slice(0,500); out.assets=JSON.stringify(d.assets||null).slice(0,600); out.rel=JSON.stringify(d.release||null).slice(0,200); out.cat=JSON.stringify(d.categories||null).slice(0,200); return out;})()`)));
c.close();
