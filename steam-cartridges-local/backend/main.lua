--- steam-cartridges-local - backend entry point.
--- Exposes local emulator save/ini detection, unlock reading, and reset RPCs.

if jit and jit.off then
  jit.off()
end

local millennium = require("millennium")
local logger     = require("logger")
local json       = require("json")
local search     = require("file_search")
local ini        = require("ini_parser")
local goldberg   = require("goldberg_parser")
local reset      = require("file_reset")

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  return content
end

local function decode_payload(payload_json)
  if type(payload_json) == "table" then
    if type(payload_json.payload) == "string" then
      local ok, inner = pcall(json.decode, payload_json.payload)
      if ok and type(inner) == "table" then return inner end
    end
    return payload_json
  end
  local ok, req = pcall(json.decode, payload_json or "{}")
  if not ok or type(req) ~= "table" then return {} end
  if type(req.payload) == "string" then
    local ok_inner, inner = pcall(json.decode, req.payload)
    if ok_inner and type(inner) == "table" then return inner end
  end
  return req
end

local function method(name, func)
  return function(payload)
    if jit and jit.off then jit.off() end
    local data = decode_payload(payload) or {}

    local success, result = pcall(func, data)
    if not success then
      logger.error("RPC " .. name .. " failed: " .. tostring(result))
      return json.encode({ error = tostring(result) })
    end

    if result == nil then return "null" end
    if type(result) == "string" then return result end
    local ok, encoded = pcall(json.encode, result)
    if not ok then
      logger.error("RPC " .. name .. " encode failed: " .. tostring(encoded))
      return json.encode({ error = tostring(encoded) })
    end
    return encoded
  end
end

--- Detect existing local save/ini files for an appid
LocalDetectFiles = method("LocalDetectFiles", function(params)
  local appid = tonumber(params and params.appid) or 0
  if appid <= 0 then return { files = {} } end

  local ok, res = pcall(search.find_candidates, appid)
  if not ok then
    logger.error("LocalDetectFiles failed: " .. tostring(res))
    return { files = {}, error = tostring(res) }
  end
  return { files = res or {} }
end)

--- Read all unlocked achievements for an appid
LocalReadUnlocks = method("LocalReadUnlocks", function(params)
  local appid = tonumber(params and params.appid) or 0
  if appid <= 0 then return { unlocks = {} } end

  local ok, candidates = pcall(search.find_candidates, appid)
  if not ok or not candidates or #candidates == 0 then
    return { unlocks = {} }
  end

  local all_unlocks = {}
  for _, c in ipairs(candidates) do
    local text = read_file(c.path)
    if text then
      local parsed = {}
      if c.emulator == "Goldberg" then
        parsed = goldberg.parse_goldberg(text)
      else
        parsed = ini.parse_ini(text)
      end
      for id, data in pairs(parsed) do
        all_unlocks[#all_unlocks + 1] = {
          id = tostring(id),
          unlockedAt = data.unlocked_time or os.time(),
          source = c.emulator,
          file = c.path,
        }
      end
    end
  end

  return { unlocks = all_unlocks }
end)

--- Reset achievements in candidate file(s)
LocalResetUnlocks = method("LocalResetUnlocks", function(params)
  local appid = tonumber(params and params.appid) or 0
  local candidates = search.find_candidates(appid)
  local total_cleared = 0
  local last_backup = nil

  for _, c in ipairs(candidates) do
    local res = reset.reset_file(c.path, c.emulator)
    if res.ok then
      total_cleared = total_cleared + (res.cleared or 0)
      last_backup = res.backup_path
    end
  end

  return {
    ok = true,
    cleared = total_cleared,
    backupPath = last_backup,
  }
end)

if millennium and millennium.ready then
  millennium.ready()
end
logger.info("steam-cartridges-local backend ready.")
