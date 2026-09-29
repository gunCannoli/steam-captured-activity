// Settings: Routing Rules (migration plan M8c, moved verbatim).
import { useState } from "react";
import { DialogButton, Dropdown, PanelSection, TextField } from "@steambrew/client";
import { useSetting } from "../settings";
import { type RoutingRule, type ServiceTarget, type RuleAction, type ConditionType } from "../../domain/routing/policy";
import { usePanelContext } from "../context";
import { ItemRow, ToggleRow, SettingsModal } from "../components";

// ===========================================================================
// 4. {Rules} Routing Engine Section
// ===========================================================================

const SERVICE_OPTIONS = [
    { data: "all", label: "All Services" },
    { data: "steam_store", label: "Steam Store Mirror" },
    { data: "retroachievements", label: "RetroAchievements" },
    { data: "console_emulators", label: "Console Emulators" },
    { data: "screenscraper", label: "ScreenScraper" },
    { data: "igdb", label: "IGDB" },
    { data: "steamgriddb", label: "SteamGridDB" },
];

const ACTION_OPTIONS = [
    { data: "include", label: "Inclusion" },
    { data: "exclude", label: "Exclusion" },
];

const CONDITION_OPTIONS = [
    { data: "collection", label: "Collection" },
    { data: "game_name", label: "Game Title" },
    { data: "regex", label: "Regex Pattern" },
];

const REGEX_EXAMPLES = [
    { pattern: "^Mario.*", desc: "Starts with Mario" },
    { pattern: ".*(Remake|Remaster).*", desc: "Remakes & Remasters" },
    { pattern: ".*(Demo|Beta|Trial).*", desc: "Demos & Betas" },
    { pattern: ".*(Disc|CD)\\s*\\d+.*", desc: "Multi-disc games" },
    { pattern: ".*\\[.*\\].*", desc: "Bracket tags [USA, En...]" },
    { pattern: "CUSA\\d{5}", desc: "PS4 Title IDs (shadPS4)" },
];

export function RulesSection() {
    const ctx = usePanelContext();
    const [rules, setRules] = useSetting("routingRules");
    const [autoMode, setAutoMode] = useSetting("autoRoutingMode");
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    // Rule builder state
    const [name, setName] = useState("");
    const [selectedServices, setSelectedServices] = useState<string[]>(["all"]);
    const [action, setAction] = useState<RuleAction>("include");
    const [conditionType, setConditionType] =
        useState<ConditionType>("collection");
    const [pattern, setPattern] = useState("");
    const [suggestionFilter, setSuggestionFilter] = useState("");

    // Collections & Shortcuts for suggestions
    const collections = ctx.routing.listCollections();
    const shortcuts = ctx.routing.listShortcuts();
    const seenShortcutNames = new Set<string>();
    const uniqueShortcuts = shortcuts.filter((s) => {
        if (!s.name || seenShortcutNames.has(s.name)) return false;
        seenShortcutNames.add(s.name);
        return true;
    });

    const filteredCollections = collections.filter((c) =>
        c.name.toLowerCase().includes(suggestionFilter.toLowerCase()),
    );
    const filteredShortcuts = uniqueShortcuts.filter((s) =>
        s.name.toLowerCase().includes(suggestionFilter.toLowerCase()),
    );

    const selectedParts = new Set(
        pattern
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    );

    const toggleSuggestion = (itemName: string) => {
        const parts = pattern
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (parts.includes(itemName)) {
            setPattern(parts.filter((p) => p !== itemName).join(", "));
        } else {
            setPattern([...parts, itemName].join(", "));
        }
    };

    const toggleService = (svcKey: string) => {
        if (svcKey === "all") {
            setSelectedServices(["all"]);
            return;
        }
        let next = selectedServices.filter((s) => s !== "all");
        if (next.includes(svcKey)) {
            next = next.filter((s) => s !== svcKey);
        } else {
            next.push(svcKey);
        }
        if (next.length === 0 || next.length === SERVICE_OPTIONS.length - 1) {
            setSelectedServices(["all"]);
        } else {
            setSelectedServices(next);
        }
    };

    const handleOpenAdd = () => {
        setEditingIndex(null);
        setName("");
        setSelectedServices(["all"]);
        setAction("include");
        setConditionType("collection");
        setPattern("");
        setSuggestionFilter("");
        setShowAddModal(true);
    };

    const handleOpenEdit = (idx: number) => {
        const r = rules[idx];
        if (!r) return;
        setEditingIndex(idx);
        setName(r.name || "");
        if (!r.service || r.service === "all") {
            setSelectedServices(["all"]);
        } else {
            const split = r.service
                .split(",")
                .map((s) =>
                    s.trim() === "rpcs3" ? "console_emulators" : s.trim(),
                )
                .filter(Boolean);
            setSelectedServices(split.length > 0 ? split : ["all"]);
        }
        setAction(r.action);
        setConditionType(r.conditionType);
        setPattern(r.pattern);
        setSuggestionFilter("");
        setShowAddModal(true);
    };

    const handleSaveRule = async () => {
        if (!name.trim() || !pattern.trim()) return;
        const chosenService = selectedServices.includes("all")
            ? "all"
            : selectedServices.join(",");
        const ruleData: RoutingRule = {
            id:
                editingIndex !== null && rules[editingIndex]
                    ? rules[editingIndex].id
                    : "rule_" + Date.now(),
            name: name.trim(),
            service: chosenService as ServiceTarget,
            action,
            conditionType,
            pattern: pattern.trim(),
            enabled: true,
        };

        const copy = [...rules];
        if (editingIndex !== null) {
            copy[editingIndex] = ruleData;
        } else {
            copy.push(ruleData);
        }
        setRules(copy);
        setShowAddModal(false);

        window.dispatchEvent(new CustomEvent("steam-cartridges:rule-updated"));
        ctx.ingest.trigger(100);
    };

    const handleDelete = (index: number) => {
        const copy = [...rules];
        copy.splice(index, 1);
        setRules(copy);
        window.dispatchEvent(new CustomEvent("steam-cartridges:rule-updated"));
        ctx.ingest.trigger(100);
    };

    return (
        <PanelSection title="Routing Rules">
            <ToggleRow
                label="Auto Mode"
                description="Auto fetches metadata and achievements of the enabled services"
                value={autoMode}
                onChange={(val) => {
                    setAutoMode(val);
                    window.dispatchEvent(
                        new CustomEvent("steam-cartridges:rule-updated"),
                    );
                    if (val) {
                        ctx.ingest.trigger(100);
                    }
                }}
            />

            {rules.length === 0 && (
                <ItemRow>
                    <div
                        style={{
                            opacity: 0.6,
                            fontSize: "12px",
                            padding: "4px 0",
                            fontStyle: "italic",
                        }}
                    >
                        No custom routing rules defined.
                    </div>
                </ItemRow>
            )}

            {/* Compact Rule Rows: Col 1 Name, Col 2 [ ✏️ ] [ 🗑️ ] */}
            {rules.map((rule, idx) => (
                <ItemRow key={rule.id}>
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "6px 10px",
                            background: "rgba(255, 255, 255, 0.03)",
                            border: "1px solid rgba(255, 255, 255, 0.06)",
                            borderRadius: "4px",
                            fontSize: "12px",
                        }}
                    >
                        <span
                            style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                marginRight: "8px",
                                fontWeight: 500,
                                color: "#e1e7ee",
                            }}
                            title={rule.name}
                        >
                            {rule.name}
                        </span>
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                flexShrink: 0,
                            }}
                        >
                            <DialogButton
                                onClick={() => handleOpenEdit(idx)}
                                style={{
                                    padding: "0 8px",
                                    minWidth: 0,
                                    width: "auto",
                                    fontSize: "12px",
                                }}
                            >
                                ✏️
                            </DialogButton>
                            <DialogButton
                                onClick={() => handleDelete(idx)}
                                style={{
                                    padding: "0 8px",
                                    minWidth: 0,
                                    width: "auto",
                                    fontSize: "12px",
                                }}
                            >
                                🗑️
                            </DialogButton>
                        </div>
                    </div>
                </ItemRow>
            ))}

            <ItemRow>
                <div
                    style={{
                        marginTop: "4px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                    }}
                >
                    <DialogButton
                        onClick={handleOpenAdd}
                        style={{
                            padding: "0 14px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        + Add Rule
                    </DialogButton>
                </div>
            </ItemRow>

            {/* Add / Edit Rule Modal */}
            <SettingsModal
                title={
                    editingIndex !== null
                        ? "Edit Routing Rule"
                        : "Add Routing Rule"
                }
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
            >
                <TextField
                    label="Rule Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Services
                    </span>
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                        }}
                    >
                        {SERVICE_OPTIONS.map((opt) => {
                            const isSel =
                                opt.data === "all"
                                    ? selectedServices.includes("all")
                                    : !selectedServices.includes("all") &&
                                      selectedServices.includes(opt.data);
                            return (
                                <button
                                    key={opt.data}
                                    type="button"
                                    onClick={() => toggleService(opt.data)}
                                    style={{
                                        background: isSel
                                            ? "rgba(102, 192, 244, 0.3)"
                                            : "rgba(255, 255, 255, 0.08)",
                                        border: isSel
                                            ? "1px solid #66c0f4"
                                            : "1px solid rgba(255, 255, 255, 0.1)",
                                        color: isSel ? "#66c0f4" : "#fff",
                                        borderRadius: "4px",
                                        padding: "3px 8px",
                                        fontSize: "11px",
                                        cursor: "pointer",
                                        fontWeight: isSel ? 600 : 400,
                                    }}
                                >
                                    {isSel ? "✓ " : ""}
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Action
                    </span>
                    <div
                        style={{
                            fontSize: "11px",
                            opacity: 0.7,
                            marginTop: "-2px",
                        }}
                    >
                        {action === "include"
                            ? "Only apply to matches"
                            : "Never apply to matches"}
                    </div>
                    <Dropdown
                        rgOptions={ACTION_OPTIONS}
                        selectedOption={action}
                        onChange={(o) => setAction(o.data as RuleAction)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Condition
                    </span>
                    <Dropdown
                        rgOptions={CONDITION_OPTIONS}
                        selectedOption={conditionType}
                        onChange={(o) =>
                            setConditionType(o.data as ConditionType)
                        }
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Pattern
                    </span>
                    <textarea
                        rows={Math.min(
                            6,
                            Math.max(2, Math.ceil((pattern.length || 1) / 36)),
                        )}
                        value={pattern}
                        onChange={(e) => setPattern(e.target.value)}
                        placeholder={
                            conditionType === "regex"
                                ? "^Mario.*"
                                : "e.g. Mario, Sonic, Zelda"
                        }
                        style={{
                            width: "100%",
                            boxSizing: "border-box",
                            background: "rgba(0, 0, 0, 0.4)",
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                            borderRadius: "4px",
                            color: "#fff",
                            padding: "6px 10px",
                            fontSize: "12px",
                            fontFamily: "inherit",
                            resize: "vertical",
                        }}
                    />
                </div>
                <div
                    style={{
                        fontSize: "11px",
                        opacity: 0.7,
                        marginTop: "-4px",
                        marginBottom: "4px",
                    }}
                >
                    {conditionType === "regex"
                        ? "Regular expression pattern matched against game titles."
                        : "Separate multiple items with commas (e.g. Mario, Sonic, Zelda)."}
                </div>

                {conditionType === "regex" && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                        }}
                    >
                        <span style={{ fontSize: "11px", opacity: 0.7 }}>
                            Regex Examples (click to apply):
                        </span>
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                                maxHeight: "130px",
                                overflowY: "auto",
                                padding: "2px 0",
                            }}
                        >
                            {REGEX_EXAMPLES.map((ex) => (
                                <button
                                    key={ex.pattern}
                                    type="button"
                                    onClick={() => setPattern(ex.pattern)}
                                    style={{
                                        background:
                                            pattern === ex.pattern
                                                ? "rgba(102, 192, 244, 0.3)"
                                                : "rgba(255, 255, 255, 0.08)",
                                        border:
                                            pattern === ex.pattern
                                                ? "1px solid #66c0f4"
                                                : "1px solid rgba(255, 255, 255, 0.1)",
                                        color:
                                            pattern === ex.pattern
                                                ? "#66c0f4"
                                                : "#fff",
                                        borderRadius: "4px",
                                        padding: "3px 8px",
                                        fontSize: "11px",
                                        cursor: "pointer",
                                        textAlign: "left",
                                    }}
                                    title={ex.desc}
                                >
                                    <code>{ex.pattern}</code>
                                    <span
                                        style={{
                                            opacity: 0.6,
                                            marginLeft: "6px",
                                            fontSize: "10px",
                                        }}
                                    >
                                        ({ex.desc})
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {(conditionType === "collection" ||
                    conditionType === "game_name") && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                        }}
                    >
                        <TextField
                            label={
                                conditionType === "collection"
                                    ? "Filter Collections"
                                    : "Filter Games"
                            }
                            value={suggestionFilter}
                            onChange={(e) =>
                                setSuggestionFilter(e.target.value)
                            }
                        />
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                                maxHeight: "130px",
                                overflowY: "auto",
                                padding: "2px 0",
                            }}
                        >
                            {conditionType === "collection" ? (
                                filteredCollections.length > 0 ? (
                                    filteredCollections.map((c) => {
                                        const isSel = selectedParts.has(c.name);
                                        return (
                                            <button
                                                key={c.id}
                                                type="button"
                                                onClick={() =>
                                                    toggleSuggestion(c.name)
                                                }
                                                style={{
                                                    background: isSel
                                                        ? "rgba(102, 192, 244, 0.3)"
                                                        : "rgba(255, 255, 255, 0.08)",
                                                    border: isSel
                                                        ? "1px solid #66c0f4"
                                                        : "1px solid rgba(255, 255, 255, 0.1)",
                                                    color: isSel
                                                        ? "#66c0f4"
                                                        : "#fff",
                                                    borderRadius: "4px",
                                                    padding: "2px 8px",
                                                    fontSize: "11px",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                {c.name}
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div
                                        style={{
                                            fontSize: "11px",
                                            opacity: 0.6,
                                            fontStyle: "italic",
                                        }}
                                    >
                                        No matching collections
                                    </div>
                                )
                            ) : filteredShortcuts.length > 0 ? (
                                filteredShortcuts.map((s) => {
                                    const isSel = selectedParts.has(s.name);
                                    return (
                                        <button
                                            key={s.appid}
                                            type="button"
                                            onClick={() =>
                                                toggleSuggestion(s.name)
                                            }
                                            style={{
                                                background: isSel
                                                    ? "rgba(102, 192, 244, 0.3)"
                                                    : "rgba(255, 255, 255, 0.08)",
                                                border: isSel
                                                    ? "1px solid #66c0f4"
                                                    : "1px solid rgba(255, 255, 255, 0.1)",
                                                color: isSel
                                                    ? "#66c0f4"
                                                    : "#fff",
                                                borderRadius: "4px",
                                                padding: "2px 8px",
                                                fontSize: "11px",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {s.name}
                                        </button>
                                    );
                                })
                            ) : (
                                <div
                                    style={{
                                        fontSize: "11px",
                                        opacity: 0.6,
                                        fontStyle: "italic",
                                    }}
                                >
                                    No matching games
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <DialogButton
                        onClick={handleSaveRule}
                        disabled={!name.trim() || !pattern.trim()}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Save Rule
                    </DialogButton>
                    <DialogButton
                        onClick={() => setShowAddModal(false)}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Cancel
                    </DialogButton>
                </div>
            </SettingsModal>
        </PanelSection>
    );
}
