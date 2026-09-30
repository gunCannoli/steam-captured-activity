import type { Events } from '../../kernel/events';
import type { Surface } from '../../kernel/surface';
import { isEnabled } from '../../safety/runtime';
import { tierFor } from '../../theme/active-theme';
import { disposeCaptures, onUnlock } from './captures';
import { initRecording } from './recording';

/** Takes screenshots and clips through Steam's Game Recording service and marks the timeline. */
export function createCapturesSurface(): Surface {
    return {
        id: 'captures',
        touches: ['GameRecording.TakeScreenshot', 'GameRecording.SaveClip', 'GameRecording.UserAddTimelineEntry'],
        install: () => initRecording(), // false = no recording service: captures stay off, nothing else does
        uninstall: () => disposeCaptures(),
    };
}

/** The `achievement.unlocked` subscriber. Runs one macrotask after the toast is shown, never inside Steam's call; onUnlock reports its own errors. */
export function capturesHandler(e: Events['achievement.unlocked']): void {
    if (isEnabled('captures')) onUnlock(e.n, tierFor(e.n));
}
