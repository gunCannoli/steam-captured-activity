// Minimal CDP helper for M0a crash triage. Usage:
//   import { evalIn, targets } from "./cdp.mjs";
//   await evalIn("SharedJSContext", "1+1")

export async function targets() {
    const r = await fetch("http://127.0.0.1:8080/json");
    return r.json();
}

export async function pick(match) {
    const list = await targets();
    const t = list.find((t) =>
        typeof match === "function" ? match(t) : t.title === match,
    );
    if (!t) throw new Error("target not found: " + match);
    return t;
}

export function session(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener("message", (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
        } else listeners.forEach((l) => l(m));
    });
    const ready = new Promise((r) => ws.addEventListener("open", r));
    return {
        ready,
        ws,
        on: (fn) => listeners.push(fn),
        send: (method, params = {}) =>
            new Promise((res) => {
                const i = ++id;
                pending.set(i, res);
                ws.send(JSON.stringify({ id: i, method, params }));
            }),
        close: () => ws.close(),
    };
}

export async function evalIn(match, expression, awaitPromise = true) {
    const t = await pick(match);
    const s = session(t.webSocketDebuggerUrl);
    await s.ready;
    const r = await s.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise,
    });
    s.close();
    if (r.result?.exceptionDetails)
        return { error: r.result.exceptionDetails.exception?.description?.slice(0, 1500) };
    return r.result?.result?.value;
}
