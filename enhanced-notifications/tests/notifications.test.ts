// Notification hook, its composition with enhanced-achievements' identical hook, the sound decision,
// the duration plan and the surface runner. Fake `proto` and `owner` objects: nothing here needs Steam.
import { pickPreview } from '../frontend/surfaces/preview/pick.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installNotificationHook, type SoundHandler } from '../frontend/steam/notification-hook.ts';
import { createSoundHandler, type Clip, type SoundDeps } from '../frontend/surfaces/sound/sound.ts';
import { planDurations } from '../frontend/surfaces/duration/duration.ts';
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
    const show = (eType: number) => (proto.PlayNotificationSound as (this: unknown, n: SteamNotification) => void).call(owner, { eType });
    return { proto, owner, played, show };
}

type Store = ReturnType<typeof fakeStore>;

function hookOn(f: Store) {
    const reported: string[] = [];
    const hook = installNotificationHook(f.proto, f.owner, { reportError: (id) => reported.push(id), warn() {} });
    return { hook, reported };
}

/** What enhanced-achievements' sound surface does: its clip for achievements, Steam's chime for the rest. */
const achievementsHandler =
    (f: Store): SoundHandler =>
    (call) => {
        if (call.n.eType !== ACHIEVEMENT) return call.playSteam();
        if (call.askSteam()) f.played.push('ea-clip');
    };

/** This plugin's handler as the sound surface builds it, with achievements handed to enhanced-achievements. */
function notificationsHandler(f: Store, over: Partial<SoundDeps> = {}): SoundHandler {
    const clip = { buffer: {} as AudioBuffer, volume: 1 };
    return createSoundHandler({
        isEnabled: () => true,
        nameOf: (eType) => ({ [ACHIEVEMENT]: 'Achievement', [DOWNLOAD]: 'DownloadComplete', [OTHER]: 'LowBattery' })[eType] ?? null,
        handles: (eType) => eType !== ACHIEVEMENT,
        clipFor: (name) => (name === 'DownloadComplete' ? clip : null),
        audioState: () => 'running',
        resumeAudio() {},
        playClip: () => f.played.push('en-clip'),
        ...over,
    });
}

for (const order of ['enhanced-achievements first', 'enhanced-notifications first'] as const) {
    test(`hook composition (${order}): each plugin sees every toast once, and each type gets exactly one sound`, () => {
        const f = fakeStore();
        const seen: string[] = [];
        const install = (who: 'ea' | 'en') => {
            const { hook } = hookOn(f);
            hook.onShown((n) => seen.push(`${who}:${n.eType}`));
            hook.setSoundHandler(who === 'ea' ? achievementsHandler(f) : notificationsHandler(f));
            return hook;
        };
        if (order === 'enhanced-achievements first') {
            install('ea');
            install('en');
        } else {
            install('en');
            install('ea');
        }

        f.show(ACHIEVEMENT);
        assert.deepEqual(f.played, ['ea-clip'], 'achievement: enhanced-achievements plays, no Steam chime');
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

test("sound: switched off, unknown or handed-over types get Steam's chime", () => {
    for (const over of [{ isEnabled: () => false }, { nameOf: () => null }, { handles: () => false }] as Partial<SoundDeps>[]) {
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

test("duration: themed values, Steam's pristine value otherwise, handed-over types skipped", () => {
    const entries = [
        { eType: ACHIEVEMENT, name: 'Achievement', pristineMs: 5000 },
        { eType: DOWNLOAD, name: 'DownloadComplete', pristineMs: 6000 },
        { eType: OTHER, name: 'LowBattery', pristineMs: undefined },
    ];
    const themedMs = (name: string) => (name === 'DownloadComplete' ? 9000 : null);
    const handles = (eType: number) => eType !== ACHIEVEMENT;
    assert.deepEqual(planDurations(entries, { themed: true, handles, themedMs }), [
        [DOWNLOAD, 9000],
        [OTHER, undefined],
    ]);
    assert.deepEqual(planDurations(entries, { themed: false, handles, themedMs }), [
        [DOWNLOAD, 6000],
        [OTHER, undefined],
    ]);
    assert.deepEqual(
        planDurations(entries, { themed: true, handles: () => true, themedMs }).map(([e]) => e),
        [ACHIEVEMENT, DOWNLOAD, OTHER],
    );
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
