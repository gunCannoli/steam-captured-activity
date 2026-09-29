--- RPC handlers for the Steam Store bucket. Names are prefixed `SteamStore` so
--- they cannot collide with generic globals; main.lua registers them.
---
--- Only calls for steam-store games reach here (the frontend gates on the
--- bucket, ADR-0032), so the network is never touched for anything else.

local fs          = require("fs")
local utils       = require("utils")
local steam_paths = require("steam_paths")
local core        = require("rpc")
local store       = require("steam_store_store")
local appdetails  = require("steam_store_appdetails")
local throttle    = require("steam_store_throttle")

local method = core.method

local RPC = {}

local function need(data, field)
  if data[field] == nil then error("missing " .. field) end
  return data[field]
end

RPC.SteamStoreGetState = method("SteamStoreGetState", function(_)
  return store.get_state()
end)

--- `exists(name)` for files in <user>/config/grid, or nil when paths are unknown.
local function grid_exists()
  local paths = steam_paths.resolve()
  if not paths or not paths.user_root then return nil end
  local grid = fs.join(paths.user_root, "config", "grid")
  return function(name) return fs.exists(fs.join(grid, name)) == true end
end

RPC.SteamStoreGetMapping = method("SteamStoreGetMapping", function(data)
  local appid = need(data, "appid")
  local exists = grid_exists()
  if exists then pcall(store.prune_missing_slots, appid, exists) end
  local entry = store.get(appid)
  return { mapping = entry.mapping, rejected = entry.rejected, applied = entry.applied }
end)

RPC.SteamStoreSetMapping = method("SteamStoreSetMapping", function(data)
  local mapping, err = store.set_mapping(need(data, "appid"), need(data, "steam_appid"), data.name, "manual")
  if not mapping then return { error = err } end
  return { mapping = mapping }
end)

--- reject=true remembers the appid so it is never auto-applied again. Returns
--- the slots the frontend must clear (only those this plugin wrote).
RPC.SteamStoreClearMapping = method("SteamStoreClearMapping", function(data)
  return store.clear(need(data, "appid"), data.reject and true or false)
end)

RPC.SteamStoreRejectSuggestion = method("SteamStoreRejectSuggestion", function(data)
  store.reject(need(data, "appid"), need(data, "steam_appid"))
  return { ok = true }
end)

RPC.SteamStoreGetAppDetails = method("SteamStoreGetAppDetails", function(data)
  local d, err, cached = appdetails.fetch(need(data, "steam_appid"), nil, { force = data.force and true or false })
  if not d then return { error = err } end
  return { metadata = appdetails.to_metadata(d, data.appid), cached = cached }
end)

RPC.SteamStoreRecordArtwork = method("SteamStoreRecordArtwork", function(data)
  if data.source == "steamgriddb" then
    -- M5c: SteamGridDB fills a shortcut with no Steam match; there is no mapping to check.
    local ok, err = store.record_sgdb_artwork(need(data, "appid"), data.slots or {}, data.tried or {})
    if not ok then return { error = err } end
    return { ok = true }
  end
  local ok, err = store.record_artwork(need(data, "appid"), need(data, "steam_appid"), data.slots or {}, nil, data.failed or {})
  if not ok then return { error = err } end
  return { ok = true }
end)

--- Fallback only: the frontend fetches CDN art itself (P0 T2).
RPC.SteamStoreDownloadImage = method("SteamStoreDownloadImage", function(data)
  local url = tostring(need(data, "url"))
  if not url:match("^https://[%w%.%-]*steamstatic%.com/") then error("url not allowed") end
  if throttle.is_offline() then error("offline") end -- P4 H3: no timeout per view while offline
  throttle.acquire()
  local res, err = require("net").get(url, { source = "steam-store", headers = { ["User-Agent"] = throttle.USER_AGENT }, timeout = throttle.TIMEOUT })
  if err == "paused" then error("paused") end
  if not res or res.status ~= 200 or not res.body then error("download failed") end
  local ext = url:match("%.(%w+)[%?]?[^/]*$") or "jpg"
  return { base64 = utils.base64_encode(res.body), ext = ext:lower() == "png" and "png" or "jpg" }
end)

return RPC
