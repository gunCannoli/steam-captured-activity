// Surface `playbar` (migration plan M3.4, ADR-0039): restores the ⓘ "Show/Hide game details"
// button on a shortcut's desktop PlayBar. Split out of surfaces/game-info; the hooks are the
// ones game-info installed before (hookComponentProps with requireMetadata: false, and the
// PlayBar render fallback). The button opens Game Info, so it is on only while both
// `playbar` and `game-info` are (as before the split, when game-info owned it).
import { logger } from "../../logger";
import type { Surface, SurfaceDeps } from "../../kernel/surface";
import { resolveOnce } from "../../steam/modules";
import { createPatchedOverview } from "../../steam/overview-proxy";
import { isShortcutAppId } from "../../kernel/appid";

let deps: SurfaceDeps & {
    /** game-info's ensureAppOverviewHooked (GetGameID / BHasStoreCategory on the overview's prototype chain). */
    hookOverview(overview: any): void;
    /** game-info's trackInstance, so its refresh re-renders the PlayBar too. */
    track(inst: any): void;
} = { isEnabled: () => true, reportError: () => {}, hookOverview: () => {}, track: () => {} };

const on = () => deps.isEnabled("playbar") && deps.isEnabled("game-info");

function isShortcutOverview(overview: any): boolean {
    return (
        isShortcutAppId(overview.appid) ||
        (typeof overview.BIsModOrShortcut === "function" && overview.BIsModOrShortcut())
    );
}

/** The requireMetadata: false path of game-info's hookComponentProps, for the PlayBar class. */
function hookPlayBarProps(componentClass: any): void {
    if (componentClass.__nsga_props_hooked) return;
    // game-info's refreshGameInfoInstances finds hooked components by this flag.
    componentClass.__nsga_props_hooked = true;
    try {
        Object.defineProperty(componentClass.prototype, "props", {
            get() {
                if (!on()) return this._nsga_raw_props;
                try {
                    deps.track(this);
                    const rawProps = this._nsga_raw_props;
                    if (!rawProps) return rawProps;
                    const overview = rawProps.overview;
                    if (!overview) return rawProps;
                    deps.hookOverview(overview);

                    if (isShortcutOverview(overview)) {
                        if (
                            this._nsga_patched_props &&
                            this._nsga_last_raw_props === rawProps
                        ) {
                            return this._nsga_patched_props;
                        }
                        this._nsga_last_raw_props = rawProps;
                        this._nsga_patched_props = new Proxy(rawProps, {
                            get(target, prop, receiver) {
                                if (prop === "overview") {
                                    return createPatchedOverview(overview);
                                }
                                return Reflect.get(target, prop, receiver);
                            },
                        });
                        return this._nsga_patched_props;
                    }
                    return rawProps;
                } catch (err) {
                    deps.reportError("playbar", err); // fail-open (plan § 7.0 D6)
                    return this._nsga_raw_props;
                }
            },
            set(newProps) {
                this._nsga_raw_props = newProps;
                this._nsga_last_raw_props = undefined;
                this._nsga_patched_props = undefined;
            },
            configurable: true,
        });
    } catch (e) {
        logger.warn("Could not define props descriptor on component:", e);
    }
}

function patchPlayBar(): void {
    const targetPlayBar = resolveOnce<any>(
        "PlayBar component",
        (v) => typeof v === "function" && (v as any).s_setGameInfoVisible instanceof Set && Array.isArray((v as any).s_rgFakeDetails),
    );
    if (!targetPlayBar || targetPlayBar.__nsga_playbar_patched) return;
    targetPlayBar.__nsga_playbar_patched = true;
    hookPlayBarProps(targetPlayBar);

    const origPlayBarRender = targetPlayBar.prototype.render;
    if (typeof origPlayBarRender === "function") {
        targetPlayBar.prototype.render = function () {
            if (!on()) return origPlayBarRender.apply(this, arguments);
            try {
                deps.track(this);
                const overview = this.props?.overview;
                if (overview) {
                    deps.hookOverview(overview);
                }
                if (overview && isShortcutOverview(overview)) {
                    this.props = {
                        ...this.props,
                        overview: createPatchedOverview(overview),
                    };
                }
            } catch (err) {
                deps.reportError("playbar", err); // fail-open (plan § 7.0 D6)
            }
            return origPlayBarRender.apply(this, arguments);
        };
    }
    logger.info(
        "Successfully patched Steam PlayBar component (show/hide game details ⓘ button restored).",
    );
}

export function createPlaybarSurface(d: typeof deps): Surface {
    deps = d;
    return {
        id: "playbar",
        touches: ["PlayBar.render", "PlayBar.props"],
        reads: ["metadata"],
        install: patchPlayBar,
        render() {
            /* record-driven from M5 (plan § 7.0 D4) */
        },
        clear() {},
        uninstall() {
            /* the patch stays until Steam restarts, as before M3.4 */
        },
    };
}
