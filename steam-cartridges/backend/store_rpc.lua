--- Third-party stores (ADR-0056): what the settings panel's Third-party section and the auto-add use.
---   StoreInstalledGames  every installed Epic and Xbox game, and whether the library has a shortcut for it
---   StoreAccounts        whether an Epic account was found on this PC (and whether its achievements are private),
---                        and whether an Xbox account is signed in (its gamertag). Never a token or an account id.
---   XboxSignInStart / XboxSignInPoll / XboxSignOut   the device-code sign-in (xbox_live.lua)

local core          = require("rpc")
local store_service = require("store_service")
local xbox_live     = require("xbox_live")
local epic_local    = require("store_epic_local")
local copies        = require("store_copies_store")

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

return RPC
