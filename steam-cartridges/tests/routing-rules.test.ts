import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    matchesRegex,
    isServiceAllowed,
    isServiceAllowedByAutoMode,
    type RoutingRule,
    type AutoRoutingProfile,
} from '../frontend/domain/routing/policy.ts';
import { inferredControllerIds } from '../frontend/domain/category-policy.ts';

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

test('isServiceAllowedByAutoMode: validates baseline rules per category', () => {
    // RetroArch (e.g. FBNeo, SNES, Genesis)
    assert.equal(isServiceAllowedByAutoMode('retroachievements', 'retroarch'), true);
    assert.equal(isServiceAllowedByAutoMode('screenscraper', 'retroarch'), true);
    assert.equal(isServiceAllowedByAutoMode('igdb', 'retroarch'), true);
    assert.equal(isServiceAllowedByAutoMode('steamgriddb', 'retroarch'), true);
    assert.equal(isServiceAllowedByAutoMode('steam_store', 'retroarch'), false);
    assert.equal(isServiceAllowedByAutoMode('steam-store', 'retroarch'), false);
    assert.equal(isServiceAllowedByAutoMode('console_emulators', 'retroarch'), false);
    assert.equal(isServiceAllowedByAutoMode('rpcs3', 'retroarch'), false);

    // Console Emulators (e.g. RPCS3, shadPS4, DuckStation, PCSX2)
    assert.equal(isServiceAllowedByAutoMode('console_emulators', 'console_emulator'), true);
    assert.equal(isServiceAllowedByAutoMode('rpcs3', 'console_emulator'), true);
    assert.equal(isServiceAllowedByAutoMode('screenscraper', 'console_emulator'), true);
    assert.equal(isServiceAllowedByAutoMode('steam_store', 'console_emulator'), false);
    assert.equal(isServiceAllowedByAutoMode('retroachievements', 'console_emulator'), true);

    // PC games
    assert.equal(isServiceAllowedByAutoMode('steam_store', 'pc'), true);
    assert.equal(isServiceAllowedByAutoMode('steam-store', 'pc'), true);
    assert.equal(isServiceAllowedByAutoMode('igdb', 'pc'), true);
    assert.equal(isServiceAllowedByAutoMode('steamgriddb', 'pc'), true);
    assert.equal(isServiceAllowedByAutoMode('screenscraper', 'pc'), false);
    assert.equal(isServiceAllowedByAutoMode('retroachievements', 'pc'), false);
    assert.equal(isServiceAllowedByAutoMode('console_emulators', 'pc'), false);
});

test('isServiceAllowed: auto mode integration and custom rule precedence', () => {
    const retroProfile: AutoRoutingProfile = {
        appid: 1001,
        title: '1944: The Loop Master',
        target: 'C:\\emu\\RetroArch\\retroarch.exe',
        category: 'retroarch',
        emulator: 'RetroArch',
        core: 'fbneo_libretro',
        platform: 'arcade',
    };

    const pcProfile: AutoRoutingProfile = {
        appid: 1002,
        title: 'AM2R',
        target: 'C:\\Games\\AM2R\\AM2R.exe',
        category: 'pc',
    };

    // With auto mode off, everything defaults to allowed if no rules
    assert.equal(isServiceAllowed('steam_store', 1001, '1944', [], [], false, retroProfile), true);

    // With auto mode on and no custom rules:
    // RetroArch game has steam_store disallowed and retroachievements allowed
    assert.equal(isServiceAllowed('steam_store', 1001, '1944', [], [], true, retroProfile), false);
    assert.equal(isServiceAllowed('retroachievements', 1001, '1944', [], [], true, retroProfile), true);
    assert.equal(isServiceAllowed('screenscraper', 1001, '1944', [], [], true, retroProfile), true);

    // PC game has steam_store allowed and retroachievements disallowed
    assert.equal(isServiceAllowed('steam_store', 1002, 'AM2R', [], [], true, pcProfile), true);
    assert.equal(isServiceAllowed('retroachievements', 1002, 'AM2R', [], [], true, pcProfile), false);

    // Custom user rule overrides auto mode (e.g. user explicitly includes steam_store for 1944)
    const customRules: RoutingRule[] = [
        {
            id: 'rule-custom-include',
            name: 'Force Steam Store for 1944',
            service: 'steam_store',
            action: 'include',
            conditionType: 'game_name',
            pattern: '1944*',
            enabled: true,
        },
    ];

    assert.equal(isServiceAllowed('steam_store', 1001, '1944: The Loop Master', [], customRules, true, retroProfile), true);
});

