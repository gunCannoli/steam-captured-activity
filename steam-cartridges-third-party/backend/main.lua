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
StoreEpicPrelaunch       = STORE_RPC.StoreEpicPrelaunch
StoreEpicReap            = STORE_RPC.StoreEpicReap

millennium.ready()
logger:info("steam-cartridges-third-party backend ready.")
