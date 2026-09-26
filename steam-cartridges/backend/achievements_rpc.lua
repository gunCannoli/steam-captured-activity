--- RPC endpoints for the native achievements subsystem (P5).
--- Wrapped via rpc.method for safe JSON marshalling.

local core     = require("rpc")
local store    = require("achievements_store")
local observer = require("achievements_observer")

local method = core.method

local RPC = {}

RPC.CartridgesAchievementsGet = method("CartridgesAchievementsGet", function(data)
  local shortcut_appid = data.shortcut_appid
  local native_appid = data.native_appid
  if not shortcut_appid then error("missing shortcut_appid") end
  return store.get_or_fetch(shortcut_appid, native_appid)
end)

RPC.CartridgesAchievementsUnlock = method("CartridgesAchievementsUnlock", function(data)
  local shortcut_appid = data.shortcut_appid
  local achievement_id = data.achievement_id
  if not shortcut_appid then error("missing shortcut_appid") end
  if not achievement_id then error("missing achievement_id") end
  return store.unlock(shortcut_appid, achievement_id, data.unlock_time)
end)

RPC.CartridgesAchievementsReset = method("CartridgesAchievementsReset", function(data)
  local shortcut_appid = data.shortcut_appid
  if not shortcut_appid then error("missing shortcut_appid") end
  return store.reset(shortcut_appid)
end)

RPC.CartridgesAchievementsCheckUnlocks = method("CartridgesAchievementsCheckUnlocks", function(data)
  local shortcut_appid = data.shortcut_appid
  local native_appid = data.native_appid
  local game_title = data.game_title
  if not shortcut_appid then error("missing shortcut_appid") end
  if not native_appid then error("missing native_appid") end
  return observer.check_unlocks(shortcut_appid, native_appid, game_title)
end)

return RPC
