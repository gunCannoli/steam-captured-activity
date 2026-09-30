import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShowable, MAX_PER_KIND, visibleMedia } from '../frontend/domain/community-media.ts';

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

test('community media: the toggles pick videos and images, in the backend order', () => {
    const media = { items: [video(), shot(1), ssArt] };
    assert.deepEqual(visibleMedia(media, ON), [video(), shot(1), ssArt]);
    assert.deepEqual(visibleMedia(media, { trailers: false, artworks: true }), [shot(1), ssArt]);
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
