import { Children, useEffect, useState } from "react";
import { DialogButton, Field, PanelSectionRow, SliderField, Toggle as SteamToggle } from "@steambrew/client";
import { toastsEnabled } from "../steam/notification-settings";
import { DEFAULTS, RANGES, useSetting, type SettingKey } from "./settings";

/**
 * Settings panel rows and the spacing system (docs/plugins.md guardrail 18): the reference
 * every plugin's settings panel copies (steam-cartridges' settings/components.tsx follows it).
 */

// Compact row wrapper to reduce inter-item vertical spacing and
// preserve card separation across all control types.
const ITEM_ROW_STYLE: React.CSSProperties = {
    margin: "0",
    padding: "0",
};

/** Steam's settings-card background (a Field's own), measured live: rgb(35, 38, 46). */
export const CARD_BACKGROUND = "rgb(35, 38, 46)";

/**
 * Spacing system. A *block* is a group of options that read as one card: its rows touch (no gap). Blocks in a section
 * are `BLOCK_GAP` apart, set in one place (`Blocks`). Steam's SliderField and TextField each end with `STEAM_TRAILING`
 * of blank space of their own; `ItemRow` cancels it (`trailing`) so a block's spacing never depends on its last control.
 */
export const BLOCK_GAP = 22;
export const STEAM_TRAILING = 22;
/** Between stacked controls inside one custom card. */
export const CONTROL_GAP = 8;

export function ItemRow({ children, trailing }: { children: React.ReactNode; trailing?: boolean }) {
    return (
        <PanelSectionRow>
            <div style={trailing ? { ...ITEM_ROW_STYLE, marginBottom: -STEAM_TRAILING } : ITEM_ROW_STYLE}>{children}</div>
        </PanelSectionRow>
    );
}

/** The blocks of one section, `BLOCK_GAP` apart. Pass each block as one child (a fragment of rows). Padding, not margin: margins would collapse into the slider's own trailing margin. */
export function Blocks({ children }: { children: React.ReactNode }) {
    return (
        <>
            {Children.toArray(children).map((block, i) => (
                <div key={i} style={{ paddingTop: i === 0 ? 0 : BLOCK_GAP }}>
                    {block}
                </div>
            ))}
        </>
    );
}

/** A toggle row on a value the caller holds (the Theme Creator's draft); `ToggleRow` is this bound to a setting. */
export function ControlledToggleRow({
    label,
    description,
    value,
    disabled,
    onChange,
}: {
    label: string;
    description?: string;
    value: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <ItemRow>
            <Field label={label} description={description} disabled={disabled}>
                <SteamToggle value={value} disabled={disabled} onChange={onChange} />
            </Field>
        </ItemRow>
    );
}

export function ToggleRow({
    k,
    label,
    description,
    disabled,
}: {
    k: SettingKey;
    label: string;
    description?: string;
    disabled?: boolean;
}) {
    const [value, set] = useSetting(k);
    return <ControlledToggleRow label={label} description={description} value={value as boolean} disabled={disabled} onChange={(v) => set(v as never)} />;
}

/** A slider row on a value the caller holds (Steam's SliderField: label and value above the track); `SliderRow` is this bound to a setting. */
export function ControlledSliderRow({
    label,
    value,
    min,
    max,
    step = 1,
    suffix = "",
    resetValue,
    disabled,
    onChange,
}: {
    label?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    suffix?: string;
    resetValue?: number;
    disabled?: boolean;
    onChange: (value: number) => void;
}) {
    return (
        <ItemRow trailing>
            <SliderField
                label={label}
                layout="below"
                value={value}
                min={min}
                max={max}
                step={step}
                showValue
                valueSuffix={suffix}
                resetValue={resetValue}
                disabled={disabled}
                onChange={onChange}
            />
        </ItemRow>
    );
}

export function SliderRow({
    k,
    label,
    suffix,
    disabled,
}: {
    k: SettingKey;
    label: string;
    suffix: string;
    disabled?: boolean;
}) {
    const [value, set] = useSetting(k);
    const range = RANGES[k]!;
    return (
        <ControlledSliderRow
            label={label}
            value={value as unknown as number}
            min={range.min}
            max={range.max}
            step={range.step}
            suffix={suffix}
            resetValue={DEFAULTS[k] as unknown as number}
            disabled={disabled}
            onChange={(v) => set(v as never)}
        />
    );
}

/** Label and description, then the control across the whole row (guardrail 18.3): dropdowns and text fields. */
export function FullWidthRows({
    label,
    description,
    disabled,
    children,
}: {
    label: string;
    description?: string;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    return (
        <>
            <ItemRow>
                <Field label={label} description={description} disabled={disabled} bottomSeparator="none" />
            </ItemRow>
            <ItemRow>
                <Field disabled={disabled} childrenContainerWidth="max">
                    {children}
                </Field>
            </ItemRow>
        </>
    );
}

/** A row's small icon button (reset, remove, play, undo). One fixed size, so different glyphs line up (18.7). */
export function IconButton({
    onClick,
    title,
    disabled,
    children,
    style,
}: {
    onClick: () => void;
    title?: string;
    disabled?: boolean;
    children: React.ReactNode;
    style?: React.CSSProperties;
}) {
    return (
        <DialogButton
            onClick={onClick}
            title={title}
            disabled={disabled}
            style={{ padding: 0, minWidth: 0, width: "40px", fontSize: "14px", lineHeight: "normal", ...style }}
        >
            {children}
        </DialogButton>
    );
}

/** A button sized to its label (popup actions, ButtonRow). */
export const BUTTON_STYLE: React.CSSProperties = { padding: "0 16px", minWidth: 0, width: "auto" };

/**
 * The last row of a popup: a status message on the left, its buttons on the right (18.6). A message ending in "..." is
 * progress, one starting with "✓" success, "●" a neutral state, anything else an error.
 */
export function ActionRow({ message, children }: { message?: string; children?: React.ReactNode }) {
    const color = !message
        ? undefined
        : message.startsWith("✓")
          ? "#a4d007"
          : message.endsWith("...") || message.startsWith("●")
            ? undefined
            : "#eb4b4b";
    return (
        <ItemRow>
            <Field label={message ? <span style={{ color, fontWeight: 400 }}>{message}</span> : undefined} bottomSeparator="none">
                {children && <div style={{ display: "flex", gap: CONTROL_GAP }}>{children}</div>}
            </Field>
        </ItemRow>
    );
}

export function ButtonRow({
    label,
    description,
    buttonLabel,
    disabled,
    onClick,
}: {
    label: string;
    description?: string;
    buttonLabel: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <ItemRow>
            <Field label={label} description={description} disabled={disabled}>
                <DialogButton disabled={disabled} onClick={onClick} style={BUTTON_STYLE}>
                    {buttonLabel}
                </DialogButton>
            </Field>
        </ItemRow>
    );
}

/** Poll while the panel is mounted: cheap after the first call. */
export function usePanelDisabled(): boolean {
    const [enabled, setEnabled] = useState(toastsEnabled());

    useEffect(() => {
        const id = setInterval(() => setEnabled(toastsEnabled()), 2000);
        return () => clearInterval(id);
    }, []);

    return enabled === false;
}
