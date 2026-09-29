--- When is a part of a record stale? (migration plan M7a).
---
--- Per (appid, part) the time it was last checked, in ms, in <data dir>/freshness.json (a new file,
--- so no existing format changes): { version = 1, parts = { ["<appid>"] = { identity = ms, metadata = ms,
--- achievements = ms } } }. One table of TTLs decides what is stale.
---
--- Never stale: anything with source "custom" (a user's manual edit, K15) and an identity with a
--- native Steam match (sticky; the user clears it in settings).

local json     = require("json")
local utils    = require("utils")
local data_dir = require("data_dir")

local M = {}

local HOUR = 3600 * 1000
local DAY = 24 * HOUR

--- TTLs in ms. `false` = never stale.
M.TTL = {
  identity_ok_no_native = 7 * DAY,     -- same as the store search negative cache
  metadata_ok = 24 * HOUR,             -- igdb / screenscraper / fallback: Flow B
  achievements_ok = 24 * HOUR,         -- the schema; unlocks are read on every open by their own channels
  unsupported = 24 * HOUR,             -- a route or source may change (credentials, settings)
  error = 30 * 60 * 1000,              -- retry soon, never in a loop
}

local FILE = "freshness.json"
local state = nil
M._path = nil -- test override

local function path() return M._path or data_dir.file(FILE) end

local function load()
  if state then return state end
  state = { version = 1, parts = {} }
  local text = utils.read_file(path())
  if text and #text > 0 then
    local ok, data = pcall(json.decode, text)
    if ok and type(data) == "table" and type(data.parts) == "table" then state.parts = data.parts end
  end
  return state
end

local function save()
  local tmp = path() .. ".tmp"
  local ok, err = utils.write_file(tmp, json.encode(load()))
  if not ok then error("could not write " .. tmp .. ": " .. tostring(err)) end
  pcall(os.remove, path())
  if not os.rename(tmp, path()) then
    utils.write_file(path(), json.encode(load()))
    pcall(os.remove, tmp)
  end
end

function M._reset() state = nil end

local function key(appid) return tostring(math.floor(tonumber(appid) or 0)) end

--- Unix ms when this part was last checked, or nil.
function M.checked_at(appid, part)
  local entry = load().parts[key(appid)]
  return entry and tonumber(entry[part]) or nil
end

--- The TTL for a part in a given result state, or false (never stale).
--- `info` is a status string or a Part-like table { status, source, data }.
local function ttl_for(part, info)
  local status = type(info) == "table" and info.status or info
  local source = type(info) == "table" and info.source or nil
  if source == "custom" then return false end
  if status == "error" then return M.TTL.error end
  if status == "ok" then
    if part == "identity" then
      local native = type(info) == "table" and info.data and info.data.native
      if native then return false end
      return M.TTL.identity_ok_no_native
    end
    if part == "metadata" then return M.TTL.metadata_ok end
    if part == "achievements" then return M.TTL.achievements_ok end
    return M.TTL.metadata_ok
  end
  if status == "unsupported" then return M.TTL.unsupported end
  return 0 -- pending, needs-setup, partial, unknown: always worth asking again
end

--- Is this part due for a refresh at `now` (ms)? Never checked counts as stale, except when the
--- policy says "never".
function M.is_stale(appid, part, info, now)
  local ttl = ttl_for(part, info)
  if ttl == false then return false end
  local at = M.checked_at(appid, part)
  if not at then return true end
  return (now or 0) - at >= ttl
end

--- Record a check at `now` (ms). An `error` result is backdated so it comes due after the short
--- error TTL instead of the long ok TTL.
function M.touch(appid, part, now, status)
  local s = load()
  local k = key(appid)
  s.parts[k] = s.parts[k] or {}
  local at = now
  if status == "error" then
    local ok_ttl = (part == "identity" and M.TTL.identity_ok_no_native) or M.TTL.metadata_ok
    at = now - (ok_ttl - M.TTL.error)
  end
  s.parts[k][part] = at
  -- Bookkeeping only: a disk error costs a refetch later, never a failed EnsureFresh.
  return pcall(save)
end

return M
