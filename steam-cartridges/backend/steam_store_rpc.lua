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
local search      = require("steam_store_search")
local appdetails  = require("steam_store_appdetails")
local throttle    = require("steam_store_throttle")
local resolve_identity = require("resolve_identity")

local method = core.method

local RPC = {}

--- Is this shortcut launched through a known emulator? False when unknown.
--- Moved to resolve_identity.lua (M4b); shared with EnsureFresh.
local launches_emulator = resolve_identity.launches_emulator

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

RPC.SteamStoreSaveKnownMatch = method("SteamStoreSaveKnownMatch", function(data)
  if launches_emulator(need(data, "appid")) then return { skipped = "emulator" } end
  local mapping, err = store.set_mapping(data.appid, need(data, "steam_appid"), data.name, "owned")
  if not mapping then
    if err == "rejected" then return { skipped = "rejected" } end
    return { error = err }
  end
  return { mapping = mapping }
end)

RPC.SteamStoreSearch = method("SteamStoreSearch", function(data)
  local appid, title = need(data, "appid"), tostring(need(data, "title"))
  if launches_emulator(appid) then return { skipped = "emulator" } end

  local result = search.search(title, nil, store)
  if result.skipped then return { skipped = result.skipped } end
  if result.error then return { error = result.error } end

  if result.exact then
    local mapping = store.set_mapping(appid, result.exact.appid, result.exact.name, "search")
    if mapping then
      store.remove_suggestion(appid, result.exact.appid)
      return { mapping = mapping }
    end
    return { skipped = "rejected" } -- an exact hit the user already rejected
  end
  return { suggestions = store.add_suggestions(appid, result.suggestions) }
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
  local ok, err = store.record_artwork(need(data, "appid"), need(data, "steam_appid"), data.slots or {}, nil, data.failed or {})
  if not ok then return { error = err } end
  return { ok = true }
end)

--- Fallback only: the frontend fetches CDN art itself (P0 T2).
RPC.SteamStoreDownloadImage = method("SteamStoreDownloadImage", function(data)
  local url = tostring(need(data, "url"))
  if not url:match("^https://[%w%.%-]*steamstatic%.com/") then error("url not allowed") end
  if throttle.is_offline() then error("offline") end -- P4 H3: no timeout per view while offline
  local http = require("http")
  throttle.acquire()
  local res = http.get(url, { headers = { ["User-Agent"] = throttle.USER_AGENT }, timeout = throttle.TIMEOUT })
  if not res or res.status ~= 200 or not res.body then error("download failed") end
  local ext = url:match("%.(%w+)[%?]?[^/]*$") or "jpg"
  return { base64 = utils.base64_encode(res.body), ext = ext:lower() == "png" and "png" or "jpg" }
end)

return RPC
