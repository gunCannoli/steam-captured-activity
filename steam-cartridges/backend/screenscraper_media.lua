--- steam-cartridges - the ScreenScraper client (jeuInfos.php).
---
--- One `jeu` record per shortcut, shared by two sources:
---   metadata (M5d)    metadata_service maps it to Game Info
---   media (F2b)       media_service lists its screenshot, title screen and fanart as keys; image bytes are
---                     downloaded on demand into memory (download) and never stored on disk
---
--- ScreenScraper's media URLs carry the developer and user accounts in their query string: they never leave
--- this module and media_service (no record, no file, no log, no RPC answer holds one).

local net         = require("net")
local json        = require("json")
local logger      = require("logger")
local utils       = require("utils")
local config      = require("web_config")

local M = {}

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

  local ok, res = pcall(net.get, url, {
    source = "screenscraper",
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

--- The `jeu` for a shortcut: the ROM file name, console and MD5 read from its shortcuts.vdf entry (the
--- RetroAchievements readers), else the title. Returns what fetch_jeu returns.
---@param appid number
---@param title string|nil
---@param info table|nil  the registry.shortcut entry
function M.jeu_for(appid, title, info)
  local ra = require("retroachievements")
  local rom_path = info and ra.extract_rom_path(info.exe, info.launch_options) or nil
  local md5 = rom_path and ra.compute_rom_md5(rom_path) or nil
  local console_id = info and ra.detect_console_id(info.exe, info.launch_options) or nil
  return M.fetch_jeu(appid, rom_path, console_id, nil, md5, title)
end

-- ---------- Community media (features plan F2b) ----------

--- ScreenScraper media types Steam's Community Content section can show, and the card each becomes. Image types
--- only: a type whose bytes are not an image (the HyperSpin theme may be an archive) is dropped when it is downloaded.
M.MEDIA_KINDS = {
  sstitle = "screenshot", ss = "screenshot", fanart = "artwork",
  mixrbv2 = "artwork", mixrbv1 = "artwork", ["box-2D"] = "artwork", ["box-3D"] = "artwork",
  ["support-2D"] = "artwork", flyer = "artwork", themehs = "artwork",
}
local MEDIA_ORDER = { "sstitle", "ss", "fanart", "mixrbv2", "mixrbv1", "box-2D", "box-3D", "support-2D", "flyer", "themehs" }
--- The caption under a card for the types that are not a plain screenshot or fanart.
M.MEDIA_TITLES = {
  mixrbv2 = "Recalbox mix", mixrbv1 = "Recalbox mix (v1)", ["box-2D"] = "Box: front", ["box-3D"] = "3D box",
  ["support-2D"] = "Cartridge / disc", flyer = "Flyer", themehs = "HyperSpin theme",
}
--- Region preference when a type exists for several regions (world first).
local REGION_RANK = { wor = 1, us = 2, eu = 3, ss = 4, jp = 5 }
--- The size a card is laid out with until the bytes are read (GetMediaImage returns the real one).
M.DEFAULT_SIZE = { screenshot = { 640, 480 }, artwork = { 1920, 1080 } }
--- ScreenScraper scales the image down to this width (mediaJeu.php `maxwidth`).
M.MAX_WIDTH = 1280

local function key_of(m)
  return tostring(m.type) .. "(" .. tostring(m.region or "") .. ")"
end

--- The images a `jeu` offers for the Community section, one item per type (best region), as keys only:
--- { kind, source = "screenscraper", key = "ss(wor)", title?, width, height }. Never a URL.
function M.media_items(jeu)
  local by_type = {}
  for _, m in ipairs(type(jeu) == "table" and type(jeu.medias) == "table" and jeu.medias or {}) do
    if type(m) == "table" and M.MEDIA_KINDS[m.type] and type(m.url) == "string" and m.url ~= "" then
      local list = by_type[m.type] or {}
      list[#list + 1] = { rank = REGION_RANK[m.region or "wor"] or 9, key = key_of(m) }
      by_type[m.type] = list
    end
  end
  local items = {}
  for _, t in ipairs(MEDIA_ORDER) do
    local list = by_type[t]
    if list then
      table.sort(list, function(a, b) if a.rank ~= b.rank then return a.rank < b.rank end return a.key < b.key end)
      local kind = M.MEDIA_KINDS[t]
      local size = M.DEFAULT_SIZE[kind]
      local item = { kind = kind, source = "screenscraper", key = list[1].key, width = size[1], height = size[2], title = M.MEDIA_TITLES[t] }
      items[#items + 1] = item
    end
  end
  return items
end

--- The URL of the media item `key` in `jeu`, or nil. Stays in the backend (it carries the accounts).
function M.media_url(jeu, key)
  for _, m in ipairs(type(jeu) == "table" and type(jeu.medias) == "table" and jeu.medias or {}) do
    if type(m) == "table" and type(m.url) == "string" and key_of(m) == key then return m.url end
  end
  return nil
end

local function u16(s, i) return s:byte(i) * 256 + s:byte(i + 1) end
local function u32(s, i) return u16(s, i) * 65536 + u16(s, i + 2) end

--- "jpg" | "png" from the first bytes, or nil (ScreenScraper answers an error as text with HTTP 200).
function M.image_type(body)
  if type(body) ~= "string" then return nil end
  if body:sub(1, 3) == "\255\216\255" then return "jpg" end
  if body:sub(1, 8) == "\137PNG\r\n\26\n" then return "png" end
  return nil
end

--- Width and height from a PNG IHDR or a JPEG SOF segment, or nil.
function M.image_size(body, ext)
  if ext == "png" and #body >= 24 then return u32(body, 17), u32(body, 21) end
  if ext ~= "jpg" then return nil end
  local i = 3
  while i + 8 <= #body do
    if body:byte(i) ~= 0xFF then return nil end
    local marker = body:byte(i + 1)
    if marker >= 0xC0 and marker <= 0xCF and marker ~= 0xC4 and marker ~= 0xC8 and marker ~= 0xCC then
      return u16(body, i + 7), u16(body, i + 5)
    end
    i = i + 2 + u16(body, i + 2)
  end
  return nil
end

--- The bytes of one media URL, scaled to MAX_WIDTH, in memory (net.get_binary). Never logs the URL.
---@return string|nil body, string ext_or_err, number|nil width, number|nil height
function M.download(url)
  local sep = url:find("?", 1, true) and "&" or "?"
  local res, err = net.get_binary(url .. sep .. "maxwidth=" .. M.MAX_WIDTH, {
    source = "screenscraper",
    user_agent = "steam-cartridges/1.0",
  })
  if not res then return nil, tostring(err) end
  if res.status ~= 200 then return nil, "status " .. tostring(res.status) end
  local ext = M.image_type(res.body)
  if not ext then return nil, "not an image" end
  local w, h = M.image_size(res.body, ext)
  return res.body, ext, w, h
end

return M
