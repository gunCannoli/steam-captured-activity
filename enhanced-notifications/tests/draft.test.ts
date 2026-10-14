// theme/draft.ts: the Theme Creator's theme document. Pure-logic tests: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
    assetPathsOf, copyPlan, createHistory, effectiveValue, getAt, HISTORY_DEPTH, libraryPath, modePath, originOf, push, redo,
    serialize, setAt, undo, unsetAt, viewOf, type CreatorDraft,
} from '../frontend/theme/draft.ts';
import { resolveTheme } from '../frontend/theme/theme.ts';
import { parseJsonc } from '../frontend/theme/jsonc.ts';
import { TIERS, BANNER_KEYS } from '../frontend/theme/achievements.ts';

const themesDir = new URL('../themes/', import.meta.url);
const bundled = readdirSync(themesDir).filter((f) => f.endsWith('.json') || f.endsWith('.jsonc'));

test('setAt / unsetAt create and prune objects, never mutate', () => {
    const a = {};
    const b = setAt(a, ['popup', 'border'], [2, '#fff', 8]);
    assert.deepEqual(a, {});
    assert.deepEqual(b, { popup: { border: [2, '#fff', 8] } });
    const c = setAt(b, ['popup', 'glow'], ['#000', 4, 0]);
    assert.deepEqual(unsetAt(c, ['popup', 'border']), { popup: { glow: ['#000', 4, 0] } });
    assert.deepEqual(unsetAt(b, ['popup', 'border']), {}, 'an emptied object goes too');
    assert.equal(unsetAt(b, ['text', 'title']), b, 'nothing to remove: the same object');
    assert.deepEqual(setAt({ popup: 5 }, ['popup', 'gap'], 3), { popup: { gap: 3 } }, 'a non-object parent becomes one');
    assert.deepEqual(setAt(b, ['popup', 'border'], undefined), {}, 'undefined unsets');
});

test('modePath and viewOf: Big Picture keys sit under bigpicture and merge over the rest', () => {
    assert.deepEqual(modePath('desktop', ['popup', 'border']), ['popup', 'border']);
    assert.deepEqual(modePath('bigpicture', ['popup', 'border']), ['bigpicture', 'popup', 'border']);
    const raw = { popup: { border: [1, '#fff', 4], gap: 3 }, bigpicture: { popup: { border: null } } };
    assert.deepEqual(viewOf(raw, 'desktop'), { popup: { border: [1, '#fff', 4], gap: 3 } });
    assert.deepEqual(viewOf(raw, 'bigpicture'), { popup: { gap: 3 } });
});

test('originOf: set, desktop, the tier chain (Normal -> All tiers -> Card), Steam', () => {
    const raw = {
        popup: { border: [1, '#111111', 4] },
        achievements: { padding: [6, 10], normal: { glow: ['#222222', 4, 0] }, rare: { threshold: 10 } },
        bigpicture: { popup: { gap: 3 }, settings: { position: null } },
        settings: { position: 'top_left' },
    };
    assert.deepEqual(originOf(raw, 'desktop', ['popup', 'border']), { kind: 'set', value: [1, '#111111', 4] });
    assert.deepEqual(originOf(raw, 'bigpicture', ['popup', 'border']), { kind: 'desktop', value: [1, '#111111', 4] });
    assert.deepEqual(originOf(raw, 'bigpicture', ['popup', 'gap']), { kind: 'set', value: 3 });
    assert.deepEqual(originOf(raw, 'bigpicture', ['settings', 'position']), { kind: 'set', value: null }, 'null: Steam\'s own, on purpose');
    assert.equal(effectiveValue(raw, 'bigpicture', ['settings', 'position']), undefined);
    assert.deepEqual(originOf(raw, 'desktop', ['achievements', 'rare', 'glow']), { kind: 'inherited', from: 'Normal', value: ['#222222', 4, 0] });
    assert.deepEqual(originOf(raw, 'desktop', ['achievements', 'rare', 'padding']), { kind: 'inherited', from: 'All tiers', value: [6, 10] });
    assert.deepEqual(originOf(raw, 'desktop', ['achievements', 'magic', 'border']), { kind: 'inherited', from: 'Card', value: [1, '#111111', 4] });
    assert.deepEqual(originOf(raw, 'desktop', ['achievements', 'magic', 'threshold']), { kind: 'steam' }, 'threshold is never inherited');
    assert.deepEqual(originOf(raw, 'desktop', ['text', 'title']), { kind: 'steam' });
    for (const tier of TIERS) for (const key of BANNER_KEYS) assert.ok(originOf(raw, 'desktop', ['achievements', tier, key]).kind, `${tier}.${key}`);
});

test('history: push, undo, redo, depth, a no-op push', () => {
    let h = createHistory({ a: 0 });
    for (let i = 1; i <= HISTORY_DEPTH + 5; i++) h = push(h, { a: i });
    assert.equal(h.past.length, HISTORY_DEPTH);
    assert.deepEqual(h.present, { a: HISTORY_DEPTH + 5 });
    h = undo(undo(h));
    assert.deepEqual(h.present, { a: HISTORY_DEPTH + 3 });
    h = redo(h);
    assert.deepEqual(h.present, { a: HISTORY_DEPTH + 4 });
    assert.equal(push(h, h.present), h);
    const fresh = push(undo(h), { b: 1 });
    assert.equal(fresh.future.length, 0, 'a new edit drops redo');
    assert.equal(undo(createHistory({})).past.length, 0);
});

test('serialize: every bundled theme re-resolves to the same theme; key order; tuples on one line', () => {
    for (const file of bundled) {
        const raw = parseJsonc(readFileSync(new URL(file, themesDir), 'utf8')) as Record<string, unknown>;
        const text = serialize(raw);
        assert.deepEqual(resolveTheme(parseJsonc(text)), resolveTheme(raw), file);
        assert.deepEqual(JSON.parse(text.slice(text.indexOf('\n') + 1)), raw, `${file}: plain JSON after the header`);
    }
    const text = serialize({ sound: ['a.wav', 50], extra: 1, popup: { gap: 3, background: ['#000', '#111'] }, settings: { hover: [true, '#fff'], position: 'top_left' } });
    const keys = [...text.matchAll(/^ {4}"([a-z_]+)"/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ['settings', 'popup', 'sound', 'extra'], 'themes.md order, unknown keys kept at the end');
    assert.match(text, /"background": \["#000", "#111"\]/);
    assert.ok(text.indexOf('"position"') < text.indexOf('"hover"'));
    assert.ok(text.indexOf('"background"') < text.indexOf('"gap"'));
});

test('assetPathsOf: sounds and icon slots, both looks, each once', () => {
    const raw = {
        sound: ['a.wav', 80],
        achievements: { normal: { icons: { rarity: 'r.svg', system: ['s.png', 50, 0], achievement: true }, sound: ['t.wav', 50] }, rare: { icons: { rarity: 'r.svg' } } },
        bigpicture: { sound: ['bp.wav', 60] },
    };
    assert.deepEqual(assetPathsOf(raw), ['a.wav', 't.wav', 's.png', 'r.svg', 'bp.wav']);
});

function draft(over: Partial<CreatorDraft>): CreatorDraft {
    return { name: 'mine', origin: { kind: 'fresh' }, raw: {}, pendingCopies: {}, ...over };
}

test('copyPlan: template assets copied and rewritten, clashes numbered, absolute kept, library picks', () => {
    const lib = libraryPath('celtic_harp', 'grand');
    const d = draft({
        origin: { kind: 'template', id: 'SteamStation', dir: 'X', hadComments: true },
        raw: {
            sound: [lib, 70],
            achievements: {
                normal: { icons: { rarity: 'SteamStation/assets/trophy.svg' }, sound: ['C:/abs/x.wav', 50] },
                rare: { icons: { rarity: ['other/trophy.svg', 120, 0] } },
                magic: { icons: { rarity: 'SteamStation/assets/trophy.svg' } },
            },
        },
        pendingCopies: { [lib]: { kind: 'library', pack: 'celtic_harp', cue: 'grand' } },
    });
    const { raw, copies } = copyPlan(d);
    assert.deepEqual(copies, [
        { from: 'library', path: 'sounds/celtic_harp/grand.wav', to: 'mine/celtic_harp_grand.wav' },
        { from: 'bundled', path: 'SteamStation/assets/trophy.svg', to: 'mine/trophy.svg' },
        { from: 'bundled', path: 'other/trophy.svg', to: 'mine/trophy-2.svg' },
    ]);
    assert.deepEqual(getAt(raw, ['sound']), ['mine/celtic_harp_grand.wav', 70]);
    assert.equal(getAt(raw, ['achievements', 'normal', 'icons', 'rarity']), 'mine/trophy.svg');
    assert.equal(getAt(raw, ['achievements', 'magic', 'icons', 'rarity']), 'mine/trophy.svg', 'one copy per file');
    assert.deepEqual(getAt(raw, ['achievements', 'rare', 'icons', 'rarity']), ['mine/trophy-2.svg', 120, 0]);
    assert.deepEqual(getAt(raw, ['achievements', 'normal', 'sound']), ['C:/abs/x.wav', 50]);
    assert.deepEqual(getAt(d.raw, ['sound']), [lib, 70], 'the draft itself is untouched');
});

test('copyPlan: a user theme saved under its own name keeps its files; under a new name copies them', () => {
    const raw = { sound: ['mine/a.wav', 80], achievements: { normal: { icons: { rarity: 'shared/b.svg' } } } };
    const own = copyPlan(draft({ origin: { kind: 'user', id: 'mine', dir: 'U', hadComments: false }, raw }));
    assert.deepEqual(own.copies, [{ from: 'user', path: 'shared/b.svg', to: 'mine/b.svg' }]);
    const copy = copyPlan(draft({ name: 'other', origin: { kind: 'user', id: 'mine', dir: 'U', hadComments: false }, raw }));
    assert.deepEqual(copy.copies.map((c) => c.to), ['other/a.wav', 'other/b.svg']);
    assert.deepEqual(copyPlan(draft({ raw: { sound: ['x.wav', 1] } })).copies, [], 'a fresh theme\'s relative paths stay');
});
