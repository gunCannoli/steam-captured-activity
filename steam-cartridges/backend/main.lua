--- steam-cartridges - backend entry point.
---
--- Supplies the library grid with capture timestamps for non-Steam games.
---
--- The app detail page is not built here. Steam renders it from its own
--- components once the frontend restores the section and feeds Steam's own
--- store (ADR-0022), so the backend only supplies what Steam genuinely does
--- not have: evidence a shortcut was played, from its screenshot index.

local logger      = require("logger")
local millennium  = require("millennium")
local steam_paths = require("steam_paths")

local data_dir    = require("data_dir")
local migrate     = require("migrate")
local config      = require("web_config")
local metadata_db = require("web_metadata_db")

local RPC     = require("rpc")
local WEB_RPC = require("web_rpc")
local STORE_RPC = require("steam_store_rpc")
local ACH_RPC   = require("achievements_rpc")
local RECORD_RPC = require("record_rpc")

-- Millennium exposes globals to the frontend as callable methods.
GetLibraryStats = RPC.GetLibraryStats
GetDiagnostics  = RPC.GetDiagnostics

-- Web metadata + artwork handlers keep their raw payload_json signatures.
GetStatus            = WEB_RPC.GetStatus
SaveGameMetadata     = WEB_RPC.SaveGameMetadata
GetArtworkForGame    = WEB_RPC.GetArtworkForGame
GetControllerInference = WEB_RPC.GetControllerInference
GetAutoRoutingProfiles = WEB_RPC.GetAutoRoutingProfiles
SaveServiceCredentials = WEB_RPC.SaveServiceCredentials

-- Steam Store bucket (P3). Flat files, prefixed names.
SteamStoreGetState       = STORE_RPC.SteamStoreGetState
SteamStoreGetMapping     = STORE_RPC.SteamStoreGetMapping
SteamStoreSetMapping     = STORE_RPC.SteamStoreSetMapping
SteamStoreClearMapping   = STORE_RPC.SteamStoreClearMapping
SteamStoreRejectSuggestion = STORE_RPC.SteamStoreRejectSuggestion
SteamStoreGetAppDetails  = STORE_RPC.SteamStoreGetAppDetails
SteamStoreRecordArtwork  = STORE_RPC.SteamStoreRecordArtwork
SteamStoreDownloadImage  = STORE_RPC.SteamStoreDownloadImage
SteamStoreSaveIcon       = STORE_RPC.SteamStoreSaveIcon
SteamStoreRecordIcon     = STORE_RPC.SteamStoreRecordIcon

-- Native Achievements subsystem (P5).
CartridgesAchievementsUnlock       = ACH_RPC.CartridgesAchievementsUnlock
CartridgesAchievementsReset        = ACH_RPC.CartridgesAchievementsReset
CartridgesAchievementsGetRetroStatus = ACH_RPC.CartridgesAchievementsGetRetroStatus

-- Record facade (migration M4b; M5a adds GetAllRecords).
GetGameRecord = RECORD_RPC.GetGameRecord
EnsureFresh    = RECORD_RPC.EnsureFresh
GetAllRecords  = RECORD_RPC.GetAllRecords
CheckUnlocks   = RECORD_RPC.CheckUnlocks
GetNewShortcuts = RECORD_RPC.GetNewShortcuts
MarkKnown      = RECORD_RPC.MarkKnown

-- Community & Media (ScreenScraper + IGDB)
local SS_MEDIA = require("screenscraper_media")
local IGDB_COMM = require("igdb_community")
GetGameMedia          = SS_MEDIA.GetGameMedia
GetGameManual         = SS_MEDIA.GetGameManual
GetGameTrailers       = IGDB_COMM.GetGameTrailers
GetGameCommunityLinks = IGDB_COMM.GetGameCommunityLinks

local function on_load()
  -- Resolve paths eagerly so a misconfigured install shows up in the log at
  -- startup rather than on the first page view.
  local paths, err = steam_paths.resolve()
  if not paths then
    logger:error("could not resolve Steam paths: " .. tostring(err))
  end

  -- Self-check (P0 T5: dotted require / cwd behaviour is unverified, so the
  -- backend uses a flat layout). Log what the runtime actually resolves.
  logger:info("self-check: package.path=" .. tostring(package.path))
  local ok_cwd, cwd = pcall(function() return require("fs").current_path() end)
  logger:info("self-check: cwd=" .. tostring(ok_cwd and cwd or "unavailable")
    .. ", data_dir=" .. tostring(data_dir.path()))

  -- A migration failure logs and continues.
  local ok_m, err_m = pcall(migrate.run)
  if not ok_m then
    logger:error("migration failed: " .. tostring(err_m))
  end
  local ok_m2, err_m2 = pcall(migrate.run_v2)
  if not ok_m2 then
    logger:error("migration v2 failed: " .. tostring(err_m2))
  end

  if config.get_twitch_credentials() then
    logger:info("Game Metadata provider loaded (Twitch credentials configured).")
  else
    logger:warn("Game Metadata provider loaded (no Twitch credentials found in .env).")
  end
  logger:info("Metadata database contains " .. tostring(metadata_db.count()) .. " cached game(s).")

  millennium.ready()
  logger:info("Backend loaded.")
end

local function on_frontend_loaded()
  logger:info("Frontend loaded.")
end

local function on_unload()
  logger:info("Backend unloading.")
end

return {
  on_load = on_load,
  on_frontend_loaded = on_frontend_loaded,
  on_unload = on_unload,
}
