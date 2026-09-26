// Pure-logic tests: run with `npm test` (Node's built-in runner, TS type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { completesGame, mergeTier, resolveTheme, selectTier } from '../frontend/theme/theme.ts';
import { parseJsonc, stripJsonc } from '../frontend/theme/jsonc.ts';

const themesDir = new URL('../themes/', import.meta.url);
const examplesDir = new URL('../examples/', import.meta.url);
const load = (dir: URL, name: string) => parseJsonc(readFileSync(new URL(name, dir), 'utf8'));
const isTheme = (f: string) => f.endsWith('.json') || f.endsWith('.jsonc');

test('every bundled theme resolves without throwing', () => {
    for (const file of readdirSync(themesDir).filter(isTheme)) {
        const theme = resolveTheme(load(themesDir, file));
        assert.equal(Object.keys(theme.tiers).length, 4, file);
    }
});

test('every example theme resolves without throwing', () => {
    for (const file of readdirSync(examplesDir).filter(isTheme)) {
        const theme = resolveTheme(load(examplesDir, file));
        assert.equal(Object.keys(theme.tiers).length, 4, file);
    }
});

test("every bundled theme's assets exist, relative to themes/", () => {
    for (const file of readdirSync(themesDir).filter(isTheme)) {
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
            text: 'achievement_left',
        },
        themes: { normal: {} },
    });
    assert.equal(theme.layout, 'custom');
    assert.equal(theme.customLayout?.achievement, 'left');
    assert.equal(theme.customLayout?.system, 'right');
    assert.equal(theme.customLayout?.rarity, 'title_left');
    assert.equal(theme.customLayout?.text, 'achievement_left');
});

test('settings: position parses supported values and falls back', () => {
    const t1 = resolveTheme({ settings: { position: 'top_right' }, themes: { normal: {} } });
    assert.equal(t1.position, 'top_right');
    assert.equal(t1.warnings.length, 0);
    const t2 = resolveTheme({ settings: { position: 'invalid' }, themes: { normal: {} } });
    assert.equal(t2.position, 'bottom_right');
    assert.ok(t2.warnings.some((w) => w.includes('settings.position')));
});

test('exceptional text parses custom title and desc strings', () => {
    const theme = resolveTheme({
        themes: {
            normal: {},
            exceptional: {
                text: {
                    title: '100% Complete',
                    desc: "You've unlocked all achievements!",
                },
            },
        },
    });
    assert.equal(theme.tiers.exceptional.text.titleText, '100% Complete');
    assert.equal(theme.tiers.exceptional.text.descText, "You've unlocked all achievements!");
});

test('settings and tier text-align parse and inherit correctly', () => {
    const t1 = resolveTheme({
        settings: { text_align: 'center' },
        themes: {
            normal: {
                text: { title: ['#ffffff', 100, 'bold'] },
            },
            magic: {
                text: { align: 'right' },
            },
        },
    });
    assert.equal(t1.textAlign, 'center');
    assert.equal(t1.tiers.normal.text.align, 'center');
    assert.equal(t1.tiers.magic.text.align, 'right');

    const t2 = resolveTheme({
        settings: { text_align: 'invalid' },
        themes: { normal: {} },
    });
    assert.equal(t2.textAlign, 'left');
    assert.ok(t2.warnings.some((w) => w.includes('text_align')));
});

test('settings.animation: bare string sets both in and out', () => {
    const t = resolveTheme({ settings: { animation: 'fade' }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'fade', out: 'fade' });
});

test('settings.animation: {in, out} object sets each independently', () => {
    const t = resolveTheme({ settings: { animation: { in: 'ps5', out: 'fade' } }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'ps5', out: 'fade' });
});

test('settings.animation: missing keys in {in, out} fall back to the default per key', () => {
    const t = resolveTheme({ settings: { animation: { in: 'up' } }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'up', out: 'fade' });
});

test('settings.animation: unsupported value warns and uses the default pair', () => {
    const t1 = resolveTheme({ settings: { animation: 'bogus' }, themes: { normal: {} } });
    assert.deepEqual(t1.animation, { in: 'slide', out: 'fade' });
    assert.ok(t1.warnings.some((w) => w.includes('settings.animation')));

    const t2 = resolveTheme({ settings: { animation: { in: 'bogus' } }, themes: { normal: {} } });
    assert.deepEqual(t2.animation, { in: 'slide', out: 'fade' });
    assert.ok(t2.warnings.some((w) => w.includes('settings.animation.in')));
});

test('settings.animation: no setting at all defaults to slide in, fade out', () => {
    const t = resolveTheme({ themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'slide', out: 'fade' });
});

test('banner dimensions width and height parse and clamp', () => {
    const theme = resolveTheme({
        themes: {
            normal: {
                banner: {
                    width: 450,
                    height: 80,
                },
            },
        },
    });
    assert.equal(theme.tiers.normal.banner.width, 450);
    assert.equal(theme.tiers.normal.banner.height, 80);
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

// --- JSONC --------------------------------------------------------------------

test('jsonc: line and block comments and trailing commas are ignored', () => {
    const text = '{\n  // a comment\n  "a": [1, 2,], /* block\n spanning */ "b": { "c": true, },\n}\n';
    assert.deepEqual(parseJsonc(text), { a: [1, 2], b: { c: true } });
});

test('jsonc: comment-like text inside strings is kept', () => {
    const text = '{ "url": "https://x.test/a//b", "s": "/* not a comment */", "q": "say \\"hi\\" // still string" }';
    assert.deepEqual(parseJsonc(text), { url: 'https://x.test/a//b', s: '/* not a comment */', q: 'say "hi" // still string' });
});

test('jsonc: a leading BOM is accepted', () => {
    assert.deepEqual(parseJsonc('﻿{"a":1}'), { a: 1 });
});

test('jsonc: stripping keeps line structure, so parse errors point at the real line', () => {
    const text = '{\n  // c\n  "a": 1 /* x */\n}';
    assert.equal(stripJsonc(text).split('\n').length, text.split('\n').length);
    assert.equal(stripJsonc(text).length, text.length);
});

test('jsonc: a comma inside a string before } is not treated as trailing', () => {
    assert.deepEqual(parseJsonc('{"a": ",", "b": [","]}'), { a: ',', b: [','] });
});

// --- resolver fixes ---------------------------------------------------------------

test('every bundled theme resolves with no warnings', () => {
    for (const file of readdirSync(themesDir).filter(isTheme)) {
        assert.deepEqual(resolveTheme(load(themesDir, file)).warnings, [], file);
    }
});

test('sound: null means Steam chime, silently', () => {
    const t = resolveTheme({ themes: { normal: { sound: null } } });
    assert.equal(t.tiers.normal.sound, null);
    assert.deepEqual(t.warnings, []);
});

test('text shorthand: a tier overriding only the words keeps the inherited title style', () => {
    const t = resolveTheme({
        themes: {
            normal: { text: { title: ['#123456', 120, 'regular'] } },
            exceptional: { text: { title: '100% Complete', desc: 'All done' } },
        },
    });
    assert.deepEqual(t.tiers.exceptional.text.title, { color: '#123456', sizePct: 120, style: 'regular' });
    assert.equal(t.tiers.exceptional.text.titleText, '100% Complete');
    assert.equal(t.tiers.exceptional.text.descText, 'All done');
});

test('pairs: a bare number or a one-element array sets both values; two elements set each', () => {
    const t = resolveTheme({ themes: { normal: { banner: { margin: 7, padding: [5], gap: [10, 5] } } } });
    assert.deepEqual(t.tiers.normal.banner.margin, [7, 7]);
    assert.deepEqual(t.tiers.normal.banner.padding, [5, 5]);
    assert.deepEqual(t.tiers.normal.banner.gap, [10, 5]);
});
