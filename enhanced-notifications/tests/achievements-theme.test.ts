// The `achievements` block (frontend/theme/achievements.ts), and how frontend/theme/theme.ts resolves it inside a theme.
// Pure-logic tests: run with `npm test` (Node's built-in runner, TS type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { completesGame, mergeTier, previewTierOfId, resolveAchievementTheme, selectTier, tierOfNotification } from '../frontend/theme/achievements.ts';
import { resolveTheme } from '../frontend/theme/theme.ts';
import { parseJsonc } from '../frontend/theme/jsonc.ts';

const examplesDir = new URL('../examples/', import.meta.url);
const load = (dir: URL, name: string) => parseJsonc(readFileSync(new URL(name, dir), 'utf8'));
const isTheme = (f: string) => f.endsWith('.json') || f.endsWith('.jsonc');
/** An example theme file, resolved as the plugin does (the whole theme), then its `achievements` block. */
function example(name: string) {
    const theme = resolveTheme(load(examplesDir, name));
    assert.ok(theme.achievements, `${name}: no achievements block (${theme.warnings.join('; ')})`);
    return theme.achievements;
}
/** A bare `achievements` block. Its tiers are under `themes` here, the old key, which stays accepted. */
const resolveBlock = resolveAchievementTheme;

test('every example theme resolves, its achievements block included, without warnings', () => {
    for (const file of readdirSync(examplesDir).filter(isTheme)) {
        assert.equal(Object.keys(example(file).tiers).length, 4, file);
        assert.deepEqual(resolveTheme(load(examplesDir, file)).warnings, [], file);
    }
});

test('tiers inherit omitted keys from normal', () => {
    const theme = example('steam_ps_exemple.json');
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
    const theme = resolveBlock({ themes: { normal: { threshold: 50 }, magic: {} } });
    assert.equal(theme.tiers.magic.threshold, null);
});

test('icon shorthand normalises to [source, 100, 0]', () => {
    const theme = example('theme_exemple.json');
    assert.deepEqual(theme.tiers.normal.icons.achievement, { source: true, scalePct: 100, rippleMs: 0 });
    assert.deepEqual(theme.tiers.normal.icons.rarity, { source: false, scalePct: 100, rippleMs: 0 });
});

test('icon 3-tuple parses [source, scalePct, rippleMs]', () => {
    const theme = resolveBlock({
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
    const theme = resolveBlock({
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
    assert.deepEqual(theme.tiers.normal.banner.margin, { top: 10, bottom: 10, left: 10, right: 10 });
    assert.deepEqual(theme.tiers.normal.banner.padding, { top: 8, bottom: 8, left: 16, right: 16 });
    assert.deepEqual(theme.tiers.normal.banner.gap, [5, 5]);
    // box is backward compatibility alias
    assert.deepEqual(theme.tiers.normal.box, theme.tiers.normal.banner);
});

test('layout: ps5 preset sets authentic anchors', () => {
    const theme = resolveBlock({
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
    const theme = resolveBlock({
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
    const t1 = resolveBlock({ settings: { position: 'top_right' }, themes: { normal: {} } });
    assert.equal(t1.position, 'top_right');
    assert.equal(t1.warnings.length, 0);
    const t2 = resolveBlock({ settings: { position: 'invalid' }, themes: { normal: {} } });
    assert.equal(t2.position, 'bottom_right');
    assert.ok(t2.warnings.some((w) => w.includes('settings.position')));
});

test('exceptional text parses custom title and desc strings', () => {
    const theme = resolveBlock({
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
    const t1 = resolveBlock({
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

    const t2 = resolveBlock({
        settings: { text_align: 'invalid' },
        themes: { normal: {} },
    });
    assert.equal(t2.textAlign, 'left');
    assert.ok(t2.warnings.some((w) => w.includes('text_align')));
});

test('settings.animation: bare string sets both in and out', () => {
    const t = resolveBlock({ settings: { animation: 'fade' }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'fade', out: 'fade' });
});

test('settings.animation: {in, out} object sets each independently', () => {
    const t = resolveBlock({ settings: { animation: { in: 'ps5', out: 'fade' } }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'ps5', out: 'fade' });
});

test('settings.animation: missing keys in {in, out} fall back to the default per key', () => {
    const t = resolveBlock({ settings: { animation: { in: 'up' } }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'up', out: 'fade' });
});

test('settings.animation: unsupported value warns and uses the default pair', () => {
    const t1 = resolveBlock({ settings: { animation: 'bogus' }, themes: { normal: {} } });
    assert.deepEqual(t1.animation, { in: 'slide', out: 'fade' });
    assert.ok(t1.warnings.some((w) => w.includes('settings.animation')));

    const t2 = resolveBlock({ settings: { animation: { in: 'bogus' } }, themes: { normal: {} } });
    assert.deepEqual(t2.animation, { in: 'slide', out: 'fade' });
    assert.ok(t2.warnings.some((w) => w.includes('settings.animation.in')));
});

test('settings.animation: no setting at all defaults to slide in, fade out', () => {
    const t = resolveBlock({ themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'slide', out: 'fade' });
});

test('banner dimensions width and height parse and clamp', () => {
    const theme = resolveBlock({
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
    const theme = resolveBlock({ settings: { layout: 'nope' }, themes: { normal: { banner: { border: [1, 'red', 5] }, sound: 'x' } } });
    assert.equal(theme.layout, 'default_steam');
    assert.equal(theme.tiers.normal.banner.border.color, '#ffffff');
    assert.equal(theme.tiers.normal.sound, null);
    assert.ok(theme.warnings.length >= 2);
});

test('a block without tiers.normal is rejected', () => {
    assert.throws(() => resolveBlock({ tiers: {} }), /tiers\.normal/);
    assert.throws(() => resolveBlock({ themes: {} }), /tiers\.normal/);
    assert.throws(() => resolveBlock(null));
});

test('tier selection: exceptional > rare > magic > normal', () => {
    const theme = example('steam_ps_exemple.json'); // magic 25, rare 10
    assert.equal(selectTier(theme, { globalPct: 50, completesGame: false }), 'normal');
    assert.equal(selectTier(theme, { globalPct: 25, completesGame: false }), 'magic');
    assert.equal(selectTier(theme, { globalPct: 10, completesGame: false }), 'rare');
    assert.equal(selectTier(theme, { globalPct: 1, completesGame: true }), 'exceptional');
});

test('no rarity data (0 / undefined) selects normal', () => {
    const theme = example('steam_ps_exemple.json');
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

// --- resolver fixes ---------------------------------------------------------------

test('sound: null means the notification sound, silently', () => {
    const t = resolveBlock({ themes: { normal: { sound: null } } });
    assert.equal(t.tiers.normal.sound, null);
    assert.deepEqual(t.warnings, []);
});

test('text shorthand: a tier overriding only the words keeps the inherited title style', () => {
    const t = resolveBlock({
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
    const t = resolveBlock({ themes: { normal: { banner: { margin: 7, padding: [5], gap: [10, 5] } } } });
    assert.deepEqual(t.tiers.normal.banner.margin, { top: 7, bottom: 7, left: 7, right: 7 });
    assert.deepEqual(t.tiers.normal.banner.padding, { top: 5, bottom: 5, left: 5, right: 5 });
    assert.deepEqual(t.tiers.normal.banner.gap, [10, 5]);
});

test("edges: CSS's clockwise shorthand (top, right, bottom, left); a bad side keeps its default", () => {
    const pad = (padding: unknown) => resolveBlock({ themes: { normal: { banner: { padding } } } }).tiers.normal.banner.padding;
    assert.deepEqual(pad([10, 5, 4, 7]), { top: 10, right: 5, bottom: 4, left: 7 });
    assert.deepEqual(pad([10, 5, 4]), { top: 10, right: 5, bottom: 4, left: 5 });
    assert.deepEqual(pad([10, 5]), { top: 10, right: 5, bottom: 10, left: 5 });
    assert.deepEqual(pad([3]), { top: 3, right: 3, bottom: 3, left: 3 });
    assert.deepEqual(pad(3), { top: 3, right: 3, bottom: 3, left: 3 });
    const t = resolveBlock({ themes: { normal: { banner: { margin: [1, 2, 'x', 4] } } } });
    assert.deepEqual(t.tiers.normal.banner.margin, { top: 1, right: 2, bottom: 0, left: 4 });
});

test('tier: a preview id carries its own tier, whatever the thresholds', () => {
    const t = example('steam_ps_exemple.json'); // magic 25, rare 10
    for (const tier of ['normal', 'magic', 'rare', 'exceptional'] as const) {
        assert.equal(previewTierOfId(`EA_PREVIEW_${tier}`), tier);
        assert.equal(tierOfNotification({ id: `EA_PREVIEW_${tier}`, globalPct: 99 }, t), tier);
        assert.equal(tierOfNotification({ id: `EA_PREVIEW_${tier}`, globalPct: 0.1 }, null), tier);
    }
});

test('tier: the completion id is exceptional; an unknown preview suffix falls back to rarity', () => {
    const t = example('steam_ps_exemple.json'); // magic 25, rare 10
    const rare = t.tiers.rare.threshold!;
    assert.equal(tierOfNotification({ id: 'EA_100_PERCENT', globalPct: 99 }, t), 'exceptional');
    assert.equal(previewTierOfId('EA_PREVIEW_bogus'), null);
    assert.equal(previewTierOfId(undefined), null);
    assert.equal(tierOfNotification({ id: 'EA_PREVIEW_bogus', globalPct: rare }, t), 'rare');
});

test('tier: a real unlock uses the theme thresholds; no theme means normal', () => {
    const t = example('steam_ps_exemple.json'); // magic 25, rare 10
    const rare = t.tiers.rare.threshold!, magic = t.tiers.magic.threshold!;
    assert.equal(tierOfNotification({ id: 'ACH_1', globalPct: rare }, t), 'rare');
    assert.equal(tierOfNotification({ id: 'ACH_1', globalPct: magic }, t), 'magic');
    assert.equal(tierOfNotification({ id: 'ACH_1', globalPct: 100 }, t), 'normal');
    assert.equal(tierOfNotification({ id: 'ACH_1', globalPct: 0 }, t), 'normal');
    assert.equal(tierOfNotification({ id: undefined, globalPct: undefined }, t), 'normal');
    assert.equal(tierOfNotification({ id: 'ACH_1', globalPct: rare }, null), 'normal');
});

// --- inside a theme (frontend/theme/theme.ts) ---------------------------------------

test('achievements: `tiers` and the old `themes` key resolve the same', () => {
    const tiers = { normal: { banner: { border: [2, '#cd7f32', 8] } }, rare: { threshold: 10 } };
    assert.deepEqual(resolveBlock({ tiers }), resolveBlock({ themes: tiers }));
});

test('achievements: without the block, achievement toasts get the notification style', () => {
    const t = resolveTheme({ popup: { background: ['#000000'] } });
    assert.equal(t.achievements, null);
    assert.deepEqual(t.warnings, []);
});

test("achievements: settings inherit the theme's position, animation and display time; its own win", () => {
    const tiers = { normal: {} };
    const inherited = resolveTheme({ settings: { position: 'top_left', animation: 'ps5', display_time_ms: 3000 }, achievements: { tiers } }).achievements!;
    assert.equal(inherited.position, 'top_left');
    assert.deepEqual(inherited.animation, { in: 'ps5', out: 'ps5' });
    assert.equal(inherited.displayTimeMs, 3000);
    const own = resolveTheme({
        settings: { position: 'top_left', animation: 'ps5', display_time_ms: 3000 },
        achievements: { settings: { position: 'bottom_center', animation: 'fade', display_time_ms: 6000 }, tiers },
    }).achievements!;
    assert.equal(own.position, 'bottom_center');
    assert.deepEqual(own.animation, { in: 'fade', out: 'fade' });
    assert.equal(own.displayTimeMs, 6000);
    const bare = resolveTheme({ achievements: { tiers } }).achievements!;
    assert.equal(bare.position, 'bottom_right');
    assert.deepEqual(bare.animation, { in: 'slide', out: 'fade' });
    assert.equal(bare.displayTimeMs, null);
});

test('achievements: an invalid theme setting is not inherited and warns once', () => {
    const t = resolveTheme({ settings: { position: 'nowhere', animation: 'bogus' }, achievements: { tiers: { normal: {} } } });
    assert.equal(t.achievements?.position, 'bottom_right');
    assert.deepEqual(t.achievements?.animation, { in: 'slide', out: 'fade' });
    assert.equal(t.warnings.filter((w) => w.includes('settings.position')).length, 1);
    assert.equal(t.warnings.filter((w) => w.includes('settings.animation')).length, 1);
});

test('achievements: an unusable block is a warning, never a failed theme', () => {
    for (const achievements of [{ tiers: {} }, 'yes', [1]]) {
        const t = resolveTheme({ text: { title: ['#66c0f4', 100, 'bold'] }, achievements });
        assert.equal(t.achievements, null);
        assert.equal(t.style.text.title.color, '#66c0f4');
        assert.equal(t.warnings.length, 1, JSON.stringify(t.warnings));
        assert.match(t.warnings[0]!, /achievement toasts get the notification style/i);
    }
});

test("achievements: the block's warnings are prefixed and its assets join the theme's", () => {
    const t = resolveTheme({
        sound: ['chime.mp3', 50],
        achievements: { settings: { layout: 'nope' }, tiers: { normal: { icons: { rarity: 'bronze.svg' }, sound: ['tier.mp3', 80] } } },
    });
    assert.ok(t.warnings.some((w) => w.startsWith('achievements: settings.layout')), JSON.stringify(t.warnings));
    assert.deepEqual([...t.assetPaths].sort(), ['bronze.svg', 'chime.mp3', 'tier.mp3']);
});
