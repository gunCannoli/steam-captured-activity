// PURGE(M9): unreachable legacy, nothing imports this component (K9). Ledger: migration plan § 7.9.
import React, { useState, useEffect } from "react";
import { getCommunityData, loadCommunityData, type CommunityData } from "../steam/community-store";
import { setting } from "../settings/settings";

interface CommunityTabProps {
    appid: number;
    title?: string;
}

export const CommunityTab: React.FC<CommunityTabProps> = ({ appid, title }) => {
    const [data, setData] = useState<CommunityData | undefined>(() => getCommunityData(appid));
    const [activeVideo, setActiveVideo] = useState<string | null>(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [showManualModal, setShowManualModal] = useState<boolean>(false);

    useEffect(() => {
        let mounted = true;
        loadCommunityData(appid, title).then((loaded) => {
            if (mounted && loaded) setData(loaded);
        });
        return () => {
            mounted = false;
        };
    }, [appid, title]);

    const showTrailers = setting("communityShowTrailers");
    const showArtworks = setting("communityShowArtworks");
    const showManuals = setting("communityShowManuals");
    const showLinks = setting("communityShowExternalLinks");

    const trailers = data?.trailers ?? [];
    const screenshots = data?.screenshots ?? [];
    const artworks = data?.artworks ?? [];
    const links = data?.links ?? [];
    const manualUrl = data?.manualUrl;

    const hasAnyContent =
        (showTrailers && trailers.length > 0) ||
        (showArtworks && (screenshots.length > 0 || artworks.length > 0)) ||
        (showManuals && !!manualUrl) ||
        (showLinks && links.length > 0);

    if (!data || !hasAnyContent) {
        return (
            <div style={{ padding: "40px 24px", textAlign: "center", color: "#8f98a0" }}>
                <div style={{ fontSize: "18px", marginBottom: "8px" }}>Community & Media</div>
                <div style={{ fontSize: "13px" }}>
                    No community content or gameplay media has been captured for this game yet.
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Trailers & Videos Carousel */}
            {showTrailers && trailers.length > 0 && (
                <section>
                    <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#e1e7ee", marginBottom: "12px" }}>
                        Trailers & Gameplay Clips
                    </h3>
                    <div
                        style={{
                            display: "flex",
                            gap: "14px",
                            overflowX: "auto",
                            paddingBottom: "8px",
                            scrollbarWidth: "thin",
                        }}
                    >
                        {trailers.map((t, idx) => (
                            <div
                                key={t.video_id || idx}
                                onClick={() => setActiveVideo(t.video_id)}
                                style={{
                                    flex: "0 0 240px",
                                    cursor: "pointer",
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    background: "#1b2838",
                                    position: "relative",
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                                    transition: "transform 0.15s ease",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                                onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                            >
                                <img
                                    src={t.thumbnail}
                                    alt={t.name}
                                    style={{ width: "100%", height: "135px", objectFit: "cover", display: "block" }}
                                />
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "45px",
                                        left: "98px",
                                        width: "44px",
                                        height: "44px",
                                        borderRadius: "50%",
                                        background: "rgba(0,0,0,0.7)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: "#fff",
                                        fontSize: "20px",
                                    }}
                                >
                                    ▶
                                </div>
                                <div
                                    style={{
                                        padding: "8px 10px",
                                        fontSize: "12px",
                                        color: "#c6d4df",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {t.name}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Video Player Modal */}
            {activeVideo && (
                <div
                    onClick={() => setActiveVideo(null)}
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "rgba(0,0,0,0.85)",
                        zIndex: 99999,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "80vw",
                            maxWidth: "960px",
                            height: "45vw",
                            maxHeight: "540px",
                            background: "#000",
                            borderRadius: "8px",
                            overflow: "hidden",
                            position: "relative",
                        }}
                    >
                        <iframe
                            src={`https://www.youtube-nocookie.com/embed/${activeVideo}?autoplay=1`}
                            title="Trailer Player"
                            style={{ width: "100%", height: "100%", border: "none" }}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                        <button
                            onClick={() => setActiveVideo(null)}
                            style={{
                                position: "absolute",
                                top: "10px",
                                right: "12px",
                                background: "rgba(0,0,0,0.7)",
                                color: "#fff",
                                border: "none",
                                fontSize: "16px",
                                padding: "6px 12px",
                                cursor: "pointer",
                                borderRadius: "4px",
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            {/* Screenshots & Art Gallery */}
            {showArtworks && (screenshots.length > 0 || artworks.length > 0) && (
                <section>
                    <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#e1e7ee", marginBottom: "12px" }}>
                        Art Gallery & Fanart
                    </h3>
                    <div
                        style={{
                            display: "flex",
                            gap: "12px",
                            overflowX: "auto",
                            paddingBottom: "8px",
                            scrollbarWidth: "thin",
                        }}
                    >
                        {[...screenshots, ...artworks.map((a) => a.url)].map((url, i) => (
                            <div
                                key={url || i}
                                onClick={() => setSelectedImage(url)}
                                style={{
                                    flex: "0 0 200px",
                                    height: "115px",
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    cursor: "pointer",
                                    background: "#16202d",
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                                }}
                            >
                                <img
                                    src={url}
                                    alt={`Artwork ${i + 1}`}
                                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                    loading="lazy"
                                />
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Lightbox Modal */}
            {selectedImage && (
                <div
                    onClick={() => setSelectedImage(null)}
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "rgba(0,0,0,0.9)",
                        zIndex: 99999,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "zoom-out",
                    }}
                >
                    <img
                        src={selectedImage}
                        alt="Zoomed Artwork"
                        style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "4px", objectFit: "contain" }}
                    />
                </div>
            )}

            {/* Digital Game Manual & Community Links Bar */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
                {/* Manual Section */}
                {showManuals && manualUrl && (
                    <section style={{ flex: "1 1 300px" }}>
                        <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#e1e7ee", marginBottom: "12px" }}>
                            Digital Game Manual
                        </h3>
                        <div
                            onClick={() => setShowManualModal(true)}
                            style={{
                                padding: "16px",
                                background: "#1b2838",
                                borderRadius: "6px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "16px",
                                border: "1px solid #2a475e",
                            }}
                        >
                            <div style={{ fontSize: "32px" }}>📖</div>
                            <div>
                                <div style={{ fontSize: "14px", fontWeight: 600, color: "#66c0f4" }}>
                                    View Original Game Manual
                                </div>
                                <div style={{ fontSize: "12px", color: "#8f98a0" }}>
                                    High-resolution scans and gameplay controls
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* Community Destinations */}
                {showLinks && links.length > 0 && (
                    <section style={{ flex: "1 1 300px" }}>
                        <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#e1e7ee", marginBottom: "12px" }}>
                            Community Hubs & Guides
                        </h3>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                            {links.map((link) => (
                                <a
                                    key={link.url}
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    style={{
                                        display: "inline-block",
                                        padding: "8px 14px",
                                        background: "#213244",
                                        color: "#c6d4df",
                                        borderRadius: "4px",
                                        textDecoration: "none",
                                        fontSize: "13px",
                                        border: "1px solid #3d536a",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = "#2a475e";
                                        e.currentTarget.style.color = "#ffffff";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = "#213244";
                                        e.currentTarget.style.color = "#c6d4df";
                                    }}
                                >
                                    {link.name} ↗
                                </a>
                            ))}
                        </div>
                    </section>
                )}
            </div>

            {/* Manual Modal Viewer */}
            {showManualModal && manualUrl && (
                <div
                    onClick={() => setShowManualModal(false)}
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "rgba(0,0,0,0.85)",
                        zIndex: 99999,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "85vw",
                            height: "85vh",
                            background: "#1e1e1e",
                            borderRadius: "8px",
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <div
                            style={{
                                padding: "10px 16px",
                                background: "#111",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }}
                        >
                            <span style={{ color: "#fff", fontWeight: 600 }}>Game Manual Viewer</span>
                            <button
                                onClick={() => setShowManualModal(false)}
                                style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "#fff",
                                    fontSize: "18px",
                                    cursor: "pointer",
                                }}
                            >
                                ✕
                            </button>
                        </div>
                        <iframe
                            src={manualUrl}
                            title="Game Manual"
                            style={{ width: "100%", flex: 1, border: "none" }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
