--- Artwork resolution: which art may a shortcut get, and from where? (migration plan M5c).
---
--- Sources:
---   steam-cdn    the shortcut has a saved Steam match: the native app's CDN URLs
---                (the frontend passes the hashed StoreItemCache URLs as ctx.artUrls).
---   steamgriddb  no Steam match: search SteamGridDB by title, then fetch the four slots.
---
--- Only EMPTY slots are ever offered for SteamGridDB (data.emptySlots): a slot with
--- a grid file in <user>/config/grid, or one this plugin already attempted, is left
--- alone, so a slot the user set (or cleared) is never touched.
---
--- ADR-0035: route bucket "none" makes no network call. ADR-0014: a missing key or a
--- failed lookup is silent to the user (needs-setup / empty urls), never an error toast.
--- The API key is read here and passed only to web_sgdb; it is never logged.

local fs          = require("fs")
local steam_paths = require("steam_paths")
local config      = require("web_config")
local sgdb        = require("web_sgdb")
local normalize   = require("steam_store_normalize")
local store       = require("steam_store_store")
local resolve_identity = require("resolve_identity")

local M = {}

--- Injectable for tests. nil = the real dependency.
M.deps = {
  api_key = nil,     -- nil = web_config.get_api_key
  search = nil,      -- nil = web_sgdb.search_game(title, key)
  fetch = nil,       -- nil = web_sgdb.fetch_artwork_urls(game_id, key)
  grid_exists = nil, -- nil = files in <user>/config/grid
  now = function() return os.time() end,
}

local SLOTS = { 0, 1, 2, 3 }
local SLOT_KEY = { [0] = "portrait", [1] = "hero", [2] = "logo", [3] = "wide" }

local function now_ms()
  return math.floor((M.deps.now or os.time)() * 1000)
end

local function grid_exists()
  if M.deps.grid_exists then return M.deps.grid_exists end
  local ok, paths = pcall(steam_paths.resolve)
  if not ok or not paths or not paths.user_root then return nil end
  local grid = fs.join(paths.user_root, "config", "grid")
  return function(name) return fs.exists(fs.join(grid, name)) == true end
end

--- Steam's public CDN paths for a native app (same as the frontend's cdnArtworkUrls).
function M.cdn_urls(steam_appid)
  local base = "https://cdn.akamai.steamstatic.com/steam/apps/" .. tostring(math.floor(steam_appid)) .. "/"
  return {
    portrait = base .. "library_600x900.jpg",
    hero = base .. "library_hero.jpg",
    logo = base .. "logo.png",
    wide = base .. "header.jpg",
  }
end

--- Slots with no grid file. With no readable grid folder nothing is known: no slot is
--- called empty, so nothing is ever overwritten blindly.
local function empty_slots(appid, exists)
  local out = {}
  if not exists then return out end
  for _, slot in ipairs(SLOTS) do
    local present = false
    for _, name in ipairs(store.slot_files(appid, slot)) do
      if exists(name) then present = true break end
    end
    if not present then out[#out + 1] = slot end
  end
  return out
end

local function without(list, drop)
  local skip, out = {}, {}
  for _, v in ipairs(drop or {}) do skip[tonumber(v)] = true end
  for _, v in ipairs(list) do if not skip[v] then out[#out + 1] = v end end
  return out
end

local function has_urls(urls)
  for _, slot in ipairs(SLOTS) do if urls[SLOT_KEY[slot]] then return true end end
  return false
end

--- Full resolution. Returns a Part (table).
--- ctx = { title=, route={bucket=,via=}, artUrls=?, allowSgdb=?, noNetwork=? }
--- data = { urls, source, steamAppid?, applied?, emptySlots }
function M.ensure(appid, ctx)
  ctx = ctx or {}
  local route = ctx.route or {}

  if route.via == "pending" then return { status = "pending", checkedAt = now_ms() } end
  if route.bucket == "none" then return { status = "unsupported", checkedAt = now_ms() } end

  local exists = grid_exists()
  if exists then pcall(store.prune_missing_slots, appid, exists) end
  local entry = store.get(appid)
  local applied = entry.applied

  -- Only a steam-store route uses a Steam match for art (a shortcut moved to web-scraping
  -- keeps the art it has, ADR-0033, and is treated as unmatched here).
  local identity = nil
  if route.bucket == "steam-store" then identity = ctx.identity or resolve_identity.saved(appid) end
  local native = identity and identity.data and identity.data.native
  if native then
    local urls = M.cdn_urls(native.appid)
    for k, v in pairs(ctx.artUrls or {}) do
      if type(v) == "string" and v ~= "" then urls[k] = v end
    end
    return {
      status = "ok",
      source = "steam-cdn",
      data = { urls = urls, source = "steam-cdn", steamAppid = native.appid, applied = applied, emptySlots = empty_slots(appid, exists) },
      checkedAt = now_ms(),
    }
  end

  if route.bucket == "steam-store" and (not identity or identity.status == "pending" or identity.status == "error") then
    -- Identity not resolved yet: wait (as metadata's local-only tier).
    return { status = "pending", checkedAt = now_ms() }
  end

  -- No Steam match: SteamGridDB, empty slots only.
  local tried = applied and applied.source == "steamgriddb" and applied.tried or {}
  local eligible = without(empty_slots(appid, exists), tried)
  local base = { urls = {}, source = "steamgriddb", emptySlots = eligible }

  if ctx.allowSgdb == false or ctx.noNetwork or #eligible == 0 then
    return { status = "ok", source = "steamgriddb", data = base, checkedAt = now_ms() }
  end

  local key = (M.deps.api_key or config.get_api_key)()
  if not key or key == "" then
    return { status = "needs-setup", message = "SteamGridDB API key not set", checkedAt = now_ms() }
  end

  local title = ctx.title or ""
  local norm = normalize.normalize(title)
  if norm == "" then return { status = "pending", checkedAt = now_ms() } end
  local neg = "sgdb:" .. norm
  if store.is_negative(neg, (M.deps.now or os.time)()) then
    return { status = "ok", source = "steamgriddb", data = base, checkedAt = now_ms() }
  end

  local search = M.deps.search or sgdb.search_game
  local fetch = M.deps.fetch or sgdb.fetch_artwork_urls
  local okc, game = pcall(search, title, key)
  if not okc then return { status = "error", message = "SteamGridDB search failed", checkedAt = now_ms() } end
  if not game or not game.id then
    store.set_negative(neg, (M.deps.now or os.time)())
    return { status = "ok", source = "steamgriddb", data = base, checkedAt = now_ms() }
  end

  local okf, urls = pcall(fetch, game.id, key)
  if not okf or type(urls) ~= "table" then
    return { status = "error", message = "SteamGridDB fetch failed", checkedAt = now_ms() }
  end
  if not has_urls(urls) then
    store.set_negative(neg, (M.deps.now or os.time)())
    return { status = "ok", source = "steamgriddb", data = base, checkedAt = now_ms() }
  end

  base.urls = urls
  return { status = "ok", source = "steamgriddb", data = base, fetchedAt = now_ms(), checkedAt = now_ms() }
end

return M
