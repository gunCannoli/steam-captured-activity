--- Web-metadata and artwork RPC handlers (ex steamgriddb-artwork).
---
--- Raw payload_json signatures and return shapes are kept exactly as they were
--- (P1 is refactor-only), so these are deliberately NOT wrapped in rpc.lua's
--- method(): that would change the error shapes the frontend already handles.

local logger = require("logger")
local json = require("json")

local config = require("web_config")
local sgdb = require("web_sgdb")
local igdb = require("web_igdb")
local metadata_db = require("web_metadata_db")
local steam_paths = require("steam_paths")
local shortcuts = require("shortcuts")
local controllers = require("emulator_controllers")
local emulators = require("steam_store_emulators")

local M = {}

function M.get_shortcut_info(appid)
  local ok_paths, paths = pcall(steam_paths.resolve)
  if ok_paths and paths and paths.shortcuts then
    local entries = shortcuts.parse(paths.shortcuts) or {}
    local by_id = shortcuts.by_appid(entries)
    return by_id[appid]
  end
  return nil
end
local get_shortcut_info = M.get_shortcut_info

--- Check status of providers (Twitch/IGDB, SteamGridDB, ScreenScraper, RetroAchievements)
function M.GetStatus()
  local twitch = config.get_twitch_credentials()
  local sgdb_key = config.get_api_key()
  local ss = config.get_screenscraper_credentials()
  local ra = config.get_retroachievements_credentials()
  return json.encode({
    has_twitch = twitch ~= nil,
    has_sgdb = sgdb_key ~= nil and #sgdb_key > 0,
    has_screenscraper = ss ~= nil,
    has_retroachievements = ra ~= nil,
    status = twitch ~= nil and "ready" or "needs_credentials",
    db_count = metadata_db.count(),
  })
end

--- Robust payload decoder handling raw JSON, tables, and nested Millennium { payload = "..." }
local function decode_payload(payload_json)
  if type(payload_json) == "table" then
    if type(payload_json.payload) == "string" then
      local ok, inner = pcall(json.decode, payload_json.payload)
      if ok and type(inner) == "table" then return inner end
    end
    return payload_json
  end
  local ok, req = pcall(json.decode, payload_json or "{}")
  if not ok or type(req) ~= "table" then return nil end
  if type(req.payload) == "string" then
    local ok_inner, inner = pcall(json.decode, req.payload)
    if ok_inner and type(inner) == "table" then return inner end
  end
  return req
end

--- Save service credentials (Twitch, ScreenScraper, RetroAchievements, SGDB)
function M.SaveServiceCredentials(payload_json)
  local data = decode_payload(payload_json)
  if not data then
    return json.encode({ success = false, error = "invalid_payload" })
  end
  local ok_save = config.save_credentials(data)
  return json.encode({ success = ok_save })
end

--- Get consolidated game metadata (checks local JSON DB first, fetches from IGDB if missing)
---@param payload_json string JSON string with { appid = number, title = string }
function M.GetGameMetadata(payload_json)
  local req = decode_payload(payload_json)
  if not req or not req.appid then
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
function M.RefreshGameMetadata(payload_json)
  local req = decode_payload(payload_json)
  if not req or not req.appid then
    return json.encode({ error = "invalid_payload" })
  end
  local appid = tonumber(req.appid)
  local title = req.title or ""
  local existing = metadata_db.get(appid)
  if existing and existing.custom_override then
    -- K15: user edits are never refreshed, forced or not.
    return json.encode({ error = "custom_override" })
  end
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
function M.GetAllMetadata()
  local all = metadata_db.get_all()
  return json.encode({ success = true, library = all })
end

--- Controller support inferred from each shortcut's emulator (parity plan Part F,
--- ADR-0038 addendum): { games = { ["<appid>"] = true|false } }; unknown games
--- are left out. Never fails: an unreadable shortcuts.vdf gives an empty map.
function M.GetControllerInference()
  local ok, games = pcall(function()
    local paths = steam_paths.resolve()
    if not paths or not paths.shortcuts then return {} end
    return controllers.for_entries(shortcuts.parse(paths.shortcuts) or {})
  end)
  return json.encode({ games = ok and games or {} })
end

--- Classify shortcuts for Auto Mode routing:
--- "retroarch" -> RetroArch / libretro cores (retroachievements + web scraping)
--- "console_emulator" -> Standalone emulators with native achievements (console_emulators + web scraping)
--- "pc" -> Native PC game (steam_store mirror + local achievements)
function M.GetAutoRoutingProfiles()
  local ok, profiles = pcall(function()
    local paths = steam_paths.resolve()
    if not paths or not paths.shortcuts then return {} end
    local entries = shortcuts.parse(paths.shortcuts) or {}
    local out = {}
    for _, entry in ipairs(entries) do
      if entry.appid then
        local cmd = tostring(entry.exe or "") .. " " .. tostring(entry.launch_options or "")
        local program = emulators.program(entry.exe)
        local head = program:match("^(%w+)[%-_ ]")
        local is_retro = program == "retroarch" or head == "retroarch" or cmd:lower():find("retroarch") ~= nil or cmd:lower():find("_libretro") ~= nil
        local is_emu = emulators.is_emulator(entry.exe) or (head and emulators.is_emulator(head))

        local category = "pc"
        if is_retro then
          category = "retroarch"
        elseif is_emu then
          category = "console_emulator"
        else
          category = "pc"
        end

        local profile = {
          category = category,
          program = program,
        }

        local u_key = tostring(entry.appid)
        out[u_key] = profile
        local num = tonumber(entry.appid)
        if num and num >= 2147483648 then
          local s_key = tostring(num - 4294967296)
          out[s_key] = profile
        end
      end
    end
    return out
  end)
  return json.encode({ profiles = ok and profiles or {} })
end

--- Save user manual edits to library_metadata.json
---@param payload_json string JSON string with { appid = number, metadata = table }
function M.SaveGameMetadata(payload_json)
  local req = decode_payload(payload_json)
  if not req or not req.appid or not req.metadata then
    return json.encode({ error = "invalid_payload" })
  end

  req.metadata.custom_override = true
  local saved = metadata_db.set(req.appid, req.metadata, true)
  return json.encode({ success = true, metadata = saved })
end

--- Retain GetArtworkForGame for artwork provider requests
---@param payload_json string JSON string with { title = string, steam_appid = number|nil }
function M.GetArtworkForGame(payload_json)
  local key = config.get_api_key()
  if not key then
    return json.encode({ error = "missing_api_key", message = "SteamGridDB API key is not configured" })
  end

  local req = decode_payload(payload_json)
  if not req then
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

return M
