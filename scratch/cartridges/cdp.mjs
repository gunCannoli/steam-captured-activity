// Minimal Chrome DevTools Protocol client for probing Steam's SharedJSContext.
// Usage: node tests/cdp.mjs "<expression>"   (expression may be async; result is JSON-printed)
// Requires Steam started with -dev -cef-enable-debugging (see start-steam-dev.ps1).

const PORT = process.env.CDP_PORT ?? '8080';
const TARGET = process.env.CDP_TARGET ?? 'SharedJSContext';

export async function connect(title = TARGET) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = targets.find((t) => t.title === title);
    if (!target) throw new Error(`No CDP target titled "${title}". Have: ${targets.map((t) => t.title).join(', ')}`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });

    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const done = pending.get(msg.id);
        if (!done) return;
        pending.delete(msg.id);
        done(msg);
    };

    const send = (method, params = {}) =>
        new Promise((resolve) => {
            const id = nextId++;
            pending.set(id, resolve);
            ws.send(JSON.stringify({ id, method, params }));
        });

    async function evaluate(expression) {
        const msg = await send('Runtime.evaluate', {
            expression: `(async () => { return (${expression}); })()`,
            awaitPromise: true,
            returnByValue: true,
        });
        if (msg.result?.exceptionDetails) {
            throw new Error(msg.result.exceptionDetails.exception?.description ?? JSON.stringify(msg.result.exceptionDetails));
        }
        if(msg.result?.result?.value===undefined) console.error(JSON.stringify(msg).slice(0,500)); return msg.result?.result?.value;
    }

    async function screenshot(file) {
        const msg = await send('Page.captureScreenshot', { format: 'png' });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(file, Buffer.from(msg.result.data, 'base64'));
        return file;
    }

    return { evaluate, screenshot, close: () => ws.close() };
}

/**
 * Resolve which deployed plugin name to drive: an env override, else the
 * `-dev` name if it is actually loaded (window.PLUGIN_LIST), else the release
 * name. Same precedence as frontend/settings/settings.ts `pluginName()`.
 */
export async function resolvePluginName(cdp, envVar, releaseName) {
    const fromEnv = process.env[envVar];
    if (fromEnv) return fromEnv;
    const devName = `${releaseName}-dev`;
    const loaded = await cdp.evaluate(`JSON.stringify(Object.keys(window.PLUGIN_LIST || {}))`);
    const names = JSON.parse(loaded);
    return names.includes(devName) ? devName : releaseName;
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    const cdp = await connect();
    try {
        console.log(JSON.stringify(await cdp.evaluate(process.argv[2]), null, 2));
    } finally {
        cdp.close();
    }
}
