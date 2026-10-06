local ini = require("ini_parser")
local goldberg = require("goldberg_parser")

local M = {}

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  return content
end

local function write_file(path, data)
  local f = io.open(path, "wb")
  if not f then return false end
  f:write(data)
  f:close()
  return true
end

--- Resets all unlocks in target file, creating a backup copy.
--- Returns { ok = boolean, cleared = count, backup_path = string, error = string }
function M.reset_file(filepath, emulator)
  local text = read_file(filepath)
  if not text then
    return { ok = false, cleared = 0, error = "Cannot read file: " .. tostring(filepath) }
  end

  local new_text, cleared, err
  if emulator == "Goldberg" or filepath:match("%.json$") then
    new_text, cleared, err = goldberg.lock_all(text)
  else
    new_text, cleared = ini.lock_all(text)
  end

  if not new_text or err then
    return { ok = false, cleared = 0, error = err or "Failed to transform file content" }
  end

  -- Create backup copy: <filepath>.bak-<timestamp>
  local backup_path = filepath .. ".bak-" .. tostring(os.time())
  if not write_file(backup_path, text) then
    return { ok = false, cleared = 0, error = "Failed to create backup at " .. backup_path }
  end

  if not write_file(filepath, new_text) then
    return { ok = false, cleared = 0, error = "Failed to write locked file at " .. filepath }
  end

  return { ok = true, cleared = cleared, backup_path = backup_path }
end

return M
