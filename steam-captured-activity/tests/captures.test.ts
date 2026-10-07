// domain/captures and kernel/appid: what the feed shows from an app's captures.
import test from "node:test";
import assert from "node:assert/strict";
import { captureDays, createRecent, inScope, signature } from "../frontend/domain/captures.ts";
import { clipGameId, isShortcutAppId, toUnsigned } from "../frontend/kernel/appid.ts";

const DAY = 86400;
/** Days at UTC midnight, so the tests do not depend on the machine's time zone. */
const dayOf = (t: number) => Math.floor(t / DAY) * DAY;
const shot = (handle: number, created: number) => ({ hHandle: handle, nCreated: created, nWidth: 1920, nHeight: 1080, strUrl: `https://steamloopback.host/${handle}.jpg` });
const clip = (id: string, clipped: number) => ({ clip_id: id, date_clipped: clipped, thumbnail_url: `https://steamloopback.host/${id}.jpg` });

test("appid: shortcut ids in either form, the clip game id per app type", () => {
    assert.equal(toUnsigned(-436078098), 3858889198);
    assert.equal(toUnsigned("435150"), 435150);
    assert.equal(toUnsigned(0), undefined);
    assert.equal(toUnsigned("x"), undefined);
    assert.equal(isShortcutAppId(-436078098), true);
    assert.equal(isShortcutAppId(435150), false);
    // AGENTS.md: gameid = (appid << 32) | 0x02000000 for a shortcut; a Steam game's clips use the plain appid.
    assert.equal(clipGameId(4263274102), ((4263274102n << 32n) | 0x02000000n).toString());
    assert.equal(clipGameId(435150), "435150");
});

test("captures: screenshots and clips grouped by day, newest day and newest capture first", () => {
    const days = captureDays(435150, [shot(1, 10 * DAY + 100), shot(2, 12 * DAY + 50)], [clip("c1", 10 * DAY + 900)], dayOf);
    assert.deepEqual(days.map((d) => d.day), [12 * DAY, 10 * DAY]);
    assert.deepEqual(days[1]!.items.map((i) => i.id), ["capture_435150_clip_c1", "capture_435150_1"]);
    assert.equal(days[1]!.items[0]!.isClip, true);
    assert.equal(days[0]!.items[0]!.url, "https://steamloopback.host/2.jpg");
});

test("captures: a capture with no time has no day and is left out", () => {
    const days = captureDays(1, [shot(1, 0)], [{ clip_id: "c", thumbnail_url: "u" }], dayOf);
    assert.deepEqual(days, []);
});

test("captures: the signature changes when a capture is deleted, and only then", () => {
    const before = captureDays(1, [shot(1, DAY), shot(2, DAY + 5)], [], dayOf);
    const same = captureDays(1, [shot(2, DAY + 5), shot(1, DAY)], [], dayOf);
    const after = captureDays(1, [shot(2, DAY + 5)], [], dayOf);
    assert.equal(signature(before), signature(same));
    assert.notEqual(signature(before), signature(after));
    assert.equal(signature([]), "");
});

test("captures: the two settings decide per app type", () => {
    assert.equal(inScope(435150, { steamGames: true, nonSteamGames: false }), true);
    assert.equal(inScope(4263274102, { steamGames: true, nonSteamGames: false }), false);
    assert.equal(inScope(4263274102, { steamGames: false, nonSteamGames: true }), true);
    assert.equal(inScope(435150, { steamGames: false, nonSteamGames: true }), false);
});

test("captures: recent keeps the newest apps and returns the one that fell out", () => {
    const r = createRecent(2);
    assert.equal(r.touch(1), undefined);
    assert.equal(r.touch(2), undefined);
    assert.equal(r.touch(1), undefined); // 1 is newest again
    assert.equal(r.touch(3), 2);
    assert.deepEqual(r.list(), [1, 3]);
});
