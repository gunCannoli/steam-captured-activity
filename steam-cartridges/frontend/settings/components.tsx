// Shared building blocks of the settings panels (migration plan M8c). The spacing system and row kinds are the ones of
// enhanced-notifications (its settings/rows.tsx), the reference; the rules are in docs/plugins.md § Settings panel layout.
import { Children, useEffect } from "react";
import { DialogButton, Field, PanelSectionRow, SliderField, Toggle as SteamToggle } from "@steambrew/client";

/** Steam's settings-card background (a Field's own), measured live: rgb(35, 38, 46). */
export const CARD_BACKGROUND = "rgb(35, 38, 46)";

/**
 * Spacing system. A *block* is a group of options that read as one card: its rows touch (no gap). Blocks in a section
 * are `BLOCK_GAP` apart, set in one place (`Blocks`). Steam's TextField ends with `STEAM_TRAILING` of blank space of
 * its own; `ItemRow` cancels it (`trailing`) so a block's spacing never depends on its last control. A slider goes in
 * `SliderRow`, which resets Steam's slider box instead (a negative margin there ate the gap to the next section).
 */
export const BLOCK_GAP = 22;
export const STEAM_TRAILING = 22;
/** Between stacked controls inside one custom card. */
export const CONTROL_GAP = 8;

const ITEM_ROW_STYLE: React.CSSProperties = {
    margin: "0",
    padding: "0",
};

export function ItemRow({ children, trailing }: { children: React.ReactNode; trailing?: boolean }) {
    return (
        <PanelSectionRow>
            <div style={trailing ? { ...ITEM_ROW_STYLE, marginBottom: -STEAM_TRAILING } : ITEM_ROW_STYLE}>{children}</div>
        </PanelSectionRow>
    );
}

/** The blocks of one section, `BLOCK_GAP` apart. Pass each block as one child (a fragment of rows). Padding, not margin: margins would collapse into Steam's own trailing margin. */
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
    label,
    description,
    value,
    onChange,
    disabled,
}: {
    label: string;
    description?: string;
    value: boolean;
    onChange: (val: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <ItemRow>
            <Field label={label} description={description} disabled={disabled}>
                <SteamToggle value={value} disabled={disabled} onChange={onChange} />
            </Field>
        </ItemRow>
    );
}

/** Steam's `SliderField` is its old dialog slider: a translucent box of its own (12 px padding, 22 px bottom margin),
 *  not a settings card. Inside `SliderRow` that box is reset, so the slider sits on the card like every other control. */
const SLIDER_RESET_CSS = `.sc-slider-row [class*="DialogSlider_Container"] { background: none; padding: 0; margin: 0; }`;

/** A slider as two rows of one card: label, description and the value on the first, the slider across the second. */
export function SliderRow({
    label,
    description,
    value,
    min,
    max,
    step,
    suffix,
    resetValue,
    onChange,
    disabled,
}: {
    label: string;
    description?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    suffix: string;
    resetValue: number;
    onChange: (val: number) => void;
    disabled?: boolean;
}) {
    return (
        <>
            <ItemRow>
                <Field label={label} description={description} disabled={disabled} bottomSeparator="none">
                    <span style={{ whiteSpace: "nowrap" }}>
                        {value}
                        {suffix}
                    </span>
                </Field>
            </ItemRow>
            <ItemRow>
                <Field disabled={disabled} childrenContainerWidth="max">
                    <div className="sc-slider-row" style={{ width: "100%" }}>
                        <style>{SLIDER_RESET_CSS}</style>
                        <SliderField
                            value={value}
                            min={min}
                            max={max}
                            step={step}
                            resetValue={resetValue}
                            disabled={disabled}
                            onChange={onChange}
                        />
                    </div>
                </Field>
            </ItemRow>
        </>
    );
}

/** A number on the right of a row (the Library Analytics counts). `warn` colours it when it asks for attention. */
export function StatRow({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
    return (
        <ItemRow>
            <Field label={label}>
                <span style={{ fontWeight: 700, color: warn && value > 0 ? "#e5a00d" : undefined }}>{value}</span>
            </Field>
        </ItemRow>
    );
}

/** A row's small icon button (remove, edit, info). One fixed size, so different glyphs line up. */
export function IconButton({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
    return (
        <DialogButton
            onClick={onClick}
            title={title}
            style={{ padding: 0, minWidth: 0, width: "40px", fontSize: "14px", lineHeight: "normal" }}
        >
            {children}
        </DialogButton>
    );
}

/** A button sized to its label (popup actions, ButtonRow). */
export const BUTTON_STYLE: React.CSSProperties = { padding: "0 16px", minWidth: 0, width: "auto" };

/** The last row of a popup: a status message on the left, its buttons on the right. A message ending in "..." is
 *  progress, one starting with "✓" success, anything else an error. */
export function ActionRow({ message, children }: { message?: string; children?: React.ReactNode }) {
    const color = !message
        ? undefined
        : message.startsWith("✓")
          ? "#a4d007"
          : message.endsWith("...")
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

/** The privacy note of a popup that asks for an account or a key. */
export function CredentialsNote({ service }: { service: string }) {
    return (
        <ItemRow>
            <Field
                label="Stored only on this PC"
                description={`Saved in the plugin's own folder, sent only to ${service}, never logged or shared.`}
                bottomSeparator="none"
            />
        </ItemRow>
    );
}

/** One row: label and description on the left, one button on the right (two columns, the most a row may have). */
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

/** A control that needs room (a dropdown, a button): three rows, label, description, then the control across the full row. */
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

/**
 * Clean Steam-themed modal dialog for popups.
 */
interface SettingsModalProps {
    title: string;
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    width?: string;
    maxHeight?: string;
}

export function SettingsModal({
    title,
    isOpen,
    onClose,
    children,
    width = "520px",
    maxHeight = "85vh",
}: SettingsModalProps) {
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.75)",
                backdropFilter: "blur(3px)",
                zIndex: 10000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: "#1b2838",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "6px",
                    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.85)",
                    width,
                    maxWidth: "94vw",
                    maxHeight,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    style={{
                        padding: "12px 18px",
                        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "rgba(0, 0, 0, 0.25)",
                    }}
                >
                    <span
                        style={{
                            fontSize: "14px",
                            fontWeight: 700,
                            color: "#fff",
                        }}
                    >
                        {title}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: "#8b929a",
                            fontSize: "18px",
                            cursor: "pointer",
                            padding: "0 4px",
                            lineHeight: 1,
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div
                    style={{
                        padding: "16px 18px",
                        overflowY: "auto",
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                    }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
