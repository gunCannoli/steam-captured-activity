// settings/creator/model.ts: the Theme Creator's pure helpers. `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyPack, currentCue, DEFAULT_CHOSEN, pageForWarning, freeName, hexToHsl, hslToHex, parseHslString, previewItems, PREVIEW_SETS, randomFour, sampleFor,
    setSound, SAMPLES,
} from '../frontend/settings/creator/model.ts';
import { copyPlan, getAt, libraryPath, type CreatorDraft } from '../frontend/theme/draft.ts';
import { resolveTheme, soundSpecFor } from '../frontend/theme/theme.ts';

/** The notification ids the creator shuffles from (never Achievement; the UI filters it out the same way). */
const NOTES = Object.keys(SAMPLES).filter((id) => id !== 'Achievement');
const draft = (raw: Record<string, unknown> = {}): CreatorDraft => ({ name: 'mine', origin: { kind: 'fresh' }, raw, pendingCopies: {} });

test('preview sets: four items, never Achievement among notifications, distinct random picks', () => {
    for (const set of PREVIEW_SETS) {
        const items = previewItems(set.id, DEFAULT_CHOSEN, randomFour(NOTES));
        assert.equal(items.length, 4, set.id);
    }
    assert.deepEqual(previewItems('choose', ['Achievement', ...DEFAULT_CHOSEN], []).map((i) => (i.kind === 'notification' ? i.id : i.tier)), DEFAULT_CHOSEN);
    assert.deepEqual(previewItems('tiers', [], []).map((i) => (i.kind === 'achievement' ? i.tier : '')), ['normal', 'magic', 'rare', 'exceptional']);
    for (let i = 0; i < 50; i++) {
        const four = randomFour(NOTES);
        assert.equal(new Set(four).size, 4);
    }
    assert.equal(randomFour(['a', 'b']).length, 2);
    assert.equal(sampleFor('DownloadComplete', 'Celeste').body, 'Celeste');
});

test('colours: hex <-> HSL round trips, Steam\'s picker string', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#1b2838', '#e5a93c', '#8a2be2']) {
        const [h, s, l] = hexToHsl(hex);
        const back = hslToHex(h, s, l);
        // Rounded HSL can move a channel by one step.
        for (let i = 1; i < 7; i += 2) assert.ok(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)) <= 3, `${hex} -> ${back}`);
    }
    assert.deepEqual(hexToHsl('#fff'), [0, 0, 100, 1]);
    assert.equal(hexToHsl('#00000080')[3], 0.502);
    assert.equal(parseHslString('hsla(0, 100%, 50%, 1)'), '#ff0000');
    assert.equal(parseHslString('hsl(120, 100%, 25%)'), '#008000');
    assert.equal(parseHslString('hsla(0, 0%, 0%, 0.5)'), '#00000080');
    assert.equal(parseHslString('red'), null);
});

test('applyPack: Keep untouched, cues as library picks with volume, tiers need a banner, one pending copy each', () => {
    const base = draft({ sound: ['my.wav', 40] });
    const out = applyPack(base, 'desktop', 'celtic_harp', { notification: { cue: 'keep', volume: 80 }, normal: { cue: 'subtle', volume: 70 } });
    assert.deepEqual(out.raw, base.raw, 'no banner: tier rows ignored, Keep leaves the sound');
    const withBanner = draft({ sound: ['my.wav', 40], achievements: { normal: {} } });
    const applied = applyPack(withBanner, 'desktop', 'celtic_harp', {
        notification: { cue: 'subtle', volume: 80 },
        rare: { cue: 'distinct', volume: 90 },
        exceptional: { cue: 'grand', volume: 100 },
        magic: { cue: 'keep', volume: 10 },
    });
    assert.deepEqual(getAt(applied.raw, ['sound']), [libraryPath('celtic_harp', 'subtle'), 80]);
    assert.deepEqual(getAt(applied.raw, ['achievements', 'rare', 'sound']), [libraryPath('celtic_harp', 'distinct'), 90]);
    assert.equal(getAt(applied.raw, ['achievements', 'magic', 'sound']), undefined);
    assert.equal(Object.keys(applied.pendingCopies).length, 3);
    assert.equal(currentCue(applied, 'desktop', 'rare', 'celtic_harp'), 'distinct', 'reopening shows what Apply wrote');
    assert.equal(currentCue(applied, 'desktop', 'rare', 'cinematic'), null);
    assert.equal(currentCue(draft({ sound: ['mine/celtic_harp_grand.wav', 50] }), 'desktop', 'notification', 'celtic_harp'), 'grand', 'a saved copy');
    const bp = applyPack(withBanner, 'bigpicture', 'cinematic', { notification: { cue: 'grand', volume: 50 } });
    assert.deepEqual(getAt(bp.raw, ['bigpicture', 'sound']), [libraryPath('cinematic', 'grand'), 50], 'Big Picture writes its own key');
    assert.deepEqual(getAt(bp.raw, ['sound']), ['my.wav', 40]);
});

test('setSound: Steam\'s in Big Picture over a desktop sound is null; unused picks dropped', () => {
    const d = draft({ sound: ['my.wav', 40] });
    assert.equal(getAt(setSound(d, 'bigpicture', 'notification', 'steam').raw, ['bigpicture', 'sound']), null);
    assert.equal(getAt(setSound(d, 'desktop', 'notification', 'steam').raw, ['sound']), undefined);
    assert.equal(getAt(setSound(d, 'desktop', 'notification', 'mute').raw, ['sound']), false);
    const picked = setSound(d, 'desktop', 'notification', { pack: 'harp', cue: 'grand', volume: 60 });
    assert.equal(Object.keys(picked.pendingCopies).length, 1);
    assert.equal(Object.keys(setSound(picked, 'desktop', 'notification', 'mute').pendingCopies).length, 0);
});

test('soundSpecFor agrees with the sound surface: tier clip, else notification sound, false mutes, else Steam', () => {
    const t = resolveTheme({ sound: ['n.wav', 50], achievements: { normal: {}, rare: { sound: ['r.wav', 70] } } });
    assert.deepEqual(soundSpecFor(t, 'rare'), { path: 'r.wav', volumePct: 70 });
    assert.deepEqual(soundSpecFor(t, 'magic'), { path: 'n.wav', volumePct: 50 });
    assert.deepEqual(soundSpecFor(t, null), { path: 'n.wav', volumePct: 50 });
    assert.equal(soundSpecFor(resolveTheme({ sound: false }), 'rare'), false);
    assert.equal(soundSpecFor(resolveTheme({}), null), null);
});

test('freeName: first free, case-insensitive, cleaned', () => {
    assert.equal(freeName('my_theme', []), 'my_theme');
    assert.equal(freeName('my_theme', ['MY_THEME', 'my_theme_2']), 'my_theme_3');
    assert.equal(freeName('a b/c', []), 'a_b_c');
});

test('pageForWarning: each warning opens the page and mode that own its key', () => {
    const t = (w: string) => { const r = pageForWarning(w); return `${r.page}/${r.mode}`; };
    assert.equal(t('settings.position "x" is not one of ...'), 'placement/desktop');
    assert.equal(t('bigpicture: settings.text_align "x" is not one of ...'), 'placement/bigpicture');
    assert.equal(t('achievements: rare.threshold must be ...'), 'tier:rare/desktop');
    assert.equal(t('achievements: layout "x" is not a preset'), 'achievements/desktop');
    assert.equal(t('sound must be ["path", volume] or false; keeping Steam\'s sound.'), 'sound/desktop');
    assert.equal(t('"game_icon" is now "popup_icon": ...'), 'icons/desktop');
    assert.equal(t('font_family is not a plain font name; ignored.'), 'card/desktop');
    assert.equal(t('"themes" (an Enhanced Achievements theme) is gone'), 'code/desktop');
    assert.equal(t('bigpicture must be an object of theme keys; ...'), 'code/desktop');
});

test('a file picked with Steam\'s dialog is a pending copy: copied under its own name on Save', () => {
    const picked = setSound(draft(), 'desktop', 'notification', { file: 'D:/Music/ding.wav', volume: 70, picked: true });
    assert.deepEqual(picked.pendingCopies, { 'D:/Music/ding.wav': { kind: 'file', path: 'D:/Music/ding.wav' } });
    const plan = copyPlan({ ...picked, name: 'mine' });
    assert.deepEqual(plan.copies, [{ from: 'file', path: 'D:/Music/ding.wav', to: 'mine/ding.wav' }]);
    assert.deepEqual(getAt(plan.raw, ['sound']), ['mine/ding.wav', 70]);
    const typed = copyPlan({ ...draft({ sound: ['D:/Music/ding.wav', 70] }), name: 'mine' });
    assert.deepEqual(typed.copies, [], 'an absolute path typed by hand stays (D2)');
});
