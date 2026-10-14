import { useState } from "react";
import { Dropdown, Field, PanelSection } from "@steambrew/client";
import { ANIMATIONS, LAYOUT_PRESETS, POSITIONS, TEXT_ALIGNS, type Tier } from "../../theme/achievements";
import { getAt, modePath, serialize, type Path } from "../../theme/draft";
import { parseJsonc } from "../../theme/jsonc";
import { Blocks, ButtonRow, ControlledToggleRow, FullWidthRows, ItemRow } from "../rows";
import { ChoiceRows, useCreator, useKey } from "./controls";
import {
    BackgroundBlock, BorderBlock, EdgesBlock, FontRows, GapBlock, GlowBlock, HoverBlock, IconSlotBlock, NumberBlock, PopupIconBlock, TextKeyRow,
    TextStyleBlock,
} from "./editors";
import { TierSoundBlocks } from "./sounds";

/** The editor column's pages (theme creator plan § 4.5). Each is a stack of PanelSections of Blocks (guardrail 18). */

const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const TIER_NAMES: Record<Tier, string> = { normal: "Normal", magic: "Magic", rare: "Rare", exceptional: "Exceptional" };

/** In Big Picture every page edits the Big Picture look; one line says so at the top of each page. */
function ModeNote() {
    const { mode } = useCreator();
    if (mode !== "bigpicture") return null;
    return (
        <ItemRow>
            <Field label="Editing the Big Picture look" description="Changes here apply only in Big Picture. Anything you leave alone comes from the desktop look." />
        </ItemRow>
    );
}

export function PlacementPage() {
    return (
        <PanelSection title="Placement">
            <Blocks>
                <ModeNote />
                <ChoiceRows label="Position" path={["settings", "position"]} options={POSITIONS.map((p) => ({ value: p, label: label(p) }))} />
                <AnimationRows />
                <NumberBlock label="Display time" path={["settings", "display_time_ms"]} fallback={5000} min={1000} max={60000} step={500} suffix=" ms" note="How long every toast stays" />
                <ChoiceRows label="Text alignment" path={["settings", "text_align"]} options={TEXT_ALIGNS.map((a) => ({ value: a, label: label(a) }))} unsetLabel="Steam's own (left)" />
                <HoverBlock path={["settings", "hover"]} />
            </Blocks>
        </PanelSection>
    );
}

/** `settings.animation`: one name for both, or `{ in, out }`. */
function AnimationRows() {
    const api = useCreator();
    const path: Path = ["settings", "animation"];
    const { value } = useKey(path);
    const split = value !== null && typeof value === "object";
    const pair = split ? (value as { in?: string; out?: string }) : { in: value as string | undefined, out: value as string | undefined };
    const options = [{ data: "__steam", label: "Steam's own" }, ...ANIMATIONS.map((a) => ({ data: a, label: a === "ps5" ? "Slide and fade (short)" : label(a) }))];
    const pick = (side: "in" | "out" | "both") => (o: { data: unknown }) => {
        const d = o.data as string;
        if (side === "both") return d === "__steam" ? api.unset(path) : api.set(path, d);
        if (d === "__steam") return api.unset(path);
        api.set(path, { in: pair.in ?? "slide", out: pair.out ?? "fade", [side]: d });
    };
    return (
        <>
            <ControlledToggleRow
                label="Same in and out"
                description="One animation for the entrance and the exit"
                value={!split}
                onChange={(same) => (same ? (pair.in ? api.set(path, pair.in) : api.unset(path)) : api.set(path, { in: pair.in ?? "slide", out: pair.out ?? "fade" }))}
            />
            {!split ? (
                <FullWidthRows label="Animation">
                    <Dropdown rgOptions={options} selectedOption={typeof value === "string" ? value : "__steam"} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={pick("both")} />
                </FullWidthRows>
            ) : (
                <>
                    <FullWidthRows label="Entrance">
                        <Dropdown rgOptions={options.slice(1)} selectedOption={pair.in ?? "slide"} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={pick("in")} />
                    </FullWidthRows>
                    <FullWidthRows label="Exit">
                        <Dropdown rgOptions={options.slice(1)} selectedOption={pair.out ?? "fade"} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={pick("out")} />
                    </FullWidthRows>
                </>
            )}
        </>
    );
}

export function CardPage() {
    return (
        <>
            <PanelSection title="Card">
                <Blocks>
                    <ModeNote />
                    <BackgroundBlock path={["popup", "background"]} anglePath={["popup", "gradient_angle"]} fallback={["#1F1F1F", "#0F0F0F"]} />
                    <BorderBlock path={["popup", "border"]} />
                    <GlowBlock path={["popup", "glow"]} note="Inner glow; not drawn on the achievement banner" />
                    <ChoiceRows label="Steam logo watermark" description="Behind desktop toasts" path={["popup", "watermark"]} options={[{ value: true, label: "Shown" }, { value: false, label: "Hidden" }]} />
                    <EdgesBlock label="Margin" path={["popup", "margin"]} fallback={10} max={200} note="Distance from the screen corner" />
                    <EdgesBlock label="Padding" path={["popup", "padding"]} fallback={10} note="Space inside the toast; it keeps Steam's height" />
                    <GapBlock path={["popup", "gap"]} />
                    <FontRows path={["font_family"]} />
                </Blocks>
            </PanelSection>
            <PanelSection title="Achievement banner size">
                <Blocks>
                    <NumberBlock label="Scale" path={["popup", "scale"]} fallback={100} min={25} max={400} suffix="%" note="Banner only; not in Big Picture's frame" />
                    <NumberBlock label="Width" path={["popup", "width"]} fallback={400} min={150} max={900} suffix=" px" note="Before scale; default: the layout's own" />
                    <NumberBlock label="Height" path={["popup", "height"]} fallback={80} min={40} max={300} suffix=" px" note="Before scale; default: the layout's own" />
                </Blocks>
            </PanelSection>
        </>
    );
}

export function TextPage() {
    return (
        <PanelSection title="Text">
            <Blocks>
                <ModeNote />
                <TextStyleBlock label="Title" path={["text", "title"]} note="The toast's first line, and the achievement's name" />
                <TextStyleBlock label="Body" path={["text", "body"]} note="The second line, and the achievement's description" />
                <TextStyleBlock label="Subtext" path={["text", "subtext"]} note="A third line some toasts have (a download's Ready to play)" />
            </Blocks>
        </PanelSection>
    );
}

export function IconsPage() {
    return (
        <PanelSection title="Icons">
            <Blocks>
                <ModeNote />
                <PopupIconBlock path={["popup_icon"]} />
                <ChoiceRows label="Header icon" description="The small icon before the title" path={["header_icon"]} options={[{ value: true, label: "Shown" }, { value: false, label: "Hidden" }]} />
            </Blocks>
        </PanelSection>
    );
}

/** Banner keys a tier (or the whole block) can set, with the card's defaults. */
function BannerKeyBlocks({ base }: { base: Path }) {
    return (
        <>
            <BackgroundBlock path={[...base, "background"]} anglePath={[...base, "gradient_angle"]} fallback={["#1b2838", "#2a475e"]} />
            <BorderBlock path={[...base, "border"]} fallback={[0, "#ffffff", 4]} />
            <EdgesBlock label="Margin" path={[...base, "margin"]} fallback={0} max={200} note="Distance from the screen corner" />
            <EdgesBlock label="Padding" path={[...base, "padding"]} fallback={[6, 10]} />
            <GapBlock path={[...base, "gap"]} fallback={[10, 2]} />
            <NumberBlock label="Scale" path={[...base, "scale"]} fallback={100} min={25} max={400} suffix="%" />
        </>
    );
}

export function AchievementsPage() {
    const api = useCreator();
    const block = getAt(api.draft.raw, modePath(api.mode, ["achievements"]));
    const inView = api.mode === "bigpicture" ? block !== undefined || getAt(api.draft.raw, ["achievements"]) !== undefined : block !== undefined;
    const [confirm, setConfirm] = useState(false);
    const layoutPath: Path = ["achievements", "layout"];
    const layout = useKey(layoutPath).value;
    const custom = layout !== null && typeof layout === "object";
    const anchors = ["left", "right", "achievement_left", "achievement_right", "title_left", "title_right", "desc_left", "desc_right"];
    return (
        <>
            <PanelSection title="Achievement banner">
                <Blocks>
                    <ModeNote />
                    <ControlledToggleRow
                        label="Themed achievement banner"
                        description={confirm ? "Turn off again to remove the banner and every tier's settings" : "A banner per rarity tier instead of Steam's achievement toast"}
                        value={inView}
                        onChange={(on) => {
                            if (on) return api.set(["achievements"], { normal: {} });
                            const content = JSON.stringify(block ?? {});
                            if (content.length > 20 && !confirm) return setConfirm(true);
                            setConfirm(false);
                            api.mode === "bigpicture" && getAt(api.draft.raw, ["achievements"]) !== undefined ? api.set(["achievements"], null) : api.unset(["achievements"]);
                        }}
                    />
                    {inView && (
                        <FullWidthRows label="Layout" description="Where the icons sit around the text">
                            <Dropdown
                                rgOptions={[...LAYOUT_PRESETS.map((p) => ({ data: p, label: p === "ps5" ? "Trophy (icon, emblem, system)" : label(p) })), { data: "__custom", label: "Custom..." }]}
                                selectedOption={custom ? "__custom" : typeof layout === "string" ? layout : "default_steam"}
                                contextMenuPositionOptions={{ bMatchWidth: true }}
                                onChange={(o) => api.set(layoutPath, o.data === "__custom" ? { achievement: "left", system: "right", rarity: "title_left" } : o.data)}
                            />
                        </FullWidthRows>
                    )}
                    {inView && custom && (
                        <>
                            {(["achievement", "system", "rarity"] as const).map((slot) => (
                                <FullWidthRows key={slot} label={`${label(slot)} icon`}>
                                    <Dropdown
                                        rgOptions={anchors.map((a) => ({ data: a, label: label(a) }))}
                                        selectedOption={(layout as Record<string, string>)[slot] ?? "left"}
                                        contextMenuPositionOptions={{ bMatchWidth: true }}
                                        onChange={(o) => api.set(layoutPath, { ...(layout as object), [slot]: o.data })}
                                    />
                                </FullWidthRows>
                            ))}
                        </>
                    )}
                </Blocks>
            </PanelSection>
            {inView && (
                <PanelSection title="All tiers">
                    <Blocks>
                        <BannerKeyBlocks base={["achievements"]} />
                    </Blocks>
                </PanelSection>
            )}
        </>
    );
}

export function TierPage({ tier, images }: { tier: Tier; images: string[] }) {
    const api = useCreator();
    const hasBanner = getAt(api.draft.raw, ["achievements"]) !== undefined || getAt(api.draft.raw, ["bigpicture", "achievements"]) !== undefined;
    if (!hasBanner) {
        return (
            <PanelSection title={TIER_NAMES[tier]}>
                <ItemRow>
                    <Field label="No achievement banner" description="Turn on the banner on the Achievements page to style each tier" />
                </ItemRow>
            </PanelSection>
        );
    }
    const base: Path = ["achievements", tier];
    return (
        <>
            <PanelSection title={TIER_NAMES[tier]}>
                <Blocks>
                    <ModeNote />
                    <ItemRow>
                        <Field label="Inherits from" description={tier === "normal" ? "All tiers ← Card" : "Normal ← All tiers ← Card"} />
                    </ItemRow>
                    {(tier === "magic" || tier === "rare") && (
                        <NumberBlock label="Threshold" path={[...base, "threshold"]} fallback={tier === "magic" ? 25 : 10} min={0.1} max={50} step={0.1} suffix="%" note="Used when this share of players or fewer has the achievement" />
                    )}
                </Blocks>
            </PanelSection>
            <PanelSection title="Card">
                <Blocks>
                    <BannerKeyBlocks base={base} />
                </Blocks>
            </PanelSection>
            <PanelSection title="Icons">
                <Blocks>
                    <IconSlotBlock label="Achievement icon" path={[...base, "icons", "achievement"]} images={images} isNormal={tier === "normal"} />
                    <IconSlotBlock label="System icon" path={[...base, "icons", "system"]} images={images} isNormal={tier === "normal"} />
                    <IconSlotBlock label="Rarity emblem" path={[...base, "icons", "rarity"]} images={images} isNormal={tier === "normal"} />
                </Blocks>
            </PanelSection>
            <TierSoundBlocks tier={tier} />
            {tier === "exceptional" && (
                <PanelSection title="Text">
                    <Blocks>
                        <TextKeyRow label="Title" path={[...base, "text", "title"]} placeholder="100% Complete" />
                        <TextKeyRow label="Description" path={[...base, "text", "desc"]} placeholder="You've unlocked all achievements!" />
                    </Blocks>
                </PanelSection>
            )}
        </>
    );
}

/** The generated JSONC; Apply replaces the draft (one undo step), Copy puts it on the clipboard. */
export function CodePage({ onStatus }: { onStatus: (message: string) => void }) {
    const api = useCreator();
    const [text, setText] = useState(() => serialize(api.draft.raw));
    const [base, setBase] = useState(api.draft.raw);
    if (base !== api.draft.raw) {
        setBase(api.draft.raw);
        setText(serialize(api.draft.raw));
    }
    return (
        <PanelSection title="Code">
            <Blocks>
                <ItemRow>
                    <textarea
                        value={text}
                        spellCheck={false}
                        onChange={(e) => setText(e.target.value)}
                        style={{
                            width: "100%",
                            height: 420,
                            boxSizing: "border-box",
                            fontFamily: "Consolas, monospace",
                            fontSize: 12,
                            color: "#dcdedf",
                            background: "rgba(0, 0, 0, 0.3)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: 2,
                            padding: 8,
                            resize: "vertical",
                        }}
                    />
                </ItemRow>
                <>
                    <ButtonRow
                        label="Apply changes"
                        description="Reads the text above into the theme"
                        buttonLabel="Apply"
                        onClick={() => {
                            try {
                                const raw = parseJsonc(text);
                                if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A theme must be a JSON object.");
                                api.replace({ ...api.draft, raw: raw as Record<string, unknown> });
                                onStatus("✓ Code applied");
                            } catch (error) {
                                onStatus(`Code not applied: ${error instanceof Error ? error.message : String(error)}`);
                            }
                        }}
                    />
                    <ButtonRow
                        label="Copy to clipboard"
                        buttonLabel="Copy"
                        onClick={() => {
                            void navigator.clipboard?.writeText(text).then(
                                () => onStatus("✓ Copied"),
                                () => onStatus("Could not copy: the clipboard is not available here"),
                            );
                        }}
                    />
                </>
            </Blocks>
        </PanelSection>
    );
}
