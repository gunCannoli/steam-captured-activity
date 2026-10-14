import { useEffect, useRef, useState } from "react";
import {
    ConfirmModal,
    DialogBodyText,
    DialogButton,
    Dropdown,
    Field,
    PanelSection,
    TextField,
    Toggle,
} from "@steambrew/client";
import { logger } from "../logger";
import { rpc, type ThemeEntry } from "../rpc";
import {
    achievementTheme,
    onThemeChange,
    reloadTheme,
    themeIssues,
    type LoadedAchievementTheme,
    type ThemeIssues,
} from "../theme/active-theme";
import { STEAM_DEFAULT_THEME } from "../theme/schema";
import { TIERS, type Tier } from "../theme/achievements";
import {
    filterCandidates,
    resetWarning,
    type AchievementResetApi,
    type ResetCandidate,
    type ResetResult,
    type ResetSource,
} from "../kernel/reset";
import { showDialog } from "../steam/modal";
import { resetSettings, useSetting } from "./settings";
import { openThemeCreator, type CreatorDeps } from "./creator";
import {
    Blocks,
    ButtonRow,
    CARD_BACKGROUND,
    CONTROL_GAP,
    ItemRow,
    SliderRow,
    STEAM_TRAILING,
    ToggleRow,
    usePanelDisabled,
} from "./rows";

/**
 * Settings panel in Millennium's sidebar (definePlugin `content`): Steam's components and the rows and spacing system
 * of ./rows.tsx (docs/plugins.md guardrail 18). Themes are hand-edited JSONC (shareable); the panel's job is picking
 * one and previewing it quickly. The achievement sections came with the banner (enhanced-achievements, merged; ADR-0050).
 */

/**
 * A theme's load problems, in a dialog the user closes rather than a line that stays in the panel. Shown only after a
 * load the user started (picking a theme, Reload), never for the load at Steam's start.
 */
function showThemeIssues(found: ThemeIssues) {
    const title = found.error
        ? `Theme "${found.name}" could not be loaded`
        : `Theme "${found.name}" loaded with warnings`;
    const lead = found.error
        ? "Notifications keep Steam's look and sound instead."
        : `${found.warnings.length} field${found.warnings.length === 1 ? "" : "s"} could not be used and fell back to the default:`;
    const lines = found.error ? [found.error] : found.warnings;
    showDialog(
        <ConfirmModal
            strTitle={title}
            strDescription={
                <>
                    <div>{lead}</div>
                    <ul
                        style={{
                            margin: "8px 0 0",
                            paddingLeft: "20px",
                            maxHeight: "160px",
                            overflowY: "auto",
                            userSelect: "text",
                        }}
                    >
                        {lines.map((line, i) => (
                            <li key={i}>{line}</li>
                        ))}
                    </ul>
                </>
            }
            strOKButtonText="Close"
            bAlertDialog
        />,
        { strTitle: "Theme problems", popupWidth: 560, popupHeight: 360 },
    );
}

/** A theme's name in the dropdown: "(jsonc)" marks the .jsonc one of a .json / .jsonc pair with the same name. */
function themeLabel(t: ThemeEntry, all: ThemeEntry[]): string {
    const paired = all.some((o) => o !== t && o.name === t.name);
    return paired && t.ext === ".jsonc" ? `${t.name} (jsonc)` : t.name;
}

function ThemeSection({ disabled, creator }: { disabled: boolean; creator: CreatorDeps }) {
    const [theme, setTheme] = useSetting("theme");
    const [themes, setThemes] = useState<ThemeEntry[]>([]);
    // Set by a load the user started here (theme picked, Reload); the next finished load then reports its problems.
    const awaitingLoad = useRef(false);

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
        return onThemeChange(() => {
            if (!awaitingLoad.current) return;
            awaitingLoad.current = false;
            const found = themeIssues();
            if (found) showThemeIssues(found);
        });
    }, []);

    const options = [
        { data: STEAM_DEFAULT_THEME, label: "Steam default" },
        ...themes.map((t) => ({ data: t.id, label: themeLabel(t, themes) })),
    ];
    if (theme !== STEAM_DEFAULT_THEME && !themes.some((t) => t.id === theme))
        options.push({ data: theme, label: `${theme} (missing)` });

    return (
        <PanelSection title="Theme">
            <Blocks>
                <>
                    {/* Three rows: label, description, then the dropdown across the full row (guardrail 18.3). */}
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
                                contextMenuPositionOptions={{
                                    bMatchWidth: true,
                                }}
                                onChange={(o) => {
                                    const next = o.data as string;
                                    if (next !== theme)
                                        awaitingLoad.current = true;
                                    setTheme(next);
                                }}
                            />
                        </Field>
                    </ItemRow>
                </>
                <ButtonRow
                    label="Theme Creator"
                    description="Make a new theme or edit one of yours, for desktop and Big Picture, with a live preview"
                    buttonLabel="Open"
                    onClick={() => openThemeCreator(creator)}
                />
                <>
                    <ButtonRow
                        label="Reload themes"
                        buttonLabel="Reload"
                        disabled={disabled}
                        onClick={() => {
                            void (async () => {
                                await refresh();
                                awaitingLoad.current = true;
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

function tierRule(tier: Tier, loaded: LoadedAchievementTheme): string {
    const { magic, rare } = loaded.theme.tiers;
    switch (tier) {
        case "exceptional":
            return "All achievements unlocked";
        case "rare":
            return rare.threshold !== null
                ? `${rare.threshold}% of players or fewer`
                : "Unused (no threshold)";
        case "magic":
            return magic.threshold !== null
                ? `${magic.threshold}% of players or fewer`
                : "Unused (no threshold)";
        default:
            return "Every other achievement";
    }
}

/** A preview id and its name (index.tsx: the preview surface's list). */
export interface PreviewOption {
    id: string;
    label: string;
}

/** Four rows on one card: label, description, the notification dropdown, then the Preview button. */
function SelectPreviewRows({
    disabled,
    options,
    onPreview,
}: {
    disabled: boolean;
    options: PreviewOption[];
    onPreview: (id: string) => Promise<unknown>;
}) {
    const [selected, setSelected] = useState(options[0]?.id ?? "");

    return (
        <ItemRow>
            {/* The card's background belongs to Steam's Field, so this wrapper paints the same colour under the controls and the two read as one card. */}
            <div style={{ background: CARD_BACKGROUND, borderRadius: "2px" }}>
                <Field
                    label="Select Notification"
                    description="Preview the selected notification"
                    disabled={disabled}
                    bottomSeparator="none"
                />
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: CONTROL_GAP,
                        padding: "0 12px 12px",
                    }}
                >
                    <Dropdown
                        rgOptions={options.map((o) => ({
                            data: o.id,
                            label: o.label,
                        }))}
                        selectedOption={selected}
                        disabled={disabled}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                        onChange={(o) => setSelected(o.data as string)}
                    />
                    <DialogButton
                        disabled={disabled || !selected}
                        onClick={() => void onPreview(selected)}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                            alignSelf: "flex-end",
                        }}
                    >
                        Preview
                    </DialogButton>
                </div>
            </div>
        </ItemRow>
    );
}

/** `onPreview` is injected by index.tsx: the panel never imports a surface. */
function PreviewSection({
    disabled,
    onPreview,
    previewOptions,
}: {
    disabled: boolean;
    onPreview: (id?: string) => Promise<unknown>;
    previewOptions: PreviewOption[];
}) {
    return (
        <PanelSection title="Preview Notifications">
            <Blocks>
                <ButtonRow
                    label="Random notification"
                    description="Shows a random notification with the selected theme"
                    buttonLabel="Preview"
                    disabled={disabled}
                    onClick={() => void onPreview()}
                />
                <SelectPreviewRows
                    disabled={disabled}
                    options={previewOptions}
                    onPreview={(id) => onPreview(id)}
                />
            </Blocks>
        </PanelSection>
    );
}

/** One row per rarity tier, only when the theme has an `achievements` block. `onPreviewTier` is injected by index.tsx. */
function AchievementsPreviewSection({
    disabled,
    onPreviewTier,
}: {
    disabled: boolean;
    onPreviewTier: (tier: Tier) => void;
}) {
    const [loaded, setLoaded] = useState(() => achievementTheme());
    useEffect(() => onThemeChange(() => setLoaded(achievementTheme())), []);
    if (!loaded) return null;

    return (
        <PanelSection title="Preview Achievements">
            {TIERS.map((tier) => (
                <ButtonRow
                    key={tier}
                    label={TIER_LABELS[tier]}
                    description={tierRule(tier, loaded)}
                    buttonLabel="Preview"
                    disabled={disabled}
                    onClick={() => void onPreviewTier(tier)}
                />
            ))}
        </PanelSection>
    );
}

function AchievementsSection({ disabled }: { disabled: boolean }) {
    const [screenshotOn] = useSetting("screenshot.enabled");
    const [clipOn] = useSetting("recording.enabled");

    return (
        <PanelSection title="General">
            <Blocks>
                <ToggleRow
                    k="queue.enabled"
                    label="Notifications queue"
                    description="One notification at a time instead of Steam's stacking"
                    disabled={disabled}
                />
                <>
                    <ToggleRow
                        k="screenshot.enabled"
                        label="Screenshot on unlock"
                        description="Starts a Steam recording if none is running"
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
                        description="Starts a Steam recording if none is running"
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
            </Blocks>
        </PanelSection>
    );
}

function resultText(
    c: ResetCandidate,
    result: ResetResult,
    sources: ResetSource[],
): string {
    if (!result.ok) return result.reason;
    const main =
        result.remaining > 0 || result.skipped > 0
            ? `Cleared ${result.cleared} in ${c.name}; ${result.remaining} still show as unlocked (Steam may need a moment, or a restart).`
            : `Cleared all achievements in ${c.name}.`;
    const labelOf = (id: string) =>
        sources.find((s) => s.id === id)?.label ?? id;
    const files = (result.sources ?? []).map((r) =>
        r.ok
            ? `${labelOf(r.id)}: ${r.cleared} cleared (backup kept next to the file).`
            : `${labelOf(r.id)}: not cleared (${r.error ?? "failed"}).`,
    );
    return [main, ...files].join(" ");
}

/**
 * One dialog from confirm to outcome. Steam's confirm dialog closes itself on OK, and a second dialog opened while the
 * first popout window is closing never shows on desktop, so OK keeps this one open (its `closeModal` is held) and the
 * same dialog shows "Resetting..." and then the outcome, with one Close button.
 * `closeModal` is injected by showModal. `onStart`/`onFinished` bracket the reset itself, so the panel's Reset button is
 * disabled only while it runs, whatever the user does with the dialog.
 */
function ResetDialog({
    candidate: c,
    sources,
    api,
    onStart,
    onFinished,
    closeModal,
}: {
    candidate: ResetCandidate;
    /** Where the game's unlocks also live (steam-cartridges), loaded before the dialog opens. */
    sources: ResetSource[];
    api: AchievementResetApi;
    onStart: () => void;
    onFinished: () => void;
    closeModal?: () => void;
}) {
    const [phase, setPhase] = useState<"confirm" | "running" | "done">(
        "confirm",
    );
    // "Also reset ..." choices, off until the user turns one on: clearing files is the bigger step.
    const [chosen, setChosen] = useState<Set<string>>(() => new Set());
    const resettable = sources.filter((s) => s.resettable);
    // A source reset by hand on a web page (RetroAchievements): its switch opens the page after the reset.
    const manual = sources.filter((s) => !s.resettable && s.url);
    const toggle = (id: string, on: boolean) =>
        setChosen((prev) => {
            const next = new Set(prev);
            if (on) next.add(id);
            else next.delete(id);
            return next;
        });
    const [outcome, setOutcome] = useState("");
    const hold = useRef(false);
    const close = () => {
        if (!hold.current) closeModal?.();
    };
    const start = async () => {
        hold.current = true;
        setPhase("running");
        onStart();
        const result = await api.reset(
            c,
            resettable.filter((s) => chosen.has(s.id)).map((s) => s.id),
        );
        hold.current = false;
        const opened = manual.filter(
            (s) => chosen.has(s.id) && api.openPage(s.url!),
        );
        const pages = opened.map(
            (s) =>
                `${s.label}: its game page opened in your browser; press Manage progress there.`,
        );
        setOutcome([resultText(c, result, sources), ...pages].join(" "));
        setPhase("done");
        onFinished();
    };

    if (phase === "confirm") {
        return (
            <ConfirmModal
                strTitle="Reset achievements"
                strDescription={
                    <>
                        <div>{resetWarning(c, sources, chosen)}</div>
                        {resettable.map((s) => (
                            <Field
                                key={s.id}
                                label={`Also reset ${s.label}`}
                                description={`${s.unlocked} unlocked`}
                                bottomSeparator="none"
                            >
                                <Toggle
                                    value={chosen.has(s.id)}
                                    onChange={(on) => toggle(s.id, on)}
                                />
                            </Field>
                        ))}
                        {manual.map((s) => (
                            <Field
                                key={s.id}
                                label={`Open ${s.label} to reset manually`}
                                description="Opens the game's page after the reset; press Manage progress there"
                                bottomSeparator="none"
                            >
                                <Toggle
                                    value={chosen.has(s.id)}
                                    onChange={(on) => toggle(s.id, on)}
                                />
                            </Field>
                        ))}
                    </>
                }
                strOKButtonText="Reset"
                bDestructiveWarning
                onOK={() => void start()}
                closeModal={close}
            />
        );
    }
    return (
        <ConfirmModal
            strTitle="Reset achievements"
            strDescription={phase === "running" ? "Resetting..." : outcome}
            strOKButtonText="Close"
            bAlertDialog
            bOKDisabled={phase === "running"}
            closeModal={close}
        />
    );
}

/**
 * Five rows (label, description, then the three controls), the same convention as the theme picker.
 * Reset is never disabled by Steam's toasts being off: it does not use them. `api` is injected by index.tsx.
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
        ...visible.map((c) => ({
            data: c.appid,
            label: `${c.name} (${c.unlocked}/${c.total})`,
        })),
    ];
    const available = api.available();

    const confirm = async () => {
        if (!chosen) return;
        // Where the unlocks also live decides the warning and the "Also reset" rows, so it is asked before the dialog
        // opens (its window size is set once, at open).
        setBusy(true);
        const sources = await api.sources(chosen);
        setBusy(false);
        const rows = sources.filter((s) => s.resettable || s.url).length;
        const notes = sources.filter((s) => !s.resettable || s.note).length;
        showDialog(
            <ResetDialog
                candidate={chosen}
                sources={sources}
                api={api}
                onStart={() => setBusy(true)}
                onFinished={() => {
                    setBusy(false);
                    setSelected(0);
                    reload();
                }}
            />,
            {
                strTitle: "Reset achievements",
                popupWidth: 480,
                popupHeight:
                    250 + rows * 64 + notes * 40 + (sources.length ? 20 : 0),
            },
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
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: CONTROL_GAP,
                        padding: "0 12px 12px",
                    }}
                >
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
                        onClick={() => void confirm()}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                            alignSelf: "flex-end",
                        }}
                    >
                        Reset
                    </DialogButton>
                </div>
            </div>
        </ItemRow>
    );
}

/** `onPreview`, `previewOptions`, `onPreviewTier`, `achievementReset` and `creator` are injected by index.tsx: this panel never imports a surface. */
export function SettingsPanel({
    onPreview,
    previewOptions,
    onPreviewTier,
    achievementReset,
    creator,
}: {
    onPreview: (id?: string) => Promise<unknown>;
    previewOptions: PreviewOption[];
    onPreviewTier: (tier: Tier) => void;
    achievementReset: AchievementResetApi;
    creator: CreatorDeps;
}) {
    const disabled = usePanelDisabled();

    return (
        <>
            {disabled && (
                <DialogBodyText>
                    Steam's toast notifications are off, so styled toasts,
                    achievement banners, sounds, display time and captures on
                    unlock will not happen. Turn them on in Steam Settings -&gt;
                    Notifications.
                </DialogBodyText>
            )}

            <ThemeSection disabled={disabled} creator={creator} />
            <PreviewSection
                disabled={disabled}
                onPreview={onPreview}
                previewOptions={previewOptions}
            />
            <AchievementsPreviewSection
                disabled={disabled}
                onPreviewTier={onPreviewTier}
            />

            <AchievementsSection disabled={disabled} />

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
