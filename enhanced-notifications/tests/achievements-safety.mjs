// Live test: the achievement banner's kill switch, against a running Steam (-dev)
// with enhanced-notifications deployed. Restores exactly the settings stored before it ran.
//
//   node tests/achievements-safety.mjs            (THEME=<name> to pick the theme; default ps5)
//
// 1. A clean start: not in safe mode, nothing tripped, no errors counted.
// 2. `disabledFeatures = banner`: the banner is off, sound stays on, and a preview
//    achievement is no banner but the theme's notification style (data-en-type).
// 3. Switch cleared: the preview is our themed banner again.
import { connect, resolvePluginName } from './cdp.mjs';

const THEME = process.env.THEME ?? 'ps5';
const cdp = await connect();
const PLUGIN = await resolvePluginName(cdp, 'EN_PLUGIN', 'enhanced-notifications');
const plugin = (expr) => cdp.evaluate(`window.PLUGIN_LIST[${JSON.stringify(PLUGIN)}].${expr}`);
const stored = () => cdp.evaluate(`window.MILLENNIUM_API.ffi('core', 'PluginConfig_GetAll')(${JSON.stringify(PLUGIN)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failed = true;
};

/** Every achievement toast popup: does it hold our banner, and which tier? */
const sample = () =>
    cdp.evaluate(`JSON.stringify([...g_PopupManager.GetPopups()]
        .filter((p) => /^notificationtoasts_/.test(p.m_strName) && (p.window ?? p.m_popup) && !(p.window ?? p.m_popup).closed)
        .map((p) => {
            const doc = (p.window ?? p.m_popup).document, b = doc.querySelector('.ea-banner');
            return { banner: !!b, tier: b?.className.match(/ea-tier-(\\w+)/)?.[1] ?? null, enType: doc.body?.getAttribute('data-en-type') ?? null, text: (doc.body?.innerText ?? '').trim().slice(0, 60) };
        }))`).then(JSON.parse);

async function waitForNoToasts(maxMs = 60_000) {
    for (let t = 0; t < maxMs; t += 500) {
        if ((await sample()).length === 0) return true;
        await wait(500);
    }
    return false;
}

/** Fire one preview and return the first popup that has rendered content. */
async function previewOnce(tier) {
    await plugin(`previewTier(${JSON.stringify(tier)})`);
    for (let i = 0; i < 20; i++) {
        await wait(250);
        const hit = (await sample()).find((p) => p.banner || p.text !== '');
        if (hit) return hit;
    }
    return null;
}

const before_ = (await stored()) ?? {};
try {
    const diag = await plugin('safetyDiagnostics()');
    check('clean start: not in safe mode', diag?.safeMode === false, JSON.stringify(diag));
    check('clean start: nothing tripped, no errors', diag?.tripped?.length === 0 && Object.keys(diag?.errors ?? {}).length === 0, JSON.stringify(diag));

    check('no toast on screen before starting', await waitForNoToasts());
    await plugin(`setSetting('theme', ${JSON.stringify(THEME)})`);
    for (let i = 0; i < 20 && (await plugin('activeTheme()?.name')) !== THEME; i++) await wait(250);
    check(`theme "${THEME}" loaded`, (await plugin('activeTheme()?.name')) === THEME);

    await plugin(`setSetting('disabledFeatures', 'banner')`);
    const switched = await plugin('safetyDiagnostics()');
    check('banner off: the switch reads off', switched?.disabled?.includes('banner') === true, JSON.stringify(switched));
    check('banner off: sound stays on', switched?.disabled?.includes('sound') === false, JSON.stringify(switched));
    const stock = await previewOnce('rare');
    check('banner off: the preview is the notification style, not the banner', !!stock && !stock.banner && stock.enType === 'Achievement', JSON.stringify(stock));
    check('banner off: toast cleared', await waitForNoToasts());

    await plugin(`setSetting('disabledFeatures', '')`);
    check('banner on again: the switch reads on', (await plugin('safetyDiagnostics()'))?.disabled?.includes('banner') === false);
    const themed = await previewOnce('rare');
    check('banner on again: preview is our banner with its tier', !!themed && themed.banner && themed.tier === 'rare', JSON.stringify(themed));
    check('banner on again: toast cleared', await waitForNoToasts());

    const after = await plugin('safetyDiagnostics()');
    check('no errors counted during the test', Object.keys(after?.errors ?? {}).length === 0, JSON.stringify(after));
} finally {
    await plugin('resetSettings()');
    for (const [key, value] of Object.entries(before_)) await plugin(`setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    const left = (await stored()) ?? {};
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    check('settings restored to what was stored before the test', sorted(left) === sorted(before_), `${JSON.stringify(before_)} -> ${JSON.stringify(left)}`);
    cdp.close();
}
process.exitCode = failed ? 1 : 0;
