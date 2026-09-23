local logger = require("logger")
local millennium = require("millennium")
local json = require("json")

local config = require("config")
local sgdb = require("sgdb")
local igdb = require("igdb")
local metadata_db = require("metadata_db")
local steam_paths = require("steam_paths")
local shortcuts = require("shortcuts")

local function get_shortcut_info(appid)
  local ok_paths, paths = pcall(steam_paths.resolve)
  if ok_paths and paths and paths.shortcuts then
    local entries = shortcuts.parse(paths.shortcuts) or {}
    local by_id = shortcuts.by_appid(entries)
    return by_id[appid]
  end
  return nil
end

--- Check status of providers (Twitch/IGDB & SteamGridDB)
function GetStatus()
  local twitch = config.get_twitch_credentials()
  local sgdb_key = config.get_api_key()
  return json.encode({
    has_twitch = twitch ~= nil,
    has_sgdb = sgdb_key ~= nil and #sgdb_key > 0,
    status = twitch ~= nil and "ready" or "needs_credentials",
    db_count = metadata_db.count(),
  })
end

--- Get consolidated game metadata (checks local JSON DB first, fetches from IGDB if missing)
---@param payload_json string JSON string with { appid = number, title = string }
function GetGameMetadata(payload_json)
  local ok, req = pcall(json.decode, payload_json)
  if not ok or type(req) ~= "table" then
    return json.encode({ error = "invalid_payload", message = "Invalid JSON payload" })
  end

  local appid = tonumber(req.appid)
  local title = req.title or ""
  if not appid then
    return json.encode({ error = "missing_appid", message = "Missing appid" })
  end

  -- 1. Check local consolidated database first
  local existing = metadata_db.get(appid)
  if existing then
    return json.encode({
      success = true,
      source = "local_db",
      metadata = existing,
    })
  end

  -- 2. Query IGDB if not in local database
  local shortcut_info = get_shortcut_info(appid)
  logger:info("Querying IGDB metadata for shortcut " .. tostring(appid) .. " ('" .. tostring(title) .. "')")
  local meta = igdb.fetch_game_metadata(appid, title, shortcut_info)
  if meta then
    metadata_db.set(appid, meta)
    return json.encode({
      success = true,
      source = "igdb",
      metadata = meta,
    })
  end

  -- 3. Fallback record if IGDB has no match (so user can edit it manually in library_metadata.json)
  local fallback = {
    appid = appid,
    title = title,
    igdb_id = nil,
    matched_title = title,
    summary = "",
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
  metadata_db.set(appid, fallback)

  return json.encode({
    success = true,
    source = "fallback",
    metadata = fallback,
  })
end

--- Force refresh / re-query metadata from IGDB, updating the local database
---@param payload_json string JSON string with { appid = number, title = string }
function RefreshGameMetadata(payload_json)
  local ok, req = pcall(json.decode, payload_json)
  if not ok or type(req) ~= "table" or not req.appid then
    return json.encode({ error = "invalid_payload" })
  end
  local appid = tonumber(req.appid)
  local title = req.title or ""
  local shortcut_info = get_shortcut_info(appid)
  logger:info("Force refreshing IGDB metadata for shortcut " .. tostring(appid) .. " ('" .. tostring(title) .. "')")
  local meta = igdb.fetch_game_metadata(appid, title, shortcut_info)
  if meta then
    metadata_db.set(appid, meta, true) -- force update
    return json.encode({ success = true, metadata = meta })
  end
  return json.encode({ error = "not_found" })
end

--- Retrieve the entire consolidated library metadata database
function GetAllMetadata()
  local all = metadata_db.get_all()
  return json.encode({ success = true, library = all })
end

--- Save user manual edits to library_metadata.json
---@param payload_json string JSON string with { appid = number, metadata = table }
function SaveGameMetadata(payload_json)
  local ok, req = pcall(json.decode, payload_json)
  if not ok or type(req) ~= "table" or not req.appid or not req.metadata then
    return json.encode({ error = "invalid_payload" })
  end

  req.metadata.custom_override = true
  local saved = metadata_db.set(req.appid, req.metadata, true)
  return json.encode({ success = true, metadata = saved })
end

--- Retain GetArtworkForGame for artwork provider requests
---@param payload_json string JSON string with { title = string, steam_appid = number|nil }
function GetArtworkForGame(payload_json)
  local key = config.get_api_key()
  if not key then
    return json.encode({ error = "missing_api_key", message = "SteamGridDB API key is not configured" })
  end

  local ok, req = pcall(json.decode, payload_json)
  if not ok or type(req) ~= "table" then
    return json.encode({ error = "invalid_payload", message = "Invalid JSON payload" })
  end

  local title = req.title or ""
  local steam_appid = req.steam_appid

  local game = nil
  if steam_appid and tonumber(steam_appid) and tonumber(steam_appid) > 0 then
    game = sgdb.get_by_steam_appid(tonumber(steam_appid), key)
  end
  if not game and title ~= "" then
    game = sgdb.search_game(title, key)
  end

  if not game then
    return json.encode({ error = "not_found", message = "Game not found on SteamGridDB" })
  end

  local urls = sgdb.fetch_artwork_urls(game.id, key)
  return json.encode({
    success = true,
    game = {
      id = game.id,
      name = game.name,
      release_date = game.release_date,
    },
    urls = urls,
  })
end

local function on_load()
  local twitch = config.get_twitch_credentials()
  if twitch then
    logger:info("Game Metadata provider loaded (Twitch credentials configured).")
  else
    logger:warn("Game Metadata provider loaded (no Twitch credentials found in .env).")
  end
  logger:info("Metadata database contains " .. tostring(metadata_db.count()) .. " cached game(s).")
  millennium.ready()
end

local function on_frontend_loaded()
  logger:info("Game Metadata frontend initialized.")
end

local function on_unload()
  logger:info("Game Metadata provider unloading.")
end

return {
  on_load = on_load,
  on_frontend_loaded = on_frontend_loaded,
  on_unload = on_unload,
}
