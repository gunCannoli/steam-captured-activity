--- The games auto-add made a shortcut for (ADR-0070): <data dir>/auto_added.json. The store stores; store_service.lua
--- decides. No network here.
---
--- { version = 1, games = { ["epic:<AppName>" | "xbox:<PFN>"] = { appid, title, at } } }. A game in this list is never
--- auto-added again, so a shortcut the user deleted stays deleted; the entry is dropped when the game is no longer
--- installed, so uninstalling and reinstalling counts as new (it is added again).

local json     = require("json")
local utils    = require("utils")
local data_dir = require("data_dir")

local M = {}

local FILE = "auto_added.json"
local state = nil
M._path = nil -- test override

local function path() return M._path or data_dir.file(FILE) end

local function load()
  if state then return state end
  state = { version = 1, games = {} }
  local text = utils.read_file(path())
  if text and #text > 0 then
    local ok, data = pcall(json.decode, text)
    if ok and type(data) == "table" and type(data.games) == "table" then state.games = data.games end
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

local function key(kind, id) return tostring(kind) .. ":" .. tostring(id) end

--- Was this game auto-added before (and is it still in the list)?
function M.has(kind, id)
  return load().games[key(kind, id)] ~= nil
end

--- Remember a game auto-add (or the settings panel's Add) made a shortcut for.
function M.record(kind, id, appid, title)
  if type(id) ~= "string" or id == "" or (kind ~= "epic" and kind ~= "xbox") then return false end
  load().games[key(kind, id)] = { appid = tonumber(appid), title = title, at = os.time() }
  save()
  return true
end

--- Drop every entry whose game is not installed any more (`installed`: { ["epic:<id>"] = true, ... }). Returns how many.
function M.prune(installed)
  local games, n = load().games, 0
  for k in pairs(games) do
    if not installed[k] then
      games[k] = nil
      n = n + 1
    end
  end
  if n > 0 then save() end
  return n
end

--- Tests: forget the cached state (after changing _path).
function M._reset() state = nil end

return M
