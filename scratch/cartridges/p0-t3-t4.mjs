import { connect } from './cdp.mjs';
const c = await connect();
const r = await c.evaluate(`(async () => {
  const out = {}; const U=2820820, O=435150;
  out.owned = [O,U].map(a=>{const o=window.appStore.GetAppOverviewByAppID(a); return o?{n:o.display_name,t:o.app_type}:null});
  out.cdnUnowned=[];
  for (const f of ['library_hero.jpg','library_600x900.jpg','logo.png','header.jpg']) { const r=await fetch('https://cdn.akamai.steamstatic.com/steam/apps/'+U+'/'+f); const b=await r.arrayBuffer(); out.cdnUnowned.push([f,r.status,b.byteLength]); }
  const sic = window.StoreItemCache;
  try { await sic.QueueAppRequest(U, {include_assets:true,include_basic_info:true,include_release:true,include_full_description:true,include_reviews:false}); } catch(e){ out.q1='ERR '+String(e).slice(0,100); }
  await new Promise(r=>setTimeout(r,3000));
  out.has = sic.BHasApp(U);
  const it = sic.GetApp ? sic.GetApp(U) : null;
  out.sicSizeErr = it? Object.keys(it).slice(0,30):null;
  if (it) { out.name=it.GetName?.(); out.basic = it.GetStoreItemData?.()?.basic_info ? Object.keys(it.GetStoreItemData().basic_info):null;
    const d = it.GetStoreItemData?.() ?? it; out.dkeys = Object.keys(d||{}).slice(0,40);
    out.assets = JSON.stringify(d.assets||null); out.short = d.basic_info?.short_description?.slice(0,60); out.devs=d.basic_info?.developers?.map(x=>x.name); out.pubs=d.basic_info?.publishers?.map(x=>x.name); out.rel=d.release?.steam_release_date; out.cats=d.categories?.supported_player_categoryids?.length; }
  // T4
  out.apc = (()=>{ try{ const m=window.appAchievementProgressCache.m_achievementProgress.mapCache; return [m.has(O), m.has(U), m.size]; }catch(e){return 'ERR '+e} })();
  try { await window.appDetailsStore.RequestAppDetails(U); } catch(e){ out.rad='ERR '+String(e).slice(0,80); }
  try { await window.appDetailsStore.RequestAchievements?.(U);} catch(e){}
  out.ach = [O,U].map(a=>{ try{ const x=window.appDetailsStore.GetAchievements(a); return x? {keys:Object.keys(x).slice(0,10), n:(x.vecAchievedHidden?.length||0)+(x.vecHighlight?.length||0)+(x.vecUnachieved?.length||0), sample: JSON.stringify(x.vecHighlight?.[0]||x.vecUnachieved?.[0]||null).slice(0,200)}:null;}catch(e){return 'ERR '+e}});
  try { const g = await SteamClient.Apps.GetMyAchievementsForApp(U); out.myU = JSON.stringify(g).slice(0,200);} catch(e){out.myU='ERR '+String(e).slice(0,80)}
  try { const g = await SteamClient.Apps.GetMyAchievementsForApp(O); out.myO = JSON.stringify(g).slice(0,200);} catch(e){out.myO='ERR '+String(e).slice(0,80)}
  return JSON.stringify(out);
})()`);
console.log(JSON.stringify(r));
c.close();
