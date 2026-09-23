local http = require("http")
local json = require("json")
local logger = require("logger")
local config = require("config")

local igdb = {}

local cached_token = nil
local token_expires_at = 0

--- Robust multi-binding HTTP POST wrapper
--- Compatible with Millennium's varying Lua http bindings
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
    calls[#calls + 1] = function() return http.post(url, { data = body, headers = headers, timeout = timeout }) end
    calls[#calls + 1] = function() return http.post(url, { body = body, headers = headers, timeout = timeout }) end
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

--- Obtain or refresh Twitch OAuth2 access token for IGDB
---@return string|nil token
local function get_access_token()
  local now = os.time()
  if cached_token and now < token_expires_at then
    return cached_token
  end

  local creds = config.get_twitch_credentials()
  if not creds then
    logger:warn("Twitch credentials (twitch_client_id, twitch_client_secret) not found in .env")
    return nil
  end

  local token_url = "https://id.twitch.tv/oauth2/token?client_id=" .. creds.client_id ..
                    "&client_secret=" .. creds.client_secret ..
                    "&grant_type=client_credentials"

  local res = http_post(token_url, { ["Accept"] = "application/json" }, "", 15)
  if not res or res.status ~= 200 or not res.body then
    logger:error("Failed to authenticate with Twitch OAuth2: " .. tostring(res and res.status) .. " " .. tostring(res and res.body))
    return nil
  end

  local ok, data = pcall(json.decode, res.body)
  if not ok or type(data) ~= "table" or not data.access_token then
    logger:error("Invalid JSON response from Twitch OAuth token endpoint")
    return nil
  end

  cached_token = data.access_token
  local expires_in = tonumber(data.expires_in) or 3600
  token_expires_at = now + (expires_in - 300) -- refresh 5 minutes early
  logger:info("Obtained fresh Twitch OAuth token for IGDB (valid for " .. tostring(expires_in) .. "s)")
  return cached_token
end

--- Clean shortcut name for IGDB search
local function clean_title(name)
  if not name or name == "" then return "" end
  local cleaned = name
  cleaned = cleaned:gsub("%.%w%w%w?%w?$", "") -- strip extensions
  cleaned = cleaned:gsub("%b()", "")          -- strip (USA), (Rev 1), etc.
  cleaned = cleaned:gsub("%b[]", "")          -- strip [v1.0], etc.
  cleaned = cleaned:gsub("[%.%_]", " ")       -- replace dots/underscores
  cleaned = cleaned:gsub('"', "")             -- strip quotes
  cleaned = cleaned:match("^%s*(.-)%s*$") or ""
  return cleaned
end

--- Escape string for APICalypse query
local function escape_query(str)
  return (str:gsub('"', '\\"'))
end

--- Query IGDB games endpoint
---@param apicalypse_query string
---@return table|nil
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
    logger:warn("IGDB API query failed (status " .. tostring(res and res.status) .. "): " .. tostring(res and res.body))
    return nil
  end

  local ok, data = pcall(json.decode, res.body)
  if not ok or type(data) ~= "table" then
    logger:warn("IGDB returned invalid JSON response")
    return nil
  end

  return data
end

--- Search for a game on IGDB and convert into consolidated metadata
---@param appid number
---@param raw_title string
---@return table|nil metadata
function igdb.fetch_game_metadata(appid, raw_title)
  local clean = clean_title(raw_title)
  if clean == "" then return nil end

  logger:info("Searching IGDB for: '" .. clean .. "' (raw: '" .. raw_title .. "')")

  local fields = "fields name, summary, storyline, first_release_date, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, franchises.name, game_modes.name, genres.name, themes.name; "
  local query = fields .. 'search "' .. escape_query(clean) .. '"; limit 1;'

  local results = query_igdb(query)
  local game = (results and #results > 0) and results[1] or nil

  -- Fallback: if no match and title has a colon/dash, try prefix
  if not game then
    local prefix = clean:match("^(.-)%s*[:%-]")
    if prefix and #prefix >= 3 then
      logger:info("Retrying IGDB search with title prefix: '" .. prefix .. "'")
      local pquery = fields .. 'search "' .. escape_query(prefix) .. '"; limit 1;'
      local presults = query_igdb(pquery)
      if presults and #presults > 0 then
        game = presults[1]
      end
    end
  end

  if not game then
    logger:info("No IGDB match found for '" .. clean .. "'")
    return nil
  end

  logger:info("Matched IGDB game: '" .. tostring(game.name) .. "' (ID: " .. tostring(game.id) .. ")")

  -- Developers & Publishers
  local devs = {}
  local pubs = {}
  if type(game.involved_companies) == "table" then
    for _, comp in ipairs(game.involved_companies) do
      local cname = comp.company and comp.company.name
      if cname then
        if comp.developer then devs[#devs + 1] = cname end
        if comp.publisher then pubs[#pubs + 1] = cname end
      end
    end
  end

  -- Franchises
  local franchises = {}
  if type(game.franchises) == "table" then
    for _, f in ipairs(game.franchises) do
      if f.name then franchises[#franchises + 1] = f.name end
    end
  end

  -- Genres
  local genres = {}
  if type(game.genres) == "table" then
    for _, g in ipairs(game.genres) do
      if g.name then genres[#genres + 1] = g.name end
    end
  end

  -- Categories from game_modes
  local single_player = false
  local multiplayer = false
  local coop = false
  local split_screen = false

  if type(game.game_modes) == "table" then
    for _, m in ipairs(game.game_modes) do
      local mname = tostring(m.name or ""):lower()
      if mname:find("single") then single_player = true end
      if mname:find("multi") then multiplayer = true end
      if mname:find("co%-op") or mname:find("coop") or mname:find("cooperative") then coop = true end
      if mname:find("split") then split_screen = true end
    end
  else
    -- Default to single player if not specified
    single_player = true
  end

  return {
    appid = appid,
    title = raw_title,
    igdb_id = game.id,
    matched_title = game.name,
    summary = game.summary or "",
    description = (game.storyline and #game.storyline > 0) and game.storyline or (game.summary or ""),
    developers = devs,
    publishers = pubs,
    franchises = franchises,
    release_date = game.first_release_date or 0,
    genres = genres,
    categories = {
      single_player = single_player,
      multiplayer = multiplayer,
      coop = coop,
      split_screen = split_screen,
      full_controller = true, -- emulator/gamepad shortcut default
    },
    custom_override = false,
  }
end

return igdb
