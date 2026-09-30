--- Persistent achievement state (ADR-0032 & P5): the store only, no network (M10: the keyless Steam
--- schema fetch moved to steam_schema.lua, a source like retroachievements.lua and the trophy readers).
---
--- Storage: <data dir>/achievements.json
--- Caches native Steam schemas by native_appid and tracks local unlocks by shortcut appid.

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

--- The shortcut's entry, created (bound to `native_appid`) when missing, re-bound when the native app changed.
function M.ensure_shortcut(shortcut_appid, native_appid)
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
  return sc
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
