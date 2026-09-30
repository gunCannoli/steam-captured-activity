// Settings: Community & Media (migration plan M8c; features plan F2 wires the first two toggles).
// communityShowManuals and communityShowExternalLinks stay in the settings (defaults unchanged) for F2c; they get
// a row when something reads them.
import { PanelSection } from "@steambrew/client";
import { useSetting } from "../settings";
import { ItemRow, ToggleRow } from "../components";

// ===========================================================================
// Community & Media Section
// ===========================================================================

export function CommunitySection() {
    const [showTrailers, setShowTrailers] = useSetting("communityShowTrailers");
    const [showArtworks, setShowArtworks] = useSetting("communityShowArtworks");

    return (
        <PanelSection title="Community & Media">
            <ItemRow>
                <div style={{ fontSize: "12px", opacity: 0.7, padding: "0 0 6px" }}>
                    For games with no Steam match: Steam's own Community section shows IGDB trailers and art, and
                    ScreenScraper screenshots and fanart (with a ScreenScraper account). Applies the next time a game's page opens.
                </div>
            </ItemRow>
            <ToggleRow
                label="Gameplay Trailers"
                description="Show IGDB video trailers in the Community section, played by Steam's own player"
                value={showTrailers}
                onChange={setShowTrailers}
            />
            <ToggleRow
                label="Screenshots & Artwork"
                description="Show IGDB screenshots and artwork, and ScreenScraper screenshots, title screens and fanart"
                value={showArtworks}
                onChange={setShowArtworks}
            />
        </PanelSection>
    );
}
