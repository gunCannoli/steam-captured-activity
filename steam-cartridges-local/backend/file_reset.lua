--- steam-cartridges-local - clearing a file's unlocks after a backup (ADR-0054, ADR-0063).
---
--- The file is copied to `<file>.bak-<unix time>` and edited in place, in its own encoding. stats.bin is read only.

local text     = require("text")
local ini      = require("ini_parser")
local tenoke   = require("tenoke")
local goldberg = require("goldberg_parser")

local M = {}

local function write_file(path, data)
  local f = io.open(path, "wb")
  if not f then return false end
  f:write(data)
  f:close()
  return true
end

--- Resets one file. Returns { ok, cleared, backup_path, error }.
function M.reset_file(filepath, format)
  if format == "stats_bin" then return { ok = false, cleared = 0, error = "read only: " .. tostring(filepath) } end
  local bytes = text.read_bytes(filepath)
  if not bytes then return { ok = false, cleared = 0, error = "Cannot read file: " .. tostring(filepath) } end
  local src = text.decode(bytes)

  local new_text, cleared, err
  if format == "goldberg" or filepath:lower():match("%.json$") then
    new_text, cleared, err = goldberg.lock_all(src)
  elseif format == "tenoke" then
    new_text, cleared = tenoke.lock_all(src)
  else
    new_text, cleared = ini.lock_all(src)
  end
  if not new_text or err then
    return { ok = false, cleared = 0, error = err or "Failed to transform file content" }
  end
  if cleared == 0 then return { ok = true, cleared = 0 } end

  local backup_path = filepath .. ".bak-" .. tostring(os.time())
  if not write_file(backup_path, bytes) then
    return { ok = false, cleared = 0, error = "Failed to create backup at " .. backup_path }
  end
  if not write_file(filepath, text.encode_like(bytes, new_text)) then
    return { ok = false, cleared = 0, error = "Failed to write locked file at " .. filepath }
  end
  return { ok = true, cleared = cleared, backup_path = backup_path }
end

return M
