import { connect } from './cdp.mjs';
const c = await connect();
const r = await c.evaluate(`(() => {
  const cs = window.collectionStore; const out = {};
  out.ctor = cs?.constructor?.name;
  out.keys = Object.getOwnPropertyNames(Object.getPrototypeOf(cs)).slice(0,80);
  out.ownKeys = Object.keys(cs).slice(0,60);
  const uc = cs.userCollections; out.ucType = uc?.constructor?.name; out.ucLen = uc?.length;
  out.cols = (uc||[]).slice(0,40).map(x => ({ctor:x.constructor.name,id:x.id,name:x.displayName,isDyn:x.bIsDynamic, keys:Object.keys(x).slice(0,25), protoKeys:Object.getOwnPropertyNames(Object.getPrototypeOf(x)).slice(0,60), appsType:x.apps?.constructor?.name, appsSize:x.apps?.size, allApps:x.allApps?.length, hasFn: typeof x.apps?.has}));
  return out;
})()`);
console.log(JSON.stringify(r, null, 1).slice(0, 9000));
c.close();
