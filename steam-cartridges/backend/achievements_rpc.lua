--- RPC endpoints for the native achievements subsystem (P5).
--- Wrapped via rpc.method for safe JSON marshalling.

local core     = require("rpc")
local store    = require("achievements_store")
local observer = require("achievements_observer")

local method = core.method

local RPC = {}

RPC.CartridgesAchievementsGet = method("CartridgesAchievementsGet", function(data)
  local shortcut_appid = data.shortcut_appid
  local native_appid = tonumber(data.native_appid) or 0
  if not shortcut_appid then error("missing shortcut_appid") end
  
  if native_appid > 0 then
    local res = store.get_or_fetch(shortcut_appid, native_appid)
    if res and res.schema then return res end
  end

  -- 1. Try RPCS3 local PlayStation 3 trophies
  local ps3 = require("ps3_trophies")
  local ps3_res = ps3.get_or_fetch(shortcut_appid)
  if ps3_res and ps3_res.schema then return ps3_res end

  -- 2. Try shadPS4 local PlayStation 4 trophies
  local ps4 = require("ps4_trophies")
  local ps4_res = ps4.get_or_fetch(shortcut_appid)
  if ps4_res and ps4_res.schema then return ps4_res end

  -- 3. Fallback to RetroAchievements (for retro games/emulators)
  local ra = require("retroachievements")
  local hardcore = data.hardcore ~= false
  local ra_res, err = ra.get_or_fetch(shortcut_appid, hardcore)
  if ra_res and ra_res.schema then return ra_res end

  if native_appid > 0 then
    return store.get_or_fetch(shortcut_appid, native_appid)
  end
  return { schema = nil, unlocks = {}, error = err }
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
  local native_appid = tonumber(data.native_appid) or 0
  local game_title = data.game_title
  if not shortcut_appid then error("missing shortcut_appid") end
  return observer.check_unlocks(shortcut_appid, native_appid, game_title)
end)

RPC.CartridgesAchievementsGetRetroStatus = method("CartridgesAchievementsGetRetroStatus", function(data)
  local ra = require("retroachievements")
  return ra.get_emulator_status()
end)

return RPC
