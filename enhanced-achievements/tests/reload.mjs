// Reload Steam's SharedJSContext (picks up a redeployed frontend, like Ctrl+R in
// devtools) and wait until the fresh page has enhanced-achievements running
// with its theme loaded.
// Usage: node tests/reload.mjs
import { connect } from './cdp.mjs';

const PLUGIN = process.env.EA_PLUGIN ?? 'enhanced-achievements-dev';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryEval(expression) {
    try {
        const cdp = await connect();
        try {
            return await cdp.evaluate(expression);
        } finally {
            cdp.close();
        }
    } catch {
        return undefined; // page mid-reload
    }
}

// A marker only the old page carries, so readiness cannot be read off the old page.
await tryEval(`(window.__eaReloadMarker = true, setTimeout(() => location.reload(), 50), true)`);

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
    const ready = await tryEval(`!window.__eaReloadMarker
        && Array.isArray(window.webpackChunksteamui)
        && typeof window.PLUGIN_LIST?.['${PLUGIN}']?.setSetting === 'function'
        && !!window.PLUGIN_LIST['${PLUGIN}'].activeTheme()
        && !Object.getPrototypeOf(window.NotificationStore).PlayNotificationSound.toString().includes('PlayNavSound')`);
    if (ready === true) {
        console.log('reloaded; plugin ready');
        process.exit(0);
    }
    await wait(1000);
}
console.error('timed out waiting for the plugin after reload');
process.exit(1);
