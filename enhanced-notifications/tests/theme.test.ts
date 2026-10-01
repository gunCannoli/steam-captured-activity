// Pure-logic tests: run with `npm test` (Node's built-in runner, TS type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCss, categoryOf, merge, resolveTheme, type ToastSelectors } from '../frontend/theme/theme.ts';
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
