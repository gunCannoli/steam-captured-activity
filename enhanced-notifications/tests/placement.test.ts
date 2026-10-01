// Pure placement math (frontend/theme/placement.ts): run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animatedOffset, placeToast, stackOffset, steamCorner } from '../frontend/theme/placement.ts';

// Live values from tests/probes/toast-placement.mjs (2026-10-01): a 1920x1032 avail area, Steam's bottom-right corner.
const AVAIL = { left: 0, top: 0, width: 1920, height: 1032 };
const SIZE = { width: 283, height: 70 };
const ZERO = { top: 0, bottom: 0, left: 0, right: 0 };

test("steamCorner: Steam's first move starts past its anchored edge, on its side", () => {
    assert.equal(steamCorner(1637, 1102, SIZE, AVAIL), 'bottom_right');
    assert.equal(steamCorner(0, 1102, SIZE, AVAIL), 'bottom_left');
    assert.equal(steamCorner(1637, -70, SIZE, AVAIL), 'top_right');
    assert.equal(steamCorner(0, -70, SIZE, AVAIL), 'top_left');
});

test('stackOffset: 0 at rest in the first slot, one toast height per older toast, negative while sliding in', () => {
    assert.equal(stackOffset('bottom_right', 962, 70, AVAIL), 0);
    assert.equal(stackOffset('bottom_right', 892, 70, AVAIL), 70);
    assert.equal(stackOffset('bottom_right', 1102, 70, AVAIL), -140);
    assert.equal(stackOffset('top_left', 70, 70, AVAIL), 70);
});

test("placeToast: Steam's offset applied from the theme's corner, margin only on the anchored sides", () => {
    assert.deepEqual(placeToast('bottom_right', ZERO, 0, SIZE, AVAIL), { x: 1637, y: 962 }, "Steam's own place round-trips");
    assert.deepEqual(placeToast('top_left', ZERO, 70, SIZE, AVAIL), { x: 0, y: 70 });
    assert.deepEqual(placeToast('top_right', { top: 5, bottom: 99, left: 99, right: 5 }, 0, SIZE, AVAIL), { x: 1632, y: 5 });
    assert.deepEqual(placeToast('bottom_left', { top: 99, bottom: 8, left: 12, right: 99 }, 0, SIZE, AVAIL), { x: 12, y: 954 });
    assert.deepEqual(placeToast('top_center', { top: 0, bottom: 0, left: 50, right: 50 }, 0, SIZE, AVAIL), { x: 819, y: 0 }, 'centre ignores left/right');
    assert.deepEqual(placeToast('top_right', ZERO, -70, SIZE, AVAIL), { x: 1637, y: -70 }, 'slide in starts past the top edge');
});

test('animatedOffset: no slide past the slot; held still once Steam slides out', () => {
    assert.equal(animatedOffset(-140, 10, 5000, null), 0, 'slide in: stays at the corner');
    assert.equal(animatedOffset(70, 1000, 5000, 0), 70, 'a restack while shown still moves it');
    assert.equal(animatedOffset(20, 5400, 5000, 70), 70, 'after 300 ms in + 5000 ms shown: held');
    assert.equal(animatedOffset(-30, 5400, 5000, null), 0);
});
