--- non-steam-games-activity - backend entry point.
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

local RPC = require("rpc")

-- Millennium exposes globals to the frontend as callable methods.
GetLibraryStats = RPC.GetLibraryStats
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
