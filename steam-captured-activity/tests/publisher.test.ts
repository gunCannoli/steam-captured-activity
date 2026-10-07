// app/publisher: when the feed is built, and the clean-up of deleted captures (on the next view and by the sweep).
import test from "node:test";
import assert from "node:assert/strict";
import { createPublisher, MAX_TRACKED, SWEEP_MS, type PublisherDeps } from "../frontend/app/publisher.ts";
import type { CaptureDay } from "../frontend/domain/captures.ts";

const DAY = 86400;
const STEAM_GAME = 435150;
const SHORTCUT = 4263274102;
const shot = (handle: number, created: number) => ({ hHandle: handle, nCreated: created, nWidth: 1920, nHeight: 1080, strUrl: `u${handle}` });

function harness() {
    const disk = new Map<number, { screenshots: ReturnType<typeof shot>[]; clips: [] }>();
    const feed = new Map<number, CaptureDay[]>();
    const calls: string[] = [];
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const scope = { steamGames: true, nonSteamGames: true };
    let storesReady = true;
    let repair = false;
    /** While set, a read takes its snapshot of the disk at once and answers when the gate opens (a slow read). */
    let gate: Promise<void> | undefined;
    const deps: PublisherDeps = {
        scope: () => scope,
        readCaptures: async (appid) => {
            const snapshot = disk.has(appid) ? disk.get(appid) : { screenshots: [], clips: [] };
            if (gate) await gate;
            return snapshot as { screenshots: ReturnType<typeof shot>[]; clips: [] };
        },
        publish(appid, days) {
            if (!storesReady) return false;
            calls.push(`publish ${appid} ${days.reduce((n, d) => n + d.items.length, 0)}`);
            if (days.length) feed.set(appid, days);
            else feed.delete(appid);
            return true;
        },
        clear(appid) {
            calls.push(`clear ${appid}`);
            feed.delete(appid);
        },
        needsRepair: () => repair,
        contentChanged: (appid) => calls.push(`changed ${appid}`),
        dayOf: (t) => Math.floor(t / DAY) * DAY,
        every(ms, fn) {
            timers.push({ ms, fn });
            return () => {};
        },
        after: (ms, fn) => timers.push({ ms, fn }),
        log: () => {},
    };
    const p = createPublisher(deps);
    return {
        p,
        disk,
        feed,
        calls,
        timers,
        scope,
        setReady: (v: boolean) => (storesReady = v),
        setRepair: (v: boolean) => (repair = v),
        /** Hold every read until the returned function is called. */
        hold() {
            let open!: () => void;
            gate = new Promise<void>((r) => (open = r));
            return () => {
                gate = undefined;
                open();
            };
        },
    };
}

test("publisher: a view publishes the app's captures; the same captures again write nothing", async () => {
    const h = harness();
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY), shot(2, 2 * DAY)], clips: [] });
    await h.p.viewed(STEAM_GAME);
    await h.p.viewed(STEAM_GAME);
    assert.deepEqual(h.calls, [`publish ${STEAM_GAME} 2`, `changed ${STEAM_GAME}`]);
    assert.equal(h.feed.get(STEAM_GAME)?.length, 2);
});

test("publisher: a capture deleted between two visits leaves the feed on the next visit", async () => {
    const h = harness();
    h.disk.set(SHORTCUT, { screenshots: [shot(1, DAY), shot(2, 2 * DAY)], clips: [] });
    await h.p.viewed(SHORTCUT);
    h.disk.set(SHORTCUT, { screenshots: [shot(2, 2 * DAY)], clips: [] });
    await h.p.viewed(SHORTCUT);
    assert.deepEqual(h.feed.get(SHORTCUT)?.map((d) => d.items.map((i) => i.id)), [[`capture_${SHORTCUT}_2`]]);
    // Every capture deleted: the feed has none, and the shortcut's section list is told.
    h.disk.delete(SHORTCUT);
    await h.p.viewed(SHORTCUT);
    assert.equal(h.feed.has(SHORTCUT), false);
    assert.deepEqual(h.calls.filter((c) => c.startsWith("changed")), [`changed ${SHORTCUT}`, `changed ${SHORTCUT}`]);
});

test("publisher: the sweep runs every 5 minutes and cleans up a deletion while the page stays open", async () => {
    const h = harness();
    h.p.start();
    assert.equal(h.timers[0]?.ms, SWEEP_MS);
    assert.equal(SWEEP_MS, 5 * 60 * 1000);
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY), shot(2, DAY + 1)], clips: [] });
    await h.p.viewed(STEAM_GAME);
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY)], clips: [] });
    await h.p.sweep();
    assert.equal(h.feed.get(STEAM_GAME)?.[0]?.items.length, 1);
});

test("publisher: the sweep repairs a feed another writer replaced without our events", async () => {
    const h = harness();
    h.disk.set(SHORTCUT, { screenshots: [shot(1, DAY)], clips: [] });
    await h.p.viewed(SHORTCUT);
    h.calls.length = 0;
    h.setRepair(true);
    await h.p.sweep();
    assert.deepEqual(h.calls, [`publish ${SHORTCUT} 1`]);
});

test("publisher: turning a toggle off clears that kind of app; on again publishes it", async () => {
    const h = harness();
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY)], clips: [] });
    h.disk.set(SHORTCUT, { screenshots: [shot(2, DAY)], clips: [] });
    await h.p.viewed(STEAM_GAME);
    await h.p.viewed(SHORTCUT);
    h.scope.nonSteamGames = false;
    await h.p.scopeChanged();
    assert.equal(h.feed.has(SHORTCUT), false);
    assert.equal(h.feed.has(STEAM_GAME), true);
    h.scope.nonSteamGames = true;
    await h.p.scopeChanged();
    assert.equal(h.feed.has(SHORTCUT), true);
});

test("publisher: an app out of scope is never read or published", async () => {
    const h = harness();
    h.scope.steamGames = false;
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY)], clips: [] });
    await h.p.viewed(STEAM_GAME);
    assert.deepEqual(h.calls, []);
});

test("publisher: Steam's stores missing at start-up: the publish retries, then succeeds", async () => {
    const h = harness();
    h.setReady(false);
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY)], clips: [] });
    await h.p.viewed(STEAM_GAME);
    assert.equal(h.timers.length, 1);
    h.setReady(true);
    h.timers[0]!.fn();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.feed.has(STEAM_GAME), true);
});

test("publisher: a quit re-reads a tracked app only", async () => {
    const h = harness();
    await h.p.quit(STEAM_GAME);
    assert.deepEqual(h.calls, []);
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY)], clips: [] });
    await h.p.viewed(STEAM_GAME);
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY), shot(2, DAY + 9)], clips: [] });
    await h.p.quit(STEAM_GAME);
    assert.equal(h.feed.get(STEAM_GAME)?.[0]?.items.length, 2);
});

test("publisher: a sweep asked while a read of the app runs waits for a fresh read (the clean-up is in when it settles)", async () => {
    const h = harness();
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY), shot(2, DAY + 1)], clips: [] });
    await h.p.viewed(STEAM_GAME);
    const release = h.hold();
    const slow = h.p.viewed(STEAM_GAME); // reads the two captures, slowly
    h.disk.set(STEAM_GAME, { screenshots: [shot(1, DAY)], clips: [] }); // one deleted meanwhile
    const swept = h.p.sweep();
    release();
    await swept; // must cover the deletion, not return on the read already running
    assert.equal(h.feed.get(STEAM_GAME)?.[0]?.items.length, 1);
    await slow;
});

test("publisher: a failing read is logged and the sweep goes on to the next app", async () => {
    const h = harness();
    h.disk.set(1, { screenshots: [shot(1, DAY)], clips: [] });
    h.disk.set(2, { screenshots: [shot(2, DAY)], clips: [] });
    await h.p.viewed(1);
    await h.p.viewed(2);
    h.disk.set(1, null as never); // readCaptures returns null: destructuring throws
    h.disk.set(2, { screenshots: [], clips: [] });
    await h.p.sweep();
    assert.equal(h.feed.has(2), false);
});

test("publisher: the sweep keeps the newest apps; the oldest one's captures leave its feed", async () => {
    const h = harness();
    for (let i = 1; i <= MAX_TRACKED + 1; i++) {
        h.disk.set(i, { screenshots: [shot(i, DAY)], clips: [] });
        await h.p.viewed(i);
    }
    assert.equal(h.p.tracked().length, MAX_TRACKED);
    assert.equal(h.feed.has(1), false);
    assert.ok(h.calls.includes("clear 1"));
});
