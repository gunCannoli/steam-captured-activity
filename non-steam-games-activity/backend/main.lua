--- non-steam-games-activity - backend entry point.
---
--- Renders the game activity page Steam declines to build for non-Steam games,
--- using the screenshots and recordings Steam has already captured.

local logger      = require("logger")
local millennium  = require("millennium")
local steam_paths = require("steam_paths")

local RPC = require("rpc")

-- Millennium exposes globals to the frontend as callable methods.
GetActivity     = RPC.GetActivity
GetLibraryStats = RPC.GetLibraryStats
GetAsset        = RPC.GetAsset
GetAssets       = RPC.GetAssets
GetDiagnostics  = RPC.GetDiagnostics

local function on_load()
  -- Resolve paths eagerly so a misconfigured install shows up in the log at
  -- startup rather than on the first page view.
  local paths, err = steam_paths.resolve()
  if not paths then
    logger:error("could not resolve Steam paths: " .. tostring(err))
  end

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
