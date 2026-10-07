--- Third-party stores (ADR-0056): what the settings panel's Third-party section and the auto-add use.
---   StoreInstalledGames  every installed Epic and Xbox game, and whether the library has a shortcut for it
---   StoreAccounts        whether an Epic account was found on this PC (and whether its achievements are private),
---                        and whether an Xbox account is signed in (its gamertag). Never a token or an account id.
---   XboxSignInStart / XboxSignInPoll / XboxSignOut   the device-code sign-in (xbox_live.lua)
---   StoreEpicLaunchShortcuts / StoreEpicPrelaunch / StoreEpicReap   the Epic Steam Overlay Workaround (store_launch.lua, ADR-0057)
---   StoreXboxRepairs     U0 Xbox shortcuts to repoint after an app update (ADR-0058)

local core          = require("rpc")
local store_service = require("store_service")
local xbox_live     = require("xbox_live")
local epic_local    = require("store_epic_local")
local copies        = require("store_copies_store")
local store_launch  = require("store_launch")

local method = core.method

local RPC = {}

--- { allowXbox? }: the installed games (store_service.installed_games).
RPC.StoreInstalledGames = method("StoreInstalledGames", function(data)
  return store_service.installed_games({ allowXbox = data.allowXbox ~= false })
end)

RPC.StoreAccounts = method("StoreAccounts", function(_)
  local epic_seen = copies.lookup("epic:account") or {}
  return {
    epic = { found = epic_local.account_id() ~= nil, private = epic_seen.private == true },
    xbox = xbox_live.status(),
  }
end)

RPC.XboxSignInStart = method("XboxSignInStart", function(_)
  return xbox_live.sign_in_start()
end)

--- { device_code }: one poll; the frontend waits `interval` seconds between polls.
RPC.XboxSignInPoll = method("XboxSignInPoll", function(data)
  return xbox_live.sign_in_poll(data.device_code)
end)

RPC.XboxSignOut = method("XboxSignOut", function(_)
  return xbox_live.sign_out()
end)

--- {}: the U0 Xbox shortcuts whose exe is an older version's (ADR-0058), with the current exe and start folder.
RPC.StoreXboxRepairs = method("StoreXboxRepairs", function(_)
  return { repairs = store_service.xbox_repairs() }
end)

--- {}: the shortcuts that are an Epic copy started through the launcher link (the ones held at Play).
RPC.StoreEpicLaunchShortcuts = method("StoreEpicLaunchShortcuts", function(_)
  return { appids = store_service.epic_launcher_shortcuts() }
end)

--- { appid, heldAt }: just before Steam launches the shortcut; closes a running Epic launcher for an Epic launcher-link copy.
--- heldAt (ms) is when Steam's Play was held: a request that waited in the queue too long closes nothing.
RPC.StoreEpicPrelaunch = method("StoreEpicPrelaunch", function(data)
  return store_launch.prelaunch(tonumber(data.appid), tonumber(data.heldAt))
end)

--- { appid, act = "start" | "tick" | "stop" }: the reaper that ends the launcher after the game.
RPC.StoreEpicReap = method("StoreEpicReap", function(data)
  return store_launch.reap(tonumber(data.appid), tostring(data.act or "tick"))
end)

local sensor_log = require("sensor_log")
--- { limit? }: returns recent sensor telemetry lines from third_party.log.
RPC.StoreSensorLogs = method("StoreSensorLogs", function(data)
  local limit = tonumber(data and data.limit) or 50
  return { lines = sensor_log.read_recent(limit) }
end)

return RPC
