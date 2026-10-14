import { useEffect, useState } from "react";
import { ConfirmModal, DialogButton, Dropdown, Field, PanelSection } from "@steambrew/client";
import { audio } from "../../theme/active-theme";
import type { Tier } from "../../theme/achievements";
import { getAt, libraryPath, modePath, originOf, type CreatorDraft } from "../../theme/draft";
import type { ThemeMode } from "../../theme/theme";
import type { SoundLibraryManifest } from "../../rpc";
import { showDialog } from "../../steam/modal";
import { Blocks, BUTTON_STYLE, ButtonRow, ControlledSliderRow, FullWidthRows, IconButton, ItemRow } from "../rows";
import { CreatorContext, useCreator, type CreatorApi } from "./controls";
import { applyPack, CUES, currentCue, PAIRING_HINT, setSound, soundPath, type CueChoice, type SoundTarget } from "./model";

/**
 * Sounds in the Theme Creator (theme creator plan § 4.7): playback through the plugin's one AudioContext, the
 * notification sound and each tier's sound, the Sound pack panel (a pack, then Subtle / Distinct / Grand per target)
 * and the single sound picker (any library cue, or a file in the theme's folder).
 */

// --- playback ---------------------------------------------------------------------------------------

const decoded = new Map<string, AudioBuffer>();
let playing: AudioBufferSourceNode | null = null;

function dataUrlToBuffer(url: string): ArrayBuffer {
    const binary = atob(url.slice(url.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/** Play a file the draft names (or a library cue), at `volume` %. A new clip stops the one playing. */
export async function play(api: Pick<CreatorApi, "loadAsset">, path: string, volume: number): Promise<void> {
    const ctx = audio();
    void ctx.resume(); // a click is a user gesture
    let buffer = decoded.get(path);
    if (!buffer) {
        const url = await api.loadAsset(path);
        if (!url) return;
        buffer = await ctx.decodeAudioData(dataUrlToBuffer(url));
        decoded.set(path, buffer);
    }
    playing?.stop();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume / 100));
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    source.start();
    playing = source;
}

/** Forget decoded clips (the creator closed). */
export function releaseClips(): void {
    playing?.stop();
    playing = null;
    decoded.clear();
}

/** A sound value in words: "Celtic Harp · Grand, 80 %", "my.wav, 50 %", "Steam's chime", "Muted". */
export function describeSound(value: unknown, draft: CreatorDraft, library: SoundLibraryManifest | null): string {
    if (value === false) return "Muted";
    if (!Array.isArray(value) || typeof value[0] !== "string") return "Steam's chime";
    const file = value[0];
    const vol = typeof value[1] === "number" ? value[1] : 100;
    const pick = draft.pendingCopies[file];
    const saved = /(?:^|\/)([A-Za-z0-9_]+)_(subtle|distinct|grand)(?:-\d+)?\.wav$/.exec(file);
    const m = pick ?? (saved ? { pack: saved[1]!, cue: saved[2]! } : null);
    const pack = m && library?.packs.find((p) => p.id === m.pack);
    const cue = m && library?.cues.find((c) => c.id === m.cue);
    return `${pack && cue ? `${pack.label} · ${cue.label}` : file}, ${vol} %`;
}

// --- one target's sound -------------------------------------------------------------------------------

/** The notification sound, or a tier's: Steam's (or inherited) / mute / a sound with ▶ and its volume, and "Choose a sound". */
function SoundTargetBlocks({ target, title }: { target: SoundTarget; title: string }) {
    const api = useCreator();
    const path = soundPath(target);
    const origin = originOf(api.draft.raw, api.mode, path);
    const own = origin.kind === "set" ? origin.value : undefined;
    const kind = own === false ? "mute" : Array.isArray(own) ? "sound" : "unset";
    const inheritedLabel = target === "notification" ? (api.mode === "bigpicture" ? "From desktop" : "Steam's chime") : "From Normal / the notification sound";
    const file = Array.isArray(own) && typeof own[0] === "string" ? own[0] : null;
    const volume = Array.isArray(own) && typeof own[1] === "number" ? own[1] : 80;
    return (
        <PanelSection title={title}>
            <Blocks>
                <FullWidthRows label="Sound" description={kind === "unset" ? `Now: ${describeSound(getAt(api.draft.raw, path), api.draft, api.library)}` : undefined}>
                    <Dropdown
                        rgOptions={[
                            { data: "unset", label: inheritedLabel },
                            ...(target === "notification" && api.mode === "bigpicture" ? [{ data: "steam", label: "Steam's chime" }] : []),
                            { data: "mute", label: "Mute" },
                            { data: "sound", label: "A sound" },
                        ]}
                        selectedOption={own === null ? "steam" : kind}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                        onChange={(o) => {
                            if (o.data === "unset") api.unset(path);
                            else if (o.data === "steam") api.replace(setSound(api.draft, api.mode, target, "steam"));
                            else if (o.data === "mute") api.replace(setSound(api.draft, api.mode, target, "mute"));
                            else openPicker(api, target, null);
                        }}
                    />
                </FullWidthRows>
                {kind === "sound" && file && (
                    <>
                        <ItemRow>
                            <Field label={describeSound(own, api.draft, api.library)} bottomSeparator="none">
                                <IconButton title="Play" onClick={() => void play(api, file, volume)}>
                                    ▶
                                </IconButton>
                            </Field>
                        </ItemRow>
                        <ControlledSliderRow label="Volume" value={volume} min={0} max={100} suffix=" %" onChange={(v) => api.set(path, [file, v])} />
                    </>
                )}
                {kind === "sound" && <ButtonRow label="Choose a sound" description="A cue from the library, or a file in the theme's folder" buttonLabel="Choose..." onClick={() => openPicker(api, target, file)} />}
            </Blocks>
        </PanelSection>
    );
}

export function TierSoundBlocks({ tier }: { tier: Tier }) {
    return <SoundTargetBlocks target={tier} title="Sound" />;
}

// --- the Sound page ---------------------------------------------------------------------------------------

export function SoundPage() {
    return (
        <>
            <SoundTargetBlocks target="notification" title="Notification sound" />
            <SoundPackPanel />
        </>
    );
}

const TARGET_LABEL: Record<SoundTarget, string> = { notification: "Notification", normal: "Normal", magic: "Magic", rare: "Rare", exceptional: "Exceptional" };

/** Pick a pack, then a cue per target (Keep leaves it), Apply writes them all (one undo step). */
function SoundPackPanel() {
    const api = useCreator();
    const library = api.library;
    const [pack, setPack] = useState<string>(() => library?.packs[0]?.id ?? "");
    const [choices, setChoices] = useState<Partial<Record<SoundTarget, { cue: CueChoice; volume: number }>>>({});
    useEffect(() => {
        if (!pack && library?.packs[0]) setPack(library.packs[0].id);
    }, [library]);
    if (!library || !library.packs.length) return null;
    const info = library.packs.find((p) => p.id === pack) ?? library.packs[0]!;
    const hasBanner = getAt(api.draft.raw, ["achievements"]) !== undefined || getAt(api.draft.raw, ["bigpicture", "achievements"]) !== undefined;
    const targets: SoundTarget[] = hasBanner ? ["notification", "normal", "magic", "rare", "exceptional"] : ["notification"];
    const choiceOf = (t: SoundTarget) => choices[t] ?? { cue: (currentCue(api.draft, api.mode, t, info.id) ?? "keep") as CueChoice, volume: 80 };
    return (
        <PanelSection title="Sound pack">
            <Blocks>
                <FullWidthRows label="Pack" description={`${info.category} · ${info.description}`}>
                    <Dropdown
                        rgOptions={library.packs.map((p) => ({ data: p.id, label: `${p.label} (${p.category})` }))}
                        selectedOption={info.id}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                        onChange={(o) => {
                            setPack(o.data as string);
                            setChoices({});
                        }}
                    />
                </FullWidthRows>
                <>
                    {library.cues.map((c) => (
                        <ItemRow key={c.id}>
                            <Field label={c.label} description={`${info.seconds[c.id] ?? c.seconds} s`} bottomSeparator="none">
                                <IconButton title="Play" onClick={() => void play(api, libraryPath(info.id, c.id), 80)}>
                                    ▶
                                </IconButton>
                            </Field>
                        </ItemRow>
                    ))}
                </>
                {targets.map((t) => {
                    const choice = choiceOf(t);
                    const now = getAt(api.draft.raw, modePath(api.mode, soundPath(t)));
                    return (
                        <div key={t}>
                            <ItemRow>
                                <Field label={TARGET_LABEL[t]} description={`Now: ${describeSound(now, api.draft, library)}${choice.cue === "keep" ? ` · ${PAIRING_HINT[t]}` : ""}`} bottomSeparator="none">
                                    <IconButton title="Play the new choice" disabled={choice.cue === "keep"} onClick={() => choice.cue !== "keep" && void play(api, libraryPath(info.id, choice.cue), choice.volume)}>
                                        ▶
                                    </IconButton>
                                </Field>
                            </ItemRow>
                            <ItemRow>
                                <Field childrenContainerWidth="max" bottomSeparator="none">
                                    <Dropdown
                                        rgOptions={[{ data: "keep", label: "Keep" }, ...CUES.map((c) => ({ data: c, label: library.cues.find((x) => x.id === c)?.label ?? c }))]}
                                        selectedOption={choice.cue}
                                        contextMenuPositionOptions={{ bMatchWidth: true }}
                                        onChange={(o) => setChoices({ ...choices, [t]: { ...choice, cue: o.data as CueChoice } })}
                                    />
                                </Field>
                            </ItemRow>
                            <ControlledSliderRow label="Volume" value={choice.volume} min={0} max={100} suffix=" %" disabled={choice.cue === "keep"} onChange={(v) => setChoices({ ...choices, [t]: { ...choice, volume: v } })} />
                        </div>
                    );
                })}
                {!hasBanner && (
                    <ItemRow>
                        <Field label="Tier sounds" description="Turn on the achievement banner to give each tier its own sound" />
                    </ItemRow>
                )}
                <ButtonRow
                    label="Apply to the theme"
                    description="Changes the rows not set to Keep"
                    buttonLabel="Apply"
                    onClick={() => {
                        const all = Object.fromEntries(targets.map((t) => [t, choiceOf(t)]));
                        api.replace(applyPack(api.draft, api.mode, info.id, all));
                        setChoices({});
                    }}
                />
            </Blocks>
        </PanelSection>
    );
}

// --- the single sound picker -------------------------------------------------------------------------------

function openPicker(api: CreatorApi, target: SoundTarget, current: string | null) {
    showDialog(
        <CreatorContext.Provider value={api}>
            <SoundPicker api={api} target={target} current={current} />
        </CreatorContext.Provider>,
        { strTitle: "Choose a sound", popupWidth: 520, popupHeight: 640 },
    );
}

const CATEGORIES = ["All", "Chiptune", "Bells", "Strings", "Orchestral", "World", "Synth"];

function SoundPicker({ api, target, current, closeModal }: { api: CreatorApi; target: SoundTarget; current: string | null; closeModal?: () => void }) {
    const library = api.library;
    const startPick = current ? api.draft.pendingCopies[current] : undefined;
    const [source, setSource] = useState<"library" | "files">(current && !startPick ? "files" : "library");
    const [category, setCategory] = useState("All");
    const packs = (library?.packs ?? []).filter((p) => category === "All" || p.category === category);
    const [pack, setPack] = useState(startPick?.pack ?? library?.packs[0]?.id ?? "");
    const [cue, setCue] = useState<string>(startPick?.cue ?? "subtle");
    const [file, setFile] = useState(current && !startPick ? current : (api.files.sounds[0] ?? ""));
    const [volume, setVolume] = useState(80);
    const packInfo = library?.packs.find((p) => p.id === pack);
    const selection = source === "library" ? (packInfo ? `${packInfo.label} · ${library?.cues.find((c) => c.id === cue)?.label}` : "") : file;
    const chosenPath = source === "library" ? libraryPath(pack, cue) : file;
    const use = () => {
        if (!chosenPath) return;
        api.replace(setSound(api.draft, api.mode, target, source === "library" ? { pack, cue, volume } : { file, volume }));
        closeModal?.();
    };
    return (
        <ConfirmModal
            strTitle="Choose a sound"
            strOKButtonText="Use"
            bOKDisabled={!chosenPath}
            onOK={use}
            closeModal={closeModal}
            strDescription={
                <PanelSection>
                    <Blocks>
                        <FullWidthRows label="Source">
                            <Dropdown
                                rgOptions={[
                                    { data: "library", label: "Sound library" },
                                    { data: "files", label: "This theme's files" },
                                ]}
                                selectedOption={source}
                                contextMenuPositionOptions={{ bMatchWidth: true }}
                                onChange={(o) => setSource(o.data as "library" | "files")}
                            />
                        </FullWidthRows>
                        {source === "library" ? (
                            <>
                                <FullWidthRows label="Category">
                                    <Dropdown rgOptions={CATEGORIES.map((c) => ({ data: c, label: c }))} selectedOption={category} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={(o) => setCategory(o.data as string)} />
                                </FullWidthRows>
                                <FullWidthRows label="Pack" description={packInfo?.description}>
                                    <Dropdown rgOptions={packs.map((p) => ({ data: p.id, label: p.label }))} selectedOption={pack} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={(o) => setPack(o.data as string)} />
                                </FullWidthRows>
                                <FullWidthRows label="Cue">
                                    <Dropdown rgOptions={(library?.cues ?? []).map((c) => ({ data: c.id, label: c.label }))} selectedOption={cue} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={(o) => setCue(o.data as string)} />
                                </FullWidthRows>
                            </>
                        ) : api.files.sounds.length ? (
                            <FullWidthRows label="File" description=".mp3, .wav or .ogg in the theme's folder">
                                <Dropdown rgOptions={api.files.sounds.map((f) => ({ data: f, label: f }))} selectedOption={file} contextMenuPositionOptions={{ bMatchWidth: true }} onChange={(o) => setFile(o.data as string)} />
                            </FullWidthRows>
                        ) : (
                            <ItemRow>
                                <Field label="No sounds in the theme's folder" description="Add .mp3 or .wav files to the themes folder, then Rescan" />
                            </ItemRow>
                        )}
                        {source === "files" && (
                            <ItemRow>
                                <Field label="Theme folder" description="Your themes folder in Explorer" bottomSeparator="none">
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <DialogButton style={BUTTON_STYLE} onClick={api.openFolder}>
                                            Open
                                        </DialogButton>
                                        <DialogButton style={BUTTON_STYLE} onClick={api.refreshFiles}>
                                            Rescan
                                        </DialogButton>
                                    </div>
                                </Field>
                            </ItemRow>
                        )}
                        <>
                            <ItemRow>
                                <Field label="Listen" description={selection || "Nothing selected"} bottomSeparator="none">
                                    <IconButton title="Play" disabled={!chosenPath} onClick={() => void play(api, chosenPath, volume)}>
                                        ▶
                                    </IconButton>
                                </Field>
                            </ItemRow>
                            <ControlledSliderRow label="Volume" value={volume} min={0} max={100} suffix=" %" onChange={setVolume} />
                        </>
                    </Blocks>
                </PanelSection>
            }
        />
    );
}

export type { ThemeMode };
