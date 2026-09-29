// Settings: Notifications (migration plan M8c, moved verbatim).
import { Dropdown, Field, PanelSection } from "@steambrew/client";
import { useSetting } from "../settings";
import { ItemRow } from "../components";

// ===========================================================================
// 3. {Notifications} Section
// ===========================================================================

const LAUNCH_NOTIFY_OPTIONS = [
    { data: "all_runs", label: "Always" },
    { data: "first_run", label: "First run" },
    { data: "off", label: "Off" },
];

export function NotificationsSection() {
    const [policy, setPolicy] = useSetting("localAchievementsNotifyOnLaunch");

    return (
        <PanelSection title="Notifications">
            {/* 3-Row layout matching theme section */}
            <ItemRow>
                <Field
                    label="Achievement Support"
                    description="Shows a notification on startup of games with supported achievements."
                    bottomSeparator="none"
                />
            </ItemRow>
            <ItemRow>
                <Field childrenContainerWidth="max">
                    <Dropdown
                        rgOptions={LAUNCH_NOTIFY_OPTIONS}
                        selectedOption={policy}
                        onChange={(o) => setPolicy(o.data as any)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </Field>
            </ItemRow>
        </PanelSection>
    );
}
