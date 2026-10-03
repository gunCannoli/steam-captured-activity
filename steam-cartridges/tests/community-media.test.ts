import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShowable, MAX_PER_KIND, visibleMedia } from '../frontend/domain/community-media.ts';
import { wantsCommunitySection } from '../frontend/surfaces/sections/community.ts';

const ON = { trailers: true, artworks: true };
const video = (id = 'yt1') => ({ kind: 'video', source: 'igdb', youtube: id }) as any;
const shot = (n = 1) => ({ kind: 'screenshot', source: 'igdb', url: `https://x/${n}.jpg`, width: 1920, height: 1080 }) as any;
const ssArt = { kind: 'artwork', source: 'screenscraper', key: 'fanart()' } as any;

test('community media: complete items are showable, incomplete ones are not', () => {
    assert.ok(isShowable(video()) && isShowable(shot()) && isShowable(ssArt));
    assert.ok(!isShowable({ kind: 'video', source: 'igdb', youtube: '' } as any));
    assert.ok(!isShowable({ kind: 'artwork', source: 'igdb' } as any), 'an IGDB image needs a URL');
    assert.ok(!isShowable({ kind: 'artwork', source: 'screenscraper' } as any), 'a ScreenScraper image needs a key');
    assert.ok(!isShowable({ kind: 'manual', source: 'igdb', url: 'x' } as any), 'unknown kinds are not cards');
});

test('community media: the toggles pick videos and images; trailers first, then ScreenScraper, then IGDB', () => {
    const media = { items: [video(), shot(1), ssArt] };
    assert.deepEqual(visibleMedia(media, ON), [video(), ssArt, shot(1)]);
    assert.deepEqual(visibleMedia(media, { trailers: false, artworks: true }), [ssArt, shot(1)]);
    assert.deepEqual(visibleMedia(media, { trailers: true, artworks: false }), [video()]);
});

test('community media: at most MAX_PER_KIND of each kind', () => {
    const items = [...Array.from({ length: MAX_PER_KIND + 3 }, (_, i) => shot(i)), video()];
    const out = visibleMedia({ items }, ON);
    assert.equal(out.filter((i) => i.kind === 'screenshot').length, MAX_PER_KIND);
    assert.equal(out.filter((i) => i.kind === 'video').length, 1);
});

test('community media: the backend\'s empty list `{}` and a missing part are no items (K1)', () => {
    assert.deepEqual(visibleMedia({ items: {} as any }, ON), []);
    assert.deepEqual(visibleMedia(undefined, ON), []);
});

test('community media: ScreenScraper images keep their place when IGDB has more than the cap', () => {
    const igdbArt = (n: number) => ({ kind: 'artwork', source: 'igdb', url: `https://x/a${n}.jpg`, width: 1920, height: 1080 }) as any;
    const ssShot = { kind: 'screenshot', source: 'screenscraper', key: 'ss(wor)' } as any;
    const items = [video(), ...Array.from({ length: MAX_PER_KIND + 3 }, (_, i) => igdbArt(i)), ssShot, ssArt];
    const out = visibleMedia({ items }, ON);
    assert.equal(out.filter((i) => i.kind === 'artwork').length, MAX_PER_KIND);
    assert.ok(out.includes(ssArt), 'the ScreenScraper fanart survives the cap');
    assert.deepEqual(out.slice(0, 3), [video(), ssShot, ssArt], 'trailers, then ScreenScraper, before any IGDB image');
    assert.equal(out.findIndex((i) => i.source === 'igdb' && i.kind === 'artwork') > 2, true);
});

test('community media: a ScreenScraper manual is the first card, behind its own toggle (features plan F2c)', () => {
    const manual = { kind: 'manual', source: 'screenscraper', key: 'manuel(us)', width: 1280, height: 720 } as any;
    assert.ok(isShowable(manual));
    assert.ok(!isShowable({ kind: 'manual', source: 'screenscraper' } as any), 'a manual needs its key');
    const media = { items: [video(), shot(1), ssArt, manual] };
    assert.deepEqual(visibleMedia(media, { ...ON, manuals: true }), [manual, video(), ssArt, shot(1)]);
    assert.deepEqual(visibleMedia(media, { ...ON, manuals: false }), [video(), ssArt, shot(1)]);
    assert.deepEqual(visibleMedia(media, { trailers: false, artworks: false, manuals: true }), [manual]);
});

test('community media: the section shows with cards, and while the media is being fetched, never for a settled part with none', () => {
    assert.ok(wantsCommunitySection(undefined), 'no part yet: being fetched');
    assert.ok(wantsCommunitySection({ status: 'pending' }));
    assert.ok(wantsCommunitySection({ status: 'ok', data: { items: [{}] } }));
    assert.ok(!wantsCommunitySection({ status: 'ok', data: { items: [] } }));
    assert.ok(!wantsCommunitySection({ status: 'error' }));
    assert.ok(!wantsCommunitySection({ status: 'unsupported' }));
    assert.ok(!wantsCommunitySection({ status: 'needs-setup' }));
});

test('community media: a store copy\'s own screenshots come before ScreenScraper and IGDB images (ADR-0056)', () => {
    const epic = { kind: 'screenshot', source: 'epic', url: 'https://cdn2.unrealengine.com/a.jpg', width: 1920, height: 1080 } as any;
    const xbox = { kind: 'screenshot', source: 'xbox', url: 'https://store-images.s-microsoft.com/b', width: 1920, height: 1080 } as any;
    assert.ok(isShowable(epic) && isShowable(xbox), 'a store screenshot is a card when it has a URL');
    const media = { items: [shot(1), ssArt, epic, video(), xbox] };
    assert.deepEqual(visibleMedia(media, ON), [video(), epic, xbox, ssArt, shot(1)]);
});
