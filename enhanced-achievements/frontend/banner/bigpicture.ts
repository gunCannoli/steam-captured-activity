import type { Edges, ToastPosition } from '../theme/theme';

/**
 * Big Picture has one toast place: a `position: fixed` placeholder div Steam renders into the Big Picture window,
 * measured by Steam each time a toast shows (docs/steam-components.md § Big Picture toast view). By default
 * enhanced-notifications' theme decides it, for every toast. With "Force achievement position in Big Picture" on,
 * this plugin moves the placeholder to its own theme's corner and margin while an achievement toast shows (ADR-0049).
 *
 * The selector repeats Steam's readable class name, so it outranks enhanced-notifications' `:is(.hash)` rule and
 * Steam's own position classes (both one or two classes); every declaration is `!important`, as theirs are. Pure.
 */
export const PLACEHOLDER_SELECTOR = '.GamepadToastPlaceholder.GamepadToastPlaceholder.GamepadToastPlaceholder';

export function bigPicturePlaceholderCss(position: ToastPosition, margin: Edges): string {
    const decls = [
        position.startsWith('top_') ? `top: ${margin.top}px !important; bottom: auto !important;` : `bottom: ${margin.bottom}px !important; top: auto !important;`,
        position.endsWith('_left')
            ? `left: ${margin.left}px !important; right: auto !important;`
            : position.endsWith('_right')
              ? `right: ${margin.right}px !important; left: auto !important;`
              : 'left: 0 !important; right: 0 !important; margin-left: auto !important; margin-right: auto !important;',
    ];
    return `${PLACEHOLDER_SELECTOR} { ${decls.join(' ')} }\n`;
}
