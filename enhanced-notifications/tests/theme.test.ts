// Pure-logic tests: run with `npm test` (Node's built-in runner, TS type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAnimationCss, buildCss, categoryOf, keyframeName, merge, resolveTheme, type ToastSelectors } from '../frontend/theme/theme.ts';
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

test('every bundled theme resolves for every category', () => {
    for (const file of readdirSync(themesDir).filter(isTheme)) {
        const theme = resolveTheme(load(file));
        for (const type of ['FriendOnline', 'FriendMessage', 'DownloadComplete', 'GameRecordingInstantClip', 'Achievement', 'LowBattery']) {
            assert.ok(theme.styleFor(type), `${file}: ${type}`);
        }
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

test('types map to categories; unknown types are system', () => {
    assert.equal(categoryOf('FriendOnline'), 'friends');
    assert.equal(categoryOf('GroupChatMessage'), 'messages');
    assert.equal(categoryOf('DownloadComplete'), 'downloads');
    assert.equal(categoryOf('GameRecordingInstantClip'), 'recording');
    assert.equal(categoryOf('Achievement'), 'achievement');
    assert.equal(categoryOf('LowBattery'), 'system');
    assert.equal(categoryOf('SomethingNew'), 'system');
});

test('resolution order: default -> category -> type', () => {
    const theme = resolveTheme({
        default: { popup: { background: ['#111111'] }, text: { title: ['#aaaaaa', 100, 'bold'] } },
        categories: { friends: { popup: { background: ['#222222'] } } },
        types: { FriendOnline: { text: { title: ['#ffffff', 110, 'bold'] } } },
    });
    const online = theme.styleFor('FriendOnline');
    assert.deepEqual(online.background, ['#222222']); // category
    assert.equal(online.text.title.color, '#ffffff'); // type
    assert.deepEqual(theme.styleFor('FriendInGame').text.title.color, '#aaaaaa'); // default
    assert.deepEqual(theme.styleFor('DownloadComplete').background, ['#111111']); // default
});

test('merge: objects key by key, arrays whole', () => {
    assert.deepEqual(merge({ a: { x: [1, 2], y: 1 } }, { a: { x: [3] } }), { a: { x: [3], y: 1 } });
});

test('unset fields stay Steam stock (null) and produce no CSS', () => {
    const style = resolveTheme({}).styleFor('FriendOnline');
    assert.equal(style.background, null);
    assert.equal(style.sound, null);
    assert.equal(buildCss('FriendOnline', style, SEL), '');
});

test('sound false mutes; bad sound warns and keeps Steam', () => {
    const theme = resolveTheme({ types: { FriendOnline: { sound: false }, FriendInGame: { sound: 'x.mp3' } } });
    assert.equal(theme.styleFor('FriendOnline').sound, false);
    assert.equal(theme.styleFor('FriendInGame').sound, null);
    assert.ok(theme.warnings.some((w) => w.includes('sound')));
});

test('font_family rejects CSS injection', () => {
    const theme = resolveTheme({ default: { font_family: 'Arial; } body { display:none' } });
    assert.equal(theme.styleFor('FriendOnline').fontFamily, null);
    assert.equal(resolveTheme({ default: { font_family: '"Motiva Sans", Arial' } }).styleFor('X').fontFamily, '"Motiva Sans", Arial');
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
    const style = resolveTheme(load('steam_midnight.json')).styleFor('FriendOnline');
    const css = buildCss('FriendOnline', style, SEL);
    assert.ok(css.length > 0);
    for (const rule of css.split('\n').filter((l) => l.includes('{') && !l.startsWith('@keyframes'))) {
        for (const selector of selectorList(rule.slice(0, rule.indexOf('{')))) {
            assert.ok(selector.trim().startsWith('body[data-en-type="FriendOnline"]'), `unscoped selector: ${selector}`);
        }
    }
});

test('asset paths collect every referenced sound once', () => {
    const theme = resolveTheme({ default: { sound: ['a.mp3', 50] }, categories: { friends: { sound: ['b.mp3', 50] } }, types: { X: { sound: ['a.mp3', 10] } } });
    assert.deepEqual(theme.assetPaths.sort(), ['a.mp3', 'b.mp3']);
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

test('settings.position and settings.animation: unset keeps Steam, enhanced-achievements values accepted', () => {
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

test('popup.margin / padding / gap: enhanced-achievements shorthand, inherited like any style', () => {
    const t = resolveTheme({
        default: { popup: { margin: 5, padding: [6, 12], gap: [8, 2] } },
        types: { FriendOnline: { popup: { padding: [10, 5, 4, 7], gap: 3 } } },
    });
    const d = t.styleFor('DownloadComplete');
    assert.deepEqual(d.margin, { top: 5, bottom: 5, left: 5, right: 5 });
    assert.deepEqual(d.padding, { top: 6, bottom: 6, left: 12, right: 12 });
    assert.deepEqual(d.gap, [8, 2]);
    const f = t.styleFor('FriendOnline');
    assert.deepEqual(f.padding, { top: 10, bottom: 5, left: 4, right: 7 }, 'order is top, bottom, left, right');
    assert.deepEqual(f.gap, [3, 3]);
    assert.deepEqual(f.margin, d.margin, 'margin inherited from default');
    const stock = resolveTheme({}).styleFor('DownloadComplete');
    assert.equal(stock.margin, null);
    assert.equal(stock.padding, null);
    assert.deepEqual(stock.gap, [null, null]);
});

test('padding and gap CSS target the toast template and the text column, scoped to the type', () => {
    const sel: ToastSelectors = { ...SEL, toastTemplate: ':is(.tt)', content: ':is(.ct)' };
    const t = resolveTheme({ default: { popup: { padding: [10, 5, 4, 7], gap: [6, 2] } } });
    const css = buildCss('DownloadComplete', t.styleFor('DownloadComplete'), sel);
    assert.match(css, /body\[data-en-type="DownloadComplete"\] :is\(\.tt\) \{ padding: 10px 7px 5px 4px !important;/);
    assert.match(css, /body\[data-en-type="DownloadComplete"\] :is\(\.ct\) \{ margin-left: 6px !important; gap: 2px !important; \}/);
    const onlyY = buildCss('X', resolveTheme({ default: { popup: { gap: [null, 4] } } }).styleFor('X'), sel);
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
