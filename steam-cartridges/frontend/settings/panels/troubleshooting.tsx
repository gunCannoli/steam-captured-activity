// Settings: Troubleshooting (migration plan M8d): the kill switches and safety diagnostics.
import { PanelSection } from "@steambrew/client";
import { useSetting } from "../settings";
import { usePanelContext } from "../context";
import { ItemRow, ToggleRow } from "../components";
import { toggleFeature } from "../troubleshooting-core";

export function TroubleshootingSection() {
    const ctx = usePanelContext();
    const [raw, setRaw] = useSetting("disabledFeatures");
    const diag = ctx.safety.diagnostics();
    const surfaces = ctx.safety.surfaces();
    const off = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));

    const state = (id: string): string => {
        if (diag.tripped.includes(id)) return `tripped (${diag.errors[id] ?? 0} errors)`;
        if (diag.disabled.includes(id) || off.has(id)) return "off";
        return diag.errors[id] ? `on (${diag.errors[id]} errors)` : "on";
    };

    const surfaceState = (x: (typeof surfaces)[number]): string => {
        if (x.disabled) return "off";
        if (!x.installed) return x.errors ? `not installed (${x.errors} errors)` : "not installed";
        return x.errors ? `installed (${x.errors} errors)` : "installed";
    };

    return (
        <PanelSection title="Troubleshooting">
            {ctx.safety.featureIds.map((id) => (
                <ToggleRow
                    key={id}
                    label={id}
                    value={!off.has(id)}
                    onChange={(on) => setRaw(toggleFeature(raw, id, on, ctx.safety.featureIds))}
                />
            ))}
            <ItemRow>
                <div style={{ fontSize: "12px", opacity: 0.7, padding: "6px 0" }}>Changes take effect after Steam restarts.</div>
            </ItemRow>
            <ItemRow>
                <div style={{ fontSize: "12px", opacity: 0.85, padding: "4px 0", fontFamily: "monospace" }}>
                    <div>safe mode: {diag.safeMode ? "on" : "off"}</div>
                    {ctx.safety.featureIds.map((id) => (
                        <div key={id}>
                            {id}: {state(id)}
                        </div>
                    ))}
                    {surfaces.length > 0 && <div style={{ marginTop: "6px" }}>surfaces:</div>}
                    {surfaces.map((x) => (
                        <div key={x.id}>
                            {x.id}: {surfaceState(x)}
                        </div>
                    ))}
                </div>
            </ItemRow>
        </PanelSection>
    );
}
