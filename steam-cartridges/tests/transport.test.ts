import { test } from 'node:test';
import assert from 'node:assert/strict';

// The transport reaches Millennium through `window`; give it a fake host that answers when told to.
const started: string[] = [];
const pending: (() => void)[] = [];
(globalThis as any).window = {
    Millennium: {
        callServerMethod(_plugin: string, name: string) {
            started.push(name);
            return new Promise<string>((resolve) => pending.push(() => resolve(JSON.stringify({ name }))));
        },
    },
};

const { call, transportDiagnostics } = await import('../frontend/ports/transport.ts');

const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
/** Let the host finish the call it is running. */
const finishOne = async () => {
    pending.shift()?.();
    await flush();
};

test('transport: one call at a time; a view call queued behind background calls runs right after the one in flight (ADR-0060)', async () => {
    started.length = 0;
    const done: string[] = [];
    const track = (p: Promise<{ name: string }>) => p.then((r) => done.push(r.name));
    track(call('Bg1', {}, { lane: 'background' }));
    await flush(); // Bg1 is running now
    track(call('Bg2', {}, { lane: 'background' }));
    track(call('Bg3', {}, { lane: 'background' }));
    track(call('Media', {}, { lane: 'media' }));
    track(call('Normal', {}));
    track(call('View', {}, { lane: 'view' }));
    await flush();
    assert.deepEqual(started, ['Bg1'], 'the host is never asked twice at once');
    assert.deepEqual(transportDiagnostics().queued, { view: ['View'], normal: ['Normal'], media: ['Media'], background: ['Bg2', 'Bg3'] });
    for (let i = 0; i < 6; i++) await finishOne();
    assert.deepEqual(started, ['Bg1', 'View', 'Normal', 'Media', 'Bg2', 'Bg3']);
    assert.deepEqual(done, ['Bg1', 'View', 'Normal', 'Media', 'Bg2', 'Bg3']);
});

test('transport: FIFO within a lane, and every finished call is timed', async () => {
    started.length = 0;
    const a = call('A', {}, { lane: 'view' });
    const b = call('B', {}, { lane: 'view' });
    await flush();
    await finishOne();
    await finishOne();
    await Promise.all([a, b]);
    assert.deepEqual(started, ['A', 'B']);
    const recent = transportDiagnostics().recent.slice(-2);
    assert.deepEqual(recent.map((r) => [r.name, r.lane, r.ok]), [['A', 'view', true], ['B', 'view', true]]);
    for (const r of recent) assert.ok(r.queuedAt <= r.startedAt && r.startedAt <= r.endedAt);
    assert.equal(transportDiagnostics().running, null);
});

test('transport: an unknown lane is "normal"; a failing call rejects and the queue moves on', async () => {
    started.length = 0;
    const saved = (globalThis as any).window.Millennium.callServerMethod;
    (globalThis as any).window.Millennium.callServerMethod = async (_p: string, name: string) => {
        started.push(name);
        if (name === 'Bad') throw new Error('boom');
        return JSON.stringify({ name });
    };
    const bad = call('Bad', {}, { lane: 'nope' as any });
    const good = call('Good', {});
    await assert.rejects(bad, /boom/);
    assert.deepEqual(await good, { name: 'Good' });
    assert.equal(transportDiagnostics().recent.at(-2)!.lane, 'normal');
    assert.equal(transportDiagnostics().recent.at(-2)!.ok, false);
    (globalThis as any).window.Millennium.callServerMethod = saved;
});
