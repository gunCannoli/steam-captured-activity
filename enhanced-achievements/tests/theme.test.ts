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
    assert.deepEqual(theme.tiers.magic.banner.border, theme.tiers.normal.banner.border);
    assert.equal(theme.tiers.magic.banner.glow.spread, 60);
    assert.notEqual(theme.tiers.magic.icons.rarity.source, theme.tiers.normal.icons.rarity.source);
});

test('objects merge key by key, arrays are replaced whole', () => {
    const merged = mergeTier({ banner: { scale: [1, 2], border: [1, '#fff', 2] } }, { banner: { scale: [3] } });
    assert.deepEqual(merged, { banner: { scale: [3], border: [1, '#fff', 2] } });
});

test('threshold is never inherited from normal', () => {
    const theme = resolveTheme({ themes: { normal: { threshold: 50 }, magic: {} } });
    assert.equal(theme.tiers.magic.threshold, null);
});

test('icon shorthand normalises to [source, 100, 0]', () => {
    const theme = resolveTheme(load(examplesDir, 'theme_exemple.json'));
    assert.deepEqual(theme.tiers.normal.icons.achievement, { source: true, scalePct: 100, rippleMs: 0 });
    assert.deepEqual(theme.tiers.normal.icons.rarity, { source: false, scalePct: 100, rippleMs: 0 });
});

test('icon 3-tuple parses [source, scalePct, rippleMs]', () => {
    const theme = resolveTheme({
        themes: {
            normal: {
                icons: {
                    system: ['custom/logo.png', 50, 2000],
                    rarity: ['custom/trophy.png', 120, 0],
                },
            },
        },
    });
    assert.deepEqual(theme.tiers.normal.icons.system, { source: 'custom/logo.png', scalePct: 50, rippleMs: 2000 });
    assert.deepEqual(theme.tiers.normal.icons.rarity, { source: 'custom/trophy.png', scalePct: 120, rippleMs: 0 });
});

test('banner geometry: margin, padding, gap parse scalars and pairs', () => {
    const theme = resolveTheme({
        themes: {
            normal: {
                banner: {
                    margin: 10,
                    padding: [8, 16],
                    gap: 5,
                },
            },
        },
    });
    assert.deepEqual(theme.tiers.normal.banner.margin, [10, 10]);
    assert.deepEqual(theme.tiers.normal.banner.padding, [8, 16]);
    assert.deepEqual(theme.tiers.normal.banner.gap, [5, 5]);
    // box is backward compatibility alias
    assert.deepEqual(theme.tiers.normal.box, theme.tiers.normal.banner);
});

test('layout: ps5 preset sets authentic anchors', () => {
    const theme = resolveTheme({
        settings: { layout: 'ps5' },
        themes: { normal: {} },
    });
    assert.equal(theme.layout, 'ps5');
    assert.deepEqual(theme.customLayout, {
        achievement: 'left',
        system: 'right',
        rarity: 'title_left',
        exceptional: 'title_left',
        text: 'center',
    });
});

test('layout: custom maps arbitrary anchors', () => {
    const theme = resolveTheme({
        settings: { layout: 'custom' },
        layout: {
            achievement: 'left',
            system: 'right',
            rarity: 'title_left',
            exceptional: 'title_right',
        },
        themes: { normal: {} },
    });
    assert.equal(theme.layout, 'custom');
    assert.equal(theme.customLayout?.achievement, 'left');
    assert.equal(theme.customLayout?.system, 'right');
    assert.equal(theme.customLayout?.rarity, 'title_left');
    assert.equal(theme.customLayout?.exceptional, 'title_right');
});

test('invalid fields fall back to defaults instead of throwing', () => {
    const theme = resolveTheme({ settings: { layout: 'nope' }, themes: { normal: { banner: { border: [1, 'red', 5] }, sound: 'x' } } });
    assert.equal(theme.layout, 'default_steam');
    assert.equal(theme.tiers.normal.banner.border.color, '#ffffff');
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
