--- steam-cartridges-local - reading a game's achievement files, and watching them while it runs (ADR-0063).
---
--- start(ctx) resolves the files once and reads them all; poll(appid) re-reads only a file whose size or write time
--- changed, tails the engine logs, and, while no file is found, searches again every 8th poll (a save file the
--- emulator creates after the game starts, PSerban93/Achievements' adaptive path watcher). stop(appid) polls once
--- more and forgets the session. Each result carries the whole snapshot; steam-cartridges keeps only what is new.

local fs          = require("fs")
local text        = require("text")
local search      = require("file_search")
local ini         = require("ini_parser")
local tenoke      = require("tenoke")
local goldberg    = require("goldberg_parser")
local stats_bin   = require("stats_bin")
local engine_logs = require("engine_logs")

local M = {}

local RESOLVE_EVERY = 8
local sessions = {}

--- One file's unlocks: { [id] = { unlocked_time } }.
function M.read_unlocks(file, ids)
  if type(file) ~= "table" or type(file.path) ~= "string" then return {} end
  if file.format == "stats_bin" then return stats_bin.parse(text.read_bytes(file.path), ids or {}) end
  local t = text.read(file.path)
  if not t then return {} end
  if file.format == "goldberg" then return goldberg.parse_goldberg(t) end
  if file.format == "tenoke" then return tenoke.parse(t) end
  return ini.parse_ini(t)
end

--- Adds unlocks into a snapshot, keeping the earliest known time (an unknown time is 0).
local function merge(snapshot, unlocks)
  local changed = false
  for id, info in pairs(unlocks or {}) do
    local t = tonumber(type(info) == "table" and info.unlocked_time) or 0
    local old = snapshot[id]
    if old == nil then
      snapshot[id] = t
      changed = true
    elseif t > 0 and (old == 0 or t < old) then
      snapshot[id] = t
      changed = true
    end
  end
  return changed
end

--- Snapshot -> [{ id, unlockedAt }].
function M.list(snapshot)
  local out = {}
  for id, t in pairs(snapshot or {}) do out[#out + 1] = { id = id, unlockedAt = t } end
  table.sort(out, function(a, b) return a.id < b.id end)
  return out
end

local function stat(path)
  local ok_t, t = pcall(fs.last_write_time, path)
  local ok_s, s = pcall(fs.file_size, path)
  return (ok_t and tonumber(t)) or 0, (ok_s and tonumber(s)) or -1
end

local function watch_files(state, files)
  for _, f in ipairs(files or {}) do
    if not state.files[f.path] then
      local mtime, size = stat(f.path)
      state.files[f.path] = { mtime = mtime, size = size, format = f.format, label = f.label }
      merge(state.snapshot, M.read_unlocks(f, state.ctx.ids))
    end
  end
end

local function scan_logs(state)
  local changed = false
  for _, p in ipairs(engine_logs.paths(state.ctx.title, state.ctx.exe)) do
    if merge(state.snapshot, engine_logs.scan(p)) then changed = true end
  end
  return changed
end

local function count(t)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  return n
end

--- Starts (or restarts) the session of a shortcut. Returns { files = [{ path, label, format }], unlocks }.
function M.start(ctx)
  local appid = tonumber(ctx and ctx.appid) or 0
  search.invalidate(appid)
  local state = { ctx = ctx, files = {}, snapshot = {}, polls = 0 }
  sessions[appid] = state
  local files = search.candidates(ctx)
  watch_files(state, files)
  scan_logs(state) -- marks first-seen logs at their end
  engine_logs.save()
  return { files = files, unlocks = M.list(state.snapshot) }
end

--- One check. Returns { changed, unlocks } (unlocks is the whole snapshot when changed, else empty).
function M.poll(appid)
  local state = sessions[tonumber(appid) or 0]
  if not state then return { changed = false, unlocks = {} } end
  state.polls = state.polls + 1
  local changed = false
  for path, f in pairs(state.files) do
    local mtime, size = stat(path)
    if size < 0 then
      state.files[path] = nil -- gone; its unlocks stay in the snapshot
    elseif mtime ~= f.mtime or size ~= f.size then
      f.mtime, f.size = mtime, size
      if merge(state.snapshot, M.read_unlocks({ path = path, format = f.format }, state.ctx.ids)) then changed = true end
    end
  end
  if count(state.files) == 0 and state.polls % RESOLVE_EVERY == 0 then
    search.invalidate(state.ctx.appid)
    local before = count(state.snapshot)
    watch_files(state, search.candidates(state.ctx))
    if count(state.snapshot) ~= before then changed = true end
  end
  if scan_logs(state) then changed = true end
  engine_logs.save()
  return { changed = changed, unlocks = changed and M.list(state.snapshot) or {} }
end

--- Final check, then forget the session. Returns the last poll's result.
function M.stop(appid)
  local r = M.poll(appid)
  sessions[tonumber(appid) or 0] = nil
  engine_logs.save()
  return r
end

--- Tests: the watched paths of a session.
function M._watched(appid)
  local state = sessions[tonumber(appid) or 0]
  local out = {}
  for p in pairs(state and state.files or {}) do out[#out + 1] = p end
  return out
end

return M
