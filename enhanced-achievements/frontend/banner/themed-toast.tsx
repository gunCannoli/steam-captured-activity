import React, { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { IconsModule } from '@steambrew/client';
import { logger } from '../logger';
import { activeTheme } from '../theme/active-theme';
import type { AnchorPosition, IconSlot, ResolvedTier } from '../theme/theme';
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

    const scaleX = banner.scale[0] / 100;
    const scaleY = banner.scale[1] / 100;
    const background =
        banner.background.length > 1
            ? `linear-gradient(${banner.gradientAngle}deg, ${banner.background.join(', ')})`
            : banner.background[0];

    const textAlign = text.align ?? theme.textAlign ?? 'left';
    const textJustify = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start';

    const rootStyle = {
        '--ea-scale-x': String(scaleX),
        '--ea-scale-y': String(scaleY),
        '--ea-scale': String(scaleX),
        '--ea-margin-y': `${banner.margin[0]}px`,
        '--ea-margin-x': `${banner.margin[1]}px`,
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

    useEffect(() => {
        const targetWindow = (rootRef.current?.ownerDocument?.defaultView as (Window & typeof globalThis) | null) || (typeof window !== 'undefined' ? window : null);
        if (!targetWindow || !targetWindow.SteamClient?.Window) return undefined;
        let t1: ReturnType<typeof setTimeout> | undefined;
        let t2: ReturnType<typeof setTimeout> | undefined;
        try {
            const w = targetWindow.SteamClient.Window;
            const sx = (banner.scale?.[0] ?? 100) / 100;
            const sy = (banner.scale?.[1] ?? 100) / 100;
            const defaultBaseW = (theme.layout === 'ps5' || theme.layout === 'custom' || theme.layout === 'default_system_right') ? 400 : 283;
            const baseW = banner.width ?? defaultBaseW;
            const baseH = banner.height ?? (theme.layout === 'compact_pill' ? 48 : 70);
            const targetW = Math.round(baseW * sx);
            const targetH = Math.round(baseH * sy);

            w.ResizeTo(targetW, targetH, true);

            const screen = targetWindow.screen;
            const availW = (screen?.availWidth && screen.availWidth > 100) ? screen.availWidth : 1920;
            const availH = (screen?.availHeight && screen.availHeight > 100) ? screen.availHeight : 1080;
            const screenLeft = (screen as unknown as { availLeft?: number })?.availLeft ?? 0;
            const screenTop = (screen as unknown as { availTop?: number })?.availTop ?? 0;
            const marginX = banner.margin?.[1] ?? 0;
            const marginY = banner.margin?.[0] ?? 0;

            const pos = theme.position ?? 'bottomright';
            let targetX = screenLeft + availW - targetW - marginX;
            let targetY = screenTop + availH - targetH - marginY;

            switch (pos) {
                case 'topleft':
                    targetX = screenLeft + marginX;
                    targetY = screenTop + marginY;
                    break;
                case 'topright':
                    targetX = screenLeft + availW - targetW - marginX;
                    targetY = screenTop + marginY;
                    break;
                case 'topcenter':
                    targetX = screenLeft + Math.round((availW - targetW) / 2);
                    targetY = screenTop + marginY;
                    break;
                case 'bottomleft':
                    targetX = screenLeft + marginX;
                    targetY = screenTop + availH - targetH - marginY;
                    break;
                case 'bottomright':
                    targetX = screenLeft + availW - targetW - marginX;
                    targetY = screenTop + availH - targetH - marginY;
                    break;
                case 'bottomcenter':
                    targetX = screenLeft + Math.round((availW - targetW) / 2);
                    targetY = screenTop + availH - targetH - marginY;
                    break;
            }

            const moveToTarget = () => {
                try {
                    (w.MoveTo as (x: number, y: number, dpi?: boolean | number) => void)(targetX, targetY, true);
                } catch {}
            };
            moveToTarget();
            t1 = setTimeout(moveToTarget, 100);
            t2 = setTimeout(moveToTarget, 300);
        } catch (e) {
            logger.warn('Could not position/resize toast window:', e);
        }
        return () => {
            if (t1) clearTimeout(t1);
            if (t2) clearTimeout(t2);
        };
    }, [banner.scale, banner.margin, banner.width, banner.height, theme.position, theme.layout]);

    const SteamLogo = (IconsModule as Record<string, React.ComponentType | undefined> | undefined)?.SteamLogo;

    const isExceptional = tier.tier === 'exceptional';
    const displayTitle = (isExceptional && tier.text.titleText) || data.name();
    const displayDesc = (isExceptional && tier.text.descText) || data.description();

    const titleStyle = {
        color: text.title.color,
        '--ea-title-size': `calc(${text.title.sizePct / 100} * 14px * var(--ea-scale-y, 1))`,
        ...fontWeight(text.title.style),
    } as React.CSSProperties;

    const descStyle = {
        color: text.desc.color,
        '--ea-desc-size': `calc(${text.desc.sizePct / 100} * 12px * var(--ea-scale-y, 1))`,
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
