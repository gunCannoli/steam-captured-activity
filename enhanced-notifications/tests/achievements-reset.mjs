// Live test: Reset Achievements (non-destructive). It never clears a real achievement.
//
//   node tests/achievements-reset.mjs
//
// 1. The `reset` surface is installed and the API says it is available.
// 2. candidates() lists games with unlocks, sorted, each with unlocked > 0.
// 3. A no-op reset of Spacewar (480, nothing unlocked) sends no console command and reports 0 cleared.
// 4. The settings panel renders the five rows (label, description, filter, dropdown, Reset) and Reset starts disabled.
// 5. With the surface switched off (`disabledFeatures = reset`) the API is unavailable and reset() refuses; restored after.
import { connect, resolvePluginName } from './cdp.mjs';

const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
// `expr` sees the plugin's exports as bare names (surfaceStatus(), achievementReset, setSetting(...)).
const plugin = (expr) => cdp.evaluate(`(() => { with (window.PLUGIN_LIST[${JSON.stringify(PLUGIN)}]) { return (${expr}); } })()`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(${JSON.stringify(PLUGIN)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const snapshot = (await stored()) ?? {};
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

try {
    const status = JSON.parse(await plugin('JSON.stringify(surfaceStatus())'));
    check('reset surface installed', status.some((s) => s.id === 'reset' && s.installed && s.skipped === null), JSON.stringify(status.find((s) => s.id === 'reset')));
    check('API available', (await plugin('achievementReset.available()')) === true);

    const list = JSON.parse(await plugin('JSON.stringify(achievementReset.candidates())'));
    const names = list.map((c) => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    check('candidates have unlocks and are sorted by name', list.length > 0 && list.every((c) => c.unlocked > 0) && JSON.stringify(names) === JSON.stringify(sorted), `${list.length} games`);
    // With steam-cartridges loaded, Steam's progress cache lists its games too (ADR-0045; non-Steam games have the `shortcut` kind).
    const cartridges = await plugin("Object.keys(window.PLUGIN_LIST).some((n) => n.startsWith('steam-cartridges') && typeof window.PLUGIN_LIST[n].resetAchievements === 'function')");
    check('non-Steam games with unlocks are listed when steam-cartridges is loaded', !cartridges || list.some((c) => c.kind === 'shortcut'), `${list.filter((c) => c.kind === 'shortcut').length} shortcuts`);

    const wrapped = await cdp.evaluate(`(() => { window.__eaConsole = []; const c = SteamClient.Console; window.__eaExec = c.ExecCommand; c.ExecCommand = (x) => { window.__eaConsole.push(x); return window.__eaExec.call(c, x); }; return true; })()`);
    const res = JSON.parse(await plugin("achievementReset.reset({ appid: 480, name: 'Spacewar', unlocked: 0, total: 0, kind: 'steam' }).then((r) => JSON.stringify(r))"));
    const sent = JSON.parse(await cdp.evaluate('JSON.stringify(window.__eaConsole)'));
    await cdp.evaluate('(() => { SteamClient.Console.ExecCommand = window.__eaExec; return true; })()');
    check('no-op reset sends no console command and clears nothing', wrapped === true && res.ok === true && res.cleared === 0 && sent.length === 0, JSON.stringify({ res, sent }));

    await cdp.evaluate(`(() => {
        document.getElementById('ea-reset-mount')?.remove();
        const d = document.createElement('div');
        d.id = 'ea-reset-mount';
        document.body.appendChild(d);
        window.__eaResetRoot = window.SP_REACTDOM.createRoot(d);
        window.__eaResetRoot.render(window.SP_REACT.createElement(window.PLUGIN_LIST[${JSON.stringify(PLUGIN)}].SettingsPanelView));
        return true;
    })()`);
    await wait(1200);
    const text = await cdp.evaluate("(() => { const t = document.getElementById('ea-reset-mount').innerText; return t.slice(t.indexOf('Reset Achievements')); })()");
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    check('panel: label, description, filter, dropdown and Reset rows', JSON.stringify(lines) === JSON.stringify(['Reset Achievements', 'Select a game to reset the achievements count', 'GAMES FILTER', 'All games', 'Reset']), JSON.stringify(lines));
    const resetDisabled = await cdp.evaluate("(() => { const b = [...document.querySelectorAll('#ea-reset-mount [class*=\"DialogButton\"]')].pop(); return b.disabled || /Disabled/.test(b.className); })()");
    check('panel: Reset is disabled until a game is selected', resetDisabled === true);
    await cdp.evaluate("(() => { window.__eaResetRoot.unmount(); document.getElementById('ea-reset-mount')?.remove(); return true; })()");

    await plugin("setSetting('disabledFeatures', 'reset').then(() => true)");
    await wait(300);
    const off = JSON.parse(await plugin("(async () => JSON.stringify({ available: achievementReset.available(), res: await achievementReset.reset({ appid: 480, name: 'x', unlocked: 1, total: 1, kind: 'steam' }) }))()"));
    check('switched off: unavailable and reset() refuses', off.available === false && off.res.ok === false, JSON.stringify(off));
} finally {
    // Put back exactly the stored settings from before this script ran.
    await plugin('resetSettings()').catch(() => {});
    for (const [key, value] of Object.entries(snapshot)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`).catch(() => {});
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
