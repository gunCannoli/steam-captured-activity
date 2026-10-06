// Settings panel shell (migration plan M8c): the sections in their fixed order.
import { useEffect, useState } from "react";
import { MetadataSection } from "./panels/metadata";
import { AchievementsSection } from "./panels/achievements";
import { NotificationsSection } from "./panels/notifications";
import { ActivitySection } from "./panels/activity";
import { CommunitySection } from "./panels/community";
import { RulesSection } from "./panels/rules";
import { RevisionSection } from "./panels/audit";
import { SyncProgressBar } from "./sync-progress";

export function SettingsPanel() {
    const [, tick] = useState(0);

    // Periodic refresh so live collections, shortcuts, and extension panels remain synced
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 3000);
        return () => clearInterval(t);
    }, []);

    const extPanels = ((window as any).SteamCartridges?.getSettingsPanels?.() ?? []) as Array<{
        id: string;
        title: string;
        order?: number;
        render: () => any;
    }>;
    const prePanels = extPanels.filter((p) => (p.order ?? 50) < 40);
    const postPanels = extPanels.filter((p) => (p.order ?? 50) >= 40);

    return (
        <div style={{ paddingBottom: "70px", position: "relative" }}>
            <MetadataSection />
            <AchievementsSection />
            {prePanels.map((p) => (
                <div key={p.id}>{p.render()}</div>
            ))}
            <NotificationsSection />
            <ActivitySection />
            <CommunitySection />
            {postPanels.map((p) => (
                <div key={p.id}>{p.render()}</div>
            ))}
            <RulesSection />
            <RevisionSection />
            <SyncProgressBar />
        </div>
    );
}
