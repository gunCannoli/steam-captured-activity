// Surface `captures`: what the composition root gives it (migration plan M3.2, § 7.0 D3/D6).
// Set once by createCapturesSurface; open defaults until then.
import type { SurfaceDeps } from "../../kernel/surface";

export interface ActivityOptions {
    /** Show Steam's "Added to library" event (setting activityShowAddedToLibrary). */
    showAdded: boolean;
    /** Show Steam's "Played for the first time" event (setting activityShowFirstPlayed). */
    showFirstPlayed: boolean;
}

export const deps: SurfaceDeps & { activityOptions(): ActivityOptions } = {
    isEnabled: () => true,
    reportError: () => {},
    activityOptions: () => ({ showAdded: true, showFirstPlayed: true }),
};
