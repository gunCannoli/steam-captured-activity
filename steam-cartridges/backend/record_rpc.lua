--- The record facade: EnsureFresh (resolves stale parts) and GetAllRecords (disk only).
--- Migration plan M4b; M5a adds "metadata" and GetAllRecords; M10 removed GetGameRecord (never called).

local core             = require("rpc")
local resolve_identity  = require("resolve_identity")
local metadata_service  = require("metadata_service")
local art_service       = require("art_service")
local metadata_db       = require("web_metadata_db")
local steam_store_store = require("steam_store_store")

local method = core.method

-- Achievements modules are loaded on first use: they pull in the trophy and RetroAchievements
-- readers, which the record facade's other parts (and their test suites) do not need.
local function ach() return require("ach_service") end
local function fresh() return require("fresh_policy") end
local function now_ms() return math.floor(os.time() * 1000) end

local RPC = {}

local function need(data, field)
  if data[field] == nil then error("missing " .. field) end
  return data[field]
end

local SHORTCUT_MIN = 0x80000000

local function is_shortcut(appid)
  local n = tonumber(appid)
  return n ~= nil and n >= SHORTCUT_MIN
end

RPC.EnsureFresh = method("EnsureFresh", function(data)
  local appid = need(data, "appid")
  if not is_shortcut(appid) then return { error = "not a shortcut" } end
  local requested = need(data, "parts")
  local ctx = data.context or {}

  local parts = {}
  for _, name in ipairs(requested) do
    if name == "identity" then
      -- A lookup that failed less than 30 min ago is answered from memory (a saved mapping always wins).
      local recent = not ctx.force and not resolve_identity.saved(appid) and fresh().recent_error(appid, "identity", now_ms())
      if recent then
        parts.identity = recent
      else
        parts.identity = resolve_identity.ensure(appid, ctx)
        if parts.identity.status == "ok" or parts.identity.status == "error" then
          fresh().touch(appid, "identity", now_ms(), parts.identity.status)
        end
        if parts.identity.status == "error" then
          fresh().remember_error(appid, "identity", now_ms(), parts.identity)
        else
          fresh().forget_error(appid, "identity")
        end
      end
      ctx.identity = parts.identity -- later parts of this same call see the fresh identity
    elseif name == "metadata" then
      parts.metadata = metadata_service.ensure(appid, ctx)
    elseif name == "artwork" then
      -- Only a lookup without a Steam match can fail (SteamGridDB); a failure less than 30 min ago is answered
      -- from memory. A Steam match (a new mapping) always asks again.
      local identity = ctx.identity
      local native = identity and identity.data and identity.data.native
      local recent = not ctx.force and not native and fresh().recent_error(appid, "artwork", now_ms())
      if recent then
        parts.artwork = recent
      else
        parts.artwork = art_service.ensure(appid, ctx)
        if parts.artwork.status == "error" then
          fresh().remember_error(appid, "artwork", now_ms(), parts.artwork)
        else
          fresh().forget_error(appid, "artwork")
        end
      end
    elseif name == "achievements" then
      -- The native app comes from the identity: this call's fresh one, else the frontend's, else disk.
      -- Only a steam-store route uses a Steam match (a shortcut moved to web-scraping is unmatched here).
      local identity = ctx.identity
      if not identity and (ctx.route or {}).bucket == "steam-store" then identity = resolve_identity.saved(appid) end
      local native = identity and identity.data and identity.data.native
      -- The schema is refreshed at most every 24 h; unlocks are read by their own channels (Flow C).
      local cached = ach().local_part(appid)
      if cached and not ctx.force and not fresh().is_stale(appid, "achievements", cached, now_ms()) then
        parts.achievements = cached
      else
        parts.achievements = ach().ensure(appid, {
          native = native and native.appid or nil,
          hardcore = ctx.hardcore ~= false,
          title = ctx.title,
        })
        local st = parts.achievements.status
        if st == "ok" or st == "error" then fresh().touch(appid, "achievements", now_ms(), st) end
      end
    end
    -- Unknown part names are ignored (not an error).
  end

  -- Which sources are paused right now (M7a breakers), so a background run can stop instead of hammering.
  local result = { appid = tonumber(appid), parts = parts }
  local paused = require("net").stats().paused
  if next(paused) ~= nil then result.paused = paused end
  return result
end)

--- Every DB record and every saved mapping, disk only. Replaces the frontend's
--- getAllMetadata preload in M5b.
RPC.GetAllRecords = method("GetAllRecords", function(_)
  local records = {}
  local all_meta = metadata_db.get_all()
  for key, rec in pairs(all_meta) do
    records[key] = records[key] or {}
    records[key].metadata = { status = "ok", data = rec, source = rec.custom_override and "custom" or "local_db" }
  end
  for key, mapping in pairs(steam_store_store.get_state().mappings) do
    records[key] = records[key] or {}
    records[key].identity = {
      status = "ok",
      data = { native = { appid = mapping.steam_appid, source = mapping.source } },
      source = "steam-store",
    }
  end
  for key in pairs(records) do
    local achievements = ach().local_part(tonumber(key))
    if achievements then records[key].achievements = achievements end
  end
  return { records = records }
end)

--- New unlocks since the last check (Flow C, M6b polls this every 2 s). K1: `new_unlocks` is always a list.
RPC.CheckUnlocks = method("CheckUnlocks", function(data)
  local appid = need(data, "appid")
  if not is_shortcut(appid) then return { error = "not a shortcut" } end
  return require("achievements_observer").check_unlocks(tonumber(appid), tonumber(data.native) or 0, data.title)
end)

--- Shortcuts in shortcuts.vdf the plugin has not seen before (Flow B). The first call seeds the file
--- with the current library and returns none, so an existing library is never fetched in one storm.
RPC.GetNewShortcuts = method("GetNewShortcuts", function(_)
  return { shortcuts = require("registry").new_shortcuts() }
end)

--- Mark shortcuts as handled: { appids = [...] }.
RPC.MarkKnown = method("MarkKnown", function(data)
  require("registry").mark_known(need(data, "appids"))
  return { ok = true }
end)

return RPC
