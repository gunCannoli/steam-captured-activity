--- The store copies a shortcut is (ADR-0056): <data dir>/store_copies.json. The store stores; store_service.lua finds
--- and fills. No network here (tests/architecture.test.ts: a store never requires net).
---
--- { version = 1, copies = { ["<shortcut appid>"] = StoreCopy }, lookups = { ["epic:<namespace>"] = {...},
---   ["xbox:<pfn>"] = {...} } }. A lookup remembers what the store's API said about a game (its offer, product, title
--- id), so another shortcut of the same game, or the next start, asks nothing.

local json     = require("json")
local utils    = require("utils")
local data_dir = require("data_dir")

local M = {}

local FILE = "store_copies.json"
local state = nil
M._path = nil -- test override

local function path() return M._path or data_dir.file(FILE) end

local function load()
  if state then return state end
  state = { version = 1, copies = {}, lookups = {} }
  local text = utils.read_file(path())
  if text and #text > 0 then
    local ok, data = pcall(json.decode, text)
    if ok and type(data) == "table" then
      if type(data.copies) == "table" then state.copies = data.copies end
      if type(data.lookups) == "table" then state.lookups = data.lookups end
    end
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

local function same(a, b) return json.encode(a) == json.encode(b) end

--- The saved copy of a shortcut, or nil. Disk only.
function M.get(appid) return load().copies[key(appid)] end

--- Save (or, with nil, forget) a shortcut's copy; writes only when it changed.
function M.set(appid, copy)
  local s = load()
  local k = key(appid)
  if same(s.copies[k], copy) then return end
  s.copies[k] = copy
  save()
end

--- What a store's API said about a game ("epic:<namespace>", "xbox:<pfn>"), or nil.
function M.lookup(k) return load().lookups[k] end

function M.remember(k, value)
  local s = load()
  if same(s.lookups[k], value) then return end
  s.lookups[k] = value
  save()
end

--- Every shortcut appid (a string) with a saved copy.
function M.copy_keys()
  local out = {}
  for k in pairs(load().copies) do out[#out + 1] = k end
  return out
end

return M
