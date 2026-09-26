import { useEffect, useState } from "react";
import {
    DialogBodyText,
    DialogButton,
    Dropdown,
    Field,
    PanelSection,
    PanelSectionRow,
    SliderField,
    Toggle as SteamToggle,
} from "@steambrew/client";
import { logger } from "../logger";
import { rpc, type ThemeEntry } from "../rpc";
import { previewTier } from "../steam/notifications";
import { toastsEnabled } from "../steam/notification-settings";
import { activeTheme, onThemeChange, reloadTheme } from "../theme/active-theme";
import { TIERS, type Tier } from "../theme/theme";
import {
    DEFAULTS,
    RANGES,
    resetSettings,
    setting,
    useSetting,
    type SettingKey,
} from "./settings";

// Compact row wrapper to reduce inter-item vertical spacing and
// preserve card separation across all control types.
const ITEM_ROW_STYLE: React.CSSProperties = {
    margin: "0",
    padding: "0",
};

function ItemRow({ children }: { children: React.ReactNode }) {
    return (
        <PanelSectionRow>
            <div style={ITEM_ROW_STYLE}>{children}</div>
        </PanelSectionRow>
    );
}

function ToggleRow({
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

function SliderRow({
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
        <ItemRow>
            <SliderField
                label={label}
                layout="below"
                value={value as number}
                min={range.min}
                max={range.max}
                step={range.step}
                showValue
                valueSuffix={suffix}
                resetValue={DEFAULTS[k] as number}
                disabled={disabled}
                onChange={(v) => set(v as never)}
            />
        </ItemRow>
    );
}

function ButtonRow({
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
function usePanelDisabled(): boolean {
    const [enabled, setEnabled] = useState(toastsEnabled());

    useEffect(() => {
        const id = setInterval(() => setEnabled(toastsEnabled()), 2000);
        return () => clearInterval(id);
    }, []);

    return enabled === false;
}

function ThemeSection({ disabled }: { disabled: boolean }) {
    const [theme, setTheme] = useSetting("theme");
    const [themes, setThemes] = useState<ThemeEntry[]>([]);
    const [problem, setProblem] = useState(themeProblem());

    const refresh = async () => {
        try {
            const result = await rpc.listThemes();
            setThemes(result.themes);
        } catch (error) {
            logger.warn("Could not list themes:", error);
        }
    };

    useEffect(() => {
        void refresh();
        return onThemeChange(() => setProblem(themeProblem()));
    }, []);

    const options: { data: string; label: string }[] = [
        { data: "", label: "Steam default" },
        ...themes.map((t) => ({ data: t.name, label: t.name })),
    ];

    if (theme && !themes.some((t) => t.name === theme)) {
        options.push({
            data: theme,
            label: `${theme} (missing)`,
        });
    }

    return (
        <PanelSection title="Theme">
            {/* Three rows: label, description, then the dropdown across the full
                row. Two Fields rather than one with childrenLayout="below", so the
                order does not depend on where Steam's Field puts the description. */}
            <ItemRow>
                <Field
                    label="Available themes"
                    description="Select a theme to choose the notification style"
                    disabled={disabled}
                    bottomSeparator="none"
                />
            </ItemRow>
            <ItemRow>
                <Field disabled={disabled} childrenContainerWidth="max">
                    <Dropdown
                        rgOptions={options}
                        selectedOption={theme}
                        disabled={disabled}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                        onChange={(o) => setTheme(o.data as string)}
                    />
                </Field>
            </ItemRow>
            {problem && (
                <ItemRow>
                    <DialogBodyText>{problem}</DialogBodyText>
                </ItemRow>
            )}

            <ButtonRow
                label="Reload themes"
                description="Pick up theme file edits without restarting Steam"
                buttonLabel="Reload"
                disabled={disabled}
                onClick={() => {
                    void (async () => {
                        await refresh();
                        await reloadTheme();
                    })();
                }}
            />

            <ButtonRow
                label="Themes folder"
                buttonLabel="Open"
                disabled={disabled}
                onClick={() => void rpc.openThemesFolder()}
            />
        </PanelSection>
    );
}

const TIER_LABELS: Record<Tier, string> = {
    normal: "Normal",
    magic: "Magic",
    rare: "Rare",
    exceptional: "Exceptional",
};

function tierRule(tier: Tier): string {
    const tiers = activeTheme()?.theme.tiers;
    const magic = tiers?.magic.threshold,
        rare = tiers?.rare.threshold;

    switch (tier) {
        case "exceptional":
            return "Triggers on all achievements unlocked";
        case "rare":
            return rare !== null && rare !== undefined
                ? `${rare}% or less Players Rarity.`
                : "Unused by this theme (no threshold set)";
        case "magic":
            return magic !== null && magic !== undefined
                ? `${magic}% or less Players Rarity.`
                : "Unused by this theme (no threshold set)";
        default:
            return "Anything below Magic Rarity";
    }
}

function PreviewSection({ disabled }: { disabled: boolean }) {
    const [, rerender] = useState(0);

    useEffect(() => onThemeChange(() => rerender((n) => n + 1)), []);

    return (
        <PanelSection title="Preview Achievements">
            {TIERS.map((tier) => (
                <ButtonRow
                    key={tier}
                    label={TIER_LABELS[tier]}
                    description={tierRule(tier)}
                    buttonLabel="Preview"
                    disabled={disabled}
                    onClick={() => void previewTier(tier)}
                />
            ))}
        </PanelSection>
    );
}

/** A problem with the selected theme worth showing under the dropdown, or null when all is well. */
function themeProblem(): string | null {
    const loaded = activeTheme();

    if (!loaded) {
        return setting("theme")
            ? "Could not load this theme (see the log): using Steam's stock toast and chime."
            : null;
    }

    const warnings = loaded.theme.warnings.length;
    return warnings
        ? `Loaded with ${warnings} warning${warnings === 1 ? "" : "s"} (see the log): the affected fields use their defaults.`
        : null;
}

function CapturesSection({ disabled }: { disabled: boolean }) {
    const [screenshotOn] = useSetting("screenshot.enabled");
    const [clipOn] = useSetting("recording.enabled");

    return (
        <PanelSection title="Screenshots & Recordings">
            <ToggleRow
                k="screenshot.enabled"
                label="Screenshot on unlock"
                description="Needs Game Recording on"
                disabled={disabled}
            />

            <SliderRow
                k="screenshot.delay_ms"
                label="Screenshot delay"
                suffix=" ms"
                disabled={disabled || !screenshotOn}
            />

            <ToggleRow
                k="recording.enabled"
                label="Record clip on unlock"
                description="Saves the last length seconds"
                disabled={disabled}
            />

            <SliderRow
                k="recording.duration_s"
                label="Clip length"
                suffix=" s"
                disabled={disabled || !clipOn}
            />

            <SliderRow
                k="recording.delay_ms"
                label="Clip delay"
                suffix=" ms"
                disabled={disabled || !clipOn}
            />

            <ToggleRow
                k="recording.add_timeline_marker"
                label="Timeline marker"
                description="Non-Steam games only"
                disabled={disabled}
            />
        </PanelSection>
    );
}

export function SettingsPanel() {
    const disabled = usePanelDisabled();

    return (
        <>
            {disabled && (
                <DialogBodyText>
                    Steam's toast notifications are off, so this plugin cannot
                    trigger anything. Turn them on in Steam Settings -&gt;
                    Notifications.
                </DialogBodyText>
            )}

            <ThemeSection disabled={disabled} />
            <PreviewSection disabled={disabled} />

            <PanelSection title="General">
                <ToggleRow
                    k="queue.enabled"
                    label="Achievement queue"
                    description="One banner at a time instead of Steam's stacking"
                    disabled={disabled}
                />
            </PanelSection>

            <CapturesSection disabled={disabled} />

            <PanelSection title="Reset">
                <ButtonRow
                    label="Reset to defaults"
                    description="Clear every changed setting"
                    buttonLabel="Reset"
                    disabled={disabled}
                    onClick={() => void resetSettings()}
                />
            </PanelSection>
        </>
    );
}
