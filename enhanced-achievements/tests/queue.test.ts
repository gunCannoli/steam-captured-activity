import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseTurn, requestTurn, resetQueue } from '../frontend/banner/queue.ts';

test('the first request always gets its turn immediately', () => {
    resetQueue();
    assert.equal(requestTurn({}, () => {}), true);
});

test('a second request while one is showing is queued, not immediate', () => {
    resetQueue();
    const a = {}, b = {};
    assert.equal(requestTurn(a, () => {}), true);
    let firedB = false;
    assert.equal(requestTurn(b, () => { firedB = true; }), false);
    assert.equal(firedB, false);
});

test('releasing the current turn schedules the next queued one (after the gap)', async () => {
    resetQueue();
    const a = {}, b = {};
    requestTurn(a, () => {});
    let firedB = false;
    requestTurn(b, () => { firedB = true; });
    releaseTurn(a);
    assert.equal(firedB, false); // not yet: QUEUE_GAP_MS hasn't elapsed
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(firedB, true);
});

test('a key already current or already queued is not queued twice', () => {
    resetQueue();
    const a = {};
    requestTurn(a, () => {});
    assert.equal(requestTurn(a, () => {}), true); // still current
});

test('releasing a queued (not current) key removes it without affecting current', async () => {
    resetQueue();
    const a = {}, b = {}, c = {};
    requestTurn(a, () => {});
    let firedB = false, firedC = false;
    requestTurn(b, () => { firedB = true; });
    requestTurn(c, () => { firedC = true; });
    releaseTurn(b); // b gives up its place before ever showing
    releaseTurn(a);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(firedB, false);
    assert.equal(firedC, true);
});

test('past MAX_QUEUE, a new request shows immediately instead of queueing forever', () => {
    resetQueue();
    requestTurn({}, () => {}); // current
    for (let i = 0; i < 5; i++) requestTurn({}, () => {}); // fills the 5-slot queue
    assert.equal(requestTurn({}, () => {}), true); // 6th waiting slot: shown anyway
});
