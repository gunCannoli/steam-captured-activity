// sensors/view-core and kernel/safety.
import test from "node:test";
import assert from "node:assert/strict";
import { createViewTracker } from "../frontend/sensors/view-core.ts";
import { createSafety } from "../frontend/kernel/safety.ts";

function tracker() {
    const log: string[] = [];
    let now = 0;
    const t = createViewTracker({
        now: () => now,
        viewed: (p) => log.push(`viewed ${p.appid} ${p.mode}`),
        left: (p) => log.push(`left ${p.appid} ${p.mode}`),
    });
    return { t, log, at: (ms: number) => (now = ms) };
}

test("view: Steam games and shortcuts alike, one event per real navigation", () => {
    const { t, log } = tracker();
    t.route(435150);
    t.route(435150);
    t.route(-436078098); // a shortcut, as CEF hands it over (signed)
    t.route(undefined);
    assert.deepEqual(log, ["viewed 435150 desktop", "left 435150 desktop", "viewed 3858889198 desktop", "left 3858889198 desktop"]);
});

test("view: Big Picture re-renders count once; the same page after a quiet gap is a new view", () => {
    const { t, log, at } = tracker();
    at(0);
    t.sighting(435150);
    at(500);
    t.sighting(435150);
    at(5000);
    t.sighting(435150);
    t.close("gamepad");
    assert.deepEqual(log, ["viewed 435150 gamepad", "viewed 435150 gamepad", "left 435150 gamepad"]);
});

test("safety: a part past its error budget is off for the session; the others stay on", () => {
    const s = createSafety({ budget: 2 });
    s.reportError("headline", new Error("a"));
    assert.equal(s.isEnabled("headline"), true);
    s.reportError("headline", new Error("b"));
    assert.equal(s.isEnabled("headline"), false);
    assert.equal(s.isEnabled("feed"), true);
    assert.deepEqual(s.diagnostics().tripped, ["headline"]);
});
