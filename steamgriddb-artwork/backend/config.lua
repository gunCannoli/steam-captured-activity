local fs = require("fs")
local utils = require("utils")
local logger = require("logger")

local config = {}

local cached_key = nil

--- Read key from file if it exists
local function read_key_file(path)
  if not fs.is_file(path) then return nil end
  local content = utils.read_file(path)
  if not content then return nil end
  local key = content:gsub("%s", "")
  if #key > 0 then return key end
  return nil
end

local cached_env = nil

--- Parse .env file for all key=value pairs
local function parse_env_all(path)
  if not fs.is_file(path) then return nil end
  local content = utils.read_file(path)
  if not content then return nil end
  local map = {}
  for line in content:gmatch("[^\r\n]+") do
    local k, v = line:match("^%s*([%w_]+)%s*=%s*(.-)%s*$")
    if k and v then
      local val = v:gsub("^[\"']", ""):gsub("[\"']$", ""):gsub("%s", "")
      map[k:lower()] = val
    end
  end
  return map
end

local function get_env_map()
  if cached_env then return cached_env end
  local candidates = {
    ".env",
    "../.env",
    "../../.env",
    "../../../.env",
    "c:/game/millennium/.env",
  }
  for _, path in ipairs(candidates) do
    local m = parse_env_all(path)
    if m and next(m) then
      cached_env = m
      return m
    end
  end
  return {}
end

--- Resolve SteamGridDB API key from sgdb_key.txt or .env
---@return string|nil key
function config.get_api_key()
  if cached_key then return cached_key end

  local key = read_key_file("sgdb_key.txt")
  if key then
    cached_key = key
    return key
  end

  local env_map = get_env_map()
  local k = env_map["steamgriddb_api"]
  if k and #k > 0 then
    cached_key = k
    return k
  end

  return nil
end

--- Resolve Twitch Client ID & Secret for IGDB API
---@return table|nil { client_id = string, client_secret = string }
function config.get_twitch_credentials()
  local env_map = get_env_map()
  local id = env_map["twitch_client_id"]
  local sec = env_map["twitch_client_secret"]
  if id and #id > 0 and sec and #sec > 0 then
    return { client_id = id, client_secret = sec }
  end
  return nil
end

--- Set or update the API key locally
---@param new_key string
---@return boolean success
function config.set_api_key(new_key)
  local k = tostring(new_key or ""):gsub("%s", "")
  if k == "" then
    cached_key = nil
    if fs.is_file("sgdb_key.txt") then
      fs.remove("sgdb_key.txt")
    end
    logger:info("SteamGridDB API key cleared.")
    return true
  end

  local ok, err = utils.write_file("sgdb_key.txt", k)
  if ok then
    cached_key = k
    logger:info("SteamGridDB API key saved to sgdb_key.txt.")
    return true
  else
    logger:warn("Could not save sgdb_key.txt: " .. tostring(err))
    return false
  end
end

return config

