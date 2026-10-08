--- The plugin's own data folder: <Steam>/millennium/config/steam-cartridges-local
---
--- Holds log_offsets.json (how far each engine log has been read). The folder name is fixed on purpose: it must not
--- change when the plugin folder is renamed or deployed as `-dev`. Forward slashes only.

local fs         = require("fs")
local millennium = require("millennium")

local data_dir = {}

local cached = nil

--- Absolute path of the data folder, created on first use.
function data_dir.path()
  if cached then return cached end
  local ok, sp = pcall(millennium.steam_path)
  local base = (ok and type(sp) == "string" and #sp > 0) and sp:gsub("\\", "/") or "."
  base = base:gsub("/+$", "")
  local dir = base .. "/millennium/config/steam-cartridges-local"
  pcall(function()
    if not fs.is_directory(dir) then fs.create_directories(dir) end
  end)
  cached = dir
  return dir
end

--- Join a file name onto the data folder.
function data_dir.file(name)
  return data_dir.path() .. "/" .. name
end

--- Tests: point the folder somewhere else (nil = recompute).
function data_dir._set(path) cached = path end

return data_dir
