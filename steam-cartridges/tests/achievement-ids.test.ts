import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAchievementId } from '../frontend/domain/achievement-ids.ts';

test('achievement ids: an exact id wins over a case-insensitive match', () => {
    const schema = [{ id: 'Kill', name: 'kill' }, { id: 'kill', name: 'X' }];
    assert.equal(canonicalAchievementId('kill', schema), 'kill');
    assert.equal(canonicalAchievementId('KILL', schema), 'Kill');
});

test('achievement ids: the ach_ prefix is added or removed', () => {
    assert.equal(canonicalAchievementId('ACH_WIN', [{ id: 'WIN', name: 'Win' }]), 'WIN');
    assert.equal(canonicalAchievementId('WIN', [{ id: 'ACH_WIN', name: 'Victory' }]), 'ACH_WIN');
});

test('achievement ids: a display name maps to its id', () => {
    const schema = [{ id: 'ACH_PLATINUM_01_F', name: 'Fallen Feathers' }];
    assert.equal(canonicalAchievementId('Fallen Feathers', schema), 'ACH_PLATINUM_01_F');
});

test('achievement ids: letters and digits only as the last resort', () => {
    const schema = [{ id: 'ACH_PLATINUM_01_F', name: 'Fallen Feathers' }];
    assert.equal(canonicalAchievementId('fallen-feathers!', schema), 'ACH_PLATINUM_01_F');
});

test('achievement ids: unknown, empty, unmatched number and empty schema give undefined', () => {
    const schema = [{ id: 'A', name: 'Alpha' }];
    assert.equal(canonicalAchievementId('nope', schema), undefined);
    assert.equal(canonicalAchievementId('', schema), undefined);
    assert.equal(canonicalAchievementId(0, schema), undefined);
    assert.equal(canonicalAchievementId(null, schema), undefined);
    assert.equal(canonicalAchievementId('A', []), undefined);
});

test('achievement ids: a non-ASCII name matches ignoring case', () => {
    assert.equal(canonicalAchievementId('ÉTÉ', [{ id: 'SUMMER', name: 'Été' }]), 'SUMMER');
});
