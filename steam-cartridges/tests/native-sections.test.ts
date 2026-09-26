import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linksOverview, nativeDetails, redirectProps } from '../frontend/features/steam-store/native-sections-core.ts';

const SHORTCUT = 2315502503;
const NATIVE = 2820820;
const nativeOf = (appid: number) => (appid === SHORTCUT ? NATIVE : undefined);

function overview(appid: number) {
    return {
        appid,
        app_type: 1,
        get label() {
            return `app ${this.appid}`;
        },
        BIsModOrShortcut() {
            return false;
        },
    };
}

test('links: a mapped shortcut shows the native links', () => {
    const props: Record<string, any> = { overview: overview(SHORTCUT), details: {} };
    assert.equal(redirectProps('links', props, nativeOf), NATIVE);
    assert.equal(props.overview.appid, NATIVE);
    assert.equal(props.overview.BIsModOrShortcut(), false);
    assert.equal(props.overview.label, `app ${SHORTCUT}`, 'getters run against the real overview');
    assert.equal(props.overview.app_type, 1);
});

test('links: an unmapped shortcut gets Steam stock behaviour (no links)', () => {
    const props: Record<string, any> = { overview: overview(4263274102) };
    assert.equal(redirectProps('links', props, nativeOf), 0);
    assert.equal(props.overview.appid, 4263274102);
    assert.equal(props.overview.BIsModOrShortcut(), true);
});

test('links: native apps are untouched', () => {
    const ov = overview(435150);
    const props: Record<string, any> = { overview: ov };
    assert.equal(redirectProps('links', props, nativeOf), undefined);
    assert.equal(props.overview, ov);
});

test('friends: details.unAppID becomes the native appid, other fields pass through', () => {
    const details = { unAppID: SHORTCUT, strDisplayName: 'x' };
    const props: Record<string, any> = { details };
    assert.equal(redirectProps('friends', props, nativeOf), NATIVE);
    assert.equal(props.details.unAppID, NATIVE);
    assert.equal(props.details.strDisplayName, 'x');
    const unmapped: Record<string, any> = { details: { unAppID: 4263274102 } };
    assert.equal(redirectProps('friends', unmapped, nativeOf), undefined);
    assert.equal(unmapped.details.unAppID, 4263274102);
});

test('community: appid prop becomes the native appid', () => {
    const props: Record<string, any> = { appid: SHORTCUT };
    assert.equal(redirectProps('community', props, nativeOf), NATIVE);
    assert.equal(props.appid, NATIVE);
    assert.equal(redirectProps('community', { appid: 435150 }, nativeOf), undefined);
    assert.equal(redirectProps('community', null, nativeOf), undefined);
});

test('proxies are stable per (target, native) so React sees one object', () => {
    const ov = overview(SHORTCUT);
    assert.equal(linksOverview(ov, NATIVE), linksOverview(ov, NATIVE));
    const d = { unAppID: SHORTCUT };
    assert.equal(nativeDetails(d, NATIVE), nativeDetails(d, NATIVE));
});
