import test from 'node:test';
import assert from 'node:assert/strict';
import { admit, finish, forget, MAX_QUEUE, peek, phaseOf, resetQueue, subscribe, whenShowing } from '../frontend/banner/queue.ts';
import { bannerTiming } from '../frontend/banner/timing.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LONG = 60_000; // show timers that never fire inside a test

test('the first toast shows immediately', () => {
    resetQueue();
    assert.equal(admit({}, LONG, true), 'showing');
});

test('queue on: a second toast waits while one is showing', () => {
    resetQueue();
    const a = {}, b = {};
    assert.equal(admit(a, LONG, true), 'showing');
    assert.equal(admit(b, LONG, true), 'waiting');
});

test('queue off: every toast shows immediately', () => {
    resetQueue();
    assert.equal(admit({}, LONG, false), 'showing');
    assert.equal(admit({}, LONG, false), 'showing');
});

test('admit is idempotent: a remounted toast keeps its phase and place', () => {
    resetQueue();
    const a = {}, b = {};
    admit(a, LONG, true);
    admit(b, LONG, true);
    assert.equal(admit(a, LONG, true), 'showing');
    assert.equal(admit(b, LONG, true), 'waiting');
});

test('finishing the current toast promotes the next after the gap, and notifies it', async () => {
    resetQueue();
    const a = {}, b = {};
    admit(a, LONG, true);
    admit(b, LONG, true);
    let notified = 0;
    subscribe(b, () => notified++);
    finish(a);
    assert.equal(phaseOf(a), 'done');
    assert.equal(phaseOf(b), 'waiting'); // gap not elapsed yet
    await wait(150);
    assert.equal(phaseOf(b), 'showing');
    assert.equal(notified, 1);
});

test('a showing toast ends on its own timer, with no animation event needed', async () => {
    resetQueue();
    const a = {}, b = {};
    admit(a, 30, true);
    admit(b, LONG, true);
    await wait(200);
    assert.equal(phaseOf(a), 'done');
    assert.equal(phaseOf(b), 'showing');
});

test('rapid bursts keep strict FIFO order, one showing at a time', async () => {
    resetQueue();
    const keys = [{}, {}, {}, {}];
    for (const k of keys) admit(k, 20, true);
    const order: number[] = [];
    keys.forEach((k, i) => subscribe(k, () => phaseOf(k) === 'showing' && order.push(i)));
    for (let t = 0; t < 40; t++) {
        await wait(25);
        assert.ok(keys.filter((k) => phaseOf(k) === 'showing').length <= 1, 'never two showing at once');
    }
    assert.deepEqual(order, [1, 2, 3]);
    assert.ok(keys.every((k) => phaseOf(k) === 'done'));
});

test('a waiting toast that unmounts gives up its place without affecting the current one', async () => {
    resetQueue();
    const a = {}, b = {}, c = {};
    admit(a, LONG, true);
    admit(b, LONG, true);
    admit(c, LONG, true);
    forget(b);
    assert.equal(phaseOf(a), 'showing');
    finish(a);
    await wait(150);
    assert.equal(phaseOf(b), 'done');
    assert.equal(phaseOf(c), 'showing');
});

test('a toast arriving during the gap waits for the gap, then shows', async () => {
    resetQueue();
    const a = {}, b = {};
    admit(a, LONG, true);
    finish(a);
    assert.equal(admit(b, LONG, true), 'waiting');
    await wait(150);
    assert.equal(phaseOf(b), 'showing');
});

test(`past MAX_QUEUE (${MAX_QUEUE}) waiting, a new toast shows at once and reports overflow`, () => {
    resetQueue();
    admit({}, LONG, true);
    for (let i = 0; i < MAX_QUEUE; i++) assert.equal(admit({}, LONG, true), 'waiting');
    let overflow = false;
    assert.equal(admit({}, LONG, true, () => (overflow = true)), 'showing');
    assert.equal(overflow, true);
});

test('unknown keys read as done (nothing holds their popup)', () => {
    assert.equal(phaseOf({}), 'done');
});

test('timing: exit starts after entrance + display, and the hold covers the whole exit', () => {
    const t = bannerTiming({ in: 'ps5', out: 'ps5' }, 4000);
    assert.equal(t.inMs, 450);
    assert.equal(t.outMs, 400);
    assert.ok(t.totalMs > t.inMs + t.displayMs + t.outMs);
    const none = bannerTiming({ in: 'none', out: 'none' }, 3000);
    assert.equal(none.inMs + none.outMs, 0);
    assert.ok(none.totalMs >= 3000);
});

test.after(() => resetQueue());

test('queue: peek is undefined for a toast never admitted', () => {
    resetQueue();
    const a = {};
    assert.equal(peek(a), undefined);
    assert.equal(phaseOf(a), 'done', 'phaseOf still calls an unknown toast done');
    admit(a, LONG, true);
    assert.equal(peek(a), 'showing');
});

test('queue: whenShowing fires once when a waiting toast gets its turn', async () => {
    resetQueue();
    const a = {}, b = {};
    admit(a, LONG, true);
    admit(b, LONG, true);
    let fired = 0;
    const r = whenShowing(b, () => fired++);
    assert.equal(r.at, 'later');
    finish(a);
    await wait(250);
    assert.equal(fired, 1);
    finish(b);
    await wait(150);
    assert.equal(fired, 1, 'never again');
});

test('queue: whenShowing never fires for a toast finished before its turn', async () => {
    resetQueue();
    const a = {}, b = {};
    admit(a, LONG, true);
    admit(b, LONG, true);
    let fired = 0;
    whenShowing(b, () => fired++);
    forget(b);
    finish(a);
    await wait(250);
    assert.equal(fired, 0);
    assert.deepEqual(whenShowing(b, () => fired++), { at: 'never' }, 'done');
    assert.deepEqual(whenShowing({}, () => fired++), { at: 'never' }, 'unknown');
});

test('queue: whenShowing answers now for a toast already showing', () => {
    resetQueue();
    const a = {};
    admit(a, LONG, true);
    let fired = 0;
    assert.deepEqual(whenShowing(a, () => fired++), { at: 'now' });
    assert.equal(fired, 0, 'the caller acts on "now" itself');
});
