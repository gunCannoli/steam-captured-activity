// Pure-logic tests: run with `npm test` (Node's built-in runner, TS type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAnimationCss, buildCss, buildPlaceholderCss, keyframeName, resolveTheme, type ToastSelectors } from '../frontend/theme/theme.ts';
import { parseJsonc, stripJsonc } from '../frontend/theme/jsonc.ts';

const themesDir = new URL('../themes/', import.meta.url);
const load = (name: string) => parseJsonc(readFileSync(new URL(name, themesDir), 'utf8'));
/** Theme files are .jsonc or .json; both parse as JSONC. */
const isTheme = (f: string) => f.endsWith('.json') || f.endsWith('.jsonc');

const SEL: ToastSelectors = {
    desktopPopup: ':is(.dp)',
    gamepadPopup: ':is(.gp)',
    watermark: ':is(.wm)',
    templates: ':is(.tpl)',
    shortTemplate: ':is(.short)',
    title: ':is(.title)',
    body: ':is(.body, .desc)',
    subtext: ':is(.sub)',
    logoBox: ':is(.logo)',
    appLogo: ':is(.applogo)',
    headerIcon: ':is(.icon)',
};

test('every bundled theme resolves without warnings', () => {
    for (const file of readdirSync(themesDir).filter(isTheme)) {
        const theme = resolveTheme(load(file));
        assert.ok(theme.style, file);
        assert.deepEqual(theme.warnings, [], file);
    }
});

test("every bundled theme's assets exist, relative to themes/", () => {
    for (const file of readdirSync(themesDir).filter(isTheme)) {
        const theme = resolveTheme(load(file));
        for (const rel of theme.assetPaths) {
            assert.ok(!/^[a-zA-Z]:[\\/]/.test(rel) && !rel.startsWith('/'), `${file}: asset path must be relative, got "${rel}"`);
            const abs = fileURLToPath(new URL(rel, themesDir));
            assert.ok(existsSync(abs), `${file}: missing asset "${rel}" (${abs})`);
        }
    }
});

test('bundled themes: steam_midnight styles achievements like every toast; ps5, steam_tiers and theme draw the banner', () => {
    assert.equal(resolveTheme(load('steam_midnight.json')).achievements, null);
    for (const file of ['ps5.jsonc', 'steam_tiers.json', 'theme_example.jsonc']) {
        const banner = resolveTheme(load(file)).achievements;
        assert.ok(banner, file);
        assert.deepEqual(Object.keys(banner.tiers), ['normal', 'magic', 'rare', 'exceptional'], file);
        assert.equal(banner.position, 'top_right', `${file}: inherited from the theme's settings`);
    }
});

test('one style for every notification; the old per-type blocks warn and are ignored', () => {
    const theme = resolveTheme({
        popup: { background: ['#111111'] },
        default: { popup: { background: ['#222222'] } },
        categories: { friends: {} },
        types: { FriendOnline: {} },
        display_time_ms: 3000,
    });
    assert.deepEqual(theme.style.background, ['#111111']);
    assert.equal(theme.displayTimeMs, null, 'display_time_ms lives in settings now');
    assert.equal(theme.warnings.length, 4);
    assert.equal(resolveTheme({ settings: { display_time_ms: 3000 } }).displayTimeMs, 3000);
});

test('game_icon: [visible, radius] or a bare visible; the old "logo" warns and is ignored', () => {
    assert.deepEqual(resolveTheme({ game_icon: [true, 4] }).style.gameIcon, { visible: true, radius: 4 });
    assert.deepEqual(resolveTheme({ game_icon: false }).style.gameIcon, { visible: false, radius: null });
    const css = buildCss(resolveTheme({ game_icon: [false, 4] }).style, SEL);
    assert.match(css, /body\[data-en-type\] :is\(\.logo\) \{ display: none !important; \}/);
    assert.match(css, /:is\(\.applogo\) img \{ border-radius: 4px !important;/);
    const old = resolveTheme({ logo: { radius: 6 } });
    assert.deepEqual(old.style.gameIcon, { visible: null, radius: null });
    assert.ok(old.warnings.some((w) => w.includes('game_icon')), JSON.stringify(old.warnings));
    assert.ok(resolveTheme({ game_icon: 'yes' }).warnings.some((w) => w.includes('game_icon')));
});

test('settings.text_align aligns every toast; invalid warns and keeps Steam', () => {
    const css = buildCss(resolveTheme({ settings: { text_align: 'center' } }).style, SEL);
    for (const sel of [':is\\(\\.title\\)', ':is\\(\\.body, \\.desc\\)', ':is\\(\\.sub\\)']) {
        assert.match(css, new RegExp(`body\\[data-en-type\\] ${sel} \\{ text-align: center !important; \\}`));
    }
    const bad = resolveTheme({ settings: { text_align: 'justify' } });
    assert.equal(bad.style.textAlign, null);
    assert.equal(bad.warnings.length, 1);
});

test('popup keys only the banner reads (scale, width, height, layout) are no warning and no toast CSS', () => {
    const t = resolveTheme({ popup: { scale: [120, 100], width: 400, height: 80, layout: 'ps5' } });
    assert.deepEqual(t.warnings, []);
    assert.equal(buildCss(t.style, SEL), '');
});

test('unset fields stay Steam stock (null) and produce no CSS', () => {
    const theme = resolveTheme({});
    assert.equal(theme.style.background, null);
    assert.equal(theme.style.sound, null);
    assert.equal(theme.displayTimeMs, null);
    assert.equal(buildCss(theme.style, SEL), '');
});

test('sound false mutes; bad sound warns and keeps Steam', () => {
    assert.equal(resolveTheme({ sound: false }).style.sound, false);
    const bad = resolveTheme({ sound: 'x.mp3' });
    assert.equal(bad.style.sound, null);
    assert.ok(bad.warnings.some((w) => w.includes('sound')));
});

test('font_family rejects CSS injection', () => {
    assert.equal(resolveTheme({ font_family: 'Arial; } body { display:none' }).style.fontFamily, null);
    assert.equal(resolveTheme({ font_family: '"Motiva Sans", Arial' }).style.fontFamily, '"Motiva Sans", Arial');
});

/** Split a selector list on top-level commas only (not those inside `:is(...)`). */
function selectorList(list: string): string[] {
    const out: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < list.length; i++) {
        if (list[i] === '(') depth++;
        else if (list[i] === ')') depth--;
        else if (list[i] === ',' && depth === 0) {
            out.push(list.slice(start, i));
            start = i + 1;
        }
    }
    out.push(list.slice(start));
    return out;
}

test('CSS is scoped to the styled toast window only', () => {
    const css = buildCss(resolveTheme(load('steam_midnight.json')).style, SEL);
    assert.ok(css.length > 0);
    for (const rule of css.split('\n').filter((l) => l.includes('{') && !l.startsWith('@keyframes'))) {
        for (const selector of selectorList(rule.slice(0, rule.indexOf('{')))) {
            assert.ok(selector.trim().startsWith('body[data-en-type]'), `unscoped selector: ${selector}`);
        }
    }
});

test('asset paths: the one sound', () => {
    assert.deepEqual(resolveTheme({ sound: ['a.mp3', 50] }).assetPaths, ['a.mp3']);
    assert.deepEqual(resolveTheme({}).assetPaths, []);
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

test('settings.position and settings.animation: unset keeps Steam, the achievement banner values accepted', () => {
    const stock = resolveTheme({});
    assert.equal(stock.position, null);
    assert.equal(stock.animation, null);
    const t = resolveTheme({ settings: { position: 'top_left', animation: 'ps5' } });
    assert.equal(t.position, 'top_left');
    assert.deepEqual(t.animation, { in: 'ps5', out: 'ps5' });
    assert.deepEqual(resolveTheme({ settings: { animation: { in: 'fade' } } }).animation, { in: 'fade', out: 'fade' });
    assert.deepEqual(resolveTheme({ settings: { animation: { out: 'none' } } }).animation, { in: 'slide', out: 'none' });
    const bad = resolveTheme({ settings: { position: 'middle', animation: 'spin' } });
    assert.equal(bad.position, null);
    assert.equal(bad.animation, null);
    assert.equal(bad.warnings.length, 2);
});

test("popup.margin / padding: CSS's clockwise shorthand; gap: [x, y] or one number", () => {
    const style = (popup: unknown) => resolveTheme({ popup }).style;
    assert.deepEqual(style({ padding: [10, 5, 4, 7] }).padding, { top: 10, right: 5, bottom: 4, left: 7 });
    assert.deepEqual(style({ padding: [10, 5, 4] }).padding, { top: 10, right: 5, bottom: 4, left: 5 });
    assert.deepEqual(style({ padding: [6, 12] }).padding, { top: 6, right: 12, bottom: 6, left: 12 });
    assert.deepEqual(style({ margin: 5 }).margin, { top: 5, right: 5, bottom: 5, left: 5 });
    assert.deepEqual(style({ margin: [1, 2, 'x', 4] }).margin, { top: 1, right: 2, bottom: 0, left: 4 }, 'a bad side takes the default');
    assert.deepEqual(style({ gap: [8, 2] }).gap, [8, 2]);
    assert.deepEqual(style({ gap: 3 }).gap, [3, 3]);
    const stock = resolveTheme({}).style;
    assert.equal(stock.margin, null);
    assert.equal(stock.padding, null);
    assert.deepEqual(stock.gap, [null, null]);
});

test('padding and gap CSS target the toast template and the text column', () => {
    const sel: ToastSelectors = { ...SEL, desktopTemplate: ':is(.tt)', content: ':is(.ct)' };
    const css = buildCss(resolveTheme({ popup: { padding: [10, 5, 4, 7], gap: [6, 2] } }).style, sel);
    assert.match(css, /body\[data-en-type\] :is\(\.tt\) \{ padding: 10px 5px 4px 7px !important;/);
    assert.match(css, /body\[data-en-type\] :is\(\.ct\) \{ margin-left: 6px !important; gap: 2px !important; \}/);
    const onlyY = buildCss(resolveTheme({ popup: { gap: [null, 4] } }).style, sel);
    assert.match(onlyY, /:is\(\.ct\) \{ gap: 4px !important; \}/);
});

test('animation CSS: direction follows the corner, exit ends when Steam closes the popup', () => {
    assert.equal(buildAnimationCss(resolveTheme({}), SEL), '', 'no animation: Steam slide, no CSS');
    const ps5 = buildAnimationCss(resolveTheme({ settings: { position: 'top_left', animation: 'ps5' } }), SEL);
    assert.match(ps5, /@keyframes en-in-ps5-left/);
    assert.match(ps5, /@keyframes en-out-ps5-left/);
    assert.match(ps5, /body\[data-en-type\] > :has\(> :is\(\.dp\)\) \{/);
    assert.match(ps5, /animation-duration: 450ms, 400ms;/);
    // Steam: 300 in + display + 300 out; a 400 ms exit starts 200 ms after the display time.
    assert.match(ps5, /animation-delay: 0ms, calc\(var\(--en-display-ms, 5000ms\) \+ 200ms\);/);
    const none = buildAnimationCss(resolveTheme({ settings: { animation: { in: 'fade', out: 'none' } } }), SEL);
    assert.match(none, /animation-name: en-in-fade, none;/);
    assert.equal(keyframeName('in', 'slide', 'bottom_left'), 'en-in-slide-left');
    assert.equal(keyframeName('out', 'slide', 'top_center'), 'en-out-slide');
    assert.equal(keyframeName('in', 'ps5', 'bottom_center'), 'en-in-ps5-bottom');
    assert.equal(keyframeName('in', 'none', 'top_right'), null);
});

test('Big Picture: placeholder CSS from the corner and margin; animation replaces Steam on its toast template', () => {
    const P = ':is(.ph)';
    assert.equal(buildPlaceholderCss(null, null, P), '', "nothing set: Steam's place");
    assert.equal(buildPlaceholderCss('top_left', null, undefined), '', 'no placeholder resolved');
    const tl = buildPlaceholderCss('top_left', { top: 20, right: 0, bottom: 0, left: 30 }, P);
    assert.match(tl, /^:is\(\.ph\) \{ top: 20px !important; bottom: auto !important; left: 30px !important; right: auto !important; \}/);
    assert.match(buildPlaceholderCss('bottom_center', null, P), /bottom: 0px !important; top: auto !important; left: 0 !important; right: 0 !important; margin-left: auto/);
    assert.match(buildPlaceholderCss(null, { top: 0, right: 8, bottom: 12, left: 0 }, P), /bottom: 12px !important;.* right: 8px !important;/, "margin alone: Steam's bottom-right");
    const anim = buildAnimationCss(resolveTheme({ settings: { position: 'top_right', animation: 'fade' } }), SEL);
    assert.match(anim, /body\[data-en-type\] :is\(\.gp\) > \* \{ animation-name: en-in-fade, en-out-fade;.* animation-delay: 0ms, calc\(var\(--toast-duration, 5000ms\) \+ 0ms\);/);
});

test('padding keeps Steam\'s toast height: the box height is what the padding leaves (never border-box)', () => {
    const sel: ToastSelectors = { ...SEL, desktopTemplate: ':is(.tt)', shortTemplate: ':is(.short)' };
    const css = buildCss(resolveTheme({ popup: { padding: 10 } }).style, sel);
    // Steam's own box: padding 10 + height 50 = 70. Same padding, same 50: the toast does not shrink.
    assert.match(css, /:is\(\.tt\) \{ padding: 10px 10px 10px 10px !important; box-sizing: content-box !important; height: 50px !important; \}/);
    assert.match(css, /:is\(\.short\) \{ padding: 10px 10px 10px 10px !important; box-sizing: content-box !important; height: 20px !important; \}/);
    assert.doesNotMatch(css, /border-box/);
    const tall = buildCss(resolveTheme({ popup: { padding: [6, 10, 4, 10] } }).style, sel);
    assert.match(tall, /:is\(\.tt\) \{[^}]*height: 60px !important; \}/);
    const huge = buildCss(resolveTheme({ popup: { padding: 50 } }).style, sel);
    assert.match(huge, /:is\(\.tt\) \{[^}]*height: 0px !important; \}/);
});

test('settings.hover: unset or true is Steam\'s own, false is none, [true, "#hex"] a colour; bad values warn', async () => {
    const { resolveHover } = await import('../frontend/theme/theme.ts');
    const w: string[] = [];
    assert.deepEqual(resolveHover(undefined, w), { enabled: true, color: null });
    assert.deepEqual(resolveHover(true, w), { enabled: true, color: null });
    assert.deepEqual(resolveHover(false, w), { enabled: false, color: null });
    assert.deepEqual(resolveHover([true], w), { enabled: true, color: null });
    assert.deepEqual(resolveHover([true, '#66c0f4'], w), { enabled: true, color: '#66c0f4' });
    assert.equal(w.length, 0);
    assert.deepEqual(resolveHover([true, 'blue'], w), { enabled: true, color: null });
    assert.deepEqual(resolveHover('yes', w), { enabled: true, color: null });
    assert.equal(w.length, 2);
    assert.deepEqual(resolveTheme({ settings: { hover: false } }).achievements, null);
    const withBlock = resolveTheme({ settings: { hover: [true, '#ff000080'] }, achievements: { normal: {} } });
    assert.deepEqual(withBlock.achievements?.hover, { enabled: true, color: '#ff000080' }, 'the banner inherits it');
});

test('hover CSS: the card holds its own overlay; false hides it; a colour replaces Steam\'s', () => {
    const sel: ToastSelectors = { ...SEL, desktopPopup: ':is(.dp)', watermark: ':is(.wm)' };
    assert.equal(buildCss(resolveTheme({}).style, sel), '', 'nothing set: stock, no CSS');
    const rounded = buildCss(resolveTheme({ popup: { border: [0, '#000', 8] } }).style, sel);
    assert.match(rounded, /body\[data-en-type\] :is\(\.dp\) \{ position: relative !important; overflow: hidden !important; \}/);
    assert.doesNotMatch(rounded, /::before/, "rounded with Steam's hover: Steam's overlay, now inside the card");
    const off = buildCss(resolveTheme({ settings: { hover: false } }).style, sel);
    assert.match(off, /:is\(\.dp\)::before \{ display: none !important; \}/);
    assert.match(off, /:is\(\.dp\):hover :is\(\.wm\) \{ color: inherit !important; opacity: 0\.05 !important; \}/);
    const tinted = buildCss(resolveTheme({ settings: { hover: [true, '#66c0f4'] } }).style, sel);
    assert.match(tinted, /:is\(\.dp\)::before \{ background: #66c0f4 !important; \}/);
    assert.match(tinted, /:is\(\.dp\):hover :is\(\.wm\) \{ color: #66c0f4 !important; \}/);
});
