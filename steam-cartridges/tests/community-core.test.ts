import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedId, FEED_ID_BASE, FILE_TYPE, isContentSection, loaderAnswer, toFeedItems } from '../frontend/surfaces/community/core.ts';

const SC = 4263274102;
const none = () => undefined;

test('community core: feed ids are 15-digit safe integers above every Valve id, unique per shortcut and index', () => {
    const a = feedId(SC, 0);
    const b = feedId(SC, 1);
    assert.equal(a.length, 15);
    assert.ok(Number(a) > FEED_ID_BASE && Number.isSafeInteger(Number(feedId(0xffffffff, 9999))));
    assert.notEqual(a, b);
    assert.notEqual(feedId(SC, 0), feedId(SC + 1, 0));
});

test('community core: a video becomes Steam\'s YouTube card (type 4)', () => {
    const [item] = toFeedItems(SC, [{ kind: 'video', source: 'igdb', youtube: 'abcDEF12345', title: 'Trailer' }], none);
    assert.equal(item!.type, FILE_TYPE.video);
    assert.equal(item!.youtube_video_id, 'abcDEF12345');
    assert.equal(item!.preview_image_url, 'https://img.youtube.com/vi/abcDEF12345/hqdefault.jpg');
    assert.equal(item!.title, 'Trailer');
});

test('community core: an IGDB image becomes a screenshot or artwork card with its size and URLs', () => {
    const items = toFeedItems(SC, [
        { kind: 'screenshot', source: 'igdb', url: 'https://i/full.jpg', thumb: 'https://i/big.jpg', width: 1280, height: 720 },
        { kind: 'artwork', source: 'igdb', url: 'https://i/art.jpg', width: 1920, height: 1080 },
    ], none);
    assert.equal(items[0]!.type, FILE_TYPE.screenshot);
    assert.equal(items[0]!.preview_image_url, 'https://i/big.jpg');
    assert.equal(items[0]!.full_image_url, 'https://i/full.jpg');
    assert.deepEqual([items[0]!.image_width, items[0]!.image_height], [1280, 720]);
    assert.equal(items[1]!.type, FILE_TYPE.artwork);
    assert.equal(items[1]!.preview_image_url, 'https://i/art.jpg', 'no thumb: the full URL is the preview');
});

test('community core: every card has the fields Steam\'s card code reads, with counts hidden', () => {
    const [item] = toFeedItems(SC, [{ kind: 'artwork', source: 'igdb', url: 'u', width: 10, height: 10 }], none);
    assert.deepEqual(item!.content_descriptorids, [], 'an array: the card calls indexOf on it');
    assert.equal(item!.comment_count, null);
    assert.equal(item!.votes_for, null);
    assert.deepEqual(item!.reactions, []);
    assert.equal(item!.spoiler_tag, false);
    assert.deepEqual(item!.creator, { name: 'IGDB', steamid: '0', avatar: '', online_state: 0 });
});

test('community core: a ScreenScraper image shows only with its object URL, at the bin\'s size', () => {
    const ss = { kind: 'artwork', source: 'screenscraper', key: 'fanart()', width: 1920, height: 1080 } as const;
    assert.deepEqual(toFeedItems(SC, [ss], none), [], 'not fetched: no card');
    const [item] = toFeedItems(SC, [ss], (key) => (key === 'fanart()' ? { url: 'blob:x', width: 800, height: 450 } : undefined));
    assert.equal(item!.full_image_url, 'blob:x');
    assert.equal(item!.preview_image_url, 'blob:x');
    assert.deepEqual([item!.image_width, item!.image_height], [800, 450]);
    assert.equal(item!.creator.name, 'ScreenScraper');
});

test('community core: an image without a size is left out (Steam would drop it)', () => {
    assert.deepEqual(toFeedItems(SC, [{ kind: 'screenshot', source: 'igdb', url: 'u' }], none), []);
});

test('community core: the loader answers page 1 with a copy of the feed, later pages empty, others untouched', () => {
    const feed = toFeedItems(SC, [{ kind: 'video', source: 'igdb', youtube: 'a' }], none);
    const feeds = new Map([[SC, feed]]);
    const page1 = loaderAnswer(SC, 1, (a) => feeds.get(a));
    assert.equal(page1!.vecContent.length, 1);
    assert.notEqual(page1!.vecContent[0], feed[0], 'a copy: Steam writes into what it is given');
    assert.equal(page1!.mapVotes.size, 0);
    assert.deepEqual(loaderAnswer(SC, 2, (a) => feeds.get(a))!.vecContent, []);
    assert.equal(loaderAnswer(SC | 0, 1, (a) => feeds.get(a))!.vecContent.length, 1, 'a signed appid is the same shortcut');
    assert.equal(loaderAnswer(435150, 1, (a) => feeds.get(a)), undefined, 'a native app: Steam\'s own loader');
    assert.equal(loaderAnswer(SC + 1, 1, (a) => feeds.get(a)), undefined, 'no feed: Steam\'s own loader');
});

test('community core: the section class is recognised by its props and prototype, nothing else is', () => {
    class Section {
        BindInnerContainer() {}
        AutoLoadAdditionalContent() {}
        CheckAndLoadInitialContent() {}
    }
    assert.ok(isContentSection(Section, { appid: SC, labelId: ':r1:' }));
    assert.ok(!isContentSection(Section, { appid: SC }), 'the wrapper (no labelId) is not the class');
    assert.ok(!isContentSection(class Other {}, { appid: SC, labelId: 'x' }));
    assert.ok(!isContentSection('div', { appid: SC, labelId: 'x' }));
    assert.ok(!isContentSection(Section, null));
});
