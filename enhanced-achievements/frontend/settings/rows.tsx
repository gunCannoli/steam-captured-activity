import { Children, useEffect, useState } from "react";
import { DialogButton, Field, PanelSectionRow, SliderField, Toggle as SteamToggle } from "@steambrew/client";
import { toastsEnabled } from "../steam/notification-settings";
import { DEFAULTS, RANGES, useSetting, type SettingKey } from "./settings";

/**
 * Settings panel rows and the spacing system (docs/plugins.md guardrail 18). SAME FILE in
 * enhanced-achievements and enhanced-notifications (plugins may not import each other):
 * each plugin's tests/architecture.test.ts fails when the copies differ. Change both in one commit.
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

    return (
        <ItemRow>
            <Field label={label} description={description} disabled={disabled}>
                <SteamToggle
                    value={value as boolean}
                    disabled={disabled}
                    onChange={(v) => set(v as never)}
                />
            </Field>
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
        <ItemRow trailing>
            <SliderField
                label={label}
                layout="below"
                value={value as unknown as number}
                min={range.min}
                max={range.max}
                step={range.step}
                showValue
                valueSuffix={suffix}
                resetValue={DEFAULTS[k] as unknown as number}
                disabled={disabled}
                onChange={(v) => set(v as never)}
            />
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
                <DialogButton
                    disabled={disabled}
                    onClick={onClick}
                    style={{
                        padding: "0 16px",
                        minWidth: 0,
                        width: "auto",
                    }}
                >
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
