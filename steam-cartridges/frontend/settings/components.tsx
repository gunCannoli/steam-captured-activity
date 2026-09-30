// Shared building blocks of the settings panels (migration plan M8c). The spacing system and row kinds are the ones of
// enhanced-achievements (its settings-panel.tsx), the reference; the rules are in docs/plugins.md § Settings panel layout.
import { Children, useEffect } from "react";
import { DialogButton, Field, PanelSectionRow, Toggle as SteamToggle } from "@steambrew/client";

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
                <DialogButton disabled={disabled} onClick={onClick} style={{ padding: "0 16px", minWidth: 0, width: "auto" }}>
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
