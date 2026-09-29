import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cdnArtworkUrls } from '../frontend/features/steam-store/resolve.ts';
import { categoryIds, gameCategoryIds, metadataFromStoreItem } from '../frontend/domain/store-item.ts';

test('cdnArtworkUrls', () => {
    const u = cdnArtworkUrls(435150);
    assert.equal(u.portrait, 'https://cdn.akamai.steamstatic.com/steam/apps/435150/library_600x900.jpg');
    assert.equal(u.hero, 'https://cdn.akamai.steamstatic.com/steam/apps/435150/library_hero.jpg');
    assert.equal(u.logo, 'https://cdn.akamai.steamstatic.com/steam/apps/435150/logo.png');
    assert.equal(u.wide, 'https://cdn.akamai.steamstatic.com/steam/apps/435150/header.jpg');
});

test('StoreItemCache item -> metadata', () => {
    assert.deepEqual(categoryIds({ supported_player_categoryids: [2, 1], feature_categoryids: [{ categoryid: 28 }] }), [2, 1, 28]);
    const meta = metadataFromStoreItem(
        {
            m_strName: 'Jotunnslayer: Hordes of Hel',
            m_BasicInfo: { short_description: 'Slay.', developers: [{ name: 'Dev' }], publishers: ['Pub'] },
            m_ReleaseInfo: { steam_release_date: 1700000000 },
            m_StoreCategories: { supported_player_categoryids: [2], feature_categoryids: [22, 28] },
        },
        2820820,
        4000000000,
    );
    assert.equal(meta?.title, 'Jotunnslayer: Hordes of Hel');
    assert.deepEqual(meta?.developers, ['Dev']);
    assert.deepEqual(meta?.publishers, ['Pub']);
    assert.equal(meta?.release_date, 1700000000);
    assert.equal(meta?.categories?.single_player, true);
    assert.equal(meta?.categories?.full_controller, true);
    assert.equal(meta?.categories?.achievements, false, 'achievements belong to P5');
    assert.equal(meta?.categories?.multiplayer, false);
    assert.equal(metadataFromStoreItem({}, 1, 2), null);
});

test('StoreItemCache accessors win over raw fields; both release dates kept (parity B)', () => {
    const meta = metadataFromStoreItem(
        {
            m_strName: 'Jotunnslayer: Hordes of Hel',
            m_BasicInfo: { short_description: 'Slay.', developers: [{ name: 'Games Farm' }], publishers: [] },
            m_ReleaseInfo: { steam_release_date: 1756917692, original_steam_release_date: 1737464732 },
            GetDeveloperNames: () => ['Games Farm', 'ARTillery'],
            GetPublisherNames: () => ['Grindstone'],
            GetFranchiseNames: () => { throw new Error('not loaded'); },
        },
        2820820,
        2315502503,
    );
    assert.deepEqual(meta?.developers, ['Games Farm', 'ARTillery']);
    assert.deepEqual(meta?.publishers, ['Grindstone']);
    assert.deepEqual(meta?.franchises, [], 'a throwing accessor falls back to the raw field');
    assert.equal(meta?.release_date, 1756917692);
    assert.equal(meta?.original_release_date, 1737464732);
    const noOriginal = metadataFromStoreItem({ m_strName: 'x', m_ReleaseInfo: { steam_release_date: 5 } }, 1, 2);
    assert.equal(noOriginal?.original_release_date, 5);
});

test('store_category_ids: player + controller groups only, accessor first (parity F)', () => {
    const raw = {
        supported_player_categoryids: [2, 1, 9, 39, 24],
        feature_categoryids: [22, 29, 23, 44, 62],
        controller_categoryids: [{ categoryid: 28 }],
    };
    assert.deepEqual(gameCategoryIds({ m_StoreCategories: raw }), [2, 1, 9, 39, 24, 28]);
    assert.deepEqual(
        gameCategoryIds({
            m_StoreCategories: raw,
            GetStoreCategories_SupportedPlayers: () => [2],
            GetStoreCategories_Controller: () => { throw new Error('not loaded'); },
        }),
        [2, 28],
        'a throwing accessor falls back to the raw group',
    );
    assert.equal(gameCategoryIds({ m_strName: 'x' }), undefined, 'no category data: the flags decide');
    const meta = metadataFromStoreItem({ m_strName: 'Jotunnslayer', m_StoreCategories: raw }, 2820820, 2315502503);
    assert.deepEqual(meta?.store_category_ids, [2, 1, 9, 39, 24, 28]);
});
