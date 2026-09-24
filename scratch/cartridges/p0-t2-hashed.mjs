import { connect } from './cdp.mjs';
const c = await connect();
const U=2820820, O=435150;
console.log(JSON.stringify(await c.evaluate(`(async()=>{const a=window.StoreItemCache.GetApp(${U}).GetAssets(); const out={};
 const t=async(k,u)=>{try{const r=await fetch(u);const b=await r.arrayBuffer();out[k]=[r.status,b.byteLength]}catch(e){out[k]='ERR '+String(e).slice(0,60)}};
 await t('hashedHero',a.GetLibraryHeroURL()); await t('hashedPortrait',a.GetLibraryCapsuleURL()); await t('hashedHero2x',a.GetLibraryHeroURL_2x());
 for (const f of ['library_hero.jpg','library_600x900.jpg','logo.png','header.jpg']) { await t('unhashed_'+f,'https://cdn.akamai.steamstatic.com/steam/apps/${U}/'+f); }
 try{ out.ctor=a.ConstructAssetURL('logo.png')}catch(e){out.ctor='ERR'}
 out.sharedUnhashedLogo=null; await t('sharedLogo','https://shared.steamstatic.com/store_item_assets/steam/apps/${U}/logo.png');
 out.ownedNative = (()=>{const o=window.appStore.GetAppOverviewByAppID(${O}); return [o.library_capsule_filename,o.header_filename]})();
 return out})()`)));
c.close();
