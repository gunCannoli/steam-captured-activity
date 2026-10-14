import { createContext, useContext, useState, type ReactNode } from "react";
import { ConfirmModal, DialogButton, Dropdown, Field, SliderField, TextField } from "@steambrew/client";
import { originOf, effectiveValue, modePath, type CreatorDraft, type Origin, type Path } from "../../theme/draft";
import type { ThemeMode } from "../../theme/theme";
import type { SoundLibraryManifest } from "../../rpc";
import { showDialog } from "../../steam/modal";
import { BUTTON_STYLE, ControlledSliderRow, FullWidthRows, IconButton, ItemRow, STEAM_TRAILING } from "../rows";
import { hexToHsl, hslToHex, isHex } from "./model";

/**
 * The Theme Creator's editing context and the two patterns every key uses (theme creator plan § 4.3):
 * - a key with a few values: one full-width dropdown whose first option is Steam's own (unset);
 * - a key with a composite value: a block that starts with a header row (its name, where its value comes from, and ↺
 *   while it is set here, or Customize while it is not).
 * Every edit goes through `set` / `unset`, which write the current mode's key (Big Picture: under `bigpicture`, ADR-0068)
 * and make one undo step.
 */
export interface CreatorApi {
    draft: CreatorDraft;
    mode: ThemeMode;
    /** Set a desktop-shaped path in the current mode. */
    set(path: Path, value: unknown): void;
    /** Unset it in the current mode (Big Picture: back to the desktop value). */
    unset(path: Path): void;
    /** Replace the whole draft (Sound pack, Code page), one undo step. */
    replace(next: CreatorDraft): void;
    /** Open an editor page (theme warnings' Go). */
    go(page: string): void;
    /** A file the draft names, as a data URL (library picks from the sound library, the rest from the theme's folder); cached. */
    loadAsset(path: string): Promise<string | null>;
    /** The sound library (themes/sounds/library.json); null until loaded or when unavailable. */
    library: SoundLibraryManifest | null;
    /** Images and sounds in the draft's folder (template: the bundled folder; yours: the user folder). */
    files: { images: string[]; sounds: string[] };
    refreshFiles(): void;
    /** The user themes folder (Open in the sound picker). */
    openFolder(): void;
    /** The creator's own window: the parent of every dialog it opens. */
    window(): Window;
}

export const CreatorContext = createContext<CreatorApi | null>(null);

export function useCreator(): CreatorApi {
    const api = useContext(CreatorContext);
    if (!api) throw new Error("Theme Creator control outside the creator");
    return api;
}

/** Where a key's value comes from, in words (the header row's description). */
export function describeOrigin(o: Origin, mode: ThemeMode): string {
    switch (o.kind) {
        case "set":
            if (o.value === null) return "Steam's own in Big Picture";
            return mode === "bigpicture" ? "Set for Big Picture" : "Set by this theme";
        case "desktop":
            return "From desktop";
        case "inherited":
            return o.from === "Card" ? "From the card" : `From ${o.from}`;
        default:
            return "Steam's own";
    }
}

/** The key's origin and the value its controls show (the inherited or desktop one while unset here). */
export function useKey(path: Path): { origin: Origin; value: unknown; isSet: boolean } {
    const { draft, mode } = useCreator();
    const origin = originOf(draft.raw, mode, path);
    return { origin, value: effectiveValue(draft.raw, mode, path), isSet: origin.kind === "set" };
}

/**
 * The header row of a composite key. Set here: ↺ unsets it (Big Picture: back to the desktop value). Not set: Customize
 * writes the value shown (inherited, from desktop, or `fallback` for Steam's own) to this key, and the block's
 * controls appear (`children`, rendered only while set).
 */
export function KeyBlock({ label, path, fallback, children, note }: { label: string; path: Path; fallback: unknown; children?: ReactNode; note?: string }) {
    const api = useCreator();
    const { origin, value, isSet } = useKey(path);
    const description = [describeOrigin(origin, api.mode), note].filter(Boolean).join(". ");
    const shown = isSet && origin.kind === "set" && origin.value !== null;
    return (
        <>
            <ItemRow>
                <Field label={label} description={description} bottomSeparator={shown ? "none" : undefined}>
                    {isSet ? (
                        <IconButton title={api.mode === "bigpicture" ? "Back to the desktop value" : "Back to Steam's own"} onClick={() => api.unset(path)}>
                            ↺
                        </IconButton>
                    ) : (
                        <DialogButton style={BUTTON_STYLE} onClick={() => api.set(path, structuredClone(value ?? fallback))}>
                            Customize
                        </DialogButton>
                    )}
                </Field>
            </ItemRow>
            {shown && children}
        </>
    );
}

/** One full-width dropdown over a key with a few values. `undefined` is the first option: Steam's own (or From desktop). */
export function ChoiceRows<T extends string | number | boolean>({
    label,
    description,
    path,
    options,
    unsetLabel,
}: {
    label: string;
    description?: string;
    path: Path;
    options: { value: T; label: string }[];
    /** The first option's name; default "Steam's own" (Big Picture adds "From desktop" when the desktop look sets it). */
    unsetLabel?: string;
}) {
    const api = useCreator();
    const { origin, value } = useKey(path);
    const desktopSets = api.mode === "bigpicture" && originOf(api.draft.raw, "desktop", path).kind === "set";
    type Opt = { data: string; label: string };
    const rg: Opt[] = [];
    if (desktopSets) rg.push({ data: "__desktop", label: `From desktop (${labelOf(options, originOf(api.draft.raw, "desktop", path))})` });
    rg.push({ data: "__steam", label: unsetLabel ?? "Steam's own" });
    for (const o of options) rg.push({ data: JSON.stringify(o.value), label: o.label });
    const selected =
        origin.kind === "desktop" ? "__desktop" : origin.kind === "set" && origin.value === null ? "__steam" : value === undefined ? (desktopSets ? "__desktop" : "__steam") : JSON.stringify(value);
    return (
        <FullWidthRows label={label} description={description ?? describeOrigin(origin, api.mode)}>
            <Dropdown
                rgOptions={rg}
                selectedOption={selected}
                contextMenuPositionOptions={{ bMatchWidth: true }}
                onChange={(o) => {
                    const data = o.data as string;
                    if (data === "__desktop") api.unset(path);
                    else if (data === "__steam") (desktopSets ? api.set(path, null) : api.unset(path));
                    else api.set(path, JSON.parse(data));
                }}
            />
        </FullWidthRows>
    );
}

function labelOf<T>(options: { value: T; label: string }[], o: Origin): string {
    const v = o.kind === "set" ? o.value : undefined;
    return options.find((x) => JSON.stringify(x.value) === JSON.stringify(v))?.label ?? String(v);
}

/** A colour row: label, the hex as description, a swatch that opens Steam's colour picker, and ✕ when removable. */
export function ColourRow({ label, value, onChange, onRemove }: { label: string; value: string; onChange: (hex: string) => void; onRemove?: () => void }) {
    const api = useCreator();
    const open = () => {
        const [h, s, l, a] = hexToHsl(isHex(value) ? value : "#ffffff");
        showDialog(
            <ColourDialog
                title={label}
                hex={value}
                hsl={[h, s, l, a]}
                onPick={(hex) => onChange(hex)}
            />,
            { strTitle: label, popupWidth: 460, popupHeight: 620 },
            api.window(),
        );
    };
    return (
        <ItemRow>
            <Field label={label} description={value} bottomSeparator="none">
                <div style={{ display: "flex", gap: 8 }}>
                    <IconButton title="Choose a colour" onClick={open} style={{ background: isHex(value) ? value : undefined, border: "1px solid rgba(255,255,255,0.3)" }}>
                        {" "}
                    </IconButton>
                    {onRemove && (
                        <IconButton title="Remove this colour" onClick={onRemove}>
                            ✕
                        </IconButton>
                    )}
                </div>
            </Field>
        </ItemRow>
    );
}

/**
 * The colour picker: a swatch, hue / saturation / lightness / opacity sliders and the hex typed in its own text field,
 * all Steam's own components (so it works in any popout; the SDK's ColorPickerModal leans on gamepad slider classes).
 */
function ColourDialog({ title, hex, hsl, onPick, closeModal }: { title: string; hex: string; hsl: [number, number, number, number]; onPick: (hex: string) => void; closeModal?: () => void }) {
    const [c, setC] = useState({ h: hsl[0], s: hsl[1], l: hsl[2], a: Math.round(hsl[3] * 100) });
    const [typed, setTyped] = useState(hex);
    const current = hslToHex(c.h, c.s, c.l, c.a / 100);
    const slide = (key: "h" | "s" | "l" | "a") => (v: number) => {
        const next = { ...c, [key]: v };
        setC(next);
        setTyped(hslToHex(next.h, next.s, next.l, next.a / 100));
    };
    return (
        <ConfirmModal
            strTitle={title}
            strOKButtonText="Use"
            closeModal={closeModal}
            onOK={() => onPick(current)}
            strDescription={
                <div>
                    <ItemRow>
                        <div style={{ height: 40, borderRadius: 4, border: "1px solid rgba(255,255,255,0.3)", background: `linear-gradient(${current}, ${current}), repeating-conic-gradient(#808080 0 25%, #c0c0c0 0 50%) 0 0 / 12px 12px` }} />
                    </ItemRow>
                    <ItemRow trailing>
                        <SliderField label="Hue" layout="below" value={c.h} min={0} max={360} step={1} showValue onChange={slide("h")} />
                    </ItemRow>
                    <ItemRow trailing>
                        <SliderField label="Saturation" layout="below" value={c.s} min={0} max={100} step={1} showValue valueSuffix="%" onChange={slide("s")} />
                    </ItemRow>
                    <ItemRow trailing>
                        <SliderField label="Lightness" layout="below" value={c.l} min={0} max={100} step={1} showValue valueSuffix="%" onChange={slide("l")} />
                    </ItemRow>
                    <ItemRow trailing>
                        <SliderField label="Opacity" layout="below" value={c.a} min={0} max={100} step={1} showValue valueSuffix="%" onChange={slide("a")} />
                    </ItemRow>
                    <ItemRow trailing>
                        <TextField
                            label="Hex"
                            value={typed}
                            onChange={(e) => {
                                const v = e.target.value.trim();
                                setTyped(v);
                                if (!isHex(v)) return;
                                const [h, s, l, a] = hexToHsl(v);
                                setC({ h, s, l, a: Math.round(a * 100) });
                            }}
                        />
                    </ItemRow>
                </div>
            }
        />
    );
}

/** A typed hex colour (the Code page and the picker's fallback). Applies on a valid value only. */
export function HexField({ hex, onPick }: { hex: string; onPick: (hex: string) => void }) {
    return (
        <div style={{ marginBottom: -STEAM_TRAILING }}>
            <TextField
                label="Hex colour"
                value={hex}
                onChange={(e) => {
                    const v = e.target.value.trim();
                    if (isHex(v)) onPick(v);
                }}
            />
        </div>
    );
}

/** A number slider over one key (or one element of a tuple through `get`/`put`). */
export function NumberRow({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
    return <ControlledSliderRow label={label} value={Number.isFinite(value) ? value : min} min={min} max={max} step={step} suffix={suffix} onChange={onChange} />;
}

/** The path a key has in the draft for the current mode (for the Code page and debugging). */
export function storedPath(mode: ThemeMode, path: Path): string {
    return modePath(mode, path).join(".");
}
