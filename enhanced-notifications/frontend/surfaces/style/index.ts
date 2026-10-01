import type { Surface } from '../../kernel/surface';
import type { NotificationHook } from '../../steam/notification-hook';
import { installInjector, uninstallInjector } from './injector';

/** Restyles Steam's toast windows in place: one scoped `<style>` per window and the shown type on its `<body>`. */
export function createStyleSurface(hook: NotificationHook, placeholder: string | undefined): Surface {
    return {
        id: 'style',
        touches: ['toastWindow <style id=enhanced-notifications-theme>', 'toastWindow body data-en-type'],
        install: () => installInjector(placeholder, hook.onShown),
        uninstall: uninstallInjector,
    };
}
