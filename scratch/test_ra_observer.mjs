import fs from 'fs';
import { connect } from './cartridges/cdp.mjs';

const smwAppId = 2713503983;

// 1. Connect to SharedJSContext
const c = await connect('SharedJSContext');
console.log('Connected to SharedJSContext');

// 2. Append simulated achievement unlock to retroarch.log
const logPath = 'C:/emu/RetroArch/logs/retroarch.log';
const unlockLine = `\n[INFO] [RCHEEVOS] Awarded achievement 2304: "All Exits"\n`;
fs.appendFileSync(logPath, unlockLine, 'utf8');
console.log('Appended simulated unlock to retroarch.log');

// 3. Trigger checkObserverUnlocks via plugin
const res = await c.evaluate(`
    (async () => {
        const plug = window.PLUGIN_LIST['steam-cartridges'];
        const unlockedCount = await plug.checkObserverUnlocks(${smwAppId}, 0, "Super Mario World");
        const current = plug.getLocalAchievements(${smwAppId});
        return {
            unlockedCount,
            nAchieved: current?.nAchieved,
            nTotal: current?.nTotal,
            unlockedSample: current?.vecAchieved?.map(a => ({ id: a.strID, name: a.strName }))
        };
    })()
`);

console.log('Observer result:', JSON.stringify(res, null, 2));
c.close();
