// Settings: Community Content (migration plan M8c; features plan F2 wires the first two toggles, F2c the manuals,
// ADR-0051 the disk cache slider).
// communityShowExternalLinks stays in the settings (default unchanged); it gets a row when something reads it.
import { Field, PanelSection } from "@steambrew/client";
import { MEDIA_CACHE_DAYS, useSetting } from "../settings";
import { Blocks, ItemRow, SliderRow, ToggleRow } from "../components";

// ===========================================================================
// Community Content Section
// ===========================================================================

export function CommunitySection() {
    const [showTrailers, setShowTrailers] = useSetting("communityShowTrailers");
    const [showArtworks, setShowArtworks] = useSetting("communityShowArtworks");
    const [showManuals, setShowManuals] = useSetting("communityShowManuals");
    const [cacheDays, setCacheDays] = useSetting("mediaCacheDays");

    return (
        <PanelSection title="Community Content">
            <Blocks>
                <>
                    <ItemRow>
                        <Field
                            label="For games with no Steam match"
                            description="Fills Steam's Community section from IGDB and ScreenScraper"
                            bottomSeparator="none"
                        />
                    </ItemRow>
                    <ToggleRow label="Gameplay Trailers" description="IGDB video trailers" value={showTrailers} onChange={setShowTrailers} />
                    <ToggleRow
                        label="Screenshots & Artwork"
                        description="IGDB and ScreenScraper images"
                        value={showArtworks}
                        onChange={setShowArtworks}
                    />
                    <ToggleRow label="Game Manuals" description="ScreenScraper manuals, shown first" value={showManuals} onChange={setShowManuals} />
                </>
                <>
                    {/* enhanced-notifications' form: the toggle, then its slider. Off is 0 days (nothing kept on disk). */}
                    <ToggleRow
                        label="Cache downloaded media"
                        description="Keeps images and manuals on this PC"
                        value={cacheDays > 0}
                        onChange={(on) => setCacheDays(on ? MEDIA_CACHE_DAYS.default : 0)}
                    />
                    <SliderRow
                        label="Cache lifespan"
                        value={cacheDays > 0 ? cacheDays : MEDIA_CACHE_DAYS.default}
                        min={1}
                        max={MEDIA_CACHE_DAYS.max}
                        step={MEDIA_CACHE_DAYS.step}
                        suffix=" days"
                        resetValue={MEDIA_CACHE_DAYS.default}
                        disabled={cacheDays === 0}
                        onChange={setCacheDays}
                    />
                </>
            </Blocks>
        </PanelSection>
    );
}
