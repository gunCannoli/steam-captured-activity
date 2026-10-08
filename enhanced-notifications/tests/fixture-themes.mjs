// Two themes the live checks rely on, removed from the bundle in c874c63 and kept here verbatim (git show
// c874c63^:enhanced-notifications/themes/<name>.json): `steam_midnight` (the notification style only, no
// `achievements` block) and `steam_tiers` (an `achievements` block with tiers and no sounds). The live scripts install
// them into the user themes folder for the run and remove what they wrote; a theme of that name already there is left
// alone. steam_tiers' icon paths do not resolve in the user folder: the checks that use it look at the banner and the
// sound, never at the icons.
import { existsSync, rmSync, writeFileSync } from 'node:fs';

export const FIXTURE_THEMES = {
    steam_midnight: {
        popup: {
            background: ['#0e141b', '#1b2838'],
            gradient_angle: 135,
            border: [1, '#66c0f455', 6],
            glow: ['#66c0f433', 18, 0],
            watermark: false,
        },
        text: {
            title: ['#66c0f4', 100, 'bold'],
            body: ['#ffffff', 100, 'regular'],
            subtext: ['#8f98a0', 100, 'regular'],
        },
        game_icon: [true, 6],
    },
    steam_tiers: {
        settings: { position: 'top_right', display_time_ms: 4000, animation: 'slide' },
        text: { title: ['#ffffff', 100, 'bold'], body: ['#ffffff', 100, 'regular'] },
        achievements: {
            layout: 'default_system_right',
            normal: {
                background: ['#2f2f2f', '#1f1f1f'],
                gradient_angle: 90,
                border: [2, '#cd7f32', 8],
                glow: ['#cd7f32', 40, 0],
                margin: [0, 0],
                padding: [6, 10],
                gap: [10, 2],
                icons: { achievement: true, system: false, rarity: 'assets/trophy_bronze.svg' },
            },
            magic: { threshold: 25, border: [2, '#c0c0c0', 8], glow: ['#c0c0c0', 60, 0], icons: { rarity: 'assets/trophy_silver.svg' } },
            rare: { threshold: 10, border: [2, '#e5a93c', 8], glow: ['#e5a93c', 80, 0], icons: { rarity: 'assets/trophy_gold.svg' } },
            exceptional: { border: [2, '#40c4ff', 16], glow: ['#40c4ff', 90, 800], icons: { rarity: 'assets/trophy_platinum.svg' } },
        },
    },
};

/**
 * Writes every fixture theme the user themes folder lacks. Returns a function that removes exactly the files it wrote.
 * `evaluate` runs an expression in SharedJSContext; `plugin` is the loaded plugin name.
 */
export async function installFixtureThemes(evaluate, plugin) {
    const listed = JSON.parse(await evaluate(`window.Millennium.callServerMethod(${JSON.stringify(plugin)}, 'ListThemes', { payload: '{}' })`));
    const known = new Set((listed.themes ?? []).map((t) => t.id));
    const written = [];
    for (const [name, theme] of Object.entries(FIXTURE_THEMES)) {
        const path = `${listed.userDir}/${name}.json`;
        if (known.has(name) || existsSync(path) || existsSync(`${listed.userDir}/${name}.jsonc`)) continue;
        writeFileSync(path, JSON.stringify(theme, null, 4));
        written.push(path);
    }
    return () => {
        for (const path of written) rmSync(path, { force: true });
    };
}
