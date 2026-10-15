import { Dropdown, TextField } from "@steambrew/client";
import { modePath, setAt, type Path } from "../../theme/draft";
import { canPickFiles, pickFile } from "../../steam/file-dialog";
import { ButtonRow, ControlledToggleRow, FullWidthRows, ItemRow, STEAM_TRAILING } from "../rows";
import { ColourRow, KeyBlock, NumberRow, useCreator, useKey } from "./controls";
import { isHex } from "./model";

/**
 * One block per theme key shape (theme creator plan § 4.5). Each starts with the key's header row (KeyBlock: where its
 * value comes from, ↺ / Customize); its controls show while the key is set here. Ranges follow themes.md.
 */

const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** `popup.background`: one colour is solid, more a gradient (up to 4), with the angle (`gradient_angle`) beside it. */
export function BackgroundBlock({ path, anglePath, fallback = ["#1b2838"] }: { path: Path; anglePath: Path; fallback?: string[] }) {
    const api = useCreator();
    const { value } = useKey(path);
    const colours = list(value).map((c) => str(c, "#000000"));
    const angle = useKey(anglePath);
    const put = (next: string[]) => api.set(path, next);
    return (
        <KeyBlock label="Background" path={path} fallback={fallback}>
            {colours.map((c, i) => (
                <ColourRow
                    key={i}
                    label={colours.length > 1 ? `Colour ${i + 1}` : "Colour"}
                    value={c}
                    onChange={(hex) => put(colours.map((x, j) => (j === i ? hex : x)))}
                    onRemove={colours.length > 1 ? () => put(colours.filter((_, j) => j !== i)) : undefined}
                />
            ))}
            {colours.length < 4 && <ButtonRow label="Add a colour" description="Two or more make a gradient" buttonLabel="Add" onClick={() => put([...colours, colours[colours.length - 1] ?? "#000000"])} />}
            {colours.length > 1 && <NumberRow label="Angle" value={num(angle.value, 135)} min={0} max={360} suffix="°" onChange={(v) => api.set(anglePath, v)} />}
        </KeyBlock>
    );
}

/** `[width, colour, radius]`. */
export function BorderBlock({ path, fallback = [1, "#ffffff33", 4] }: { path: Path; fallback?: unknown[] }) {
    const api = useCreator();
    const v = list(useKey(path).value);
    const put = (i: number, x: unknown) => api.set(path, [num(v[0], 1), str(v[1], "#ffffff33"), num(v[2], 4)].map((y, j) => (j === i ? x : y)));
    return (
        <KeyBlock label="Border" path={path} fallback={fallback}>
            <NumberRow label="Width" value={num(v[0], 1)} min={0} max={8} suffix=" px" onChange={(x) => put(0, x)} />
            <ColourRow label="Border colour" value={str(v[1], "#ffffff33")} onChange={(x) => put(1, x)} />
            <NumberRow label="Corner radius" value={num(v[2], 4)} min={0} max={32} suffix=" px" onChange={(x) => put(2, x)} />
        </KeyBlock>
    );
}

/** `[colour, spread, pulse ms]`. */
export function GlowBlock({ path, note }: { path: Path; note?: string }) {
    const api = useCreator();
    const v = list(useKey(path).value);
    const put = (i: number, x: unknown) => api.set(path, [str(v[0], "#8a2be2"), num(v[1], 8), num(v[2], 0)].map((y, j) => (j === i ? x : y)));
    return (
        <KeyBlock label="Glow" path={path} fallback={["#8a2be2", 8, 0]} note={note}>
            <ColourRow label="Glow colour" value={str(v[0], "#8a2be2")} onChange={(x) => put(0, x)} />
            <NumberRow label="Spread" value={num(v[1], 8)} min={0} max={120} suffix=" px" onChange={(x) => put(1, x)} />
            <NumberRow label="Pulse" value={num(v[2], 0)} min={0} max={5000} step={100} suffix=" ms" onChange={(x) => put(2, x)} />
        </KeyBlock>
    );
}

/** `margin` / `padding`: one value for every side, or four (CSS order: top, right, bottom, left). */
export function EdgesBlock({ label, path, fallback, max = 64, note }: { label: string; path: Path; fallback: number | number[]; max?: number; note?: string }) {
    const api = useCreator();
    const raw = useKey(path).value;
    const sides = typeof raw === "number" ? [raw, raw, raw, raw] : (() => {
        const l = list(raw).map((x) => num(x, 0));
        const [t = 0, r = t, b = t, lf = r] = l;
        return [t, r, b, lf];
    })();
    const same = typeof raw === "number" || (Array.isArray(raw) && raw.length === 1) || sides.every((x) => x === sides[0]);
    return (
        <KeyBlock label={label} path={path} fallback={fallback} note={note}>
            <ControlledToggleRow label="Same on every side" value={same} onChange={(on) => api.set(path, on ? sides[0] : [...sides])} />
            {same ? (
                <NumberRow label="All sides" value={sides[0]!} min={0} max={max} suffix=" px" onChange={(x) => api.set(path, x)} />
            ) : (
                ["Top", "Right", "Bottom", "Left"].map((name, i) => (
                    <NumberRow key={name} label={name} value={sides[i]!} min={0} max={max} suffix=" px" onChange={(x) => api.set(path, sides.map((y, j) => (j === i ? x : y)))} />
                ))
            )}
        </KeyBlock>
    );
}

/** `gap`: `[icon to text, between rows]`. */
export function GapBlock({ path, fallback = [12, 0] }: { path: Path; fallback?: number[] }) {
    const api = useCreator();
    const raw = useKey(path).value;
    const v = typeof raw === "number" ? [raw, raw] : list(raw).map((x) => num(x, 0));
    const put = (i: number, x: number) => api.set(path, [v[0] ?? 0, v[1] ?? 0].map((y, j) => (j === i ? x : y)));
    return (
        <KeyBlock label="Gaps" path={path} fallback={fallback} note="Keep Between rows small: 10 px crops a three-row toast">
            <NumberRow label="Icon to text" value={v[0] ?? 0} min={0} max={32} suffix=" px" onChange={(x) => put(0, x)} />
            <NumberRow label="Between rows" value={v[1] ?? 0} min={0} max={12} suffix=" px" onChange={(x) => put(1, x)} />
        </KeyBlock>
    );
}

const FONT_STYLES = [
    { data: "regular", label: "Regular" },
    { data: "bold", label: "Bold" },
    { data: "italic", label: "Italic" },
];

/** `text.<line>`: `[colour, size %, style]`. */
export function TextStyleBlock({ label, path, note }: { label: string; path: Path; note: string }) {
    const api = useCreator();
    const v = list(useKey(path).value);
    const put = (i: number, x: unknown) => api.set(path, [str(v[0], "#ffffff"), num(v[1], 100), str(v[2], "regular")].map((y, j) => (j === i ? x : y)));
    return (
        <KeyBlock label={label} path={path} fallback={["#ffffff", 100, "regular"]} note={note}>
            <ColourRow label="Text colour" value={str(v[0], "#ffffff")} onChange={(x) => put(0, x)} />
            <NumberRow label="Size" value={num(v[1], 100)} min={50} max={200} suffix="%" onChange={(x) => put(1, x)} />
            <FullWidthRows label="Style">
                <Dropdown rgOptions={FONT_STYLES} selectedOption={str(v[2], "regular")} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={(o) => put(2, o.data)} />
            </FullWidthRows>
        </KeyBlock>
    );
}

/** `popup_icon`: `[shown, scale %, radius px]`. */
export function PopupIconBlock({ path }: { path: Path }) {
    const api = useCreator();
    const raw = useKey(path).value;
    const v = typeof raw === "boolean" ? [raw, 100, 0] : list(raw);
    const shown = v[0] !== false;
    const put = (i: number, x: unknown) => api.set(path, [shown, num(v[1], 100), num(v[2], 0)].map((y, j) => (j === i ? x : y)));
    return (
        <KeyBlock label="Toast icon" path={path} fallback={[true, 100, 0]} note="The game's icon, an avatar or a system icon">
            <ControlledToggleRow label="Shown" value={shown} onChange={(on) => put(0, on)} />
            {shown && <NumberRow label="Scale" value={num(v[1], 100)} min={25} max={200} suffix="%" onChange={(x) => put(1, x)} />}
            {shown && <NumberRow label="Corner radius" value={num(v[2], 0)} min={0} max={32} suffix=" px" onChange={(x) => put(2, x)} />}
        </KeyBlock>
    );
}

/** A plain number key (display time, banner width / height / scale, a tier threshold). */
export function NumberBlock({ label, path, fallback, min, max, step = 1, suffix = "", note }: { label: string; path: Path; fallback: number; min: number; max: number; step?: number; suffix?: string; note?: string }) {
    const api = useCreator();
    const raw = useKey(path).value;
    const value = Array.isArray(raw) ? num(raw[0], fallback) : num(raw, fallback);
    return (
        <KeyBlock label={label} path={path} fallback={fallback} note={note}>
            <NumberRow label={label} value={value} min={min} max={max} step={step} suffix={suffix} onChange={(x) => api.set(path, x)} />
        </KeyBlock>
    );
}

/** `settings.hover`: Steam's own, none, or a colour. */
export function HoverBlock({ path }: { path: Path }) {
    const api = useCreator();
    const raw = useKey(path).value;
    const kind = raw === false ? "none" : Array.isArray(raw) && isHex(raw[1]) ? "colour" : "steam";
    return (
        <>
            <FullWidthRows label="Mouse-over highlight" description="Shown while the mouse is over a toast">
                <Dropdown
                    rgOptions={[
                        { data: "steam", label: "Steam's own" },
                        { data: "none", label: "None" },
                        { data: "colour", label: "A colour" },
                    ]}
                    selectedOption={kind}
                    contextMenuPositionOptions={{ bMatchWidth: true }}
                    onChange={(o) => (o.data === "steam" ? api.unset(path) : o.data === "none" ? api.set(path, false) : api.set(path, [true, "#1a9fff"]))}
                />
            </FullWidthRows>
            {kind === "colour" && <ColourRow label="Highlight colour" value={str(list(raw)[1], "#1a9fff")} onChange={(x) => api.set(path, [true, x])} />}
        </>
    );
}

const FONTS = ["Motiva Sans, Arial, sans-serif", "Arial, sans-serif", "Segoe UI, sans-serif", "Verdana, sans-serif", "Georgia, serif", "Consolas, monospace"];

/** `font_family`: Steam's own, a font Windows and Steam ship, or a typed one. */
export function FontRows({ path }: { path: Path }) {
    const api = useCreator();
    const raw = useKey(path).value;
    const value = typeof raw === "string" ? raw : undefined;
    const custom = value !== undefined && !FONTS.includes(value);
    return (
        <>
            <FullWidthRows label="Font" description="Plain font names only">
                <Dropdown
                    rgOptions={[{ data: "__steam", label: "Steam's own" }, ...FONTS.map((f) => ({ data: f, label: f.split(",")[0]! })), { data: "__custom", label: "Custom..." }]}
                    selectedOption={value === undefined ? "__steam" : custom ? "__custom" : value}
                    contextMenuPositionOptions={{ bMatchWidth: true }}
                    onChange={(o) => (o.data === "__steam" ? api.unset(path) : o.data === "__custom" ? api.set(path, value ?? "Arial") : api.set(path, o.data))}
                />
            </FullWidthRows>
            {custom && (
                <ItemRow trailing>
                    <TextField label="Font names" value={value} onChange={(e) => /^[\w\s,"'-]{1,120}$/.test(e.target.value) && api.set(path, e.target.value)} />
                </ItemRow>
            )}
        </>
    );
}

/** A tier's icon slot: `[source, scale %, ripple ms]`; source true = Steam's, false = hidden, a path = an image. */
export function IconSlotBlock({ label, path, images, isNormal }: { label: string; path: Path; images: string[]; isNormal: boolean }) {
    const api = useCreator();
    const { value, isSet } = useKey(path);
    const v = Array.isArray(value) ? value : value === undefined ? [] : [value];
    const source = v[0];
    const kind = !isSet ? "inherit" : source === true ? "steam" : source === false ? "hidden" : "image";
    const put = (i: number, x: unknown) => api.set(path, [source ?? true, num(v[1], 100), num(v[2], 0)].map((y, j) => (j === i ? x : y)));
    return (
        <>
            <FullWidthRows label={label} description={kind === "image" ? str(source, "") : undefined}>
                <Dropdown
                    rgOptions={[
                        { data: "inherit", label: isNormal ? "Default" : "From Normal" },
                        { data: "steam", label: "Steam's" },
                        { data: "hidden", label: "Hidden" },
                        ...[...new Set([...images, ...(kind === "image" && typeof source === "string" ? [source] : [])])].map((img) => ({ data: `img:${img}`, label: img.split(/[\\/]/).pop() ?? img })),
                    ]}
                    selectedOption={kind === "image" ? `img:${str(source, "")}` : kind}
                    contextMenuPositionOptions={{ bMatchWidth: true }}
                    onChange={(o) => {
                        const d = o.data as string;
                        if (d === "inherit") api.unset(path);
                        else if (d === "steam") api.set(path, [true, num(v[1], 100), num(v[2], 0)]);
                        else if (d === "hidden") api.set(path, false);
                        else api.set(path, [d.slice(4), num(v[1], 100), num(v[2], 0)]);
                    }}
                />
            </FullWidthRows>
            {canPickFiles() && (
                <ButtonRow
                    label="Choose an image"
                    description="A .png, .jpg or .svg from your PC, copied into the theme's folder when you save"
                    buttonLabel="Choose..."
                    onClick={() =>
                        void pickFile("image", label, api.window()).then((file) => {
                            if (!file) return;
                            api.replace({
                                ...api.draft,
                                raw: setAt(api.draft.raw, modePath(api.mode, path), [file, num(v[1], 100), num(v[2], 0)]),
                                pendingCopies: { ...api.draft.pendingCopies, [file]: { kind: "file", path: file } },
                            });
                        })
                    }
                />
            )}
            {isSet && source !== false && <NumberRow label="Scale" value={num(v[1], 100)} min={25} max={300} suffix="%" onChange={(x) => put(1, x)} />}
            {isSet && source !== false && <NumberRow label="Ripple" value={num(v[2], 0)} min={0} max={5000} step={100} suffix=" ms" onChange={(x) => put(2, x)} />}
        </>
    );
}

/** A text field over one string key (the Exceptional tier's words). */
export function TextKeyRow({ label, path, placeholder }: { label: string; path: Path; placeholder: string }) {
    const api = useCreator();
    const raw = useKey(path).value;
    return (
        <ItemRow trailing>
            <div style={{ marginBottom: 0 }}>
                <TextField label={label} value={typeof raw === "string" ? raw : ""} description={`Empty: "${placeholder}"`} onChange={(e) => (e.target.value ? api.set(path, e.target.value) : api.unset(path))} />
            </div>
        </ItemRow>
    );
}

export { STEAM_TRAILING };
