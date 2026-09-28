--- steam-cartridges - IGDB Community, Media & Trailers Provider.
---
--- Fetches rich community destinations, YouTube trailers, and official artworks
--- using Twitch OAuth credentials.

local http        = require("http")
local json        = require("json")
local logger      = require("logger")
local config      = require("web_config")
local data_dir    = require("data_dir")
local utils       = require("utils")
local steam_paths = require("steam_paths")
local shortcuts   = require("shortcuts")

local M = {}

local cached_token = nil
local token_expires_at = 0

--- HTTP POST wrapper for IGDB queries
local function http_post(url, headers, body, timeout)
  timeout = timeout or 20
  headers = headers or {}
  body = body or ""
  local calls = {}

  if type(http.request) == "function" then
    calls[#calls + 1] = function() return http.request(url, { method = "POST", data = body, headers = headers, timeout = timeout }) end
    calls[#calls + 1] = function() return http.request(url, { method = "POST", body = body, headers = headers, timeout = timeout }) end
  end
  if type(http.post) == "function" then
    calls[#calls + 1] = function() return http.post(url, { method = "POST", data = body, headers = headers, timeout = timeout }) end
    calls[#calls + 1] = function() return http.post(url, { method = "POST", body = body, headers = headers, timeout = timeout }) end
  end

  local first_err = nil
  for _, fn in ipairs(calls) do
    local ok, res = pcall(fn)
    if ok and type(res) == "table" and res.status then
      if (res.status >= 200 and res.status < 300) or res.status == 400 or res.status == 401 then
        return res
      end
      first_err = first_err or res
    end
  end
  return first_err
end

--- Obtain or refresh Twitch OAuth2 token
local function get_access_token()
  local now = os.time()
  if cached_token and now < token_expires_at then
    return cached_token
  end

  local creds = config.get_twitch_credentials()
  if not creds then return nil end

  local token_url = "https://id.twitch.tv/oauth2/token?client_id=" .. creds.client_id ..
                    "&client_secret=" .. creds.client_secret ..
                    "&grant_type=client_credentials"

  local res = http_post(token_url, { ["Accept"] = "application/json" }, "", 15)
  if not res or res.status ~= 200 or not res.body then
    return nil
  end

  local ok, data = pcall(json.decode, res.body)
  if not ok or type(data) ~= "table" or not data.access_token then
    return nil
  end

  cached_token = data.access_token
  local expires_in = tonumber(data.expires_in) or 3600
  token_expires_at = now + (expires_in - 300)
  return cached_token
end

--- Clean shortcut name for IGDB search
local function clean_title(name)
  if not name or name == "" then return "" end
  local cleaned = name
  cleaned = cleaned:gsub("%.%w%w%w?%w?$", "")
  cleaned = cleaned:gsub("%b()", "")
  cleaned = cleaned:gsub("%b[]", "")
  if cleaned:find("/") then
    local first = cleaned:match("^(.-)%s*/")
    if first and #first:gsub("%s+", "") >= 2 then cleaned = first end
  end
  cleaned = cleaned:gsub("[%.%_]", " ")
  cleaned = cleaned:gsub('"', "")
  cleaned = cleaned:match("^%s*(.-)%s*$") or ""
  return cleaned
end

--- Query IGDB
local function query_igdb(apicalypse_query)
  local creds = config.get_twitch_credentials()
  if not creds then return nil end

  local token = get_access_token()
  if not token then return nil end

  local headers = {
    ["Client-ID"] = creds.client_id,
    ["Authorization"] = "Bearer " .. token,
    ["Content-Type"] = "text/plain",
    ["Accept"] = "application/json",
  }

  local res = http_post("https://api.igdb.com/v4/games", headers, apicalypse_query, 15)
  if not res or res.status ~= 200 or not res.body then
    return nil
  end

  local ok, data = pcall(json.decode, res.body)
  if not ok or type(data) ~= "table" then return nil end
  return data
end

--- Cache directory for community data
local function get_cache_path(appid)
  local dir = data_dir.path() .. "/community"
  pcall(function()
    local fs = require("fs")
    if not fs.is_directory(dir) then fs.create_directories(dir) end
  end)
  return dir .. "/" .. tostring(appid) .. ".json"
end

local function load_cached(appid)
  local path = get_cache_path(appid)
  local content = utils.read_file(path)
  if not content then return nil end
  local ok, data = pcall(json.decode, content)
  if ok and type(data) == "table" then return data end
  return nil
end

local function save_cached(appid, data)
  local path = get_cache_path(appid)
  utils.write_file(path, json.encode(data))
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

--- Fetch IGDB community data for a shortcut
---@param appid number
---@param title string
---@return table|nil
function M.fetch_community_data(appid, title)
  if not appid then return nil end
  local cached = load_cached(appid)
  if cached then return cached end

  local clean = clean_title(title)
  if clean == "" then return nil end

  local fields = "fields name, slug, summary, storyline, videos.video_id, videos.name, videos.category, artworks.image_id, artworks.url, websites.category, websites.url, websites.trusted; "
  local escaped = clean:gsub('"', '\\"')
  local query = fields .. 'search "' .. escaped .. '"; limit 5;'

  local results = query_igdb(query)
  if not results or #results == 0 then
    -- Try title prefix if dash/colon present
    local prefix = clean:match("^(.-)%s*[:%-]")
    if prefix and #prefix >= 3 then
      local pquery = fields .. 'search "' .. prefix:gsub('"', '\\"') .. '"; limit 5;'
      results = query_igdb(pquery)
    end
  end

  if not results or #results == 0 then return nil end

  local game = results[1]

  -- Parse trailers
  local trailers = {}
  if type(game.videos) == "table" then
    for _, v in ipairs(game.videos) do
      if v.video_id and #v.video_id > 0 then
        local cat = v.category or 1
        local is_trailer = (cat == 1 or cat == 2)
        table.insert(trailers, {
          video_id = v.video_id,
          name = v.name or (is_trailer and "Trailer" or "Gameplay Video"),
          category = cat,
          url = "https://www.youtube.com/watch?v=" .. v.video_id,
          thumbnail = "https://img.youtube.com/vi/" .. v.video_id .. "/hqdefault.jpg",
        })
      end
    end
  end

  -- Parse artworks
  local artworks = {}
  if type(game.artworks) == "table" then
    for _, art in ipairs(game.artworks) do
      if art.image_id and #art.image_id > 0 then
        table.insert(artworks, {
          image_id = art.image_id,
          url = "https://images.igdb.com/igdb/image/upload/t_1080p/" .. art.image_id .. ".jpg",
          thumbnail = "https://images.igdb.com/igdb/image/upload/t_cover_big/" .. art.image_id .. ".jpg",
        })
      end
    end
  end

  -- Parse websites / community destinations
  local community_links = {}
  local category_names = {
    [1] = "Official Website",
    [2] = "Fandom / Wiki",
    [3] = "Wikipedia",
    [14] = "Reddit",
    [18] = "Discord",
    [20] = "Speedrun.com",
  }

  if type(game.websites) == "table" then
    for _, site in ipairs(game.websites) do
      local cat = site.category or 0
      local label = category_names[cat]
      if label and site.url and #site.url > 0 then
        table.insert(community_links, {
          name = label,
          category = cat,
          url = site.url,
        })
      end
    end
  end

  local data = {
    appid = appid,
    igdb_id = game.id,
    matched_title = game.name,
    trailers = trailers,
    artworks = artworks,
    links = community_links,
  }

  save_cached(appid, data)
  return data
end

--- Get trailers for a game
function M.GetGameTrailers(payload_json)
  local req = decode_payload(payload_json)
  local appid = tonumber(req and (req.appid or req.shortcut_appid))
  if not appid then
    return json.encode({ error = "missing_appid", trailers = {} })
  end

  local cached = load_cached(appid)
  if cached and cached.trailers then
    return json.encode({ success = true, trailers = cached.trailers })
  end

  local title = req and req.title or ""
  if title == "" then
    local paths = steam_paths.resolve()
    local entries = (paths and paths.shortcuts) and shortcuts.parse(paths.shortcuts) or {}
    for _, entry in ipairs(entries) do
      if entry.appid == appid then
        title = entry.name or entry.appname or ""
        break
      end
    end
  end

  local data = M.fetch_community_data(appid, title)
  return json.encode({
    success = true,
    trailers = (data and data.trailers) and data.trailers or {},
  })
end

--- Get community links for a game
function M.GetGameCommunityLinks(payload_json)
  local req = decode_payload(payload_json)
  local appid = tonumber(req and (req.appid or req.shortcut_appid))
  if not appid then
    return json.encode({ error = "missing_appid", links = {} })
  end

  local cached = load_cached(appid)
  if cached and cached.links then
    return json.encode({ success = true, links = cached.links })
  end

  local title = req and req.title or ""
  if title == "" then
    local paths = steam_paths.resolve()
    local entries = (paths and paths.shortcuts) and shortcuts.parse(paths.shortcuts) or {}
    for _, entry in ipairs(entries) do
      if entry.appid == appid then
        title = entry.name or entry.appname or ""
        break
      end
    end
  end

  local data = M.fetch_community_data(appid, title)
  return json.encode({
    success = true,
    links = (data and data.links) and data.links or {},
    artworks = (data and data.artworks) and data.artworks or {},
  })
end

return M
