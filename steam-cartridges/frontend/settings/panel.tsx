// Settings panel shell (migration plan M8c): the sections in their fixed order.
import { useEffect, useState } from "react";
import { MetadataSection } from "./panels/metadata";
import { AchievementsSection } from "./panels/achievements";
import { ThirdPartySection } from "./panels/third-party";
import { NotificationsSection } from "./panels/notifications";
import { ActivitySection } from "./panels/activity";
import { CommunitySection } from "./panels/community";
import { RulesSection } from "./panels/rules";
import { RevisionSection } from "./panels/audit";
import { SyncProgressBar } from "./sync-progress";

export function SettingsPanel() {
    const [, tick] = useState(0);

    // Periodic refresh so live collections and shortcuts remain synced
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 3000);
        return () => clearInterval(t);
    }, []);

    return (
        <div style={{ paddingBottom: "70px", position: "relative" }}>
            <MetadataSection />
            <AchievementsSection />
            <ThirdPartySection />
            <NotificationsSection />
            <ActivitySection />
            <CommunitySection />
            <RulesSection />
            <RevisionSection />
            <SyncProgressBar />
        </div>
    );
}
