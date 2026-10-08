// Consistency plan B3: in game, a toast goes to the toast view the user can see (steam/toast-location.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocationProps, locationMayShow, routeLocationProps, type LocationState } from '../frontend/steam/toast-location.ts';

const GAME = 4263274102;
const DESKTOP = 413080; // "Steam Controller Configs - Desktop": Steam's focus when no window has it (B3-loc)
const BIG_PICTURE = 769;
const GAME_IN_FRONT: LocationState = { overlayOpen: true, focusedAppid: GAME, runningAppids: [GAME] };
const LIBRARY_WITH_GAME: LocationState = { overlayOpen: true, focusedAppid: BIG_PICTURE, runningAppids: [GAME] };
const NOTHING_FOCUSED: LocationState = { overlayOpen: true, focusedAppid: DESKTOP, runningAppids: [GAME] };
const NO_GAME: LocationState = { overlayOpen: false, focusedAppid: BIG_PICTURE, runningAppids: [] };
const UNKNOWN: LocationState = { overlayOpen: true, focusedAppid: null, runningAppids: [GAME] };
const NO_OVERLAY: LocationState = { overlayOpen: false, focusedAppid: GAME, runningAppids: [GAME] };
const ALL = [GAME_IN_FRONT, LIBRARY_WITH_GAME, NOTHING_FOCUSED, NO_GAME, UNKNOWN, NO_OVERLAY];

test('location: with the game focused only its overlay container pops; otherwise Big Picture\'s', () => {
    assert.equal(locationMayShow(0, true, GAME_IN_FRONT), false, "Big Picture's own view is behind the game");
    assert.equal(locationMayShow(GAME, true, GAME_IN_FRONT), true);
    assert.equal(locationMayShow(0, true, LIBRARY_WITH_GAME), true, 'Big Picture focused: its own view');
    assert.equal(locationMayShow(GAME, true, LIBRARY_WITH_GAME), false);
    assert.equal(locationMayShow(0, true, NOTHING_FOCUSED), true, 'nothing focused (minimised RDP): Big Picture, as Steam');
    assert.equal(locationMayShow(GAME, true, NOTHING_FOCUSED), false);
    assert.equal(locationMayShow(0, true, NO_GAME), true, 'no game: Steam as before');
    assert.equal(locationMayShow(0, true, NO_OVERLAY), true, 'no overlay: never blocked');
});

test('location: focus unknown gives Steam\'s value to both', () => {
    assert.equal(locationMayShow(0, true, UNKNOWN), true);
    assert.equal(locationMayShow(GAME, true, UNKNOWN), true);
});

test('location: never both blocked, and never turned on against Steam', () => {
    for (const s of ALL) {
        assert.ok(locationMayShow(0, true, s) || locationMayShow(GAME, true, s), JSON.stringify(s));
        assert.equal(locationMayShow(0, false, s), false);
        assert.equal(locationMayShow(GAME, false, s), false);
    }
});

test('location: only props with a boolean bFocusedLocation are containers', () => {
    assert.equal(isLocationProps({ bFocusedLocation: true, appid: 0 }), true);
    assert.equal(isLocationProps({ bFocusedLocation: 'yes' }), false);
    assert.equal(isLocationProps({ notification: {} }), false);
    assert.equal(isLocationProps(null), false);
});

test('location: the prop becomes a live getter; the kill switch gives Steam\'s value', () => {
    let state = GAME_IN_FRONT;
    let enabled = true;
    const bp: Record<string, unknown> = { appid: undefined, bFocusedLocation: true };
    const ov: Record<string, unknown> = { appid: GAME, bFocusedLocation: true };
    routeLocationProps(bp, () => enabled, () => state);
    routeLocationProps(ov, () => enabled, () => state);
    assert.equal(bp.bFocusedLocation, false);
    assert.equal(ov.bFocusedLocation, true);
    state = NO_GAME; // the game quit: the next read (the container re-renders on the next arrival) frees Big Picture's
    assert.equal(bp.bFocusedLocation, true);
    state = GAME_IN_FRONT;
    enabled = false;
    assert.equal(bp.bFocusedLocation, true, 'switched off: Steam');
    assert.deepEqual(Object.keys(bp), ['appid', 'bFocusedLocation'], 'still an own enumerable prop');
    routeLocationProps(bp, () => true, () => GAME_IN_FRONT); // a second pass leaves the getter alone
    assert.equal(bp.bFocusedLocation, true, 'the first getter (switched off) still decides');
    const failing: Record<string, unknown> = { bFocusedLocation: true };
    routeLocationProps(failing, () => true, () => { throw new Error('no popup manager'); });
    assert.equal(failing.bFocusedLocation, true, 'an error gives Steam\'s value');
});
