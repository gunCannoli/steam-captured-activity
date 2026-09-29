import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderQueue } from '../frontend/app/render-queue.ts';
import { toShortcutId } from '../frontend/kernel/appid.ts';

const A = toShortcutId(0x8000_0001)!;
const B = toShortcutId(0x8000_0002)!;

test('coalescing: two pushes for the same appid before a flush render once with the union of parts', () => {
    const calls: [number, string[]][] = [];
    let scheduled: (() => void) | undefined;
    const queue = createRenderQueue((appid, parts) => calls.push([appid, parts]), (f) => { scheduled = f; });

    queue.push(A, ['identity']);
    queue.push(A, ['metadata']);
    assert.equal(calls.length, 0, 'nothing renders before the scheduled flush runs');
    scheduled!();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]![0], A);
    assert.deepEqual([...calls[0]![1]].sort(), ['identity', 'metadata']);
});

test('one flush per tick: schedule is called once even with several pushes and several appids', () => {
    let scheduleCalls = 0;
    let scheduled: (() => void) | undefined;
    const calls: [number, string[]][] = [];
    const queue = createRenderQueue((appid, parts) => calls.push([appid, parts]), (f) => { scheduleCalls++; scheduled = f; });

    queue.push(A, ['identity']);
    queue.push(B, ['identity']);
    queue.push(A, ['achievements']);
    assert.equal(scheduleCalls, 1, 'schedule is called once for the whole batch, not once per push');
    scheduled!();
    assert.equal(calls.length, 2, 'each appid renders once');

    // after a flush, a new push schedules again
    queue.push(A, ['identity']);
    assert.equal(scheduleCalls, 2);
});
