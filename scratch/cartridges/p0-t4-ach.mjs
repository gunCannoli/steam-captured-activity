import { connect } from './cdp.mjs';
const c = await connect();
const U=2820820, O=435150;
const ev=(e)=>c.evaluate(e);
console.log(JSON.stringify(await ev(`(()=>{const m=window.appAchievementProgressCache.m_achievementProgress.mapCache; window.appDetailsStore.RequestAppDetails(${U}); return {has:[m.has(${O}),m.has(${U})],size:m.size, o:JSON.stringify(m.get(${O})||null).slice(0,300)}})()`)));
await new Promise(r=>setTimeout(r,4000));
console.log(JSON.stringify(await ev(`(()=>{const d=window.appDetailsStore; const f=a=>{const x=d.GetAchievements(a); if(!x) return null; const o={keys:Object.keys(x)}; for(const k of Object.keys(x)) if(Array.isArray(x[k])) o[k]=x[k].length; o.s=JSON.stringify(x.vecHighlight?.[0]||x.vecUnachieved?.[0]||x.vecAchieved?.[0]||null).slice(0,300); return o}; return {O:f(${O}),U:f(${U}), det:JSON.stringify(d.GetAppDetails(${U})||null).slice(0,100)}})()`)));
console.log(JSON.stringify(await ev(`(async()=>{const o={}; for(const [k,a] of [['O',${O}],['U',${U}]]){ try{ const g=await Promise.race([SteamClient.Apps.GetMyAchievementsForApp(a), new Promise(r=>setTimeout(()=>r('TIMEOUT'),4000))]); o[k]=JSON.stringify(g).slice(0,250)}catch(e){o[k]='ERR '+String(e).slice(0,80)} } o.methods=Object.keys(SteamClient.Apps).filter(k=>/chiev/i.test(k)); return o})()`)));
c.close();
