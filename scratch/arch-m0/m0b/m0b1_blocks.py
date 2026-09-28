# M0b-1 literal before/after blocks (migration plan § 7, M0b-1). Apply AFTER M0a is committed.
# Every "before" block must occur exactly once, or the plan is stale.
#   python scratch/arch-m0/m0b/m0b1_blocks.py <steam-cartridges dir> check|apply
import os
import sys

SET = "frontend/settings/settings.ts"
IDX = "frontend/index.tsx"
STEPS = []


def step(n, path, before, after):
    STEPS.append((n, path, before, after))


step("1.1", SET,
"""    /** Show external community destinations (Discord, Speedrun, Wiki). Default true. */
    communityShowExternalLinks: boolean;
}
""",
"""    /** Show external community destinations (Discord, Speedrun, Wiki). Default true. */
    communityShowExternalLinks: boolean;
    /** Kill switches (migration plan M0b): comma-separated feature ids skipped at start-up. Default "". */
    disabledFeatures: string;
}
""")

step("1.2", SET,
"""    communityShowExternalLinks: true,
};

const VALIDATORS""",
"""    communityShowExternalLinks: true,
    disabledFeatures: '',
};

const VALIDATORS""")

step("1.4", SET,
"""    communityShowExternalLinks: true,
};
const listeners""",
"""    communityShowExternalLinks: true,
    disabledFeatures: '',
};
const listeners""")

step("1.3", SET,
"""    communityShowExternalLinks: (raw) => raw !== false,
""",
"""    communityShowExternalLinks: (raw) => raw !== false,
    disabledFeatures: (raw) => (typeof raw === 'string' ? raw : ''),
""")

step("2.1", IDX,
"""import { triggerSync } from "./features/scraper/sync-manager";
""",
"""import { triggerSync } from "./features/scraper/sync-manager";
import { features } from "./safety/switches";
import { beginBoot, watchBoot } from "./safety/boot";
""")

step("2.2", IDX,
"""export { setSetting, resetSettings };
""",
"""export { setSetting, resetSettings };
/** Kill switches, error counts and safe mode (migration plan M0b). */
export const safetyDiagnostics = () => features.diagnostics();
""")

step("2.3", IDX,
"""    // Settings first: the Game Info gate reads them (ADR-0033).
    await initSettings();
""",
"""    // Settings first: the Game Info gate reads them (ADR-0033).
    await initSettings();

    // ===== Safety (migration plan M0b) =====
    // Kill switches come from the `disabledFeatures` setting. Two starts in a row that
    // never finished cleanly switch safe mode on (capture tier only, ADR-0012).
    features.reload();
    try {
        const boot = beginBoot(window.localStorage);
        if (boot.safeMode) {
            features.setSafeMode(true);
            logger.error(
                `Safe mode: the last ${boot.unclean} starts did not finish cleanly; only sections and captures are on.`,
            );
        }
        watchBoot(window.localStorage, () => features.errorCount(), window);
    } catch (e) {
        logger.warn("Boot sentinel unavailable.", e);
    }
""")

step("2.4", IDX,
"""    if (!registerLibraryApp()) {
""",
"""    if (features.isEnabled("sections") && !features.run("sections", () => registerLibraryApp())) {
""")

step("2.5", IDX,
"""    ensureStoreCacheHooked();
""",
"""    features.run("store-cache", () => ensureStoreCacheHooked());
""")

step("2.6", IDX,
"""    installHeadlinePatch();
""",
"""    features.run("headline", () => installHeadlinePatch());
""")

step("2.7", IDX,
"""    installActivityCardsPatch();
""",
"""    features.run("activity-cards", () => installActivityCardsPatch());
""")

step("2.8", IDX,
"""    installNativeSections();
""",
"""    features.run("native-links", () => installNativeSections());
""")

step("2.9", IDX,
"""    initAchievements();
""",
"""    features.run("achievements", () => initAchievements());
""")

step("2.10", IDX,
"""    void loadAutoRoutingProfiles();
    initSourceView();
    void initGameInfo().catch((e) =>
        logger.error("Game Info feature failed; activity is unaffected.", e),
    );
""",
"""    features.run("game-info", () => {
        void loadAutoRoutingProfiles();
        initSourceView();
        void initGameInfo().catch((e) => {
            features.reportError("game-info", e);
            logger.error("Game Info feature failed; activity is unaffected.", e);
        });
    });
""")

step("2.11", IDX,
"""    await registerLibraryHome();
""",
"""    if (features.isEnabled("library-home")) {
        try {
            await registerLibraryHome();
        } catch (e) {
            features.reportError("library-home", e);
        }
    }
""")

step("2.12", IDX,
"""    onPopupCreate((popup, type) => {
        if (type === PopupType.Desktop) {
""",
"""    onPopupCreate((popup, type) => {
        if (!features.isEnabled("captures")) return undefined;
        if (type === PopupType.Desktop) {
""")

step("2.13", IDX,
"""        handleAppLaunchAchievements(app.appid);

        // Start active observer session while game is running
        void rpc.steamStoreGetMapping(app.appid).then((res) => {
""",
"""        features.run("achievements-observer", () => handleAppLaunchAchievements(app.appid));

        // Start active observer session while game is running
        if (features.isEnabled("achievements-observer")) void rpc.steamStoreGetMapping(app.appid).then((res) => {
""")

step("2.14", IDX,
"""    triggerSync(3000);
""",
"""    features.run("background-sync", () => triggerSync(3000));
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
