// Pure-logic tests: run with `npm test` (Node's built-in runner, TS type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameIdCandidates, mergeClip, planCaptures, resolveCaptureSettings, SETTLE_MS, unlockOffsetMs, type Action, type CaptureSettings } from '../frontend/capture/plan.ts';

const OFF: CaptureSettings = {
    screenshot: { enabled: false, delayMs: 500 },
    clip: { enabled: false, durationS: 15, delayMs: 0 },
    marker: { enabled: false },
};

test('gameIdCandidates: shortcut composes the 64-bit id, native is the plain appid', () => {
    assert.equal(gameIdCandidates(4271448594).shortcut, '18345732017808736256');
    assert.equal(gameIdCandidates(435150).native, '435150');
});

test('resolveCaptureSettings: a tier override wins', () => {
    const { settings, warnings } = resolveCaptureSettings(OFF, { screenshot: { enabled: true, delay_ms: 200 }, recording: { enabled: true, duration_s: 30 } });
    assert.equal(settings.screenshot.enabled, true);
    assert.equal(settings.screenshot.delayMs, 200);
    assert.equal(settings.clip.enabled, true);
    assert.equal(settings.clip.durationS, 30);
    assert.equal(warnings.length, 0);
});

test('resolveCaptureSettings: out-of-range or wrong-type fields are ignored with a warning', () => {
    const { settings, warnings } = resolveCaptureSettings(OFF, { screenshot: { delay_ms: 99999 }, recording: { duration_s: 'nope' as unknown as number } });
    assert.equal(settings.screenshot.delayMs, OFF.screenshot.delayMs);
    assert.equal(settings.clip.durationS, OFF.clip.durationS);
    assert.equal(warnings.length, 2);
});

test('resolveCaptureSettings: add_timeline_marker is not overridable', () => {
    const { settings, warnings } = resolveCaptureSettings(OFF, { recording: { add_timeline_marker: true } });
    assert.equal(settings.marker.enabled, false);
    assert.ok(warnings.some((w) => w.includes('add_timeline_marker')));
});

test('unlockOffsetMs: fresh toast keeps nowOffset', () => {
    assert.equal(unlockOffsetMs(10_000, 1_000_000, 999.9), 10_000);
});

test('unlockOffsetMs: a queued toast 6s old walks the offset back', () => {
    const rtCreatedS = 1_000_000 / 1000 - 6;
    assert.equal(unlockOffsetMs(10_000, 1_000_000, rtCreatedS), 4_000);
});

test('unlockOffsetMs: never negative', () => {
    const rtCreatedS = 1_000_000 / 1000 - 60;
    assert.equal(unlockOffsetMs(10_000, 1_000_000, rtCreatedS), 0);
});

const ALL_ON: CaptureSettings = {
    screenshot: { enabled: true, delayMs: 500 },
    clip: { enabled: true, durationS: 15, delayMs: 0 },
    marker: { enabled: true },
};
const unlock = { appid: 480, name: 'Test Achievement', description: 'desc', nowMs: 1_000_000, rtCreatedS: 1_000_000 / 1000 };

test('planCaptures: null timeline skips everything', () => {
    const plan = planCaptures(ALL_ON, unlock, null);
    assert.deepEqual(plan.actions, []);
    assert.deepEqual(plan.skipped, [{ kind: 'all', reason: 'no-running-timeline' }]);
});

test('planCaptures: recording null skips screenshot and clip, keeps marker (shortcut)', () => {
    const shortcutGameId = gameIdCandidates(480).shortcut;
    const timeline = { timelineId: 't1', gameId: shortcutGameId, nowOffsetMs: 10_000, startBeforeZeroMs: 0, recording: null };
    const plan = planCaptures(ALL_ON, unlock, timeline);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0]!.kind, 'marker');
    assert.deepEqual(
        plan.skipped.map((s) => s.reason),
        ['recording-not-active', 'recording-not-active'],
    );
});

test('planCaptures: native game skips marker with steam-marks-achievements', () => {
    const timeline = { timelineId: 't1', gameId: gameIdCandidates(480).native, nowOffsetMs: 10_000, startBeforeZeroMs: 0, recording: { startOffsetMs: 0 } };
    const plan = planCaptures(ALL_ON, unlock, timeline);
    assert.ok(plan.skipped.some((s) => s.kind === 'marker' && s.reason === 'steam-marks-achievements'));
    assert.ok(!plan.actions.some((a) => a.kind === 'marker'));
});

test('planCaptures: clip start is clamped to recording.startOffsetMs and to 0', () => {
    const timeline = { timelineId: 't1', gameId: gameIdCandidates(480).native, nowOffsetMs: 10_000, startBeforeZeroMs: 0, recording: { startOffsetMs: 8_000 } };
    const plan = planCaptures(ALL_ON, unlock, timeline);
    const clip = plan.actions.find((a) => a.kind === 'clip') as Extract<Action, { kind: 'clip' }>;
    assert.equal(clip.startOffsetMs, 8_000);

    const timeline2 = { ...timeline, nowOffsetMs: 1_000, recording: { startOffsetMs: 0 } };
    const plan2 = planCaptures(ALL_ON, unlock, timeline2);
    const clip2 = plan2.actions.find((a) => a.kind === 'clip') as Extract<Action, { kind: 'clip' }>;
    assert.equal(clip2.startOffsetMs, 0);
});

test('planCaptures: sendAfterMs = delay + SETTLE_MS', () => {
    const timeline = { timelineId: 't1', gameId: gameIdCandidates(480).native, nowOffsetMs: 10_000, startBeforeZeroMs: 0, recording: { startOffsetMs: 0 } };
    const plan = planCaptures(ALL_ON, unlock, timeline);
    const shot = plan.actions.find((a) => a.kind === 'screenshot')!;
    assert.equal(shot.sendAfterMs, 500 + SETTLE_MS);
});

test('planCaptures: all disabled gives empty actions and no skip noise', () => {
    const timeline = { timelineId: 't1', gameId: gameIdCandidates(480).native, nowOffsetMs: 10_000, startBeforeZeroMs: 0, recording: { startOffsetMs: 0 } };
    const plan = planCaptures(OFF, unlock, timeline);
    assert.deepEqual(plan.actions, []);
    assert.deepEqual(plan.skipped, []);
});

test('mergeClip: end extended, capped at start + MAX_CLIP_MS, name gets (+1)', () => {
    const pending: Extract<Action, { kind: 'clip' }> = { kind: 'clip', sendAfterMs: 2000, startOffsetMs: 0, endOffsetMs: 15_000, name: 'A' };
    const next: Extract<Action, { kind: 'clip' }> = { kind: 'clip', sendAfterMs: 2000, startOffsetMs: 10_000, endOffsetMs: 200_000, name: 'B' };
    const merged = mergeClip(pending, next, 1);
    assert.equal(merged.endOffsetMs, 120_000);
    assert.equal(merged.name, 'A (+1)');
    assert.equal(merged.startOffsetMs, 0);
});
