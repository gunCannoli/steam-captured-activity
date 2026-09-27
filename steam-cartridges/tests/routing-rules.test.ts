import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    matchesRegex,
    isServiceAllowed,
    type RoutingRule,
} from '../frontend/features/buckets/resolve.ts';
import { inferredControllerIds } from '../frontend/features/game-info/category-policy.ts';

test('matchesRegex: handles valid regex and handles syntax error gracefully', () => {
    assert.equal(matchesRegex('Castlevania - Symphony of the Night', 'Castlevania.*'), true);
    assert.equal(matchesRegex('Pokemon Emerald', '^Castlevania'), false);
    // Invalid regex pattern should not throw and return false
    assert.equal(matchesRegex('Some Game', '[invalid('), false);
});

test('isServiceAllowed: empty rules allow all services', () => {
    assert.equal(isServiceAllowed('steam-store', 123, 'Super Mario', ['nintendo'], []), true);
    assert.equal(isServiceAllowed('retroachievements', 123, 'Super Mario', ['nintendo'], []), true);
});

test('isServiceAllowed: exclude rule disables service on match', () => {
    const rules: RoutingRule[] = [
        {
            id: 'rule-1',
            name: 'No RetroAchievements for Switch',
            service: 'retroachievements',
            action: 'exclude',
            conditionType: 'collection',
            pattern: 'Switch',
            enabled: true,
        },
    ];

    // Matches Switch collection -> excluded
    assert.equal(isServiceAllowed('retroachievements', 123, 'Mario Odyssey', ['Switch', 'Favorites'], rules), false);
    // Different collection -> allowed
    assert.equal(isServiceAllowed('retroachievements', 124, 'Super Metroid', ['SNES'], rules), true);
    // Different service -> allowed even if matching Switch
    assert.equal(isServiceAllowed('steam-store', 123, 'Mario Odyssey', ['Switch'], rules), true);
});

test('isServiceAllowed: include rule permits service and regex matching', () => {
    const rules: RoutingRule[] = [
        {
            id: 'rule-regex',
            name: 'Steam Store only for PC Ports',
            service: 'steam-store',
            action: 'include',
            conditionType: 'regex',
            pattern: '.*\\(PC\\)$',
            enabled: true,
        },
    ];

    // Matches regex -> allowed
    assert.equal(isServiceAllowed('steam-store', 125, 'Final Fantasy VII (PC)', [], rules), true);
});

test('isServiceAllowed: multi-service selection and console_emulators alias', () => {
    const rules: RoutingRule[] = [
        {
            id: 'rule-multi',
            name: 'Disable scraping for emulated ROMs',
            service: 'screenscraper,igdb,console_emulators',
            action: 'exclude',
            conditionType: 'collection',
            pattern: 'SNES, GBA, Genesis',
            enabled: true,
        },
    ];

    // Matches 'SNES' from comma-separated pattern for screenscraper
    assert.equal(isServiceAllowed('screenscraper', 101, 'Mario World', ['SNES'], rules), false);
    // Matches 'GBA' for console_emulators
    assert.equal(isServiceAllowed('console_emulators', 102, 'Metroid Fusion', ['GBA'], rules), false);
    // console_emulators alias covers legacy 'rpcs3' service target as well
    assert.equal(isServiceAllowed('rpcs3', 103, 'Persona 5', ['Genesis'], rules), false);
    // Service not in the rule (e.g. steam_store) remains allowed
    assert.equal(isServiceAllowed('steam_store', 101, 'Mario World', ['SNES'], rules), true);
    // Non-matching collection remains allowed
    assert.equal(isServiceAllowed('screenscraper', 104, 'PS5 Game', ['PlayStation 5'], rules), true);
});

test('inferredControllerIds: controller overrides take precedence', () => {
    // Normal emulator inference
    assert.deepEqual(inferredControllerIds({ inferred: true }), [28]);

    // Explicit override 'none' beats inferred
    assert.deepEqual(inferredControllerIds({ inferred: true, override: 'none' }), []);

    // Explicit override 'partial' beats inferred
    assert.deepEqual(inferredControllerIds({ inferred: true, override: 'partial' }), [18]);

    // Explicit override 'full' when nothing inferred
    assert.deepEqual(inferredControllerIds({ inferred: false, override: 'full' }), [28]);

    // Override 'auto' falls back to normal inference
    assert.deepEqual(inferredControllerIds({ inferred: true, override: 'auto' }), [28]);
    assert.deepEqual(inferredControllerIds({ inferred: false, override: 'auto' }), []);
});
