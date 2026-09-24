// Capture SharedJSContext console output and exceptions while running an expression.
// Usage: node tests/console.mjs "<expression>" [ms=4000] [filter-regex]
const PORT = process.env.CDP_PORT ?? '8080';
const [expression, ms = '4000', filter = ''] = process.argv.slice(2);
const target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.title === 'SharedJSContext');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const re = filter ? new RegExp(filter, 'i') : null;
let id = 0;
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    let line = null;
    if (m.method === 'Runtime.consoleAPICalled') {
        line = `[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    } else if (m.method === 'Runtime.exceptionThrown') {
        line = `[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`;
    }
    if (line && (!re || re.test(line))) console.log(line.slice(0, 600));
};
ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true } }));
await new Promise((r) => setTimeout(r, Number(ms)));
ws.close();
