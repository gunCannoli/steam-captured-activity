import type { Surface } from '../../kernel/surface';
import type { SteamNotification } from '../../kernel/notification';
import { bigPicturePlaceholderCss, PLACEHOLDER_SELECTOR } from '../../banner/bigpicture';
import { setting } from '../../settings/settings';
import { achievementEType, notificationStore } from '../../steam/notification-store';
import { installToastPop } from '../../steam/toast-pop';
import { activeTheme, tierFor } from '../../theme/active-theme';
import { isEnabled, reportError } from '../../safety/runtime';

/**
 * "Force achievement position in Big Picture" (setting `bigpicture.force_position`, ADR-0049). Big Picture has one
 * toast place, which enhanced-notifications' theme decides by default. With the toggle on, while an achievement
 * toast shows, this plugin's theme position and margin win: a `<style>` in the Big Picture window outranks every
 * other rule on Steam's placeholder (../../banner/bigpicture.ts).
 *
 * Timing: Steam measures the placeholder once, when the toast renders. `PopNextToastNotification` runs before that
 * (../../steam/toast-pop.ts, shared with enhanced-notifications), so the style is written or cleared at each pop:
 * written for an achievement, cleared for any other toast. Desktop needs nothing here: the banner already pins its
 * own popup (../banner/window-pin.ts), which enhanced-notifications passes through.
 *
 * Kill switch `placement`: off, nothing is written and the next pop clears what was.
 */
const STYLE_ID = 'enhanced-achievements-placement';
/** Big Picture documents holding our style right now. */
const written = new Set<Document>();
let unpop: (() => void) | null = null;

/** The forced placeholder CSS for this toast, or '' (not an achievement, toggle off, switched off, no theme). */
function cssFor(n: SteamNotification): string {
    if (!isEnabled('placement') || !setting('bigpicture.force_position')) return '';
    if (n.eType !== achievementEType()) return '';
    const loaded = activeTheme();
    if (!loaded) return '';
    const tier = loaded.theme.tiers[tierFor(n)];
    return bigPicturePlaceholderCss(loaded.theme.position, (tier.banner ?? tier.box).margin);
}

function clear(): void {
    for (const doc of written) {
        try {
            doc.getElementById(STYLE_ID)?.remove();
        } catch {
            /* a window going away is fine */
        }
    }
    written.clear();
}

/** O(1) for every pop while nothing is forced; otherwise one pass over the popup manager's windows. */
function apply(css: string): void {
    if (!css) {
        if (written.size) clear();
        return;
    }
    const manager = Reflect.get(globalThis, 'g_PopupManager') as { GetPopups?: () => Iterable<{ window?: Window }> } | undefined;
    for (const popup of manager?.GetPopups?.() ?? []) {
        const doc = popup.window?.document;
        if (!doc?.head || !doc.querySelector(PLACEHOLDER_SELECTOR)) continue;
        let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
        if (!el) {
            el = doc.createElement('style');
            el.id = STYLE_ID;
            doc.head.appendChild(el); // last in <head>; it also outranks by specificity
        }
        if (el.textContent !== css) el.textContent = css;
        written.add(doc);
    }
}

export function createPlacementSurface(): Surface {
    return {
        id: 'placement',
        touches: ['NotificationStore PopNextToastNotification (own property)', 'Big Picture window <style id=enhanced-achievements-placement>'],
        install: () => {
            const store = notificationStore()?.store;
            if (!store) return false;
            unpop = installToastPop(
                store,
                (n) => apply(cssFor(n as SteamNotification)),
                (error) => reportError('placement', error),
            );
            return unpop !== null;
        },
        uninstall: () => {
            unpop?.();
            unpop = null;
            clear();
        },
    };
}
