--- steam-cartridges-local - backend entry point.
--- RPCs for Steam API emulator achievement files and engine logs: find, read, watch while a game runs, reset
--- (ADR-0063). Every payload is shaped like steam-cartridges' AppContext.

if jit and jit.off then
  jit.off()
end

local millennium = require("millennium")
local logger     = require("logger")
local json       = require("json")
local search      = require("file_search")
local watcher     = require("watcher")
local reset       = require("file_reset")
local engine_logs = require("engine_logs")

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
      logger:error("RPC " .. name .. " failed: " .. tostring(result))
      return json.encode({ error = tostring(result) })
    end

    if result == nil then return "null" end
    if type(result) == "string" then return result end
    local ok, encoded = pcall(json.encode, result)
    if not ok then
      logger:error("RPC " .. name .. " encode failed: " .. tostring(encoded))
      return json.encode({ error = tostring(encoded) })
    end
    return encoded
  end
end

--- K1: Millennium's cjson encodes an empty Lua table as `{}`; mark lists as arrays when it can (guardrail 21).
local function as_array(list)
  local ok, cjson = pcall(require, "cjson")
  if ok and type(cjson) == "table" and cjson.array_mt then setmetatable(list, cjson.array_mt) end
  return list
end

local function normalize_appid(id)
  local n = tonumber(id) or 0
  if n < 0 then n = n + 0x100000000 end
  return n
end

--- AppContext payload -> search / watcher context.
local function context(p)
  p = type(p) == "table" and p or {}
  local ids = {}
  if type(p.achievementIds) == "table" then
    for _, id in ipairs(p.achievementIds) do
      if type(id) == "string" or type(id) == "number" then ids[#ids + 1] = tostring(id) end
    end
  end
  return {
    appid = normalize_appid(p.appid),
    exe = type(p.exe) == "string" and p.exe or nil,
    start_dir = type(p.startDir) == "string" and p.startDir or nil,
    native = tonumber(p.nativeAppid) or 0,
    ids = ids,
    title = type(p.displayName) == "string" and p.displayName or "",
  }
end

local function result_list(r)
  r = type(r) == "table" and r or {}
  return { changed = r.changed == true, unlocks = as_array(r.unlocks or {}), files = r.files and as_array(r.files) or nil }
end

--- Existing achievement files: { files = [{ path, label, format }] }.
LocalDetectFiles = method("LocalDetectFiles", function(params)
  local ctx = context(params)
  if ctx.appid <= 0 then return { files = as_array({}) } end
  local files = search.candidates(ctx)
  return { files = as_array(files or {}) }
end)

--- Unlocks in the files (not the engine logs): { unlocks = [{ id, unlockedAt }] }, unlockedAt 0 = unknown.
LocalReadUnlocks = method("LocalReadUnlocks", function(params)
  local ctx = context(params)
  if ctx.appid <= 0 then return { unlocks = as_array({}) } end
  local snapshot = {}
  for _, f in ipairs(search.candidates(ctx) or {}) do
    for id, info in pairs(watcher.read_unlocks(f, ctx.ids)) do
      local t = tonumber(info.unlocked_time) or 0
      if snapshot[id] == nil or (t > 0 and (snapshot[id] == 0 or t < snapshot[id])) then snapshot[id] = t end
    end
  end
  return { unlocks = as_array(watcher.list(snapshot)) }
end)

--- Clears every file's unlocks (backed up first) and marks the engine logs read.
LocalResetUnlocks = method("LocalResetUnlocks", function(params)
  local ctx = context(params)
  local total, last_backup, errors, all_ok = 0, nil, {}, true
  for _, f in ipairs(search.candidates(ctx) or {}) do
    local res = reset.reset_file(f.path, f.format)
    if res.ok then
      total = total + (res.cleared or 0)
      last_backup = res.backup_path or last_backup
    else
      all_ok = false
      errors[#errors + 1] = tostring(res.error)
      logger:warn("LocalResetUnlocks: " .. tostring(res.error))
    end
  end
  local ok_logs, err_logs = pcall(engine_logs.mark_read, ctx.title, ctx.exe)
  if not ok_logs then logger:warn("LocalResetUnlocks: could not mark logs read: " .. tostring(err_logs)) end
  search.invalidate(ctx.appid)
  return { ok = all_ok, cleared = total, backupPath = last_backup, errors = as_array(errors) }
end)

--- Watch while a game runs (ADR-0063).
LocalWatchStart = method("LocalWatchStart", function(params)
  return result_list(watcher.start(context(params)))
end)

LocalWatchPoll = method("LocalWatchPoll", function(params)
  return result_list(watcher.poll(normalize_appid(type(params) == "table" and params.appid)))
end)

LocalWatchStop = method("LocalWatchStop", function(params)
  return result_list(watcher.stop(normalize_appid(type(params) == "table" and params.appid)))
end)

-- Millennium's lifecycle (docs/plugins.md § 2): the table is required; ready() belongs in on_load.
local function on_load()
  millennium.ready()
  logger:info("steam-cartridges-local backend ready.")
end

return {
  on_load = on_load,
  on_frontend_loaded = function() end,
  on_unload = function() logger:info("steam-cartridges-local backend unloading.") end,
}
