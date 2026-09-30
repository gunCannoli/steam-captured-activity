// Banner timing tests (migration plan § E1a).
import test from 'node:test';
import assert from 'node:assert/strict';
import { themedDisplayMs } from '../frontend/banner/timing.ts';

test("timing: themedDisplayMs prefers display_time_ms, then Steam's duration, then 5000", () => {
    assert.equal(themedDisplayMs(4000, 7000), 4000);
    assert.equal(themedDisplayMs(null, 7000), 7000);
    assert.equal(themedDisplayMs(undefined, 7000), 7000);
    assert.equal(themedDisplayMs(null, undefined), 5000);
    assert.equal(themedDisplayMs(null, 0), 5000);
});
