import type { EventBus } from '../../kernel/events';
import type { NotificationHook } from '../../steam/notification-hook';
import { isAchievementUnlock, progressFor } from '../../steam/notification-store';
import { createUnlockSensor } from './unlock';

/** Wire the unlock sensor to the hook: one `achievement.unlocked` per unlock, one macrotask after Steam's call. */
export function installUnlockSensor(hook: NotificationHook, bus: EventBus): () => void {
    return hook.onShown(
        createUnlockSensor({
            isAchievementUnlock,
            progressFor,
            emit: (payload) => bus.emit('achievement.unlocked', payload),
            defer: (fn) => void setTimeout(fn, 0),
            now: Date.now,
        }),
    );
}
