--- steam-cartridges-local - the Steam AppID a game folder names for its emulator.
---
--- Checked in order: steam_appid.txt, steam_settings/steam_appid.txt, SOVEREIGN.ini [Game] AppID,
--- UniverseLAN.ini [GameSettings] AppID, tenoke.ini id= (the last two from PSerban93/Achievements, MIT).

local text   = require("text")
local tenoke = require("tenoke")

local M = {}

--- The value of `key` in `[section]` of an INI's text, or nil.
function M.ini_value(raw, section, key)
  local cur = nil
  section, key = section:lower(), key:lower()
  for line in (text.decode(raw) .. "\n"):gmatch("([^\r\n]*)\r?\n") do
    local s = line:match("^%s*%[([^%]]+)%]%s*$")
    if s then
      cur = s:lower()
    elseif cur == section and not line:match("^%s*[;#]") then
      local k, v = line:match("^%s*([^=]-)%s*=%s*(.-)%s*$")
      if k and k:lower() == key then return v end
    end
  end
  return nil
end

local function positive(n)
  n = tonumber(n)
  if n and n > 0 then return math.floor(n) end
  return nil
end

--- The first AppID found in `dir` (forward or back slashes), or nil.
function M.from_folder(dir)
  if type(dir) ~= "string" or #dir == 0 then return nil end
  dir = dir:gsub("\\", "/"):gsub("/+$", "")
  for _, name in ipairs({ "/steam_appid.txt", "/steam_settings/steam_appid.txt" }) do
    local t = text.read(dir .. name)
    local id = t and positive(t:match("(%d+)"))
    if id then return id end
  end
  local sov = text.read(dir .. "/SOVEREIGN.ini")
  local id = sov and positive(M.ini_value(sov, "Game", "AppID"))
  if id then return id end
  local ulan = text.read(dir .. "/UniverseLAN.ini")
  id = ulan and positive(M.ini_value(ulan, "GameSettings", "AppID"))
  if id then return id end
  local ten = text.read(dir .. "/tenoke.ini")
  id = ten and positive(tenoke.appid_from_ini(ten))
  return id
end

return M
