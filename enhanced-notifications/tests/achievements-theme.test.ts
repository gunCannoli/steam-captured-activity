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
/** A theme with only this `achievements` block (plus `rest` at the top level), resolved; its block. */
const block = (achievements: unknown, rest: Record<string, unknown> = {}) => resolveTheme({ ...rest, achievements }).achievements!;

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
    const merged = mergeTier({ icons: { a: [1, 2], b: true }, border: [1, '#fff', 2] }, { icons: { a: [3] } });
    assert.deepEqual(merged, { icons: { a: [3], b: true }, border: [1, '#fff', 2] });
});

test('the banner is layered: theme popup, then the block, then normal, then the tier', () => {
    const t = block(
        { padding: [10, 15, 10, 10], gap: 4, normal: { border: [1, '#111111', 3] }, magic: { background: ['#222222'], border: [2, '#333333', 9] } },
        { popup: { background: ['#1F1F1F', '#0F0F0F'], border: [0, '#8a2be2', 8], margin: 10, padding: 10, gap: 10, watermark: false } },
    );
    const normal = t.tiers.normal.banner, magic = t.tiers.magic.banner;
    assert.deepEqual(normal.background, ['#1F1F1F', '#0F0F0F'], 'from the popup');
    assert.deepEqual(normal.margin, { top: 10, right: 10, bottom: 10, left: 10 }, 'from the popup');
    assert.deepEqual(normal.padding, { top: 10, right: 15, bottom: 10, left: 10 }, 'the block wins over the popup');
    assert.deepEqual(normal.gap, [4, 4], 'the block wins over the popup');
    assert.deepEqual(normal.border, { width: 1, color: '#111111', radius: 3 }, 'normal wins over the popup');
    assert.deepEqual(magic.background, ['#222222'], 'the tier wins');
    assert.deepEqual(magic.border, { width: 2, color: '#333333', radius: 9 }, 'the tier wins over normal');
    assert.deepEqual(magic.padding, normal.padding);
});

test('no popup and no keys: the banner defaults', () => {
    const banner = block({}).tiers.normal.banner;
    assert.deepEqual(banner.background, ['#1b2838', '#2a475e']);
    assert.deepEqual(banner.padding, { top: 6, right: 10, bottom: 6, left: 10 });
    assert.deepEqual(banner.gap, [10, 2]);
    assert.deepEqual(banner.scale, [100, 100]);
});

test('scale, width and height: from the popup, the block or a tier', () => {
    const t = block({ width: 450, rare: { scale: 120 } }, { popup: { scale: [110, 90], height: 80 } });
    assert.deepEqual(t.tiers.normal.banner.scale, [110, 90]);
    assert.equal(t.tiers.normal.banner.width, 450);
    assert.equal(t.tiers.normal.banner.height, 80);
    assert.deepEqual(t.tiers.rare.banner.scale, [120, 120]);
});

test('threshold is never inherited from normal', () => {
    const theme = block({ normal: { threshold: 50 }, magic: {} });
    assert.equal(theme.tiers.magic.threshold, null);
});

test('icon shorthand normalises to [source, 100, 0]', () => {
    const theme = example('theme_exemple.json');
    assert.deepEqual(theme.tiers.normal.icons.achievement, { source: true, scalePct: 100, rippleMs: 0 });
    assert.deepEqual(theme.tiers.normal.icons.rarity, { source: false, scalePct: 100, rippleMs: 0 });
});

test('icon 3-tuple parses [source, scalePct, rippleMs]', () => {
    const theme = block({ normal: { icons: { system: ['custom/logo.png', 50, 2000], rarity: ['custom/trophy.png', 120, 0] } } });
    assert.deepEqual(theme.tiers.normal.icons.system, { source: 'custom/logo.png', scalePct: 50, rippleMs: 2000 });
    assert.deepEqual(theme.tiers.normal.icons.rarity, { source: 'custom/trophy.png', scalePct: 120, rippleMs: 0 });
});

test('pairs: a bare number or a one-element array sets both values; two elements set each', () => {
    const t = block({ normal: { margin: 7, padding: [5], gap: [10, 5] } });
    assert.deepEqual(t.tiers.normal.banner.margin, { top: 7, bottom: 7, left: 7, right: 7 });
    assert.deepEqual(t.tiers.normal.banner.padding, { top: 5, bottom: 5, left: 5, right: 5 });
    assert.deepEqual(t.tiers.normal.banner.gap, [10, 5]);
});

test("edges: CSS's clockwise shorthand (top, right, bottom, left); a bad side keeps its default", () => {
    const pad = (padding: unknown) => block({ padding }).tiers.normal.banner.padding;
    assert.deepEqual(pad([10, 5, 4, 7]), { top: 10, right: 5, bottom: 4, left: 7 });
    assert.deepEqual(pad([10, 5, 4]), { top: 10, right: 5, bottom: 4, left: 5 });
    assert.deepEqual(pad([10, 5]), { top: 10, right: 5, bottom: 10, left: 5 });
    assert.deepEqual(pad([3]), { top: 3, right: 3, bottom: 3, left: 3 });
    assert.deepEqual(pad(3), { top: 3, right: 3, bottom: 3, left: 3 });
    const t = block({ margin: [1, 2, 'x', 4] });
    assert.deepEqual(t.tiers.normal.banner.margin, { top: 1, right: 2, bottom: 0, left: 4 });
});

test('layout: a preset name, an object (custom), the block over popup.layout', () => {
    const ps5 = block({ layout: 'ps5' });
    assert.equal(ps5.layout, 'ps5');
    assert.deepEqual(ps5.customLayout, { achievement: 'left', system: 'right', rarity: 'title_left', text: 'center' });
    const custom = block({ layout: { achievement: 'right', system: 'left', rarity: 'desc_right' } });
    assert.equal(custom.layout, 'custom');
    assert.deepEqual(custom.customLayout, { achievement: 'right', system: 'left', rarity: 'desc_right', text: 'center' });
    assert.equal(block({}, { popup: { layout: 'compact_pill' } }).layout, 'compact_pill');
    assert.equal(block({ layout: 'ps5' }, { popup: { layout: 'compact_pill' } }).layout, 'ps5');
    assert.equal(block({}).layout, 'default_steam');
});

test('layout: "custom" and unknown names warn and use default_steam', () => {
    for (const layout of ['custom', 'nope']) {
        const t = resolveTheme({ achievements: { layout } });
        assert.equal(t.achievements?.layout, 'default_steam');
        assert.ok(t.warnings.some((w) => w.startsWith('achievements: layout')), JSON.stringify(t.warnings));
    }
});

test("text: styles are the theme's text.title / text.body; a tier sets only the words", () => {
    const t = resolveTheme({
        text: { title: ['#123456', 120, 'regular'], body: ['#abcdef'] },
        achievements: { exceptional: { text: { title: '100% Complete', desc: 'All done' } }, rare: { text: { title: ['#ff0000', 100, 'bold'] } } },
    });
    const ach = t.achievements!;
    for (const tier of ['normal', 'rare', 'exceptional'] as const) {
        assert.deepEqual(ach.tiers[tier].text.title, { color: '#123456', sizePct: 120, style: 'regular' }, tier);
        assert.deepEqual(ach.tiers[tier].text.desc, { color: '#abcdef', sizePct: 100, style: 'regular' }, `${tier}: unset fields keep the banner default`);
    }
    assert.equal(ach.tiers.exceptional.text.titleText, '100% Complete');
    assert.equal(ach.tiers.exceptional.text.descText, 'All done');
    assert.equal(ach.tiers.rare.text.titleText, undefined);
    assert.ok(t.warnings.some((w) => w.includes('rare.text.title is the words only')), JSON.stringify(t.warnings));
});

test('exceptional has default words; other tiers show the achievement', () => {
    const t = block({});
    assert.equal(t.tiers.exceptional.text.titleText, '100% Complete');
    assert.equal(t.tiers.normal.text.titleText, undefined);
});

test('invalid fields fall back to defaults instead of throwing', () => {
    const t = resolveTheme({ achievements: { normal: { border: [1, 'red', 5], sound: 'x' } } });
    assert.equal(t.achievements?.tiers.normal.banner.border.color, '#ffffff');
    assert.equal(t.achievements?.tiers.normal.sound, null);
    assert.ok(t.warnings.some((w) => w.includes('normal.sound')), JSON.stringify(t.warnings));
});

test('sound: null means the notification sound, silently', () => {
    const t = resolveTheme({ achievements: { normal: { sound: null } } });
    assert.equal(t.achievements?.tiers.normal.sound, null);
    assert.deepEqual(t.warnings, []);
});

test('an empty block is a banner with every default', () => {
    const t = resolveTheme({ achievements: {} });
    assert.ok(t.achievements);
    assert.deepEqual(Object.keys(t.achievements.tiers), ['normal', 'magic', 'rare', 'exceptional']);
    assert.deepEqual(t.warnings, []);
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

test('achievements: without the block, achievement toasts get the notification style', () => {
    const t = resolveTheme({ popup: { background: ['#000000'] } });
    assert.equal(t.achievements, null);
    assert.deepEqual(t.warnings, []);
});

test("achievements: the theme's settings are the banner's; unset, the banner's defaults", () => {
    const t = block({}, { settings: { position: 'top_left', animation: 'ps5', display_time_ms: 3000, text_align: 'center' } });
    assert.equal(t.position, 'top_left');
    assert.deepEqual(t.animation, { in: 'ps5', out: 'ps5' });
    assert.equal(t.displayTimeMs, 3000);
    assert.equal(t.textAlign, 'center');
    const bare = block({});
    assert.equal(bare.position, 'bottom_right');
    assert.deepEqual(bare.animation, { in: 'slide', out: 'fade' });
    assert.equal(bare.displayTimeMs, null);
    assert.equal(bare.textAlign, 'left');
});

test('achievements: an invalid theme setting is not inherited and warns once', () => {
    const t = resolveTheme({ settings: { position: 'nowhere', animation: 'bogus', text_align: 'justify' }, achievements: {} });
    assert.equal(t.achievements?.position, 'bottom_right');
    assert.deepEqual(t.achievements?.animation, { in: 'slide', out: 'fade' });
    assert.equal(t.achievements?.textAlign, 'left');
    for (const key of ['settings.position', 'settings.animation', 'settings.text_align']) {
        assert.equal(t.warnings.filter((w) => w.includes(key)).length, 1, key);
    }
});

test('achievements: an unusable block is a warning, never a failed theme', () => {
    for (const achievements of ['yes', [1]]) {
        const t = resolveTheme({ text: { title: ['#66c0f4', 100, 'bold'] }, achievements });
        assert.equal(t.achievements, null);
        assert.equal(t.style.text.title.color, '#66c0f4');
        assert.equal(t.warnings.length, 1, JSON.stringify(t.warnings));
        assert.match(t.warnings[0]!, /achievement toasts get the notification style/i);
    }
});

test('achievements: the old format loads with a warning per old key, which is ignored', () => {
    const t = resolveTheme({
        achievements: {
            settings: { layout: 'ps5', position: 'top_left' },
            tiers: { normal: {} },
            themes: { normal: {} },
            normal: { banner: { border: [3, '#123456', 3] }, background_color: ['#000000'] },
            magic: { box: {} },
        },
    });
    const ach = t.achievements!;
    assert.equal(ach.layout, 'default_steam');
    assert.equal(ach.position, 'bottom_right');
    assert.equal(ach.tiers.normal.banner.border.width, 0);
    assert.deepEqual(ach.tiers.normal.banner.background, ['#1b2838', '#2a475e']);
    for (const key of ['achievements.settings', 'achievements.tiers', 'achievements.themes', 'normal.banner', 'normal.background_color', 'magic.box']) {
        assert.ok(t.warnings.some((w) => w.includes(key)), `${key}: ${JSON.stringify(t.warnings)}`);
    }
});

test("achievements: the block's warnings are prefixed and its assets join the theme's", () => {
    const t = resolveTheme({
        sound: ['chime.mp3', 50],
        achievements: { layout: 'nope', normal: { icons: { rarity: 'bronze.svg' }, sound: ['tier.mp3', 80] } },
    });
    assert.ok(t.warnings.some((w) => w.startsWith('achievements: layout')), JSON.stringify(t.warnings));
    assert.deepEqual([...t.assetPaths].sort(), ['bronze.svg', 'chime.mp3', 'tier.mp3']);
});

test('resolveAchievementTheme: a block that is not an object throws', () => {
    assert.throws(() => resolveAchievementTheme(null));
    assert.throws(() => resolveAchievementTheme([1]));
});
