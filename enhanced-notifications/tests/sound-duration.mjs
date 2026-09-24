// Live test: per-type sound (replace + mute), display time, and fallbacks, using a
// temporary theme written to the user themes folder. Restores settings and deletes
// the theme afterwards. Optional: EN_TEST_SOUND=<absolute .mp3> (else replacement is skipped).
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from './cdp.mjs';

const PLUGIN = process.env.EN_PLUGIN ?? 'enhanced-notifications-dev';
const SOUND = process.env.EN_TEST_SOUND ?? 'C:/auto/res/sfx/ps5_trophy.mp3';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await connect();
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].${expr}`);

const userDir = JSON.parse(await cdp.evaluate(`window.Millennium.callServerMethod('${PLUGIN}', 'ListThemes', { payload: '{}' })`)).userDir;
const themePath = `${userDir}/en_test.json`;
const haveSound = existsSync(SOUND);
writeFileSync(
    themePath,
    JSON.stringify({
        default: { popup: { background: ['#101010', '#202020'] } },
        types: {
            DownloadComplete: { sound: false, display_time_ms: 2500 },
            ...(haveSound ? { CloudSyncFailure: { sound: [SOUND, 50] } } : {}),
        },
    }),
);

// Record our WebAudio plays and Steam's own sound requests (PlayNavSound).
await cdp.evaluate(`(() => {
    window.__enSounds = [];
    const proto = AudioBufferSourceNode.prototype;
    window.__enOrigStart ??= proto.start;
    const start = window.__enOrigStart;
    proto.start = function (...a) { window.__enSounds.push('themed'); return start.apply(this, a); };
    let req; const key = '__en_s_' + Date.now();
    window.webpackChunksteamui.push([[key], { [key]: (m, e, r) => (req = r) }, (r) => r(key)]);
    for (const id of Object.keys(req.m)) {
        if (!req.m[id].toString().includes('m_fnCallbackOnPlaySound')) continue;
        for (const v of Object.values(req(id))) if (v && typeof v.PlayNavSound === 'function' && v.m_fnCallbackOnPlaySound) {
            v.__enOrigNav ??= v.PlayNavSound; const o = v.__enOrigNav;
            v.PlayNavSound = function (...a) { window.__enSounds.push('steam'); return o.apply(this, a); };
            return true;
        }
    }
    return false;
})()`);

const durationOf = (typeName) =>
    cdp.evaluate(`(() => {
        const proto = Object.getPrototypeOf(window.NotificationStore);
        const eType = window.MILLENNIUM_API.EClientNotificationType['${typeName}'];
        let cfg; proto.PlayNotificationSound.call({ ChooseSound(c) { cfg = c; return null; } }, { eType });
        return cfg?.toastDurationMS ?? null;
    })()`);

async function fire(call) {
    await cdp.evaluate(`(window.__enSounds.length = 0, window.NotificationStore.${call}, true)`);
    await wait(1500);
    const sounds = JSON.parse(await cdp.evaluate(`JSON.stringify(window.__enSounds)`));
    await wait(6000);
    return sounds;
}

try {
    const stockDuration = await durationOf('DownloadComplete');
    await plugin(`setSetting('theme', 'en_test')`);
    for (let i = 0; i < 20 && (await plugin(`activeTheme()?.name`)) !== 'en_test'; i++) await wait(250);
    check('temp theme loaded', (await plugin(`activeTheme()?.name`)) === 'en_test');

    check('display_time_ms applied per type', (await durationOf('DownloadComplete')) === 2500, `DownloadComplete=${await durationOf('DownloadComplete')}`);

    await fire('TestCloudSyncFailure(435150)'); // warm up the AudioContext
    let s = await fire('TestDownloadComplete(435150)');
    check('sound false mutes the type (no Steam sound, no themed sound)', s.length === 0, JSON.stringify(s));

    if (haveSound) {
        s = await fire('TestCloudSyncFailure(435150)');
        check('theme sound replaces Steam sound', s.includes('themed') && !s.includes('steam'), JSON.stringify(s));
    } else console.log(`SKIP  sound replacement (no ${SOUND})`);

    await plugin(`setSetting('sound.enabled', false)`);
    s = await fire('TestDownloadComplete(435150)');
    check('sound.enabled=false -> Steam sound back', s.includes('steam') && !s.includes('themed'), JSON.stringify(s));
    await plugin(`setSetting('sound.enabled', true)`);

    await plugin(`setSetting('duration.enabled', false)`);
    check('duration.enabled=false -> Steam duration restored', (await durationOf('DownloadComplete')) === stockDuration, `DownloadComplete=${await durationOf('DownloadComplete')}`);
} finally {
    await plugin(`resetSettings()`);
    rmSync(themePath, { force: true });
    const left = await cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')('${PLUGIN}')`);
    check('settings reset, temp theme removed', Object.keys(left ?? {}).length === 0 && !existsSync(themePath), JSON.stringify(left));
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
