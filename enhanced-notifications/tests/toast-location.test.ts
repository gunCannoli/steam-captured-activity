// Consistency plan B3: in game, a toast goes to the toast view the user can see (steam/toast-location.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocationProps, locationMayShow, routeLocationProps } from '../frontend/steam/toast-location.ts';

const GAME_IN_FRONT = { overlayOpen: true, bigPictureVisible: false };
const LIBRARY_WITH_GAME = { overlayOpen: true, bigPictureVisible: true };
const NO_GAME = { overlayOpen: false, bigPictureVisible: true };

test('location: with the game in front only the overlay container pops; in the library only Big Picture\'s', () => {
    assert.equal(locationMayShow(false, true, GAME_IN_FRONT), false, "Big Picture's own view is behind the game");
    assert.equal(locationMayShow(true, true, GAME_IN_FRONT), true);
    assert.equal(locationMayShow(false, true, LIBRARY_WITH_GAME), true, 'Big Picture in front: its own view');
    assert.equal(locationMayShow(true, true, LIBRARY_WITH_GAME), false);
    assert.equal(locationMayShow(false, true, NO_GAME), true, 'no game: Steam as before');
    assert.equal(locationMayShow(false, true, { overlayOpen: false, bigPictureVisible: false }), true, 'no overlay: never blocked');
});

test('location: never both blocked, and never turned on against Steam', () => {
    for (const s of [GAME_IN_FRONT, LIBRARY_WITH_GAME, NO_GAME, { overlayOpen: false, bigPictureVisible: false }]) {
        assert.ok(locationMayShow(false, true, s) || locationMayShow(true, true, s), JSON.stringify(s));
        assert.equal(locationMayShow(false, false, s), false);
        assert.equal(locationMayShow(true, false, s), false);
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
    const bp: Record<string, unknown> = { appid: 0, bFocusedLocation: true };
    const ov: Record<string, unknown> = { appid: 4263274102, bFocusedLocation: true };
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
