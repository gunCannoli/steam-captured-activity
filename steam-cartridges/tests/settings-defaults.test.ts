import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../frontend/settings/defaults.ts';
import { DEFAULT_BUCKETS } from '../frontend/domain/routing/policy.ts';

test('settings keys and defaults are unchanged', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/settings-defaults.json', import.meta.url), 'utf8'));
    assert.deepEqual(JSON.parse(JSON.stringify(DEFAULTS)), fixture);
});

test("the bucket default equals the routing policy's DEFAULT_BUCKETS", () => {
    assert.deepEqual(DEFAULTS.buckets, DEFAULT_BUCKETS);
});
