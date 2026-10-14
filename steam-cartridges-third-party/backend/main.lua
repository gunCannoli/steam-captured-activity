--- steam-cartridges-third-party backend entry point.
--- Manages Epic Games Store and Xbox / Microsoft Store integrations.

if jit and jit.off then
  jit.off()
end

local logger     = require("logger")
local millennium = require("millennium")
local STORE_RPC  = require("store_rpc")

-- Export RPC endpoints
StoreInstalledGames      = STORE_RPC.StoreInstalledGames
StoreAccounts            = STORE_RPC.StoreAccounts
XboxSignInStart          = STORE_RPC.XboxSignInStart
XboxSignInPoll           = STORE_RPC.XboxSignInPoll
XboxSignOut              = STORE_RPC.XboxSignOut
StoreEpicLaunchShortcuts = STORE_RPC.StoreEpicLaunchShortcuts
StoreXboxRepairs         = STORE_RPC.StoreXboxRepairs
StoreXboxRunning         = STORE_RPC.StoreXboxRunning
StoreLibraryCopies       = STORE_RPC.StoreLibraryCopies
StoreGameData            = STORE_RPC.StoreGameData
StoreEpicPrelaunch       = STORE_RPC.StoreEpicPrelaunch
StoreEpicReap            = STORE_RPC.StoreEpicReap
StoreSensorLogs          = STORE_RPC.StoreSensorLogs

-- Millennium's lifecycle (docs/plugins.md § 2): the table is required; ready() belongs in on_load.
local function on_load()
  millennium.ready()
  logger:info("steam-cartridges-third-party backend ready.")
end

return {
  on_load = on_load,
  on_frontend_loaded = function() end,
  on_unload = function() logger:info("steam-cartridges-third-party backend unloading.") end,
}
