--- Sensor Logging Engine for steam-cartridges-third-party
--- Writes structured sensor telemetry to <data_dir>/third_party.log
--- and mirrors to Millennium logger.

local data_dir = require("data_dir")
local logger   = require("logger")

local M = {}

function M.write(sensor, message)
  local ts = os.date("!%Y-%m-%d %H:%M:%SZ")
  local line = string.format("[%s] [%s] %s\n", ts, tostring(sensor), tostring(message))

  -- Mirror to Millennium logger
  pcall(function()
    logger:info("[" .. tostring(sensor) .. "] " .. tostring(message))
  end)

  -- Write to persistent log file
  pcall(function()
    local path = data_dir.file("third_party.log")
    local f = io.open(path, "a")
    if f then
      f:write(line)
      f:close()
    end
  end)
end

--- Returns the last N lines from third_party.log for UI sensors / debugging
function M.read_recent(max_lines)
  max_lines = max_lines or 50
  local path = data_dir.file("third_party.log")
  local f = io.open(path, "r")
  if not f then return {} end

  local lines = {}
  for line in f:lines() do
    lines[#lines + 1] = line
  end
  f:close()

  local out = {}
  local start = math.max(1, #lines - max_lines + 1)
  for i = start, #lines do
    out[#out + 1] = lines[i]
  end
  return out
end

return M
