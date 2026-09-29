// Settings: Community & Media (migration plan M8c; adds one help line).
import { PanelSection } from "@steambrew/client";
import { useSetting } from "../settings";
import { ItemRow, ToggleRow } from "../components";

// ===========================================================================
// Community & Media Section
// ===========================================================================

export function CommunitySection() {
    const [showTrailers, setShowTrailers] = useSetting("communityShowTrailers");
    const [showArtworks, setShowArtworks] = useSetting("communityShowArtworks");
    const [showManuals, setShowManuals] = useSetting("communityShowManuals");
    const [showLinks, setShowLinks] = useSetting("communityShowExternalLinks");

    return (
        <PanelSection title="Community & Media">
            <ItemRow>
                <div style={{ fontSize: "12px", opacity: 0.7, padding: "0 0 6px" }}>
                    These apply when the Media service is connected (migration plan § 7.10).
                </div>
            </ItemRow>
            <ToggleRow
                label="Gameplay Trailers"
                description="Show video trailers and gameplay previews in the Community tab"
                value={showTrailers}
                onChange={setShowTrailers}
            />
            <ToggleRow
                label="Fanart & Screenshots"
                description="Show promotional artworks, title screens, and fanart galleries"
                value={showArtworks}
                onChange={setShowArtworks}
            />
            <ToggleRow
                label="Digital Game Manuals"
                description="Show original retro game manuals viewer modal when available"
                value={showManuals}
                onChange={setShowManuals}
            />
            <ToggleRow
                label="Community Hub Links"
                description="Display quick action links to Wikipedia, Speedrun leaderboards, Discord, and wikis"
                value={showLinks}
                onChange={setShowLinks}
            />
        </PanelSection>
    );
}
