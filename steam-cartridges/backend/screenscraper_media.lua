--- steam-cartridges - ScreenScraper media & manuals provider.
---
--- Integrates ScreenScraper's jeuInfos.php API for retro games media:
---   1. In-game screenshots & title screens
---   2. Fanart & promotional backdrops
---   3. Gameplay preview videos (MP4)
---   4. Digital game manuals (PDF / multi-page scans)

local http        = require("http")
local json        = require("json")
local logger      = require("logger")
local data_dir    = require("data_dir")
local utils       = require("utils")
local config      = require("web_config")
local steam_paths = require("steam_paths")
local shortcuts   = require("shortcuts")

local M = {}

--- Cache for media results keyed by appid
local media_cache = {}

local function count_keys(tbl)
  local c = 0
  for _ in pairs(tbl or {}) do c = c + 1 end
  return c
end

--- Get media directory for a given appid
local function get_media_dir(appid)
  local dir = data_dir.path() .. "/media/" .. tostring(appid)
  pcall(function()
    local fs = require("fs")
    if not fs.is_directory(dir) then
      fs.create_directories(dir)
      fs.create_directories(dir .. "/screenshots")
      fs.create_directories(dir .. "/videos")
      fs.create_directories(dir .. "/manuals")
    end
  end)
  return dir
end

--- Decode incoming RPC payload
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

--- In-memory `jeu` records, by shortcut appid (positive results only).
local jeu_cache = {}

--- The raw ScreenScraper `jeu` record for a game (jeuInfos.php): the one client the media
--- (M-series) and metadata (M5d) sources share.
---@param appid number
---@param rom_path string|nil
---@param system_id number|nil
---@param crc string|nil
---@param md5 string|nil
---@param name string|nil  a title to search by when there is no ROM file name
---@return table|nil jeu
---@return string|nil err  "no-credentials" | "request-failed" | "not-found"
function M.fetch_jeu(appid, rom_path, system_id, crc, md5, name)
  if not appid then return nil, "not-found" end
  if jeu_cache[appid] then return jeu_cache[appid] end

  local creds = config.get_screenscraper_credentials()
  if not creds or (creds.dev_user == "" and creds.user == "") then
    -- Fail silently if no ScreenScraper credentials configured (ADR-0014)
    return nil, "no-credentials"
  end

  local dev_id = creds.dev_user ~= "" and creds.dev_user or creds.user
  local dev_pw = creds.dev_pw ~= "" and creds.dev_pw or creds.pass
  local ssid   = creds.user
  local sspw   = creds.pass

  local filename = rom_path and rom_path:match("([^/\\]+)$") or ""
  if filename == "" and name and #name > 0 then filename = name end
  local url = string.format(
    "https://api.screenscraper.fr/api2/jeuInfos.php?devid=%s&devpassword=%s&softname=steam-cartridges&output=json&romtype=rom",
    utils.url_encode(dev_id),
    utils.url_encode(dev_pw)
  )

  if #ssid > 0 and #sspw > 0 then
    url = url .. string.format("&ssid=%s&sspassword=%s", utils.url_encode(ssid), utils.url_encode(sspw))
  end
  if #filename > 0 then
    url = url .. "&romnom=" .. utils.url_encode(filename)
  end
  if system_id and system_id > 0 then
    url = url .. "&systemeid=" .. tostring(system_id)
  end
  if crc and #crc > 0 then
    url = url .. "&crc=" .. utils.url_encode(crc)
  end
  if md5 and #md5 > 0 then
    url = url .. "&md5=" .. utils.url_encode(md5)
  end

  local ok, res = pcall(http.get, url, {
    user_agent = "steam-cartridges/1.0",
    timeout = 15,
  })

  -- Never log `url`: it carries the account credentials.
  if not ok or not res or res.status ~= 200 or not res.body then
    logger:info("ScreenScraper API request returned status " .. tostring(res and res.status))
    return nil, "request-failed"
  end

  local decode_ok, data = pcall(json.decode, res.body)
  if not decode_ok or type(data) ~= "table" or not data.response or not data.response.jeu then
    return nil, "not-found"
  end

  jeu_cache[appid] = data.response.jeu
  return jeu_cache[appid]
end

--- Fetch media from ScreenScraper API
---@param appid number
---@param rom_path string|nil
---@param system_id number|nil
---@param crc string|nil
---@param md5 string|nil
---@return table|nil
function M.fetch_media(appid, rom_path, system_id, crc, md5)
  if not appid then return nil end
  if media_cache[appid] then return media_cache[appid] end

  local jeu, err = M.fetch_jeu(appid, rom_path, system_id, crc, md5)
  if err == "no-credentials" then
    return {
      appid = appid,
      screenshots = {},
      titlescreen = nil,
      fanart = nil,
      video = nil,
      manual = nil,
    }
  end
  if not jeu then return nil end

  local filename = rom_path and rom_path:match("([^/\\]+)$") or ""
  local medias = jeu.medias or {}
  local screenshots = {}
  local titlescreen = nil
  local fanart = nil
  local video = nil
  local manual = nil

  for _, m in ipairs(medias) do
    local mtype = m.type or ""
    local murl = m.url or ""
    if #murl > 0 then
      if mtype == "ss" or mtype == "screenshot" then
        table.insert(screenshots, murl)
      elseif mtype == "sstitle" or mtype == "titlescreen" then
        titlescreen = titlescreen or murl
      elseif mtype == "fanart" then
        fanart = fanart or murl
      elseif mtype == "video-normalized" or mtype == "video" then
        video = video or murl
      elseif mtype == "manual" then
        manual = manual or murl
      end
    end
  end

  local result = {
    appid = appid,
    rom_title = jeu.nom or filename,
    screenshots = screenshots,
    titlescreen = titlescreen,
    fanart = fanart,
    video = video,
    manual = manual,
  }

  media_cache[appid] = result
  return result
end

--- Get media for a shortcut appid
function M.GetGameMedia(payload_json)
  local req = decode_payload(payload_json)
  local appid = tonumber(req and (req.appid or req.shortcut_appid))
  if not appid then
    return json.encode({ error = "missing_appid", screenshots = {} })
  end
  if appid < 0 then appid = appid + 0x100000000 end

  if media_cache[appid] then
    return json.encode({ success = true, media = media_cache[appid] })
  end

  -- Check if shortcut provides ROM info
  local ra = require("retroachievements")
  local paths = steam_paths.resolve()
  local entries = (paths and paths.shortcuts) and shortcuts.parse(paths.shortcuts) or {}
  local sc = nil
  for _, entry in ipairs(entries) do
    if entry.appid == appid then
      sc = entry
      break
    end
  end

  local rom_path = sc and ra.extract_rom_path(sc.exe, sc.launch_options) or nil
  local md5 = rom_path and ra.compute_rom_md5(rom_path) or nil
  local console_id = sc and ra.detect_console_id(sc.exe, sc.launch_options) or nil

  local media = M.fetch_media(appid, rom_path, console_id, nil, md5)
  if media then
    return json.encode({ success = true, media = media })
  end

  return json.encode({ success = true, media = { appid = appid, screenshots = {} } })
end

--- Get manual info for a game
function M.GetGameManual(payload_json)
  local req = decode_payload(payload_json)
  local appid = tonumber(req and (req.appid or req.shortcut_appid))
  if not appid then
    return json.encode({ error = "missing_appid" })
  end
  if appid < 0 then appid = appid + 0x100000000 end

  local cached = media_cache[appid]
  if cached and cached.manual then
    return json.encode({ success = true, manual_url = cached.manual })
  end

  return json.encode({ success = false, message = "no manual available" })
end

return M
