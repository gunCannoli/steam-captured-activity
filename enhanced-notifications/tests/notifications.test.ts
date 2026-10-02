// Notification hook, its composition with a second copy of itself (another plugin using the same file, or the
// released and the -dev copy loaded together), the sound decision, the duration plan and the surface runner.
// Fake `proto` and `owner` objects: nothing here needs Steam. The achievement side (unlock sensor, queued banner
// sounds, the 100% toast) is in tests/achievements.test.ts.
import { pickPreview } from '../frontend/surfaces/preview/pick.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installNotificationHook, type SoundHandler } from '../frontend/steam/notification-hook.ts';
import { createSoundHandler, type Clip, type SoundDeps } from '../frontend/surfaces/sound/sound.ts';
import { planDurations, type DurationEntry } from '../frontend/surfaces/duration/duration.ts';
import { assertDisjointTouches, installSurfaces, type Surface } from '../frontend/kernel/surface.ts';
import type { SteamNotification } from '../frontend/kernel/notification.ts';

const ACHIEVEMENT = 7;
const DOWNLOAD = 3;
const OTHER = 9;

/** A fake NotificationStore prototype: PlayNotificationSound asks this.ChooseSound and plays when it answers truthy. */
function fakeStore() {
    const played: string[] = [];
    const proto = {
        PlayNotificationSound(this: { ChooseSound(config: unknown, n: SteamNotification): unknown }, n: SteamNotification) {
            if (this.ChooseSound({}, n)) played.push('steam');
        },
        ChooseSound(_config: unknown, _n: SteamNotification): unknown {
            return 'chime';
        },
    };
    const owner = Object.create(proto) as object;
    const show = (eType: number) => (proto.PlayNotificationSound as (this: unknown, n: SteamNotification) => void).call(owner, { eType } as SteamNotification);
    return { proto, owner, played, show };
}

type Store = ReturnType<typeof fakeStore>;

function hookOn(f: Store) {
    const reported: string[] = [];
    const hook = installNotificationHook(f.proto, f.owner, { reportError: (id) => reported.push(id), warn() {} });
    return { hook, reported };
}

/** A second copy of the hook that only themes achievements (its clip), and gives Steam's chime to the rest. */
const achievementsHandler =
    (f: Store): SoundHandler =>
    (call) => {
        if (call.n.eType !== ACHIEVEMENT) return call.playSteam();
        if (call.askSteam()) f.played.push('ea-clip');
    };

/** This plugin's handler as the sound surface builds it: a clip for downloads, Steam's sound for the rest (no tier sounds). */
function notificationsHandler(f: Store, over: Partial<SoundDeps> = {}): SoundHandler {
    const clip = { buffer: {} as AudioBuffer, volume: 1 };
    return createSoundHandler({
        isEnabled: () => true,
        nameOf: (eType) => ({ [ACHIEVEMENT]: 'Achievement', [DOWNLOAD]: 'DownloadComplete', [OTHER]: 'LowBattery' })[eType] ?? null,
        clipFor: (name) => (name === 'DownloadComplete' ? clip : null),
        isAchievementUnlock: () => false,
        tierClipFor: () => undefined,
        audioState: () => 'running',
        resumeAudio() {},
        playClip: () => f.played.push('en-clip'),
        peek: () => undefined,
        whenShowing: () => ({ at: 'never' }),
        ...over,
    });
}

for (const order of ['the other copy first', 'this plugin first'] as const) {
    test(`hook composition (${order}): each copy sees every toast once, and each type gets exactly one sound`, () => {
        const f = fakeStore();
        const seen: string[] = [];
        const install = (who: 'ea' | 'en') => {
            const { hook } = hookOn(f);
            hook.onShown((n) => seen.push(`${who}:${n.eType}`));
            hook.setSoundHandler(who === 'ea' ? achievementsHandler(f) : notificationsHandler(f));
            return hook;
        };
        if (order === 'the other copy first') {
            install('ea');
            install('en');
        } else {
            install('en');
            install('ea');
        }

        f.show(ACHIEVEMENT);
        assert.deepEqual(f.played, ['ea-clip'], 'achievement: the other copy plays (ours gives Steam its sound), no Steam chime');
        f.played.length = 0;
        f.show(DOWNLOAD);
        assert.deepEqual(f.played, ['en-clip'], 'download: our clip, no Steam chime');
        f.played.length = 0;
        f.show(OTHER);
        assert.deepEqual(f.played, ['steam'], 'unthemed type: Steam chime once');

        assert.deepEqual(seen.filter((s) => s.startsWith('ea:')), ['ea:7', 'ea:3', 'ea:9']);
        assert.deepEqual(seen.filter((s) => s.startsWith('en:')), ['en:7', 'en:3', 'en:9']);
        assert.equal(Object.prototype.hasOwnProperty.call(f.owner, 'ChooseSound'), false, 'no own ChooseSound left behind');
    });
}

test('hook composition: stand-in calls (type discovery) pass through both hooks untouched', () => {
    const f = fakeStore();
    let listened = 0;
    for (let i = 0; i < 2; i++) {
        const { hook } = hookOn(f);
        hook.onShown(() => listened++);
        hook.setSoundHandler(() => {
            throw new Error('must not run');
        });
    }
    let captured: unknown;
    const standIn = { ChooseSound: (config: unknown) => ((captured = config), null) };
    (f.proto.PlayNotificationSound as (this: unknown, n: SteamNotification) => void).call(standIn, { eType: DOWNLOAD });
    assert.equal(listened, 0);
    assert.deepEqual(captured, {});
    assert.deepEqual(f.played, []);
});

test('hook composition: uninstalling the outer hook leaves the inner one working; the inner one cannot unhook itself', () => {
    const f = fakeStore();
    const inner = hookOn(f).hook;
    const innerWrapper = f.proto.PlayNotificationSound;
    inner.setSoundHandler(notificationsHandler(f));
    const outer = hookOn(f).hook;
    outer.setSoundHandler(achievementsHandler(f));

    inner.uninstall(); // not on top: stays in the chain
    f.show(DOWNLOAD);
    assert.deepEqual(f.played, ['en-clip']);
    outer.uninstall();
    assert.equal(f.proto.PlayNotificationSound, innerWrapper, 'the outer hook restored what it wrapped');
    f.played.length = 0;
    inner.setSoundHandler(null); // what the sound surface's uninstall does
    f.show(DOWNLOAD);
    assert.deepEqual(f.played, ['steam']);
});

test("sound: switched off, unknown or unthemed types get Steam's chime", () => {
    for (const over of [{ isEnabled: () => false }, { nameOf: () => null }, { clipFor: () => null }] as Partial<SoundDeps>[]) {
        const f = fakeStore();
        hookOn(f).hook.setSoundHandler(notificationsHandler(f, over));
        f.show(DOWNLOAD);
        assert.deepEqual(f.played, ['steam'], JSON.stringify(Object.keys(over)));
    }
});

test('sound: a muted type plays nothing; a clip respects Steam saying no sound', () => {
    const f = fakeStore();
    hookOn(f).hook.setSoundHandler(notificationsHandler(f, { clipFor: () => false }));
    f.show(DOWNLOAD);
    assert.deepEqual(f.played, []);

    const g = fakeStore();
    g.proto.ChooseSound = () => null; // Steam's own sound setting is off
    hookOn(g).hook.setSoundHandler(notificationsHandler(g));
    g.show(DOWNLOAD);
    assert.deepEqual(g.played, []);
});

test("sound: suspended audio is resumed and this toast gets Steam's chime", () => {
    const f = fakeStore();
    let resumed = 0;
    hookOn(f).hook.setSoundHandler(notificationsHandler(f, { audioState: () => 'suspended', resumeAudio: () => void resumed++ }));
    f.show(DOWNLOAD);
    assert.deepEqual(f.played, ['steam']);
    assert.equal(resumed, 1);
});

test("sound: a throwing clip lookup falls back to Steam's chime and counts a sound error", () => {
    const f = fakeStore();
    const { hook, reported } = hookOn(f);
    hook.setSoundHandler(
        notificationsHandler(f, {
            clipFor: (): Clip => {
                throw new Error('decode');
            },
        }),
    );
    f.show(DOWNLOAD);
    assert.deepEqual(f.played, ['steam']);
    assert.deepEqual(reported, ['sound']);
});

test("sound: an unlock plays its tier's clip, else the notification sound; a muted theme mutes it too", () => {
    const unlock = { isAchievementUnlock: (n: SteamNotification) => n.eType === ACHIEVEMENT };
    const tier = { buffer: {} as AudioBuffer, volume: 0.5 };
    const f = fakeStore();
    hookOn(f).hook.setSoundHandler(
        notificationsHandler(f, { ...unlock, tierClipFor: () => tier, playClip: (c) => f.played.push(c === tier ? 'tier-clip' : 'en-clip') }),
    );
    f.show(ACHIEVEMENT);
    f.show(DOWNLOAD);
    assert.deepEqual(f.played, ['tier-clip', 'en-clip'], 'the tier clip for the unlock only');

    const g = fakeStore();
    hookOn(g).hook.setSoundHandler(notificationsHandler(g, { ...unlock, clipFor: () => ({ buffer: {} as AudioBuffer, volume: 1 }) }));
    g.show(ACHIEVEMENT);
    assert.deepEqual(g.played, ['en-clip'], 'no tier sound: the notification sound');

    const h = fakeStore();
    hookOn(h).hook.setSoundHandler(notificationsHandler(h, { ...unlock, clipFor: () => false }));
    h.show(ACHIEVEMENT);
    assert.deepEqual(h.played, [], 'no tier sound, theme muted: silent');
});

test("duration: themed values, the banner's lifetime for achievements, Steam's pristine value otherwise", () => {
    const entries: DurationEntry[] = [
        { eType: ACHIEVEMENT, name: 'Achievement', pristineMs: 5000 },
        { eType: DOWNLOAD, name: 'DownloadComplete', pristineMs: 6000 },
        { eType: OTHER, name: 'LowBattery', pristineMs: undefined },
    ];
    const themedMs = (name: string) => (name === 'DownloadComplete' ? 9000 : null);
    const noBanner = () => undefined;
    const banner = (e: DurationEntry) => (e.eType === ACHIEVEMENT ? 4800 : undefined);
    assert.deepEqual(planDurations(entries, { themed: true, themedMs, bannerMs: noBanner }), [
        [ACHIEVEMENT, 5000],
        [DOWNLOAD, 9000],
        [OTHER, undefined],
    ]);
    assert.deepEqual(planDurations(entries, { themed: true, themedMs: () => 7000, bannerMs: banner }), [
        [ACHIEVEMENT, 4800],
        [DOWNLOAD, 7000],
        [OTHER, 7000],
    ]);
    assert.deepEqual(planDurations(entries, { themed: false, themedMs, bannerMs: banner }), [
        [ACHIEVEMENT, 5000],
        [DOWNLOAD, 6000],
        [OTHER, undefined],
    ]);
});

const surface = (id: string, touches: string[], install: () => boolean = () => true): Surface => ({ id, touches, install, uninstall() {} });

test('surface: a shared target throws before anything installs; a failing install does not stop the rest', () => {
    assert.throws(() => assertDisjointTouches([surface('a', ['x']), surface('b', ['x'])]), /Steam target "x" is touched by both "a" and "b"/);
    const reported: string[] = [];
    const status = installSurfaces(
        [
            surface('off', ['t1']),
            surface('bad', ['t2'], () => {
                throw new Error('nope');
            }),
            surface('ok', ['t3']),
        ],
        { isEnabled: (id) => id !== 'off', reportError: (id) => reported.push(id) },
    );
    assert.deepEqual(reported, ['bad']);
    assert.deepEqual(
        status.map((s) => s.skipped),
        ['disabled', 'failed', null],
    );
});

test('preview: a random type, never the same twice in a row when there is a choice', () => {
    const ids = ['A', 'B', 'C'];
    assert.equal(pickPreview(ids, null, () => 0), 'A');
    assert.equal(pickPreview(ids, 'A', () => 0), 'B', 'the last one is skipped');
    assert.equal(pickPreview(ids, 'A', () => 0.999), 'C');
    assert.equal(pickPreview(['A'], 'A', () => 0.5), 'A', 'one choice: repeats');
    assert.equal(pickPreview([], null), null);
    const seen = new Set<string>();
    let last: string | null = null;
    for (let i = 0; i < 50; i++) {
        const next = pickPreview(ids, last)!;
        assert.notEqual(next, last);
        seen.add((last = next));
    }
    assert.equal(seen.size, 3);
});

// ---------- the notifications queue (surfaces/queue/queue.ts) ----------
import { planAlone } from '../frontend/surfaces/queue/queue.ts';

test('notifications queue: on, every type is displayToastAlone; off, Steam\'s own value comes back', () => {
    const entries = [
        { eType: 2, pristine: undefined },
        { eType: 33, pristine: true },
        { eType: 9, pristine: false },
    ];
    assert.deepEqual(planAlone(entries, true), [[2, true], [33, true], [9, true]]);
    assert.deepEqual(planAlone(entries, false), [[2, undefined], [33, true], [9, false]]);
});

test('notifications queue: the desktop stack looks stuck only with toasts waiting and none on screen', async () => {
    const { stackLooksStuck } = await import('../frontend/steam/toast-stack.ts');
    assert.equal(stackLooksStuck({ m_rgNotificationToasts: [1, 2], m_setContextsRenderingToasts: { size: 0 } }), true);
    assert.equal(stackLooksStuck({ m_rgNotificationToasts: [1], m_setContextsRenderingToasts: { size: 1 } }), false);
    assert.equal(stackLooksStuck({ m_rgNotificationToasts: [], m_setContextsRenderingToasts: { size: 0 } }), false);
    assert.equal(stackLooksStuck(undefined), false);
});

test('toast stack idle: onIdle runs after SetContextRenderingToast(ctx, false), never for true; uninstall restores Steam', async () => {
    const { installStackIdle } = await import('../frontend/steam/toast-stack.ts');
    const calls: unknown[][] = [];
    const proto = { SetContextRenderingToast(...args: unknown[]) { calls.push(args); return 'steam'; } };
    const store = Object.create(proto) as Record<string, unknown>;
    let idle = 0;
    const off = installStackIdle(store, () => idle++, () => {})!;
    assert.ok(Object.prototype.hasOwnProperty.call(store, 'SetContextRenderingToast'));
    assert.equal((store.SetContextRenderingToast as (...a: unknown[]) => unknown)(0, true), 'steam');
    assert.equal((store.SetContextRenderingToast as (...a: unknown[]) => unknown)(0, false), 'steam');
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(idle, 1);
    assert.deepEqual(calls, [[0, true], [0, false]]);
    off();
    assert.ok(!Object.prototype.hasOwnProperty.call(store, 'SetContextRenderingToast'));
    assert.equal(installStackIdle({}, () => {}, () => {}), null);
});
