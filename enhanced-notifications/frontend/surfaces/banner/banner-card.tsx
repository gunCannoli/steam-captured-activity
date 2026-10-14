import React, { type ReactNode, type Ref } from 'react';
import { IconsModule } from '@steambrew/client';
import type { AchievementTheme, AnchorPosition, IconSlot, ResolvedTier } from '../../theme/achievements';
import type { Phase } from '../../banner/queue';
import { BANNER_CSS } from '../../banner/styles';

/**
 * The achievement banner's markup (theme creator plan § 6.4, D7): what the real banner (./themed-toast.tsx) renders
 * and what the Theme Creator's preview shows, injected into it by index.tsx, so the preview cannot drift from the
 * banner. Presentational: every value comes in as a prop; it starts nothing and writes nothing into Steam.
 *
 * Supports the PS5-style layout, custom anchor placement, and the classic layouts.
 */
export interface BannerCardProps {
    theme: AchievementTheme;
    tier: ResolvedTier;
    /** Asset path -> data URL. */
    assets: ReadonlyMap<string, string>;
    /** The achievement's own name, description and art (the Exceptional tier may replace the words). */
    title: string;
    description: string;
    imageUrl: string | null;
    phase: Phase;
    /** banner/geometry.ts `bannerSize` (`innerH` sets the text area's height). */
    size: { innerH: number };
    /** banner/timing.ts `bannerTiming`. */
    timing: { inMs: number; outMs: number; displayMs: number };
    onClick?: () => void;
    rootRef?: Ref<HTMLDivElement>;
}

function iconUrl(slot: IconSlot, steamDefault: string | null, assets: ReadonlyMap<string, string>): string | null {
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

export function BannerCard({ theme, tier, assets, title, description, imageUrl, phase, size, timing, onClick, rootRef }: BannerCardProps) {
    const banner = tier.banner;
    const { text, icons } = tier;

    if (phase === 'waiting') {
        // The root stays mounted (ref, pin) but paints nothing and hides Steam's popup chrome.
        return (
            <div ref={rootRef} className="ea-banner ea-waiting">
                <style>{BANNER_CSS}</style>
            </div>
        );
    }

    const background =
        banner.background.length > 1
            ? `linear-gradient(${banner.gradientAngle}deg, ${banner.background.join(', ')})`
            : banner.background[0];

    const textAlign = theme.textAlign;
    const textJustify = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start';

    const rootStyle = {
        '--ea-inner-h': `${size.innerH}px`,
        '--ea-pad': `${banner.padding.top}px ${banner.padding.right}px ${banner.padding.bottom}px ${banner.padding.left}px`,
        '--ea-gap-x': `${banner.gap[0]}px`,
        '--ea-gap-y': `${banner.gap[1]}px`,
        '--ea-text-align': textAlign,
        '--ea-text-justify': textJustify,
        '--ea-in-ms': `${timing.inMs}ms`,
        '--ea-out-ms': `${timing.outMs}ms`,
        '--ea-display-ms': `${timing.displayMs}ms`,
        background,
        border: banner.border.width > 0 ? `${banner.border.width}px solid ${banner.border.color}` : 'none',
        borderRadius: `${banner.border.radius}px`,
        ...(theme.hover.color ? { '--ea-hover-bg': theme.hover.color } : {}),
    } as React.CSSProperties;

    const SteamLogo = (IconsModule as Record<string, React.ComponentType | undefined> | undefined)?.SteamLogo;

    const isExceptional = tier.tier === 'exceptional';
    const displayTitle = (isExceptional && tier.text.titleText) || title;
    const displayDesc = (isExceptional && tier.text.descText) || description;

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
            : iconUrl(icons.achievement, imageUrl || null, assets);

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
            className={`ea-banner ea-layout-${theme.layout} ea-in-${theme.animation.in} ea-out-${theme.animation.out} ea-pos-${theme.position} ea-tier-${tier.tier}${theme.hover.enabled ? '' : ' ea-hover-off'}${phase === 'done' ? ' ea-done' : ''}`}
            style={rootStyle}
            onClick={onClick}
        >
            <style>{BANNER_CSS}</style>
            {content}
        </div>
    );
}
