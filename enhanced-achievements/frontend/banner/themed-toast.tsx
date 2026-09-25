import React, { Component, useLayoutEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { IconsModule } from '@steambrew/client';
import { logger } from '../logger';
import { activeTheme } from '../theme/active-theme';
import type { AnchorPosition, IconSlot, ResolvedTier } from '../theme/theme';
import { tierFor, type SteamNotification } from '../steam/notifications';
import { BANNER_CSS } from './styles';
import { bannerSize, placeBanner } from './geometry';
import { pinToastWindow } from './window-pin';

/**
 * The themed achievement banner, rendered in place of Steam's toast
 * dispatcher (steam/toast-patch.ts).
 *
 * Steam keeps everything around it: the toast window, queue, timing and
 * dismissal. Any failure renders Steam's own toast instead, through an error
 * boundary, so a theme bug can never blank a notification.
 *
 * Supports the authentic PS5 layout, custom anchor placement, and classic layouts.
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

function Icon({
    url,
    scalePct = 100,
    rippleMs = 0,
    className,
    fallback,
    style,
}: {
    url: string | null;
    scalePct?: number;
    rippleMs?: number;
    className: string;
    fallback?: ReactNode;
    style?: React.CSSProperties;
}) {
    if (!url && !fallback) return null;
    const combinedStyle = {
        '--ea-icon-scale': String(scalePct / 100),
        '--ea-ripple': rippleMs > 0 ? `${rippleMs}ms` : undefined,
        ...style,
    } as React.CSSProperties;

    return (
        <div className={`ea-icon ${className}`} style={combinedStyle}>
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
    const banner = tier.banner ?? tier.box;
    const { text, icons } = tier;
    const data = n.data;
    const size = bannerSize(theme.layout, banner);

    const background =
        banner.background.length > 1
            ? `linear-gradient(${banner.gradientAngle}deg, ${banner.background.join(', ')})`
            : banner.background[0];

    const textAlign = text.align ?? theme.textAlign ?? 'left';
    const textJustify = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start';

    const rootStyle = {
        '--ea-inner-h': `${size.innerH}px`,
        '--ea-pad-y': `${banner.padding[0]}px`,
        '--ea-pad-x': `${banner.padding[1]}px`,
        '--ea-gap-x': `${banner.gap[0]}px`,
        '--ea-gap-y': `${banner.gap[1]}px`,
        '--ea-glow': banner.glow.color,
        '--ea-glow-spread': `${banner.glow.spread}px`,
        '--ea-glow-pulse': `${banner.glow.pulseMs}ms`,
        '--ea-text-align': textAlign,
        '--ea-text-justify': textJustify,
        background,
        border: banner.border.width > 0 ? `${banner.border.width}px solid ${banner.border.color}` : 'none',
        borderRadius: `${banner.border.radius}px`,
    } as React.CSSProperties;

    const rootRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const win = rootRef.current?.ownerDocument?.defaultView;
        if (!win) return undefined;
        const s = win.screen as Screen & { availLeft?: number; availTop?: number };
        const avail = { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
        const unpin = pinToastWindow(win, (slot) => ({
            ...placeBanner(theme.position, banner.margin, size, avail, slot),
            width: size.width,
            height: size.height,
        }));
        return unpin ?? undefined;
        // Pinned once per toast: a toast's theme does not change while it is shown.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const SteamLogo = (IconsModule as Record<string, React.ComponentType | undefined> | undefined)?.SteamLogo;

    const isExceptional = tier.tier === 'exceptional';
    const displayTitle = (isExceptional && tier.text.titleText) || data.name();
    const displayDesc = (isExceptional && tier.text.descText) || data.description();

    const titleStyle = {
        color: text.title.color,
        '--ea-title-size': `calc(${text.title.sizePct / 100} * 14px)`,
        ...fontWeight(text.title.style),
    } as React.CSSProperties;

    const descStyle = {
        color: text.desc.color,
        '--ea-desc-size': `calc(${text.desc.sizePct / 100} * 12px)`,
        ...fontWeight(text.desc.style),
    } as React.CSSProperties;

    // Elements
    const achievementUrl =
        isExceptional && typeof icons.achievement.source === 'string'
            ? (assets.get(icons.achievement.source) ?? null)
            : iconUrl(icons.achievement, data.image_url() || null, assets);

    const AchievementIcon = (className = 'ea-achievement') => (
        <Icon
            key="achievement"
            url={achievementUrl}
            scalePct={icons.achievement.scalePct}
            rippleMs={icons.achievement.rippleMs}
            className={className}
        />
    );

    const SystemIcon = (className = 'ea-system') => (
        <Icon
            key="system"
            url={iconUrl(icons.system, null, assets)}
            scalePct={icons.system.scalePct}
            rippleMs={icons.system.rippleMs}
            className={className}
            fallback={icons.system.source === true && SteamLogo ? <SteamLogo /> : undefined}
        />
    );

    const RarityIcon = (className = 'ea-rarity') => (
        <Icon
            key="rarity"
            url={iconUrl(icons.rarity, null, assets)}
            scalePct={icons.rarity.scalePct}
            rippleMs={icons.rarity.rippleMs}
            className={className}
        />
    );

    // Render by layout mode
    let content: ReactNode = null;

    if (theme.layout === 'ps5') {
        content = (
            <>
                <div className="ea-zone-left">{AchievementIcon()}</div>
                <div className="ea-zone-center">
                    <div className="ea-row-title">
                        {RarityIcon('ea-anchored-icon ea-rarity')}
                        <div className="ea-title" style={titleStyle}>
                            {displayTitle}
                        </div>
                    </div>
                    <div className="ea-row-desc">
                        <div className="ea-desc" style={descStyle}>
                            {displayDesc}
                        </div>
                    </div>
                </div>
                <div className="ea-zone-right">{SystemIcon()}</div>
            </>
        );
    } else if (theme.layout === 'custom' && theme.customLayout) {
        const cl = theme.customLayout;
        const inSlot = (pos: AnchorPosition) => {
            const list: ReactNode[] = [];
            if (cl.achievement === pos) list.push(AchievementIcon(pos.includes('title') || pos.includes('desc') ? 'ea-anchored-icon ea-achievement' : 'ea-achievement'));
            if (cl.rarity === pos) list.push(RarityIcon(pos.includes('title') || pos.includes('desc') ? 'ea-anchored-icon ea-rarity' : 'ea-rarity'));
            if (cl.system === pos) list.push(SystemIcon(pos.includes('title') || pos.includes('desc') ? 'ea-anchored-icon ea-system' : 'ea-system'));
            return list;
        };

        content = (
            <>
                <div className="ea-zone-left">
                    {inSlot('left')}
                    {inSlot('achievement_left')}
                </div>
                <div className="ea-zone-center">
                    <div className="ea-row-title">
                        {inSlot('title_left')}
                        <div className="ea-title" style={titleStyle}>
                            {displayTitle}
                        </div>
                        {inSlot('title_right')}
                    </div>
                    <div className="ea-row-desc">
                        {inSlot('desc_left')}
                        <div className="ea-desc" style={descStyle}>
                            {displayDesc}
                        </div>
                        {inSlot('desc_right')}
                    </div>
                </div>
                <div className="ea-zone-right">
                    {inSlot('right')}
                    {inSlot('achievement_right')}
                </div>
            </>
        );
    } else {
        // Classic default_steam, default_system_right, compact_pill
        const showSystem = theme.layout === 'default_system_right';
        content = (
            <>
                {AchievementIcon()}
                <div className="ea-text">
                    <div className="ea-title" style={titleStyle}>
                        {displayTitle}
                    </div>
                    {theme.layout !== 'compact_pill' && (
                        <div className="ea-desc" style={descStyle}>
                            {displayDesc}
                        </div>
                    )}
                </div>
                <div className="ea-badges">
                    {RarityIcon()}
                    {showSystem && SystemIcon()}
                </div>
            </>
        );
    }

    return (
        <div
            ref={rootRef}
            className={`ea-banner ea-layout-${theme.layout} ea-anim-${theme.animation} ea-tier-${tier.tier}${banner.glow.spread > 0 ? ' ea-glow' : ''}${banner.glow.pulseMs > 0 ? ' ea-pulse' : ''}`}
            style={rootStyle}
            onClick={toast.onDismiss}
        >
            <style>{BANNER_CSS}</style>
            {content}
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
