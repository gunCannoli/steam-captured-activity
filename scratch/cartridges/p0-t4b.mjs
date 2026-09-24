import { connect } from './cdp.mjs';
const c = await connect(); const O=435150;
await c.evaluate(`(()=>{window.appDetailsStore.RequestAppDetails(${O}); window.appDetailsStore.RequestAchievements(${O});return 1})()`);
await new Promise(r=>setTimeout(r,4000));
console.log(JSON.stringify(await c.evaluate(`(()=>{const x=window.appDetailsStore.GetAchievements(${O}); if(!x) return null; return {n:x.nTotal,a:x.nAchieved,h:x.vecHighlight.length,u:x.vecUnachieved.length,s:JSON.stringify(x.vecUnachieved[0]||x.vecHighlight[0]||null)}})()`)));
c.close();
