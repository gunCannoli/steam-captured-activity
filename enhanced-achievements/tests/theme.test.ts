// Pure-logic tests: run with `npm test` (Node's built-in runner, TS type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { completesGame, mergeTier, resolveTheme, selectTier } from '../frontend/theme/theme.ts';

const themesDir = new URL('../themes/', import.meta.url);
const examplesDir = new URL('../examples/', import.meta.url);
const load = (dir: URL, name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

test('every bundled theme resolves without throwing', () => {
    for (const file of readdirSync(themesDir).filter((f) => f.endsWith('.json'))) {
        const theme = resolveTheme(load(themesDir, file));
        assert.equal(Object.keys(theme.tiers).length, 4, file);
    }
});

test('every example theme resolves without throwing', () => {
    for (const file of readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
        const theme = resolveTheme(load(examplesDir, file));
        assert.equal(Object.keys(theme.tiers).length, 4, file);
    }
});

test("every bundled theme's assets exist, relative to themes/", () => {
    for (const file of readdirSync(themesDir).filter((f) => f.endsWith('.json'))) {
        const theme = resolveTheme(load(themesDir, file));
        for (const rel of theme.assetPaths) {
            assert.ok(!/^[a-zA-Z]:[\\/]/.test(rel) && !rel.startsWith('/'), `${file}: asset path must be relative, got "${rel}"`);
            const abs = fileURLToPath(new URL(rel, themesDir));
            assert.ok(existsSync(abs), `${file}: missing asset "${rel}" (${abs})`);
        }
    }
});

test('tiers inherit omitted keys from normal', () => {
    const theme = resolveTheme(load(examplesDir, 'steam_ps_exemple.json'));
    // magic overrides only glow + rarity icon; text and border come from normal.
    assert.deepEqual(theme.tiers.magic.text, theme.tiers.normal.text);
    assert.deepEqual(theme.tiers.magic.box.border, theme.tiers.normal.box.border);
    assert.equal(theme.tiers.magic.box.glow.spread, 60);
    assert.notEqual(theme.tiers.magic.icons.rarity.source, theme.tiers.normal.icons.rarity.source);
});

test('objects merge key by key, arrays are replaced whole', () => {
    const merged = mergeTier({ box: { scale: [1, 2], border: [1, '#fff', 2] } }, { box: { scale: [3] } });
    assert.deepEqual(merged, { box: { scale: [3], border: [1, '#fff', 2] } });
});

test('threshold is never inherited from normal', () => {
    const theme = resolveTheme({ themes: { normal: { threshold: 50 }, magic: {} } });
    assert.equal(theme.tiers.magic.threshold, null);
});

test('icon shorthand normalises to [source, 0]', () => {
    const theme = resolveTheme(load(examplesDir, 'theme_exemple.json'));
    assert.deepEqual(theme.tiers.normal.icons.achievement, { source: true, rippleMs: 0 });
    assert.deepEqual(theme.tiers.normal.icons.rarity, { source: false, rippleMs: 0 });
});

test('invalid fields fall back to defaults instead of throwing', () => {
    const theme = resolveTheme({ settings: { layout: 'nope' }, themes: { normal: { box: { border: [1, 'red', 5] }, sound: 'x' } } });
    assert.equal(theme.layout, 'default_steam');
    assert.equal(theme.tiers.normal.box.border.color, '#ffffff');
    assert.equal(theme.tiers.normal.sound, null);
    assert.ok(theme.warnings.length >= 2);
});

test('a file without themes.normal is rejected', () => {
    assert.throws(() => resolveTheme({ themes: {} }));
    assert.throws(() => resolveTheme(null));
});

test('tier selection: exceptional > rare > magic > normal', () => {
    const theme = resolveTheme(load(examplesDir, 'steam_ps_exemple.json')); // magic 25, rare 10
    assert.equal(selectTier(theme, { globalPct: 50, completesGame: false }), 'normal');
    assert.equal(selectTier(theme, { globalPct: 25, completesGame: false }), 'magic');
    assert.equal(selectTier(theme, { globalPct: 10, completesGame: false }), 'rare');
    assert.equal(selectTier(theme, { globalPct: 1, completesGame: true }), 'exceptional');
});

test('no rarity data (0 / undefined) selects normal', () => {
    const theme = resolveTheme(load(examplesDir, 'steam_ps_exemple.json'));
    assert.equal(selectTier(theme, { globalPct: 0, completesGame: false }), 'normal');
    assert.equal(selectTier(theme, { globalPct: undefined, completesGame: false }), 'normal');
});

test('completesGame reads the pre-unlock cache entry', () => {
    assert.equal(completesGame({ unlocked: 96, total: 97, all_unlocked: false }), true);
    assert.equal(completesGame({ unlocked: 4, total: 97, all_unlocked: false }), false);
    assert.equal(completesGame({ unlocked: 97, total: 97, all_unlocked: true }), false);
    assert.equal(completesGame(undefined), false);
    assert.equal(completesGame({ unlocked: 0, total: 0 }), false);
});
