import { useEffect, useState } from "react";
import {
    DialogBodyText,
    DialogButton,
    ConfirmModal,
    Dropdown,
    Field,
    PanelSection,
    TextField,
    showModal,
} from "@steambrew/client";
import { logger } from "../logger";
import { rpc, type ThemeEntry } from "../rpc";
import { activeTheme, onThemeChange, reloadTheme } from "../theme/active-theme";
import { TIERS, type Tier } from "../theme/theme";
import { filterCandidates, type AchievementResetApi, type ResetCandidate } from "../kernel/reset";
import { resetSettings, setting, useSetting } from "./settings";
import { Blocks, ButtonRow, CARD_BACKGROUND, CONTROL_GAP, ItemRow, SliderRow, STEAM_TRAILING, ToggleRow, usePanelDisabled } from "./rows";

// Rows and the spacing system (Blocks, BLOCK_GAP, ItemRow trailing) live in ./rows.tsx, shared with enhanced-notifications.

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
            <Blocks>
                <>
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
                </>
                <>
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
                </>
            </Blocks>
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

function PreviewSection({ disabled, onPreview }: { disabled: boolean; onPreview: (tier: Tier) => void }) {
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
                    onClick={() => void onPreview(tier)}
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
            <Blocks>
                <>
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
                </>
                <>
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
                </>
                <>
                <ToggleRow
                    k="recording.add_timeline_marker"
                    label="Timeline marker"
                    description="Non-Steam games only"
                    disabled={disabled}
                />
                </>
            </Blocks>
        </PanelSection>
    );
}

/**
 * Five rows (label, description, then the three controls), the same convention as the theme picker.
 * Reset is never disabled by Steam's toasts being off: it does not use them. `api` is injected (D7).
 */
function ResetAchievementsRows({ api }: { api: AchievementResetApi }) {
    const [all, setAll] = useState<ResetCandidate[]>([]);
    const reload = () => setAll(api.candidates());
    useEffect(reload, []);
    const [filter, setFilter] = useState("");
    const [selected, setSelected] = useState(0);
    const [busy, setBusy] = useState(false);

    const visible = filterCandidates(all, filter);
    const chosen = visible.find((c) => c.appid === selected);
    const options = [
        { data: 0, label: "All games" },
        ...visible.map((c) => ({ data: c.appid, label: `${c.name} (${c.unlocked}/${c.total})` })),
    ];
    const available = api.available();

    const run = async (c: ResetCandidate) => {
        setBusy(true);
        const result = await api.reset(c);
        setBusy(false);
        // The outcome goes in a popup the user closes, not in the panel, where it would stay until the page is left.
        showResult(
            !result.ok
                ? result.reason
                : result.remaining > 0 || result.skipped > 0
                  ? `Cleared ${result.cleared} in ${c.name}; ${result.remaining} still show as unlocked (Steam may need a moment, or a restart).`
                  : `Cleared all achievements in ${c.name}.`,
        );
        setSelected(0);
        reload();
    };

    /** Steam's confirm dialog closes itself on OK, so the outcome is a second, alert-style dialog: one Close button, plus the title bar's X. */
    const showResult = (text: string) => {
        showModal(
            <ConfirmModal
                strTitle="Reset achievements"
                strDescription={text}
                strOKButtonText="Close"
                bAlertDialog
                bHideCloseIcon={false}
            />,
            window,
        );
    };

    const confirm = () => {
        if (!chosen) return;
        showModal(
            <ConfirmModal
                strTitle="Reset achievements"
                strDescription={`${chosen.name} will lose all its achievements (${chosen.unlocked} unlocked). ${
                    chosen.kind === "steam" ? "They are cleared on your Steam account. " : ""
                }This cannot be undone.`}
                strOKButtonText="Reset"
                bDestructiveWarning
                onOK={() => void run(chosen)}
            />,
            window,
        );
    };

    // One block: the label and description, then the filter, dropdown and button, all in one row (one card).
    return (
        <ItemRow>
            {/* The card's background belongs to Steam's Field, so this wrapper paints the same colour under the controls and the two read as one card. */}
            <div style={{ background: CARD_BACKGROUND, borderRadius: "2px" }}>
            <Field
                label="Reset Achievements"
                description="Select a game to reset the achievements count"
                disabled={!available}
                bottomSeparator="none"
            />
            <div style={{ display: "flex", flexDirection: "column", gap: CONTROL_GAP, padding: "0 12px 12px" }}>
                {/* Steam's text field ends with 22 px of blank space: pull the dropdown up to 8 px below it. */}
                <div style={{ marginBottom: -STEAM_TRAILING }}>
                    <TextField
                        label="Games filter"
                        value={filter}
                        disabled={!available}
                        onFocus={reload}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                </div>
                <Dropdown
                    rgOptions={options}
                    selectedOption={chosen ? chosen.appid : 0}
                    disabled={!available}
                    contextMenuPositionOptions={{ bMatchWidth: true }}
                    onChange={(o) => setSelected(o.data as number)}
                />
                <DialogButton
                    disabled={!available || busy || !chosen}
                    onClick={confirm}
                    style={{ padding: "0 16px", minWidth: 0, width: "auto", alignSelf: "flex-end" }}
                >
                    Reset
                </DialogButton>
            </div>
            </div>
        </ItemRow>
    );
}

/** `onPreview` and `achievementReset` are injected by index.tsx: this panel must not import a surface (migration D7). */
export function SettingsPanel({ onPreview, achievementReset }: { onPreview: (tier: Tier) => void; achievementReset: AchievementResetApi }) {
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
            <PreviewSection disabled={disabled} onPreview={onPreview} />

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
                <Blocks>
                <ButtonRow
                    label="Reset to defaults"
                    description="Clear every changed setting"
                    buttonLabel="Reset"
                    disabled={disabled}
                    onClick={() => void resetSettings()}
                />

                <ResetAchievementsRows api={achievementReset} />
                </Blocks>
            </PanelSection>
        </>
    );
}
