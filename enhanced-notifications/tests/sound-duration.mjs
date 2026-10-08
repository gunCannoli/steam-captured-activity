// Live test: per-type sound (replace + mute), display time, and fallbacks, using a
// temporary theme written to the user themes folder. Restores settings and deletes
// the theme afterwards. Optional: EN_TEST_SOUND=<absolute .mp3>; otherwise a
// generated 0.3s 440Hz WAV in os.tmpdir() is used (deleted afterwards), so the
// test needs no machine-specific asset.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, resolvePluginName } from './cdp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST['${PLUGIN}'].${expr}`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')('${PLUGIN}')`);
// The user's own stored settings, restored exactly at the end (never wiped).
const before_ = (await stored()) ?? {};
/** Put back exactly what was stored before the test; true when the stored settings match it again. */
async function restoreSettings() {
    await plugin('resetSettings()');
    for (const [key, value] of Object.entries(before_)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    const left = (await stored()) ?? {};
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    return { ok: sorted(left) === sorted(before_), detail: `${JSON.stringify(before_)} -> ${JSON.stringify(left)}` };
}

/** A minimal, self-contained 0.3s 440Hz mono 16-bit PCM WAV: no bundled asset needed. */
function generateTestWav() {
    const sampleRate = 8000;
    const seconds = 0.3;
    const n = Math.floor(sampleRate * seconds);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
        const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 32767 * 0.5);
        data.writeInt16LE(sample, i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    const dir = mkdtempSync(join(tmpdir(), 'en-test-sound-'));
    const path = join(dir, 'test.wav');
    writeFileSync(path, Buffer.concat([header, data]));
    return path;
}

const generatedSound = process.env.EN_TEST_SOUND ? null : generateTestWav();
const SOUND = process.env.EN_TEST_SOUND ?? generatedSound;

const userDir = JSON.parse(await cdp.evaluate(`window.Millennium.callServerMethod('${PLUGIN}', 'ListThemes', { payload: '{}' })`)).userDir;
// Two temp themes (one style for every notification): one mutes and sets the display time, one replaces the sound.
const themePath = `${userDir}/en_test.json`;
const soundThemePath = `${userDir}/en_test_sound.json`;
const haveSound = existsSync(SOUND);
writeFileSync(themePath, JSON.stringify({ settings: { display_time_ms: 2500 }, popup: { background: ['#101010', '#202020'] }, sound: false }));
if (haveSound) writeFileSync(soundThemePath, JSON.stringify({ popup: { background: ['#101010'] }, sound: [SOUND, 50] }));

async function selectTheme(name) {
    await plugin(`setSetting('theme', '${name}')`);
    for (let i = 0; i < 20 && (await plugin(`activeTheme()?.name`)) !== name; i++) await wait(250);
    return (await plugin(`activeTheme()?.name`)) === name;
}

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
    // Steam's own duration, read with no theme ("Steam default"): the user's active theme may set its own.
    await plugin(`setSetting('theme', '<steam>')`);
    for (let i = 0; i < 20 && (await plugin(`activeTheme()?.name ?? null`)) !== null; i++) await wait(250);
    const stockDuration = await durationOf('DownloadComplete');
    check('temp theme loaded', await selectTheme('en_test'));

    const shown = [await durationOf('DownloadComplete'), await durationOf('CloudSyncFailure')];
    check('settings.display_time_ms applied to every type', shown.every((ms) => ms === 2500), JSON.stringify(shown));

    await fire('TestCloudSyncFailure(435150)'); // warm up the AudioContext
    let s = await fire('TestDownloadComplete(435150)');
    check('sound false mutes notifications (no Steam sound, no themed sound)', s.length === 0, JSON.stringify(s));

    if (haveSound) {
        check('sound theme loaded', await selectTheme('en_test_sound'));
        s = await fire('TestCloudSyncFailure(435150)');
        check('theme sound replaces Steam sound', s.includes('themed') && !s.includes('steam'), JSON.stringify(s));
        check('no display_time_ms -> Steam duration', (await durationOf('DownloadComplete')) === stockDuration, `DownloadComplete=${await durationOf('DownloadComplete')}`);
        await selectTheme('en_test');
    } else console.log(`SKIP  sound replacement (no ${SOUND})`);

    // "Steam default" (the theme setting's '<steam>'): no theme, so Steam's sound and display time come back.
    await plugin(`setSetting('theme', '<steam>')`);
    for (let i = 0; i < 20 && (await plugin(`activeTheme()?.name ?? null`)) !== null; i++) await wait(250);
    check('Steam default -> no theme loaded', (await plugin(`activeTheme()?.name ?? null`)) === null);
    s = await fire('TestDownloadComplete(435150)');
    check('Steam default -> Steam sound back', s.includes('steam') && !s.includes('themed'), JSON.stringify(s));
    check('Steam default -> Steam duration restored', (await durationOf('DownloadComplete')) === stockDuration, `DownloadComplete=${await durationOf('DownloadComplete')}`);
} finally {
    const restored = await restoreSettings();
    rmSync(themePath, { force: true });
    rmSync(soundThemePath, { force: true });
    if (generatedSound) rmSync(join(generatedSound, '..'), { recursive: true, force: true });
    check('settings restored, temp theme removed', restored.ok && !existsSync(themePath), restored.detail);
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
