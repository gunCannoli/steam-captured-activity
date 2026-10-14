import React, { Component, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../../logger';
import { achievementTheme, tierFor, type LoadedAchievementTheme } from '../../theme/active-theme';
import type { ResolvedTier } from '../../theme/achievements';
import type { SteamNotification } from '../../kernel/notification';
import { notificationStore } from '../../steam/notification-store';
import { bannerSize, placeBanner } from '../../banner/geometry';
import { BannerCard } from './banner-card';
import { pinToastWindow, type PinnedWindow } from './window-pin';
import { setting } from '../../settings/settings';
import { admit, finish, forget, MAX_QUEUE, peek, phaseOf, subscribe, type Phase } from '../../banner/queue';
import { bannerTiming, themedDisplayMs } from '../../banner/timing';
import { reportError } from '../../safety/runtime';

/**
 * The themed achievement banner, rendered in place of Steam's toast
 * dispatcher (steam/toast-patch.ts).
 *
 * Steam keeps everything around it: the toast window, queue, timing and
 * dismissal. Any failure renders Steam's own toast instead, through an error
 * boundary, so a theme bug can never blank a notification.
 *
 * The markup is ./banner-card.tsx (shared with the Theme Creator's preview); this file keeps the queue, the window
 * pin, the popup hold and the timing.
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
        reportError('banner', error); // past the budget, later toasts are Steam's own
    }

    override render(): ReactNode {
        return this.state.failed ? renderSteam(this.props.toast) : this.props.children;
    }
}

/** Stable React key per notification, so a reused toast slot (Big Picture) remounts per toast. */
const toastKeys = new WeakMap<object, number>();
let nextToastKey = 1;
function toastKey(data: object): number {
    let k = toastKeys.get(data);
    if (k === undefined) toastKeys.set(data, (k = nextToastKey++));
    return k;
}

/**
 * Keep Steam's per-toast popup open until our scheduler says this toast is
 * done. Steam's desktop toast loop re-reads `fnNotificationResolved` on the
 * notification every frame while the toast is showing and, when it is set,
 * waits for it instead of `nToastDurationMS` (docs/steam-components.md §
 * Resolution signatures & toast windows). The cap guarantees the popup always
 * closes whatever happens to us. A resolver Steam set itself is never replaced.
 */
function holdPopup(n: SteamNotification, key: object, capMs: number): void {
    if (n.fnNotificationResolved) return;
    const until = Date.now() + capMs;
    n.fnNotificationResolved = () => phaseOf(key) === 'done' || Date.now() > until;
}

/**
 * Big Picture's toast window is created hidden and its document timeline does
 * not tick until the window first paints, so it reads 0 while the banner mounts.
 * CSS animations created then start at time 0; on the first frame the timeline
 * jumps to the window's age and the entrance AND exit (delayed by the display
 * time) both land on their end state: opacity 0, an invisible banner (found live
 * 2026-09-30, docs/steam-debug.md). Once the window is really painting (two
 * frames), restart any banner animation that started on that frozen clock.
 * Returns a cancel function.
 */
function restartFrozenAnimations(el: HTMLElement): () => void {
    const win = el.ownerDocument.defaultView;
    if (!win) return () => {};
    let outer = 0;
    let inner = 0;
    outer = win.requestAnimationFrame(() => {
        inner = win.requestAnimationFrame(() => {
            for (const a of el.getAnimations()) {
                if (a.startTime === 0 && /^ea-(in|out)/.test((a as CSSAnimation).animationName ?? '')) a.currentTime = 0;
            }
        });
    });
    return () => {
        win.cancelAnimationFrame(outer);
        win.cancelAnimationFrame(inner);
    };
}

/** Snapshots the theme at mount: a toast keeps the theme it arrived with, even across a reload. */
function Banner({ toast }: { toast: ToastProps }) {
    const [loaded] = useState(achievementTheme);
    const n = toast.group?.notifications?.[0];
    if (!loaded || !n) return <>{renderSteam(toast)}</>;
    return <ThemedBanner key={toastKey(n.data)} loaded={loaded} n={n} onDismiss={toast.onDismiss} />;
}

/**
 * Every hook runs on every render, whatever the phase: an early return above
 * a hook is what broke the old queue (React threw "rendered more hooks" when a
 * queued toast got its turn, and the error boundary fell back to Steam's
 * unpinned stock toast).
 */
function ThemedBanner({ loaded, n, onDismiss }: { loaded: LoadedAchievementTheme; n: SteamNotification; onDismiss?: () => void }) {
    const key = n.data;
    const { theme, assets } = loaded;
    const tier: ResolvedTier = theme.tiers[tierFor(n)];
    const banner = tier.banner;
    const data = n.data;
    const size = bannerSize(theme.layout, banner);
    const timing = bannerTiming(theme.animation, themedDisplayMs(theme.displayTimeMs, notificationStore()?.achievement?.pristineMs));

    // Read once per toast: toggling the setting affects later toasts, not this one.
    const [queued] = useState(() => setting('queue.enabled'));
    // A render starts nothing (guardrail 17): the shell stays invisible until the mount effect admits the toast.
    const [phase, setPhase] = useState<Phase>(() => peek(key) ?? 'waiting');
    useEffect(() => {
        setPhase(phaseOf(key)); // it may have changed between render and subscribe
        return subscribe(key, () => setPhase(phaseOf(key)));
    }, [key]);

    const rootRef = useRef<HTMLDivElement>(null);
    const pinRef = useRef<PinnedWindow | null>(null);

    /** Queue on: always the anchor slot (one at a time). Waiting: 1x1, so it cannot catch clicks. */
    const targetFor = (slot: number, p: Phase, win: Window) => {
        const s = win.screen as Screen & { availLeft?: number; availTop?: number };
        const avail = { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
        const at = placeBanner(theme.position, banner.margin, size, avail, queued ? 0 : slot);
        return p === 'waiting' ? { ...at, width: 1, height: 1 } : { ...at, width: size.width, height: size.height };
    };

    useLayoutEffect(() => {
        // The one place a toast is admitted, before the pin reads its phase and before Steam asks for its sound.
        setPhase(admit(key, timing.totalMs, queued, () => logger.warn('Achievement toast queue full; showing out of turn.')));
        const win = rootRef.current?.ownerDocument?.defaultView;
        const pin = win ? pinToastWindow(win, (slot) => targetFor(slot, phaseOf(key), win)) : null;
        pinRef.current = pin;
        // Only per-toast popups (the ones we pin) are held; Big Picture's single
        // popup already shows one toast at a time, on Steam's own timer.
        if (pin) holdPopup(n, key, timing.totalMs * (MAX_QUEUE + 2) + 10_000);
        return () => {
            pin?.unpin();
            pinRef.current = null;
            forget(key);
        };
        // Once per toast: its theme and size are fixed at mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Every time the banner starts showing (its CSS animations are created then), not only at mount.
    useEffect(() => (phase === 'showing' && rootRef.current ? restartFrozenAnimations(rootRef.current) : undefined), [phase]);

    useLayoutEffect(() => {
        const pin = pinRef.current;
        const win = rootRef.current?.ownerDocument?.defaultView;
        if (pin && win && phase === 'showing') pin.retarget(targetFor(pin.slot, phase, win));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    const dismiss = () => {
        finish(key);
        onDismiss?.();
    };

    return (
        <BannerCard
            theme={theme}
            tier={tier}
            assets={assets}
            title={data.name()}
            description={data.description()}
            imageUrl={data.image_url() || null}
            phase={phase}
            size={size}
            timing={timing}
            onClick={dismiss}
            rootRef={rootRef}
        />
    );
}

export function ThemedToast(props: ToastProps) {
    return (
        <Fallback toast={props}>
            <Banner toast={props} />
        </Fallback>
    );
}
