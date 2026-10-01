import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardElement, CREATOR_AVATARS, CREATOR_STEAMIDS, feedId, FEED_ID_BASE, FILE_TYPE, isContentSection, isCreatedByLabel, isDateRow, isOurFeedId, isPlaceholderAppIcon, isViewerImage, VIEWER_IMAGE_MAX_HEIGHT, loaderAnswer, shouldLoadFirstPage, sourceOfAccount, toFeedItems } from '../frontend/surfaces/community/core.ts';

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
    assert.deepEqual(item!.creator, { name: 'IGDB', steamid: CREATOR_STEAMIDS.igdb, avatar: CREATOR_AVATARS.igdb, online_state: 0 });
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

test('community core: each source has its own inline icon (no "?" avatar, no request)', () => {
    assert.match(CREATOR_AVATARS.igdb, /^data:image\/svg\+xml;utf8,/);
    assert.notEqual(CREATOR_AVATARS.igdb, CREATOR_AVATARS.screenscraper);
    const [a] = toFeedItems(SC, [{ kind: 'video', source: 'igdb', youtube: 'abcDEF12345' }], none);
    assert.equal(a!.creator.avatar, CREATOR_AVATARS.igdb);
    const [b] = toFeedItems(SC, [{ kind: 'screenshot', source: 'screenscraper', key: 'k', width: 10, height: 10 }], () => ({ url: 'blob:x', width: 10, height: 10 }));
    assert.equal(b!.creator.avatar, CREATOR_AVATARS.screenscraper);
});

test('community core: the first page loads early only for a shortcut with a feed, before anything was requested', () => {
    const has = (appid: number) => appid === SC;
    const fresh = { m_nNextPage: 1, m_bHasEmptyRows: true, m_unAppID: SC };
    assert.equal(shouldLoadFirstPage(fresh, has), true);
    assert.equal(shouldLoadFirstPage({ ...fresh, m_nNextPage: 2 }, has), false, 'a page was already requested');
    assert.equal(shouldLoadFirstPage({ ...fresh, m_bHasEmptyRows: false }, has), false, 'no placeholder rows: community content is disabled');
    assert.equal(shouldLoadFirstPage({ ...fresh, m_unAppID: 435150 }, has), false, 'a native app keeps Steam own timing');
    assert.equal(shouldLoadFirstPage({ ...fresh, m_unAppID: SC + 1 }, has), false, 'a shortcut with no feed');
    assert.equal(shouldLoadFirstPage({}, has), false);
    assert.equal(shouldLoadFirstPage(undefined, has), false);
});

test('community core: each source is a made-up Steam account below 2^31 (signed-int32 safe)', () => {
    assert.ok(2147483101 < 2 ** 31 && 2147483102 < 2 ** 31);
    assert.equal(sourceOfAccount(2147483101), 'igdb');
    assert.equal(sourceOfAccount(2147483102), 'screenscraper');
    assert.equal(sourceOfAccount(83513586), undefined, 'a real account');
    assert.equal(sourceOfAccount('2147483101'), undefined);
    assert.equal(sourceOfAccount(undefined), undefined);
    // the 64-bit id is the individual-account base plus the account id, as a decimal string (it exceeds 2^53)
    assert.equal(BigInt(CREATOR_STEAMIDS.igdb) - 76561197960265728n, 2147483101n);
    assert.equal(BigInt(CREATOR_STEAMIDS.screenscraper) - 76561197960265728n, 2147483102n);
});

test('community core: only our published file ids are ours', () => {
    assert.equal(isOurFeedId(feedId(SC, 0)), true);
    assert.equal(isOurFeedId('3843261199'), false, "a Valve id");
    assert.equal(isOurFeedId(900000000000000), false, 'a number, not the string Steam gives');
    assert.equal(isOurFeedId(undefined), false);
});

test('community core: vote, award, comment and Report controls go only from our cards; the gamepad menu too', () => {
    const ours = { item: { published_file_id: feedId(SC, 1) } };
    const valve = { item: { published_file_id: '3843261199' } };
    assert.equal(cardElement({ card: ours, showVotingControls: true, onVoted() {} }), 'hide', 'the controls row');
    assert.equal(cardElement({ card: ours, onReported() {} }), 'hide', 'the Report menu button');
    assert.equal(cardElement({ card: valve, showVotingControls: true }), undefined, "Steam's own card keeps its controls");
    assert.equal(cardElement({ card: valve, onReported() {} }), undefined);
    assert.equal(cardElement({ card: ours, index: 0, dismissedInappropriate: false }), undefined, 'the card itself is not hidden');
    assert.equal(cardElement({ onMenuButton() {}, 'data-id': feedId(SC, 1) }), 'strip-menu');
    assert.equal(cardElement({ onMenuButton() {}, 'data-id': '3843261199' }), undefined);
    assert.equal(cardElement({ onMenuButton() {} }), undefined);
    assert.equal(cardElement(null), undefined);
    assert.equal(cardElement('x'), undefined);
});

test('community core: only the viewer placeholder game icon is replaced', () => {
    assert.equal(isPlaceholderAppIcon('img', { className: 'x AppIcon y' }), true, 'no src');
    assert.equal(isPlaceholderAppIcon('img', { className: 'x AppIcon', src: 'https://avatars.steamstatic.com/0618.jpg' }), true, 'the default avatar fallback');
    assert.equal(isPlaceholderAppIcon('img', { className: 'x AppIcon', src: 'https://cdn.steamstatic.com/steamcommunity/public/images/apps/1/a.jpg' }), false, 'a real icon stays');
    assert.equal(isPlaceholderAppIcon('img', { className: 'Avatar', src: 'https://avatars.steamstatic.com/0618.jpg' }), false, 'an avatar is not an app icon');
    assert.equal(isPlaceholderAppIcon('img', {}), false);
    assert.equal(isPlaceholderAppIcon('div', { className: 'AppIcon' }), false);
    assert.equal(isPlaceholderAppIcon('img', null), false);
});

test('community core: the viewer tweaks pick our big image, the date row and the Created by label, nothing else', () => {
    const ours = (u: string) => u === 'https://x/ours.jpg';
    const steamStyle = { maxWidth: '100%', maxHeight: '600px' };
    assert.equal(isViewerImage('img', { src: 'https://x/ours.jpg', style: steamStyle }, ours), true);
    assert.equal(isViewerImage('img', { src: 'https://x/other.jpg', style: steamStyle }, ours), false, 'not one of ours');
    assert.equal(isViewerImage('img', { src: 'https://x/ours.jpg', style: { maxHeight: VIEWER_IMAGE_MAX_HEIGHT } }, ours), false, 'already capped: no loop');
    assert.equal(isViewerImage('img', { src: 'https://x/ours.jpg' }, ours), false, 'a card image has no pixel cap');
    assert.equal(isViewerImage('div', { src: 'https://x/ours.jpg', style: steamStyle }, ours), false);
    assert.match(VIEWER_IMAGE_MAX_HEIGHT, /100vh/);
    assert.equal(isDateRow('div', { className: '_1a IconAndDate' }), true);
    assert.equal(isDateRow('div', { className: 'Fields' }), false);
    assert.equal(isDateRow('span', { className: 'IconAndDate' }), false);
    assert.equal(isCreatedByLabel('div', { className: '_2b Label', children: 'Created by' }), true);
    assert.equal(isCreatedByLabel('div', { className: '_2b Label', children: 'CREATED BY' }), true);
    assert.equal(isCreatedByLabel('div', { className: '_2b Label', children: 'Added by' }), false, 'our own label: no loop');
    assert.equal(isCreatedByLabel('div', { className: 'Title', children: 'Created by' }), false);
    assert.equal(isCreatedByLabel('div', { className: 'Label', children: ['Created by'] }), false);
});
