import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { IconsModule } from '@steambrew/client';
import { logger } from '../logger';
import { activeTheme } from '../theme/active-theme';
import type { IconSlot, ResolvedTier } from '../theme/theme';
import { tierFor, type SteamNotification } from '../steam/notifications';
import { BANNER_CSS } from './styles';

/**
 * The themed achievement banner, rendered in place of Steam's toast
 * dispatcher (steam/toast-patch.ts).
 *
 * Steam keeps everything around it: the toast window, queue, timing and
 * dismissal. Any failure renders Steam's own toast instead, through an error
 * boundary, so a theme bug can never blank a notification.
 *
 * Styling is ours by definition (the theme *is* the custom look), but every
 * rule is scoped under `.ea-banner` and none targets Steam's hashed classes.
 */

interface ToastProps {
    location?: number;
    group?: { notifications?: SteamNotification[] };
    onDismiss?: () => void;
}

let steamToast: unknown = null;

/** The original dispatcher, for fallbacks. Set once by toast-patch.ts. */
export function setSteamToast(component: unknown): void {
    steamToast = component;
}

/** createElement is not the patched jsx runtime, so this cannot recurse into us. */
function renderSteam(props: ToastProps): ReactNode {
    return steamToast ? React.createElement(steamToast as React.ComponentType<ToastProps>, props) : null;
}

class Fallback extends Component<{ toast: ToastProps; children: ReactNode }, { failed: boolean }> {
    override state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        logger.error('Themed banner failed; showing Steam toast.', error, info.componentStack);
    }

    override render(): ReactNode {
        return this.state.failed ? renderSteam(this.props.toast) : this.props.children;
    }
}

function iconUrl(slot: IconSlot, steamDefault: string | null, assets: Map<string, string>): string | null {
    if (slot.source === false) return null;
    if (slot.source === true) return steamDefault;
    return assets.get(slot.source) ?? null;
}

function Icon({ url, rippleMs, className, fallback }: { url: string | null; rippleMs: number; className: string; fallback?: ReactNode }) {
    if (!url && !fallback) return null;
    return (
        <div className={`ea-icon ${className}`} style={rippleMs > 0 ? ({ '--ea-ripple': `${rippleMs}ms` } as React.CSSProperties) : undefined}>
            {rippleMs > 0 && <span className="ea-ripple" />}
            {url ? <img src={url} alt="" draggable={false} /> : fallback}
        </div>
    );
}

function fontWeight(style: string): React.CSSProperties {
    return style === 'bold' ? { fontWeight: 700 } : style === 'italic' ? { fontStyle: 'italic', fontWeight: 400 } : { fontWeight: 400 };
}

function Banner({ toast }: { toast: ToastProps }) {
    const loaded = activeTheme();
    const n = toast.group?.notifications?.[0];
    if (!loaded || !n) return <>{renderSteam(toast)}</>;

    const { theme, assets } = loaded;
    const tier: ResolvedTier = theme.tiers[tierFor(n)];
    const { box, text, icons } = tier;
    const data = n.data;

    const scale = box.scale[0] / 100;
    const background =
        box.background.length > 1 ? `linear-gradient(${box.gradientAngle}deg, ${box.background.join(', ')})` : box.background[0];

    const rootStyle = {
        '--ea-scale': String(scale),
        '--ea-glow': box.glow.color,
        '--ea-glow-spread': `${box.glow.spread}px`,
        '--ea-glow-pulse': `${box.glow.pulseMs}ms`,
        background,
        border: box.border.width > 0 ? `${box.border.width}px solid ${box.border.color}` : 'none',
        borderRadius: `${box.border.radius}px`,
    } as React.CSSProperties;

    const SteamLogo = (IconsModule as Record<string, React.ComponentType | undefined> | undefined)?.SteamLogo;
    const showSystem = theme.layout === 'default_system_right';

    return (
        <div
            className={`ea-banner ea-layout-${theme.layout} ea-anim-${theme.animation} ea-tier-${tier.tier}${box.glow.spread > 0 ? ' ea-glow' : ''}${box.glow.pulseMs > 0 ? ' ea-pulse' : ''}`}
            style={rootStyle}
            onClick={toast.onDismiss}
        >
            <style>{BANNER_CSS}</style>
            <Icon url={iconUrl(icons.achievement, data.image_url() || null, assets)} rippleMs={icons.achievement.rippleMs} className="ea-achievement" />
            <div className="ea-text">
                <div className="ea-title" style={{ color: text.title.color, '--ea-title-size': `calc(${text.title.sizePct / 100} * 14px * var(--ea-scale))`, ...fontWeight(text.title.style) } as React.CSSProperties}>
                    {data.name()}
                </div>
                {theme.layout !== 'compact_pill' && (
                    <div className="ea-desc" style={{ color: text.desc.color, '--ea-desc-size': `calc(${text.desc.sizePct / 100} * 12px * var(--ea-scale))`, ...fontWeight(text.desc.style) } as React.CSSProperties}>
                        {data.description()}
                    </div>
                )}
            </div>
            <div className="ea-badges">
                {tier.tier === 'exceptional' && (
                    <Icon url={iconUrl(icons.exceptional, null, assets)} rippleMs={icons.exceptional.rippleMs} className="ea-exceptional" />
                )}
                <Icon url={iconUrl(icons.rarity, null, assets)} rippleMs={icons.rarity.rippleMs} className="ea-rarity" />
                {showSystem && (
                    <Icon
                        url={iconUrl(icons.system, null, assets)}
                        rippleMs={icons.system.rippleMs}
                        className="ea-system"
                        fallback={icons.system.source === true && SteamLogo ? <SteamLogo /> : undefined}
                    />
                )}
            </div>
        </div>
    );
}

export function ThemedToast(props: ToastProps) {
    return (
        <Fallback toast={props}>
            <Banner toast={props} />
        </Fallback>
    );
}
