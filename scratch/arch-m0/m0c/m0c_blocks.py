# M0c literal before/after blocks for scratch/check_all_tabs.js (migration plan § 7, M0c).
# Guardrail 15: a timing flake is fixed by polling the data signal (Steam's store), never by
# relaxing what is checked. Every "before" block must occur exactly once.
#   python scratch/arch-m0/m0c/m0c_blocks.py <repo root> check|apply
import os
import sys

CAT = "scratch/check_all_tabs.js"
STEPS = []


def step(n, path, before, after):
    STEPS.append((n, path, before, after))


step("1.1", CAT,
"""    ok('2. Activity feed: "{Username} captured" cards (hasEvent)', activity.captured > 0, activity.captured);
""",
"""    ok('2. Activity feed: "{Username} captured" cards (hasEvent)', activity.captured > 0, activity.captured);
    // Guardrail 15: the A -> B -> A check compares Steam's store (the data signal), not DOM
    // card counts, which Steam reveals progressively (1 or 3 cards for the same data, 2026-09-28).
    const activityDays = () =>
        shared.evaluate(`window.appActivityStore?.GetAppActivity?.(${A})?.appActivityByDay?.length ?? 0`);
    const daysA = await activityDays();
""")

step("1.2", CAT,
"""    let back;
    for (let i = 0; i < 20; i++) {
        back = await view(shared, `/library/app/${A}`, nameA);
        if (back.captured >= 1 && back.captured === activity.captured) break;
        await wait(500);
    }
    ok('A -> B -> A: Post-Game Summary intact', back.postGameSummary);
    ok('A -> B -> A: no error boundary', !back.errorBoundary);
    ok('A -> B -> A: activity cards intact (hasEvent)', back.captured >= 1 && back.captured === activity.captured, back.captured);
""",
"""    let back;
    let daysBack = 0;
    for (let i = 0; i < 20; i++) {
        back = await view(shared, `/library/app/${A}`, nameA);
        daysBack = await activityDays();
        if (back.captured >= 1 && daysBack === daysA) break;
        await wait(500);
    }
    ok('A -> B -> A: Post-Game Summary intact', back.postGameSummary);
    ok('A -> B -> A: no error boundary', !back.errorBoundary);
    ok('A -> B -> A: activity cards intact (hasEvent)', back.captured >= 1 && daysA > 0 && daysBack === daysA, { cards: back.captured, days: daysBack, daysBefore: daysA });
""")

if __name__ == "__main__":
    root = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "check"
    for n, path, before, after in STEPS:
        p = os.path.join(root, path)
        with open(p, encoding="utf-8", newline="") as f:
            src = f.read()
        eol = "\r\n" if "\r\n" in src else "\n"  # match the file's own line endings
        before = before.replace("\n", eol)
        after = after.replace("\n", eol)
        c = src.count(before)
        if c != 1:
            print(f"STEP {n}: before-block found {c} times in {path} -> STALE")
            sys.exit(1)
        if mode == "apply":
            with open(p, "w", encoding="utf-8", newline="") as f:
                f.write(src.replace(before, after))
        print(f"STEP {n}: ok ({path})")
