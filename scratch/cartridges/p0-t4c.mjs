import { connect } from './cdp.mjs';
const c = await connect();
const r = await c.evaluate(`(async () => {
  const out = {};
  const t = (p)=>Promise.race([p,new Promise(r=>setTimeout(()=>r('TIMEOUT'),8000))]);
  for (const [k,u] of [['gap','https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=2820820'],['store','https://store.steampowered.com/api/appdetails?appids=2820820&filters=achievements'],['sh','https://steamcommunity.com/stats/2820820/achievements/']]) {
    try { const r = await t(fetch(u)); out[k] = typeof r==='string'?r:{s:r.status, b:(await r.text()).slice(0,300)}; } catch(e){ out[k]='ERR '+e.message; }
  }
  try { const m = await t(SteamClient.Apps.GetMyAchievementsForApp(435150)); out.my = JSON.stringify(m).slice(0,400);} catch(e){out.my='ERR '+e}
  try { const m = await t(SteamClient.Apps.GetMyAchievementsForApp(2820820)); out.myU = JSON.stringify(m).slice(0,300);} catch(e){out.myU='ERR '+e}
  try { const s=window.StoreItemCache||null; out.sic=!!s; } catch(e){}
  return out;
})()`);
console.log(JSON.stringify(r).slice(0,3500)); c.close();
