// Surface `game-info`: what the composition root gives it (migration plan M3.3, § 7.0 D3/D6).
// Set once by createGameInfoSurface; open defaults until then.
import type { GameMetadata } from "../../kernel/record";
import type { SurfaceDeps } from "../../kernel/surface";
import type { ControllerContext } from "./category-policy";

export const deps: SurfaceDeps & {
    /** O(1) controller context of a shortcut (features/game-info/controller.ts). */
    controllerContext(appid: number): ControllerContext;
    /** O(1) cached Game Info of a shortcut (records.get(appid)?.metadata?.data, M5b). */
    metadataOf(appid: number): GameMetadata | undefined;
} = {
    isEnabled: () => true,
    reportError: () => {},
    controllerContext: () => ({}),
    metadataOf: () => undefined,
};
