--- Metadata resolution: which Game Info to show for a shortcut? (migration plan M5a).
---
--- A port of frontend/features/game-info/policy.ts `gameInfoPlan` plus
--- features/steam-store/index.ts `loadNative` and web_rpc.lua `GetGameMetadata`,
--- called from one place (record_rpc.lua `EnsureFresh`) instead of being spread
--- across the frontend.
---
--- Needs identity: EnsureFresh(appid, {"identity","metadata"}, ctx) resolves
--- identity first in the same call; {"metadata"} alone reads the saved identity
--- (resolve_identity.saved) without a network call for identity.

local resolve_identity = require("resolve_identity")
local metadata_db      = require("web_metadata_db")
local appdetails       = require("steam_store_appdetails")
local igdb             = require("web_igdb")
local web_rpc          = require("web_rpc")

local M = {}

--- Injectable for tests. nil = the real dependency.
M.deps = {
  igdb_fetch = nil,       -- nil = igdb.fetch_game_metadata
  appdetails_fetch = nil, -- nil = appdetails.fetch
  shortcut_info = nil,    -- nil = web_rpc.get_shortcut_info
  now = function() return os.time() end,
}

local function igdb_fetch(appid, title, shortcut_info)
  return (M.deps.igdb_fetch or igdb.fetch_game_metadata)(appid, title, shortcut_info)
end

local function appdetails_fetch(steam_appid)
  return (M.deps.appdetails_fetch or appdetails.fetch)(steam_appid)
end

local function shortcut_info(appid)
  return (M.deps.shortcut_info or web_rpc.get_shortcut_info)(appid)
end

local function now_ms()
  return math.floor((M.deps.now or os.time)() * 1000)
end

--- Disk only: the local library_metadata.json record as a metadata part, or nil.
function M.local_part(appid)
  local rec = metadata_db.get(appid)
  if not rec then return nil end
  return { status = "ok", data = rec, source = rec.custom_override and "custom" or "local_db", checkedAt = now_ms() }
end

--- The fallback record exactly as web_rpc.lua GetGameMetadata builds and persists it.
local function fallback_record(appid, title)
  return {
    appid = appid,
    title = title,
    igdb_id = nil,
    matched_title = title,
    description = "",
    developers = {},
    publishers = {},
    franchises = {},
    release_date = 0,
    genres = {},
    categories = {
      single_player = true,
      multiplayer = false,
      coop = false,
      split_screen = false,
      full_controller = true,
    },
    custom_override = false,
  }
end

--- Full resolution: local db -> steam appdetails / storeItem -> igdb -> fallback.
--- Returns a Part (table). ctx = { title=, route={bucket=,via=}, owned=?, storeItem=?,
--- allowWeb=?, noNetwork=? }
function M.ensure(appid, ctx)
  ctx = ctx or {}
  local route = ctx.route or {}
  local title = ctx.title or ""

  local local_rec = metadata_db.get(appid)
  if local_rec and local_rec.custom_override then
    return { status = "ok", data = local_rec, source = "custom", checkedAt = now_ms() }
  end

  if route.via == "pending" then
    if local_rec then return { status = "ok", data = local_rec, source = "local_db", checkedAt = now_ms() } end
    return { status = "pending", checkedAt = now_ms() }
  end

  if route.bucket == "steam-store" then
    -- The frontend passes the identity it knows (an "ok" result with no native match is
    -- never persisted, so the disk alone cannot tell "no match" from "not known yet").
    local identity = ctx.identity or resolve_identity.saved(appid)
    local native = identity and identity.data and identity.data.native

    if native then
      if ctx.storeItem ~= nil then
        return { status = "ok", data = ctx.storeItem, source = "steam-store", checkedAt = now_ms() }
      end
      local data, err = appdetails_fetch(native.appid)
      if data then
        local meta = appdetails.to_metadata(data, appid)
        return { status = "ok", data = meta, source = "steam-appdetails", checkedAt = now_ms() }
      end
      if local_rec then
        return { status = "error", data = local_rec, message = err, checkedAt = now_ms() }
      end
      return { status = "error", message = err, checkedAt = now_ms() }
    end

    -- Not resolved yet (or failed): local only. "ok" (no match) and "unsupported"
    -- (emulator launcher) fall through to the web tier, as the old ADR-0036 fallback did.
    if not identity or identity.status == "pending" or identity.status == "error" then
      if local_rec then return { status = "ok", data = local_rec, source = "local_db", checkedAt = now_ms() } end
      return { status = "pending", checkedAt = now_ms() }
    end
    -- identity ok, no native match: falls through to the igdb/fallback tier below.
  elseif route.bucket ~= "web-scraping" then
    -- route.bucket == "none"
    if local_rec then return { status = "ok", data = local_rec, source = "local_db", checkedAt = now_ms() } end
    return { status = "unsupported", checkedAt = now_ms() }
  end

  -- web-scraping, or steam-store identity ok without a native match: local -> igdb -> fallback.
  if local_rec then
    return { status = "ok", data = local_rec, source = "local_db", checkedAt = now_ms() }
  end

  if ctx.allowWeb and not ctx.noNetwork then
    local info = shortcut_info(appid)
    local meta = igdb_fetch(appid, title, info)
    if meta then
      metadata_db.set(appid, meta)
      return { status = "ok", data = meta, source = "igdb", checkedAt = now_ms() }
    end
    local fallback = fallback_record(appid, title)
    metadata_db.set(appid, fallback)
    return { status = "ok", data = fallback, source = "fallback", checkedAt = now_ms() }
  end

  return { status = "pending", checkedAt = now_ms() }
end

return M
