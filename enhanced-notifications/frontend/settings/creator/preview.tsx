import { useEffect, useMemo, useState, type ComponentType, type Ref } from "react";
import { Dropdown, Field, PanelSection } from "@steambrew/client";
import type { AchievementTheme, ResolvedTier, Tier } from "../../theme/achievements";
import { buildAnimationCss, buildCss, soundSpecFor, STEAM_TEMPLATE_HEIGHT, type ResolvedTheme, type ThemeMode, type ToastSelectors } from "../../theme/theme";
import { placeToast, STEAM_TOAST_HEIGHT, STEAM_TOAST_WIDTH } from "../../theme/placement";
import { bannerSize, placeBanner } from "../../banner/geometry";
import { bannerTiming, themedDisplayMs } from "../../banner/timing";
import type { Phase } from "../../banner/queue";
import { Blocks, ButtonRow, ControlledToggleRow, FullWidthRows, IconButton, ItemRow } from "../rows";
import { useCreator } from "./controls";
import { DEFAULT_CHOSEN, previewItems, PREVIEW_SETS, randomFour, sampleFor, SAMPLE_ACHIEVEMENT, type PreviewItem, type PreviewSetId } from "./model";
import { describeSound, play } from "./sounds";
import { TIER_NAMES } from "./pages";

/**
 * The preview column (theme creator plan § 4.6): the stage (sticky) with the draft's toasts as the chosen mode draws
 * them (desktop's 283 x 70 card, Big Picture's card in its 300 x 80 frame), then the set, the mode switch, sounds,
 * replay and Test on screen. Notification toasts are a mock of Steam's toast parts styled by the plugin's own CSS
 * builder through a selector set for the mock (so the stage needs nothing from Steam's stylesheets); achievement
 * banners are the real banner's markup (BannerCard, injected). Writes nothing into Steam.
 */

/** The props the creator passes to the injected banner markup (surfaces/banner/banner-card.tsx has the same shape). */
export interface CreatorBannerProps {
    theme: AchievementTheme;
    tier: ResolvedTier;
    assets: ReadonlyMap<string, string>;
    title: string;
    description: string;
    imageUrl: string | null;
    phase: Phase;
    size: { innerH: number };
    timing: { inMs: number; outMs: number; displayMs: number };
    onClick?: () => void;
    rootRef?: Ref<HTMLDivElement>;
}

/** A game from the library for the samples (index.tsx reads Steam); null: a neutral placeholder. */
export interface SampleGame {
    name: string;
    iconUrl: string | null;
    achievement: { name: string; description: string; iconUrl: string | null } | null;
}

/** The mock's class names: the plugin's CSS builder writes the theme's rules against these. */
const MOCK: Required<ToastSelectors> = {
    desktopPopup: ".enm-desktop-popup",
    gamepadPopup: ".enm-gamepad-popup",
    watermark: ".enm-watermark",
    templates: ".enm-template",
    shortTemplate: ".enm-short",
    title: ".enm-title",
    body: ".enm-body",
    subtext: ".enm-subtext",
    logoBox: ".enm-logo-box",
    appLogo: ".enm-app-logo",
    headerIcon: ".enm-header-icon",
    desktopTemplate: ".enm-desktop-template",
    content: ".enm-content",
};
const ROOT = "[data-en-creator-toast]";
/** A display time long enough that the preview never plays the exit unless looping. */
const STILL_MS = 1_000_000_000;

/** Steam's own toast look (measured live; docs/steam-components.md § Theme Creator preview), under the theme's rules. */
const BASELINE_CSS = `
${ROOT} { position: relative; font-family: "Motiva Sans", Arial, sans-serif; }
${ROOT} .enm-desktop-popup { position: relative; width: ${STEAM_TOAST_WIDTH}px; height: ${STEAM_TOAST_HEIGHT}px; box-sizing: border-box; overflow: hidden;
  background: linear-gradient(135deg, #3d4450 0%, #23262e 100%); box-shadow: 0 0 6px rgba(0,0,0,.5); color: #b8bcbf; }
${ROOT} .enm-desktop-popup::before { content: ""; position: absolute; inset: 0; opacity: 0; transition: opacity .3s linear;
  background: radial-gradient(155.42% 100% at 0% 0%, rgb(31, 42, 57) 0px, rgb(31, 42, 57) 0%, rgba(26, 160, 255, 0.325) 100%); }
${ROOT} .enm-desktop-popup:hover::before { opacity: .5; }
${ROOT} .enm-watermark { position: absolute; right: -14px; bottom: -22px; width: 82px; height: 82px; opacity: .05; color: #fff; pointer-events: none; }
${ROOT} .enm-desktop-template { position: relative; display: flex; align-items: center; padding: 10px; height: ${STEAM_TEMPLATE_HEIGHT.desktop - 20}px; }
${ROOT} .enm-gamepad-popup { width: 300px; height: 80px; display: flex; align-items: center; justify-content: center; }
${ROOT} .enm-gamepad-popup > * { width: 288px; border-radius: 6px; overflow: hidden; box-sizing: border-box;
  background: #3b3e45; box-shadow: 0 4px 12px rgba(0,0,0,.6); color: #b8bcbf; padding: 10px 12px; }
${ROOT} .enm-short { display: flex; align-items: center; height: ${STEAM_TEMPLATE_HEIGHT.short}px; }
${ROOT} .enm-logo-box { flex: none; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; }
${ROOT} .enm-short .enm-logo-box { width: 40px; height: 40px; }
${ROOT} .enm-app-logo, ${ROOT} .enm-app-logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
${ROOT} .enm-glyph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #1a9fff22; color: #1a9fff; font-size: 22px; }
${ROOT} .enm-content { display: flex; flex-direction: column; justify-content: center; margin-left: 12px; min-width: 0; flex: 1; }
${ROOT} .enm-title { font-size: 11px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; }
${ROOT} .enm-header-icon { width: 12px; height: 12px; border-radius: 2px; background: #1a9fff; flex: none; }
${ROOT} .enm-body { font-size: 12px; color: #dcdedf; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${ROOT} .enm-subtext { font-size: 11px; color: #8f98a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${ROOT} .enm-banner-frame { position: relative; overflow: hidden; }
`;

const GLYPH: Record<string, string> = { download: "⤓", clip: "●", cloud: "☁", battery: "▮", system: "⚙", game: "▶" };

function SteamMark() {
    return (
        <svg className="enm-watermark" viewBox="0 0 36 36" fill="currentColor" aria-hidden>
            <circle cx="18" cy="18" r="16" />
        </svg>
    );
}

/** One notification toast as `mode` draws it. */
function MockToast({ id, mode, game, displayMs, durationMs }: { id: string; mode: ThemeMode; game: SampleGame | null; displayMs: number; durationMs: number }) {
    const s = sampleFor(id, game?.name ?? "Sample Game");
    const icon = s.icon === "game" || s.icon === "download" ? game?.iconUrl : null;
    const logo = (
        <div className="enm-logo-box">
            <div className="enm-app-logo">{icon ? <img src={icon} alt="" /> : <div className="enm-glyph">{GLYPH[s.icon]}</div>}</div>
        </div>
    );
    const content = (
        <div className="enm-content">
            <div className="enm-title">
                <span className="enm-header-icon" />
                {s.title}
            </div>
            <div className="enm-body">{s.body}</div>
            {s.subtext && mode === "desktop" && <div className="enm-subtext">{s.subtext}</div>}
        </div>
    );
    if (mode === "bigpicture") {
        return (
            <div data-en-creator-toast="" data-en-type={id} style={{ ["--toast-duration" as string]: `${durationMs}ms` }}>
                <div className="enm-gamepad-popup">
                    <div>
                        <div className="enm-template enm-short">
                            {logo}
                            {content}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div data-en-creator-toast="" data-en-type={id} style={{ ["--en-display-ms" as string]: `${displayMs}ms` }}>
            <div>
                <div className="enm-desktop-popup">
                    <SteamMark />
                    <div className="enm-template enm-desktop-template">
                        {logo}
                        {content}
                    </div>
                </div>
            </div>
        </div>
    );
}

interface StageProps {
    theme: ResolvedTheme | null;
    mode: ThemeMode;
    items: PreviewItem[];
    assets: ReadonlyMap<string, string>;
    BannerCard: ComponentType<CreatorBannerProps>;
    game: SampleGame | null;
    onScreen: boolean;
    loop: boolean;
    replay: number;
}

/** What one item draws: a banner (with its size) when the theme has an `achievements` block, else a toast. */
function itemSize(theme: ResolvedTheme | null, item: PreviewItem, mode: ThemeMode): { width: number; height: number } {
    if (item.kind === "achievement" && theme?.achievements) {
        if (mode === "bigpicture") return { width: 300, height: 80 };
        const size = bannerSize(theme.achievements.layout, theme.achievements.tiers[item.tier].banner);
        return { width: size.width, height: size.height };
    }
    return mode === "bigpicture" ? { width: 300, height: 80 } : { width: STEAM_TOAST_WIDTH, height: STEAM_TOAST_HEIGHT };
}

function Stage({ theme, mode, items, assets, BannerCard, game, onScreen, loop, replay }: StageProps) {
    const displayMs = loop ? (theme?.displayTimeMs ?? 5000) : STILL_MS;
    const css = useMemo(() => {
        if (!theme) return BASELINE_CSS;
        return BASELINE_CSS + buildAnimationCss(theme, MOCK, ROOT) + buildCss(theme.style, MOCK, ROOT);
    }, [theme]);
    const [cycle, setCycle] = useState(0);
    useEffect(() => {
        if (!loop) return;
        const anim = theme?.animation;
        const total = (anim ? 300 + 300 : 600) + displayMs + 600;
        const t = setInterval(() => setCycle((c) => c + 1), total);
        return () => clearInterval(t);
    }, [loop, displayMs, theme]);

    const draw = (item: PreviewItem, i: number) => {
        const key = `${replay}-${cycle}-${i}`;
        if (item.kind === "achievement" && theme?.achievements) {
            const ach = theme.achievements;
            const tier = ach.tiers[item.tier];
            const size = bannerSize(ach.layout, tier.banner);
            const timing = bannerTiming(ach.animation, loop ? themedDisplayMs(ach.displayTimeMs, 5000) : STILL_MS);
            const frame = itemSize(theme, item, mode);
            return (
                <div key={key} className="enm-banner-frame" style={{ width: frame.width, height: frame.height }}>
                    <BannerCard
                        theme={ach}
                        tier={tier}
                        assets={assets}
                        title={game?.achievement?.name ?? SAMPLE_ACHIEVEMENT.name}
                        description={game?.achievement?.description ?? SAMPLE_ACHIEVEMENT.description}
                        imageUrl={game?.achievement?.iconUrl ?? null}
                        phase="showing"
                        size={size}
                        timing={timing}
                    />
                </div>
            );
        }
        if (item.kind === "achievement") {
            // No banner: achievements look like every toast.
            const g = { name: game?.achievement?.name ?? SAMPLE_ACHIEVEMENT.name, iconUrl: game?.achievement?.iconUrl ?? game?.iconUrl ?? null, achievement: null };
            return <MockToast key={key} id="Achievement" mode={mode} game={g} displayMs={displayMs} durationMs={loop ? displayMs : STILL_MS} />;
        }
        return <MockToast key={key} id={item.id} mode={mode} game={game} displayMs={displayMs} durationMs={loop ? displayMs : STILL_MS} />;
    };

    if (!onScreen) {
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "12px 0" }}>
                <style>{css}</style>
                {items.map(draw)}
            </div>
        );
    }

    // On screen: a 1920 x 1080 screen drawn at 560 px wide, toasts placed and stacked as Steam would.
    const SCREEN = { left: 0, top: 0, width: 1920, height: 1080 };
    const scale = 560 / SCREEN.width;
    const position = theme?.position ?? (mode === "bigpicture" ? "bottom_right" : "bottom_right");
    const margin = theme?.style.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
    let offset = 0;
    const placed = items.slice(0, mode === "bigpicture" ? 1 : 4).map((item, i) => {
        const size = itemSize(theme, item, mode);
        if (item.kind === "achievement" && theme?.achievements) {
            const tier = theme.achievements.tiers[item.tier];
            const at = placeBanner(theme.achievements.position, tier.banner.margin, size, SCREEN, i);
            return { item, i, at };
        }
        const at = placeToast(position, margin, offset, size, SCREEN);
        offset += size.height + 8;
        return { item, i, at };
    });
    return (
        <div style={{ padding: "12px 0", display: "flex", justifyContent: "center" }}>
            <style>{css}</style>
            <div style={{ position: "relative", width: 560, height: 315, background: "linear-gradient(160deg, #1b2838, #0e141b)", border: "1px solid rgba(255,255,255,.12)", overflow: "hidden" }}>
                {placed.map(({ item, i, at }) => (
                    <div key={i} style={{ position: "absolute", left: at.x * scale, top: at.y * scale, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
                        {draw(item, i)}
                    </div>
                ))}
            </div>
        </div>
    );
}

export interface PreviewColumnProps {
    theme: ResolvedTheme | null;
    warnings: string[];
    assets: ReadonlyMap<string, string>;
    BannerCard: ComponentType<CreatorBannerProps>;
    game: SampleGame | null;
    previewIds: string[];
    previewLabels: Record<string, string>;
    onModeChange: (mode: ThemeMode) => void;
    onTest: (items: PreviewItem[]) => void;
    testDisabled: boolean;
}

/** The middle column: the stage, sticky, then the preview's own settings. */
export function PreviewColumn({ theme, warnings, assets, BannerCard, game, previewIds, previewLabels, onModeChange, onTest, testDisabled }: PreviewColumnProps) {
    const api = useCreator();
    const [set, setSet] = useState<PreviewSetId>("tiers");
    const [chosen, setChosen] = useState<string[]>(DEFAULT_CHOSEN);
    const [shuffled, setShuffled] = useState<string[]>(() => randomFour(previewIds.filter((id) => id !== "Achievement")));
    const [onScreen, setOnScreen] = useState(false);
    const [loop, setLoop] = useState(false);
    const [replay, setReplay] = useState(0);
    const items = previewItems(set, chosen, shuffled);
    const notificationIds = previewIds.filter((id) => id !== "Achievement");
    const describe = (item: PreviewItem) => {
        const spec = theme ? soundSpecFor(theme, item.kind === "achievement" && theme.achievements ? item.tier : null) : null;
        return { spec, text: describeSound(spec === null ? undefined : spec === false ? false : [spec.path, spec.volumePct], api.draft, api.library) };
    };
    return (
        <>
            <div style={{ position: "sticky", top: 0, zIndex: 2, background: "#1b1e24", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                <ModeSwitch mode={api.mode} onChange={onModeChange} />
                <Stage theme={theme} mode={api.mode} items={items} assets={assets} BannerCard={BannerCard} game={game} onScreen={onScreen} loop={loop} replay={replay} />
            </div>
            <PanelSection title="Preview">
                <Blocks>
                    <>
                        <FullWidthRows label="Preview set" description={PREVIEW_SETS.find((s) => s.id === set)?.description + (set !== "choose" && set !== "random" && !theme?.achievements && set !== "stack" ? ". No banner: achievements look like every toast" : "")}>
                            <Dropdown rgOptions={PREVIEW_SETS.map((s) => ({ data: s.id, label: s.label }))} selectedOption={set} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={(o) => setSet(o.data as PreviewSetId)} />
                        </FullWidthRows>
                    </>
                    {(set === "choose" || set === "mixed" || set === "stack") && (
                        <>
                            {(set === "stack" ? [0] : set === "mixed" ? [0, 1] : [0, 1, 2, 3]).map((i) => (
                                <FullWidthRows key={i} label={set === "stack" ? "Notification" : `Notification ${i + 1}`}>
                                    <Dropdown
                                        rgOptions={notificationIds.map((id) => ({ data: id, label: previewLabels[id] ?? id }))}
                                        selectedOption={chosen[i] ?? notificationIds[0]}
                                        contextMenuPositionOptions={{ bMatchWidth: true }}
                                        onChange={(o) => setChosen(chosen.map((c, j) => (j === i ? (o.data as string) : c)))}
                                    />
                                </FullWidthRows>
                            ))}
                        </>
                    )}
                    {set === "random" && <ButtonRow label="New random set" buttonLabel="Shuffle" onClick={() => setShuffled(randomFour(notificationIds))} />}
                    <>
                        <ControlledToggleRow label="On screen" description="Placed and stacked on a screen, as Steam would" value={onScreen} onChange={setOnScreen} />
                    </>
                </Blocks>
            </PanelSection>
            <PanelSection title="Sounds">
                {items.map((item, i) => {
                    const { spec, text } = describe(item);
                    return (
                        <ItemRow key={i}>
                            <Field label={item.kind === "achievement" ? TIER_NAMES[item.tier as Tier] : (previewLabels[item.id] ?? item.id)} description={spec === null ? "Steam's chime (plays with Test on screen)" : text} bottomSeparator="none">
                                <IconButton title="Play" disabled={!spec} onClick={() => spec && void play(api, spec.path, spec.volumePct)}>
                                    ▶
                                </IconButton>
                            </Field>
                        </ItemRow>
                    );
                })}
            </PanelSection>
            <PanelSection title="Animation">
                <Blocks>
                    <>
                        <ButtonRow label="Replay" description="The entrance again, then the glow and ripples" buttonLabel="Replay" onClick={() => setReplay((r) => r + 1)} />
                        <ControlledToggleRow label="Loop entrance and exit" description="With the theme's real timings" value={loop} onChange={setLoop} />
                    </>
                    <ButtonRow
                        label="Test on screen"
                        description={api.mode === "bigpicture" ? "Real toasts in Steam's current mode; open Big Picture to see this look" : "Shows this set as real Steam toasts"}
                        buttonLabel="Test"
                        disabled={testDisabled}
                        onClick={() => onTest(items)}
                    />
                </Blocks>
            </PanelSection>
            {warnings.length > 0 && (
                <PanelSection title="Theme warnings">
                    {warnings.map((w, i) => (
                        <ItemRow key={i}>
                            <Field label={w.split(/[ :]/)[0]!} description={w} />
                        </ItemRow>
                    ))}
                </PanelSection>
            )}
        </>
    );
}

/** Desktop | Big Picture: which look the preview draws and the editor edits (ADR-0068). */
function ModeSwitch({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
    const tab = (m: ThemeMode, text: string) => (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onChange(m)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onChange(m)}
            style={{
                flex: 1,
                textAlign: "center",
                padding: "8px 0",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: mode === m ? 700 : 400,
                color: mode === m ? "#fff" : "#8f98a0",
                borderBottom: `2px solid ${mode === m ? "#1a9fff" : "transparent"}`,
            }}
        >
            {text}
        </div>
    );
    return (
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
            {tab("desktop", "Desktop")}
            {tab("bigpicture", "Big Picture")}
        </div>
    );
}
