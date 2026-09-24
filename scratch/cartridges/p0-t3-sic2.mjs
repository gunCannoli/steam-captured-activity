import { connect } from './cdp.mjs';
const c = await connect();
const U=2820820;
console.log(JSON.stringify(await c.evaluate(`(()=>{const it=window.StoreItemCache.GetApp(${U}); const j=(x,n=500)=>JSON.stringify(x??null).slice(0,n); const a=it.m_Assets; return {name:it.m_strName,type:it.m_eAppType,basic:j(it.m_BasicInfo,700),assets:j(a,900),ak:Object.getOwnPropertyNames(Object.getPrototypeOf(a)).slice(0,30),rel:j(it.m_ReleaseInfo,200),cats:j(it.m_StoreCategories,150),tags:j(it.m_rgStoreTagIDs,100), full:(it.m_strFullDescriptionBBCode||'').length, hasGetAssets: typeof it.GetAssets, urls: typeof it.GetAssets==='function'? j(it.GetAssets(),100):null}})()`)));
console.log(JSON.stringify(await c.evaluate(`(async()=>{const it=window.StoreItemCache.GetApp(${U}); const a=it.GetAssets(); const P=Object.getOwnPropertyNames(Object.getPrototypeOf(a)); const out={P, urls:{}}; for(const m of P){ if(/Hero|Capsule|Logo|Header/i.test(m)&&typeof a[m]==='function'){ try{ out.urls[m]=a[m]()}catch(e){out.urls[m]='ERR'} } } out.base=a.GetAssetURLBase?.(); return out})()`)));
c.close();
