// Wait until Steam's SharedJSContext has enhanced-achievements running with its
// theme loaded (e.g. after `dev.ps1` restarted Steam).
// Usage: node tests/reload.mjs
//
// This deliberately does NOT reload SharedJSContext (location.reload / Ctrl+R):
// doing so can make the main Steam window load its in-app route
// (/routes/library/home) as a document, which CEF treats as a file download and
// answers with a blocking "Save as" dialog (confirmed 2026-09-24 12:35; see
// docs/plugins.md § 4). Deploy frontend changes with a full `dev.ps1` restart.
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
        return undefined; // Steam still starting
    }
}

const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
    const ready = await tryEval(`Array.isArray(window.webpackChunksteamui)
        && typeof window.PLUGIN_LIST?.['${PLUGIN}']?.setSetting === 'function'
        && !!window.PLUGIN_LIST['${PLUGIN}'].activeTheme()
        && !Object.getPrototypeOf(window.NotificationStore).PlayNotificationSound.toString().includes('PlayNavSound')`);
    if (ready === true) {
        console.log('plugin ready');
        process.exit(0);
    }
    await wait(1000);
}
console.error('timed out waiting for the plugin');
process.exit(1);
