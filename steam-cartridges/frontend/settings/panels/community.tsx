// Settings: Community & Media (migration plan M8c; features plan F2 wires the first two toggles, F2c the manuals).
// communityShowExternalLinks stays in the settings (default unchanged); it gets a row when something reads it.
import { Field, PanelSection } from "@steambrew/client";
import { useSetting } from "../settings";
import { Blocks, ItemRow, ToggleRow } from "../components";

// ===========================================================================
// Community & Media Section
// ===========================================================================

export function CommunitySection() {
    const [showTrailers, setShowTrailers] = useSetting("communityShowTrailers");
    const [showArtworks, setShowArtworks] = useSetting("communityShowArtworks");
    const [showManuals, setShowManuals] = useSetting("communityShowManuals");

    return (
        <PanelSection title="Community & Media">
            <Blocks>
                <ItemRow>
                    <Field
                        label="For games with no Steam match"
                        description="Steam's own Community section shows IGDB trailers and art, and ScreenScraper screenshots and fanart (with a ScreenScraper account). Applies the next time a game's page opens."
                        bottomSeparator="none"
                    />
                </ItemRow>
                <>
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
                    <ToggleRow
                        label="Game Manuals"
                        description="Show the game's ScreenScraper manual as the first card; open it to read it page by page"
                        value={showManuals}
                        onChange={setShowManuals}
                    />
                </>
            </Blocks>
        </PanelSection>
    );
}
