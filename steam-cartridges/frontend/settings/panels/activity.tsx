// Settings: Activity Feed (migration plan M8c, moved verbatim).
import { PanelSection } from "@steambrew/client";
import { useSetting } from "../settings";
import { ToggleRow } from "../components";

// ===========================================================================
// 4. {Activity} Feed Section
// ===========================================================================

export function ActivitySection() {
    const [showAdded, setShowAdded] = useSetting("activityShowAddedToLibrary");
    const [showFirstPlayed, setShowFirstPlayed] = useSetting(
        "activityShowFirstPlayed",
    );

    return (
        <PanelSection title="Activity Feed">
            <ToggleRow
                label="Added to Library"
                description="Card when game is added to library"
                value={showAdded}
                onChange={setShowAdded}
            />
            <ToggleRow
                label="First Time Played"
                description="Card when game is played for first time"
                value={showFirstPlayed}
                onChange={setShowFirstPlayed}
            />
        </PanelSection>
    );
}
