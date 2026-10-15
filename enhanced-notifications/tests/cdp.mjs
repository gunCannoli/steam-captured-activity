// Minimal Chrome DevTools Protocol client for probing Steam's SharedJSContext.
// Usage: node tests/cdp.mjs "<expression>"   (expression may be async; result is JSON-printed)
// Requires Steam started with -dev -cef-enable-debugging (see start-steam-dev.ps1).

const PORT = process.env.CDP_PORT ?? '8080';
const TARGET = process.env.CDP_TARGET ?? 'SharedJSContext';

/**
 * `timeoutMs`: how long opening the socket and each evaluate may take. A toast window can close between listing it and
 * connecting (found 2026-10-15: achievements-tiers then hung for ever, or read "no banner"); a dead target now rejects.
 */
export async function connect(title = TARGET, { timeoutMs = 8000 } = {}) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = targets.find((t) => t.title === title);
    if (!target) throw new Error(`No CDP target titled "${title}". Have: ${targets.map((t) => t.title).join(', ')}`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`CDP target "${title}" did not open within ${timeoutMs} ms`)), timeoutMs);
        ws.onopen = () => {
            clearTimeout(timer);
            resolve();
        };
        ws.onerror = (e) => {
            clearTimeout(timer);
            reject(e);
        };
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

    // A long-running evaluate (a live check that waits) passes a larger timeout through evaluate(expr, ms).
    const send = (method, params = {}, ms = timeoutMs) =>
        new Promise((resolve, reject) => {
            const id = nextId++;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP ${method} on "${title}" got no answer within ${ms} ms`));
            }, ms);
            pending.set(id, (msg) => {
                clearTimeout(timer);
                resolve(msg);
            });
            ws.send(JSON.stringify({ id, method, params }));
        });

    async function evaluate(expression, ms = 120_000) {
        const msg = await send('Runtime.evaluate', {
            expression: `(async () => { return (${expression}); })()`,
            awaitPromise: true,
            returnByValue: true,
        }, ms);
        if (msg.result?.exceptionDetails) {
            throw new Error(msg.result.exceptionDetails.exception?.description ?? JSON.stringify(msg.result.exceptionDetails));
        }
        return msg.result?.result?.value;
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
