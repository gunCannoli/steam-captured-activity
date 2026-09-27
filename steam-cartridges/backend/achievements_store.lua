--- Persistent achievement state & keyless schema ingestion (ADR-0032 & P5).
---
--- Storage: <data dir>/achievements.json
--- Caches native Steam schemas by native_appid and tracks local unlocks by shortcut appid.
--- Strictly offline-first and keyless: uses public percentages WebAPI + Community HTML.

local json     = require("json")
local utils    = require("utils")
local data_dir = require("data_dir")

local M = {}

local FILE = "achievements.json"
local state = nil
M._path = nil -- test override

local function path() return M._path or data_dir.file(FILE) end

local function blank()
  return { version = 1, schemas = {}, shortcuts = {} }
end

local function load()
  if state then return state end
  state = blank()
  local text = utils.read_file(path())
  if text and #text > 0 then
    local ok, data = pcall(json.decode, text)
    if ok and type(data) == "table" then
      if type(data.schemas) == "table" then state.schemas = data.schemas end
      if type(data.shortcuts) == "table" then state.shortcuts = data.shortcuts end
      state.version = 1
    end
  end
  return state
end

local function save()
  local p = path()
  local tmp = p .. ".tmp"
  local body = json.encode(load())
  local ok, err = utils.write_file(tmp, body)
  if not ok then error("could not write " .. tmp .. ": " .. tostring(err)) end
  pcall(os.remove, p)
  local renamed, rerr = os.rename(tmp, p)
  if not renamed then
    local ok2, err2 = utils.write_file(p, body)
    pcall(os.remove, tmp)
    if not ok2 then error("could not save " .. p .. ": " .. tostring(rerr or err2)) end
  end
end

function M._reset() state = nil end

function M.strip_html(s)
  s = tostring(s or "")
  s = s:gsub("<br%s*/?>", " "):gsub("<[^>]*>", "")
  s = s:gsub("&quot;", '"'):gsub("&#39;", "'"):gsub("&#039;", "'")
  s = s:gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&nbsp;", " "):gsub("&amp;", "&")
  return (s:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", ""))
end

--- Parses Steam Community achievements HTML page into list of { icon, name, description }
function M.parse_community_html(html)
  local items = {}
  if not html or #html == 0 then return items end

  for block in html:gmatch('<div class="achieveRow%s*">(.-)<div style="clear: both;"></div>') do
    local icon = block:match('<div class="achieveImgHolder">%s*<img src="([^"]+)"')
    local title = block:match('<div class="achieveTxt">.-<h3>(.-)</h3>')
    local desc  = block:match('<div class="achieveTxt">.-<h5>(.-)</h5>')
    items[#items + 1] = {
      icon = icon or "",
      name = M.strip_html(title or ""),
      description = M.strip_html(desc or ""),
    }
  end

  return items
end

--- Parses Steam WebAPI GetGlobalAchievementPercentagesForApp response into list of { id, percent }
function M.parse_webapi_percentages(body)
  local items = {}
  if not body or #body == 0 then return items end
  local ok, data = pcall(json.decode, body)
  if not ok or type(data) ~= "table" then return items end
  local pct_table = data.achievementpercentages
  if type(pct_table) ~= "table" or type(pct_table.achievements) ~= "table" then return items end

  for _, entry in ipairs(pct_table.achievements) do
    if entry.name then
      items[#items + 1] = {
        id = tostring(entry.name),
        percent = tonumber(entry.percent) or 0,
      }
    end
  end
  return items
end

--- Merges WebAPI percentages and Community HTML into canonical schema.
function M.merge_schema(native_appid, webapi_items, html_items)
  local achievements = {}
  html_items = html_items or {}

  for i, api_item in ipairs(webapi_items) do
    local html = html_items[i]
    local name = (html and #html.name > 0) and html.name or api_item.id
    local desc = html and html.description or ""
    local icon = html and html.icon or ""
    achievements[#achievements + 1] = {
      id = api_item.id,
      name = name,
      description = desc,
      icon = icon,
      global_pct = api_item.percent,
    }
  end

  return {
    native_appid = tonumber(native_appid) or 0,
    total = #achievements,
    fetched_at = os.time(),
    achievements = achievements,
  }
end

local function default_http_get(url, is_json)
  local http = require("http")
  local accept = is_json and "application/json" or "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  local ok, res = pcall(http.get, url, {
    headers = {
      ["Accept"] = accept,
      ["User-Agent"] = "steam-cartridges (Millennium plugin)",
    },
    timeout = 10,
  })
  if not ok or not res or not res.status or res.status ~= 200 or not res.body then
    return nil, (res and res.status) and ("HTTP " .. tostring(res.status)) or "request failed"
  end
  return res.body
end

--- Fetches schema keylessly from Steam public endpoints.
function M.fetch_schema(native_appid, http_get_json, http_get_html)
  local id = tostring(math.floor(tonumber(native_appid) or 0))
  if id == "0" then return nil, "invalid native appid" end

  local get_json = http_get_json or function(u) return default_http_get(u, true) end
  local get_html = http_get_html or function(u) return default_http_get(u, false) end

  local api_url = "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=" .. id
  local api_body, err = get_json(api_url)
  if not api_body then
    return nil, "percentages fetch failed: " .. tostring(err)
  end

  local webapi_items = M.parse_webapi_percentages(api_body)
  if #webapi_items == 0 then
    return nil, "no achievements found in percentages"
  end

  local html_url = "https://steamcommunity.com/stats/" .. id .. "/achievements/"
  local html_body = get_html(html_url)
  local html_items = html_body and M.parse_community_html(html_body) or {}

  local schema = M.merge_schema(id, webapi_items, html_items)
  M.save_schema(id, schema)
  return schema
end

local function to_schema_key(id)
  if type(id) == "string" and id:match("^ra_") then
    return id
  end
  return tostring(math.floor(tonumber(id) or 0))
end

function M.get_schema(native_appid)
  local s = load()
  return s.schemas[to_schema_key(native_appid)]
end

function M.save_schema(native_appid, schema)
  local s = load()
  s.schemas[to_schema_key(native_appid)] = schema
  save()
end

function M.bind_schema(shortcut_appid, schema_id)
  local s = load()
  local sc_key = tostring(math.floor(tonumber(shortcut_appid) or 0))
  local sc = s.shortcuts[sc_key]
  if not sc then
    sc = { schema_appid = schema_id, unlocks = {} }
    s.shortcuts[sc_key] = sc
  else
    sc.schema_appid = schema_id
  end
  save()
end

function M.get_state(shortcut_appid, native_appid)
  local s = load()
  local sc_key = tostring(math.floor(tonumber(shortcut_appid) or 0))
  local sc = s.shortcuts[sc_key]
  if not sc and native_appid then
    sc = { schema_appid = native_appid, unlocks = {} }
    s.shortcuts[sc_key] = sc
    save()
  end

  local schema_id = sc and sc.schema_appid or native_appid
  local schema = schema_id and s.schemas[to_schema_key(schema_id)] or nil
  return {
    schema = schema,
    unlocks = sc and sc.unlocks or {},
  }
end

function M.get_or_fetch(shortcut_appid, native_appid, http_get_json, http_get_html)
  local nid = tonumber(native_appid) or 0
  local sc_key = tostring(math.floor(tonumber(shortcut_appid) or 0))
  local s = load()
  local sc = s.shortcuts[sc_key]
  if not sc then
    sc = { schema_appid = nid, unlocks = {} }
    s.shortcuts[sc_key] = sc
    save()
  elseif nid > 0 and sc.schema_appid ~= nid then
    sc.schema_appid = nid
    save()
  end

  local schema = (nid > 0) and s.schemas[tostring(nid)] or nil
  if not schema and nid > 0 then
    local fetched, err = M.fetch_schema(nid, http_get_json, http_get_html)
    if not fetched then
      return { schema = nil, unlocks = sc.unlocks, error = err }
    end
    schema = fetched
  end

  return {
    schema = schema,
    unlocks = sc.unlocks or {},
  }
end

function M.unlock(shortcut_appid, achievement_id, unlock_time)
  local s = load()
  local sc_key = tostring(math.floor(tonumber(shortcut_appid) or 0))
  local sc = s.shortcuts[sc_key]
  if not sc then
    sc = { unlocks = {} }
    s.shortcuts[sc_key] = sc
  end
  sc.unlocks = sc.unlocks or {}
  sc.unlocks[tostring(achievement_id)] = {
    unlocked_time = tonumber(unlock_time) or os.time(),
  }
  save()
  return { ok = true, unlocks = sc.unlocks }
end

function M.reset(shortcut_appid)
  local s = load()
  local sc_key = tostring(math.floor(tonumber(shortcut_appid) or 0))
  local sc = s.shortcuts[sc_key]
  if sc then
    sc.unlocks = {}
    save()
  end
  return { ok = true, unlocks = {} }
end

return M
