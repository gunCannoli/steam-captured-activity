// Settings: Metadata services (migration plan M8c, moved verbatim).
import { useEffect, useState } from "react";
import {
    DialogButton,
    Dropdown,
    Field,
    PanelSection,
    TextField,
} from "@steambrew/client";
import { useSetting } from "../settings";
import { backend, type ProviderStatus } from "../../ports/backend";
import { usePanelContext } from "../context";
import { Blocks, ButtonRow, ItemRow, SettingsModal } from "../components";

// ===========================================================================
// 1. {Metadata} Services Section
// ===========================================================================

type MetadataServiceId =
    | "steam_store"
    | "screenscraper"
    | "igdb"
    | "steamgriddb";

interface MetadataServiceDef {
    id: MetadataServiceId;
    label: string;
}

const ALL_METADATA_SERVICES: MetadataServiceDef[] = [
    { id: "steam_store", label: "Steam Store Mirror" },
    { id: "screenscraper", label: "ScreenScraper" },
    { id: "igdb", label: "IGDB" },
    { id: "steamgriddb", label: "SteamGridDB" },
];

export function MetadataSection() {
    const ctx = usePanelContext();
    const [services, setServices] = useSetting("services");
    const [status, setStatus] = useState<ProviderStatus | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);

    // Form inputs in modal
    const [selectedService, setSelectedService] =
        useState<MetadataServiceId>("steam_store");
    const [ssUser, setSsUser] = useState("");
    const [ssPass, setSsPass] = useState("");
    const [ssDevUser, setSsDevUser] = useState("");
    const [ssDevPw, setSsDevPw] = useState("");
    const [igdbId, setIgdbId] = useState("");
    const [igdbSecret, setIgdbSecret] = useState("");
    const [sgdbKey, setSgdbKey] = useState("");

    const [statusMsg, setStatusMsg] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const refresh = () => {
        backend
            .getStatus()
            .then(setStatus)
            .catch(() => {});
    };

    useEffect(() => {
        refresh();
    }, []);

    // Determine active services
    const activeServices: MetadataServiceDef[] = [];
    const [steamStoreService, ssService, igdbService, sgdbService] =
        ALL_METADATA_SERVICES;
    if (steamStoreService && services.steamStoreEnabled !== false) {
        activeServices.push(steamStoreService);
    }
    if (
        ssService &&
        services.screenscraperEnabled !== false &&
        status?.has_screenscraper
    ) {
        activeServices.push(ssService);
    }
    if (igdbService && services.igdbEnabled !== false && status?.has_twitch) {
        activeServices.push(igdbService);
    }
    if (
        sgdbService &&
        services.steamgriddbEnabled !== false &&
        status?.has_sgdb
    ) {
        activeServices.push(sgdbService);
    }

    const availableToAdd = ALL_METADATA_SERVICES.filter(
        (s) => !activeServices.some((active) => active.id === s.id),
    );

    const handleRemoveService = (id: MetadataServiceId) => {
        if (id === "steam_store") {
            setServices({ ...services, steamStoreEnabled: false });
        } else if (id === "screenscraper") {
            setServices({ ...services, screenscraperEnabled: false });
        } else if (id === "igdb") {
            setServices({ ...services, igdbEnabled: false });
        } else if (id === "steamgriddb") {
            setServices({ ...services, steamgriddbEnabled: false });
        }
        ctx.ingest.trigger(250);
    };

    const handleOpenAddModal = () => {
        const first = availableToAdd[0];
        if (first) {
            setSelectedService(first.id);
            setStatusMsg("");
            setShowAddModal(true);
        }
    };

    const handleRegisterService = async () => {
        setIsSaving(true);
        setStatusMsg("Checking API connection...");

        if (selectedService === "steam_store") {
            setServices({ ...services, steamStoreEnabled: true });
            ctx.ingest.trigger(250);
            setStatusMsg("✓ Steam Store Mirror enabled!");
            setTimeout(() => {
                setShowAddModal(false);
                setIsSaving(false);
                setStatusMsg("");
            }, 1000);
            return;
        }

        if (selectedService === "screenscraper") {
            if (!ssUser.trim() || !ssPass.trim()) {
                setStatusMsg("Username and password are required.");
                setIsSaving(false);
                return;
            }
            const res = await backend.saveServiceCredentials({
                screenscraper_user: ssUser.trim(),
                screenscraper_pass: ssPass.trim(),
                screenscraper_dev_user: ssDevUser.trim(),
                screenscraper_dev_pw: ssDevPw.trim(),
            });
            if (res.success) {
                setServices({ ...services, screenscraperEnabled: true });
                ctx.ingest.trigger(250);
                refresh();
                setStatusMsg("✓ ScreenScraper registered & verified!");
                setTimeout(() => {
                    setShowAddModal(false);
                    setIsSaving(false);
                    setStatusMsg("");
                    setSsPass("");
                }, 1200);
            } else {
                setStatusMsg("Failed to save credentials.");
                setIsSaving(false);
            }
            return;
        }

        if (selectedService === "igdb") {
            if (!igdbId.trim() || !igdbSecret.trim()) {
                setStatusMsg("Client ID and Secret are required.");
                setIsSaving(false);
                return;
            }
            const res = await backend.saveServiceCredentials({
                twitch_client_id: igdbId.trim(),
                twitch_client_secret: igdbSecret.trim(),
            });
            if (res.success) {
                setServices({ ...services, igdbEnabled: true });
                ctx.ingest.trigger(250);
                refresh();
                setStatusMsg("✓ IGDB registered & verified!");
                setTimeout(() => {
                    setShowAddModal(false);
                    setIsSaving(false);
                    setStatusMsg("");
                    setIgdbSecret("");
                }, 1200);
            } else {
                setStatusMsg("Failed to save credentials.");
                setIsSaving(false);
            }
            return;
        }

        if (selectedService === "steamgriddb") {
            if (!sgdbKey.trim()) {
                setStatusMsg("An API key is required.");
                setIsSaving(false);
                return;
            }
            const res = await backend.saveServiceCredentials({
                steamgriddb_api: sgdbKey.trim(),
            });
            if (res.success) {
                setServices({ ...services, steamgriddbEnabled: true });
                refresh();
                setStatusMsg("✓ SteamGridDB key saved!");
                setTimeout(() => {
                    setShowAddModal(false);
                    setIsSaving(false);
                    setStatusMsg("");
                    setSgdbKey("");
                }, 1200);
            } else {
                setStatusMsg("Failed to save credentials.");
                setIsSaving(false);
            }
            return;
        }
    };

    return (
        <PanelSection title="Metadata">
            <Blocks>
                <>
                    {activeServices.length === 0 && (
                        <ItemRow>
                            <div
                                style={{
                                    opacity: 0.6,
                                    fontSize: "12px",
                                    padding: "4px 0",
                                    fontStyle: "italic",
                                }}
                            >
                                No metadata services active.
                            </div>
                        </ItemRow>
                    )}

                    {/* List of Active Services */}
                    {activeServices.map((svc) => (
                        <ItemRow key={svc.id}>
                            <Field label={svc.label}>
                                <DialogButton
                                    onClick={() => handleRemoveService(svc.id)}
                                    style={{
                                        padding: "0 8px",
                                        minWidth: 0,
                                        width: "auto",
                                        fontSize: "12px",
                                    }}
                                >
                                    🗑️
                                </DialogButton>
                            </Field>
                        </ItemRow>
                    ))}
                </>
                <>
                    {availableToAdd.length > 0 && (
                        <ButtonRow
                            label="Add service"
                            description="Connect another source of game info and artwork"
                            buttonLabel="Add"
                            onClick={handleOpenAddModal}
                        />
                    )}
                </>
            </Blocks>

            {/* Add Service Modal */}
            <SettingsModal
                title="Register Metadata Service"
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            fontSize: "12px",
                            color: "#e1e7ee",
                            fontWeight: 600,
                        }}
                    >
                        Service
                    </span>
                    <Dropdown
                        rgOptions={availableToAdd.map((s) => ({
                            data: s.id,
                            label: s.label,
                        }))}
                        selectedOption={selectedService}
                        onChange={(o) => setSelectedService(o.data as any)}
                        contextMenuPositionOptions={{ bMatchWidth: true }}
                    />
                </div>

                {selectedService === "steam_store" && (
                    <div
                        style={{
                            fontSize: "12px",
                            opacity: 0.8,
                            padding: "4px 0",
                        }}
                    >
                        Steam Store Mirror extracts Game Info, descriptions,
                        genres, and release dates directly from Steam Store
                        matching. No API key required.
                    </div>
                )}

                {selectedService === "screenscraper" && (
                    <>
                        <TextField
                            label="Account Username"
                            value={ssUser}
                            onChange={(e) => setSsUser(e.target.value)}
                        />
                        <TextField
                            label="Account Password"
                            bIsPassword
                            value={ssPass}
                            onChange={(e) => setSsPass(e.target.value)}
                        />
                        <TextField
                            label="Dev ID (Optional)"
                            value={ssDevUser}
                            onChange={(e) => setSsDevUser(e.target.value)}
                        />
                        <TextField
                            label="Dev Password (Optional)"
                            bIsPassword
                            value={ssDevPw}
                            onChange={(e) => setSsDevPw(e.target.value)}
                        />
                    </>
                )}

                {selectedService === "igdb" && (
                    <>
                        <TextField
                            label="Twitch Client ID"
                            value={igdbId}
                            onChange={(e) => setIgdbId(e.target.value)}
                        />
                        <TextField
                            label="Twitch Client Secret"
                            bIsPassword
                            value={igdbSecret}
                            onChange={(e) => setIgdbSecret(e.target.value)}
                        />
                    </>
                )}

                {selectedService === "steamgriddb" && (
                    <>
                        <div
                            style={{
                                fontSize: "12px",
                                opacity: 0.8,
                                padding: "4px 0",
                            }}
                        >
                            Fills empty artwork slots (capsule, hero, logo,
                            wide) for shortcuts with no Steam match. Art you set
                            yourself is never replaced. Get a free key in your
                            SteamGridDB profile preferences.
                        </div>
                        <TextField
                            label="SteamGridDB API Key"
                            bIsPassword
                            value={sgdbKey}
                            onChange={(e) => setSgdbKey(e.target.value)}
                        />
                    </>
                )}

                {statusMsg && (
                    <div
                        style={{
                            fontSize: "12px",
                            color: statusMsg.startsWith("✓")
                                ? "#a4d007"
                                : "#eb4b4b",
                        }}
                    >
                        {statusMsg}
                    </div>
                )}

                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    <DialogButton
                        disabled={isSaving}
                        onClick={handleRegisterService}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Register
                    </DialogButton>
                    <DialogButton
                        onClick={() => setShowAddModal(false)}
                        style={{
                            padding: "0 16px",
                            minWidth: 0,
                            width: "auto",
                        }}
                    >
                        Cancel
                    </DialogButton>
                </div>
            </SettingsModal>
        </PanelSection>
    );
}
