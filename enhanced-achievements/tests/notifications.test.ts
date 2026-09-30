// Notification hook, unlock sensor, and the sound / completion / duration decisions (migration plan § E1b).
// Fake `proto` and `owner` objects: nothing here needs Steam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installNotificationHook, type SoundCall } from '../frontend/steam/notification-hook.ts';
import { createUnlockSensor } from '../frontend/sensors/unlock/unlock.ts';
import { createSoundHandler } from '../frontend/surfaces/sound/sound.ts';
import { createCompletion } from '../frontend/surfaces/toasts/completion.ts';
import { applyDuration, durationFor } from '../frontend/surfaces/duration/duration.ts';
import { resolveTheme } from '../frontend/theme/theme.ts';
import type { Events } from '../frontend/kernel/events.ts';
import type { SteamNotification } from '../frontend/kernel/notification.ts';

const note = (id = 'ACH', eType = 7): SteamNotification =>
    ({ eType, data: { achievement_id: () => id, achieved: () => true, appid: () => 480 } }) as unknown as SteamNotification;

/** A fake NotificationStore prototype: PlayNotificationSound asks this.ChooseSound and plays when it answers truthy. */
function fakeStore() {
    const played: string[] = [];
    const chooseCalls: string[] = [];
    const proto = {
        PlayNotificationSound(this: { ChooseSound(config: unknown, n: SteamNotification): unknown }, n: SteamNotification) {
            if (this.ChooseSound({}, n)) played.push('steam');
        },
        ChooseSound(_config: unknown, _n: SteamNotification): unknown {
            chooseCalls.push('original');
            return 'chime';
        },
    };
    const owner = Object.create(proto) as object;
    return { proto, owner, played, chooseCalls };
}

function install(f = fakeStore()) {
    const reported: string[] = [];
    const warned: string[] = [];
    const hook = installNotificationHook(f.proto, f.owner, {
        reportError: (id) => reported.push(id),
        warn: (message) => warned.push(message),
    });
    const show = (n = note()) => (f.proto.PlayNotificationSound as (this: unknown, n: SteamNotification) => void).call(f.owner, n);
    return { ...f, hook, reported, warned, show };
}

test('hook: calls on a stand-in object pass straight through', () => {
    const t = install();
    let listened = 0;
    let handled = 0;
    t.hook.onShown(() => listened++);
    t.hook.setSoundHandler(() => handled++);
    const standIn = { ChooseSound: () => null };
    (t.proto.PlayNotificationSound as (this: unknown, n: SteamNotification) => void).call(standIn, note());
    assert.equal(listened, 0);
    assert.equal(handled, 0);
    assert.deepEqual(t.played, []);
});

test("hook: with no sound handler Steam's original runs once", () => {
    const t = install();
    t.show();
    assert.deepEqual(t.played, ['steam']);
    assert.deepEqual(t.chooseCalls, ['original']);
});

test("hook: a throwing sound handler falls back to Steam's original once and reports a sound error", () => {
    const t = install();
    t.hook.setSoundHandler(() => {
        throw new Error('boom');
    });
    t.show();
    assert.deepEqual(t.played, ['steam']);
    assert.deepEqual(t.reported, ['sound']);

    // A handler that already played does not get a second chime after it throws.
    const u = install();
    u.hook.setSoundHandler((call) => {
        call.playSteam();
        throw new Error('late');
    });
    u.show();
    assert.deepEqual(u.played, ['steam']);
    assert.deepEqual(u.reported, ['sound']);
});

test("hook: askSteam returns Steam's decision, plays nothing and removes the own ChooseSound", () => {
    const t = install();
    let answer: boolean | null = null;
    t.hook.setSoundHandler((call) => {
        answer = call.askSteam();
    });
    t.show();
    assert.equal(answer, true, "Steam's ChooseSound answered truthy: a sound is wanted");
    assert.deepEqual(t.played, [], 'nothing played');
    assert.equal(Object.prototype.hasOwnProperty.call(t.owner, 'ChooseSound'), false, 'own ChooseSound removed');
    assert.deepEqual(t.chooseCalls, ['original']);
});

test('hook: playSteam and askSteam together still reach Steam only once', () => {
    const t = install();
    let second: boolean | undefined;
    t.hook.setSoundHandler((call: SoundCall) => {
        call.playSteam();
        call.playSteam();
        second = call.askSteam();
    });
    t.show();
    assert.deepEqual(t.played, ['steam']);
    assert.equal(second, false);
    assert.deepEqual(t.chooseCalls, ['original']);
});

test('hook: a throwing onShown listener does not stop the sound', () => {
    const t = install();
    const order: string[] = [];
    t.hook.onShown(() => {
        order.push('first');
        throw new Error('listener');
    });
    t.hook.onShown(() => order.push('second'));
    t.hook.setSoundHandler((call) => {
        order.push('sound');
        call.playSteam();
    });
    t.show();
    assert.deepEqual(order, ['first', 'second', 'sound']);
    assert.equal(t.warned.length, 1);
    assert.deepEqual(t.played, ['steam']);
    t.hook.uninstall();
    t.hook.uninstall();
    assert.equal(t.proto.PlayNotificationSound.name === 'PlayNotificationSound', true, 'the original is back');
});

function sensor(progress: { unlocked?: unknown; total?: unknown; all_unlocked?: unknown } | undefined = undefined) {
    const emitted: Events['achievement.unlocked'][] = [];
    const deferred: (() => void)[] = [];
    let clock = 1000;
    const feed = createUnlockSensor({
        isAchievementUnlock: (n) => n.eType === 7,
        progressFor: () => progress,
        emit: (p) => emitted.push(p),
        defer: (fn) => deferred.push(fn),
        now: () => clock,
    });
    return { feed, emitted, deferred, setClock: (ms: number) => (clock = ms), flush: () => deferred.splice(0).forEach((fn) => fn()) };
}

test('sensor: one achievement.unlocked per notification, however often Steam asks for its sound', () => {
    const s = sensor();
    const n = note('ACH_1');
    s.feed(n);
    s.feed(n);
    s.feed(n);
    s.flush();
    assert.equal(s.emitted.length, 1);
    s.feed(note('ACH_1')); // a new notification of the same achievement is a new unlock
    s.flush();
    assert.equal(s.emitted.length, 2);
    s.feed(note('ACH_2', 3)); // not an achievement unlock
    s.flush();
    assert.equal(s.emitted.length, 2);
});

test('sensor: previews and the 100% toast never emit; EA_TEST does', () => {
    const s = sensor();
    s.feed(note('EA_PREVIEW_rare'));
    s.feed(note('EA_PREVIEW_whatever'));
    s.feed(note('EA_100_PERCENT'));
    s.feed(note('EA_TEST'));
    s.flush();
    assert.deepEqual(s.emitted.map((e) => e.n.data.achievement_id()), ['EA_TEST']);
});

test('sensor: completesGame and atMs are read at show time, the event is emitted only after defer runs', () => {
    const progress = { unlocked: 9, total: 10 as unknown, all_unlocked: false };
    const s = sensor(progress);
    s.setClock(5000);
    s.feed(note('ACH_LAST'));
    assert.equal(s.emitted.length, 0, 'nothing emitted inside Steam\'s call');
    // Steam refreshes its progress cache and time passes before the deferred emit runs.
    progress.unlocked = 10;
    progress.all_unlocked = true;
    s.setClock(9000);
    s.flush();
    assert.equal(s.emitted.length, 1);
    assert.equal(s.emitted[0]!.atMs, 5000);
    assert.equal(s.emitted[0]!.completesGame, true);
});

function soundRig(over: Partial<Parameters<typeof createSoundHandler>[0]> = {}) {
    const phases = new Map<object, 'waiting' | 'showing' | 'done'>();
    const listeners = new Map<object, Set<() => void>>();
    const log: string[] = [];
    let enabled = true;
    const handler = createSoundHandler({
        isEnabled: () => enabled,
        isAchievementUnlock: () => true,
        clipFor: () => ({ buffer: {} as AudioBuffer, volume: 1 }),
        audioState: () => 'running',
        resumeAudio: () => log.push('resume'),
        playClip: () => log.push('clip'),
        peek: (key) => phases.get(key),
        whenShowing: (key, onShow) => {
            const phase = phases.get(key);
            if (phase === undefined || phase === 'done') return { at: 'never' };
            if (phase === 'showing') return { at: 'now' };
            const set = listeners.get(key) ?? new Set();
            listeners.set(key, set);
            const fn = () => {
                const p = phases.get(key);
                if (p === 'waiting') return;
                set.delete(fn);
                if (p === 'showing') onShow();
            };
            set.add(fn);
            return { at: 'later', cancel: () => void set.delete(fn) };
        },
        ...over,
    });
    const call = (n: SteamNotification): SoundCall => ({
        n,
        playSteam: () => log.push('steam'),
        askSteam: () => (log.push('ask'), true),
    });
    const setPhase = (n: SteamNotification, p: 'waiting' | 'showing' | 'done') => {
        phases.set(n.data, p);
        for (const fn of [...(listeners.get(n.data) ?? [])]) fn();
    };
    return { handler, call, log, phases, setPhase, listeners, setEnabled: (v: boolean) => (enabled = v) };
}

test("sound: a queued banner's sound plays once when its turn comes and never if it is dismissed first", () => {
    const r = soundRig();
    const a = note('A');
    r.phases.set(a.data, 'waiting');
    r.handler(r.call(a));
    r.handler(r.call(a)); // Steam may ask again for the same toast
    assert.deepEqual(r.log, [], 'nothing on arrival');
    r.setPhase(a, 'showing');
    assert.deepEqual(r.log, ['ask', 'clip'], 'once, on its turn');
    r.setPhase(a, 'done');
    assert.deepEqual(r.log, ['ask', 'clip']);

    const b = note('B');
    r.log.length = 0;
    r.phases.set(b.data, 'waiting');
    r.handler(r.call(b));
    r.setPhase(b, 'done'); // dismissed before its turn
    assert.deepEqual(r.log, [], 'silent');

    // Audio not unlocked yet: Steam's chime this time, and the context is resumed for the next one.
    const c = soundRig({ audioState: () => 'suspended' });
    const n = note('C');
    c.phases.set(n.data, 'showing');
    c.handler(c.call(n));
    assert.deepEqual(c.log, ['resume', 'steam']);
    // No clip for this tier: Steam's chime, no resume.
    const d = soundRig({ clipFor: () => undefined });
    d.phases.set(n.data, 'showing');
    d.handler(d.call(n));
    assert.deepEqual(d.log, ['steam']);
});

test("sound: switched off, Steam's chime plays at once and nothing is deferred", () => {
    const r = soundRig();
    r.setEnabled(false);
    const a = note('A');
    r.phases.set(a.data, 'waiting');
    r.handler(r.call(a));
    assert.deepEqual(r.log, ['steam']);
    assert.equal(r.listeners.size, 0, 'nothing subscribed');
    const other = soundRig({ isAchievementUnlock: () => false });
    other.handler(other.call(note('P', 3)));
    assert.deepEqual(other.log, ['steam']);
});

test('completion: one 100% toast 1.5 s after a completing unlock; none when completion is off', () => {
    const posted: number[] = [];
    const scheduled: { ms: number; fn: () => void }[] = [];
    let enabled = true;
    const handle = createCompletion({
        isEnabled: () => enabled,
        post: (appid) => void posted.push(appid),
        schedule: (fn, ms) => void scheduled.push({ fn, ms }),
    });
    const event = (completesGame: boolean) => ({ n: note('X'), atMs: 1, completesGame });
    handle(event(false));
    assert.equal(scheduled.length, 0, 'not a completing unlock');
    handle(event(true));
    assert.deepEqual(scheduled.map((s) => s.ms), [1500]);
    assert.deepEqual(posted, [], 'not posted until the delay passes');
    scheduled[0]!.fn();
    assert.deepEqual(posted, [480]);
    enabled = false;
    handle(event(true));
    assert.equal(scheduled.length, 1, 'switched off: nothing scheduled');
});

test('duration: the banner lifetime with a theme, Steam\'s pristine value without, nothing when switched off', () => {
    const theme = resolveTheme({ themes: { normal: {} }, settings: { display_time_ms: 4000, animation: 'fade' } });
    // fade: 400 in, 300 out, 100 settle
    assert.equal(durationFor(theme, 7000), 4000 + 400 + 300 + 100);
    assert.equal(durationFor(null, 7000), 7000);
    assert.equal(durationFor(null, undefined), undefined);
    const noDisplay = resolveTheme({ themes: { normal: {} }, settings: { animation: 'fade' } });
    assert.equal(durationFor(noDisplay, 7000), 7000 + 800, 'no display_time_ms: Steam\'s own duration');

    const writes: (number | undefined)[] = [];
    const errors: unknown[] = [];
    let enabled = true;
    const apply = () =>
        applyDuration({ isEnabled: () => enabled, theme: () => theme, pristineMs: 7000, write: (ms) => writes.push(ms), reportError: (e) => errors.push(e) });
    apply();
    assert.deepEqual(writes, [4800]);
    enabled = false;
    apply();
    assert.deepEqual(writes, [4800], 'switched off: nothing written');
    enabled = true;
    applyDuration({
        isEnabled: () => true,
        theme: () => {
            throw new Error('bad theme');
        },
        pristineMs: 7000,
        write: (ms) => writes.push(ms),
        reportError: (e) => errors.push(e),
    });
    assert.equal(errors.length, 1);
    assert.deepEqual(writes, [4800]);
});
