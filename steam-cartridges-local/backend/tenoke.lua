--- steam-cartridges-local - Tenoke user_stats.ini and tenoke.ini (format from PSerban93/Achievements, MIT).
---
---   [ACHIEVEMENTS]
---   "ACH_ID" = {unlocked = true, time = 1700000000}
---   [STATS]
---   "STAT_ID" = 12            (progress only: never an unlock)
--- The game's tenoke.ini names its Steam AppID: `id = 2277560`.

local text = require("text")

local M = {}

local function truthy(v)
  local l = tostring(v or ""):lower()
  return l == "true" or l == "1" or l == "yes"
end

--- Fields of a `{k = v, ...}` value.
local function fields(body)
  local out = {}
  for part in (body .. ","):gmatch("([^,]*),") do
    local k, v = part:match("^%s*([%w_]+)%s*=%s*(.-)%s*$")
    if k then out[k:lower()] = v end
  end
  return out
end

--- { [id] = { unlocked_time } } for the unlocked achievements (time 0 when unknown).
function M.parse(raw)
  local unlocked, section = {}, nil
  for line in (text.decode(raw) .. "\n"):gmatch("([^\r\n]*)\r?\n") do
    local s = line:match("^%s*%[([^%]]+)%]%s*$")
    if s then
      section = s:upper()
    elseif section == "ACHIEVEMENTS" then
      local id, body = line:match('^%s*"([^"]+)"%s*=%s*{(.*)}%s*,?%s*$')
      if id then
        local f = fields(body)
        if truthy(f.unlocked) then
          local t = tonumber(f.time) or 0
          if t > 1e10 then t = math.floor(t / 1000) end
          unlocked[id] = { unlocked_time = t > 0 and math.floor(t) or 0 }
        end
      end
    end
  end
  return unlocked
end

--- Locks every achievement: `unlocked = false`, `time = 0` inside the braces; every other byte kept.
--- Returns (new_text, cleared_count).
function M.lock_all(raw)
  local src = text.decode(raw)
  local out, cleared, section = {}, 0, nil
  for line, nl in (src):gmatch("([^\n]*)(\n?)") do
    if line == "" and nl == "" then break end
    local s = line:match("^%s*%[([^%]]+)%]%s*\r?$")
    if s then
      section = s:upper()
    elseif section == "ACHIEVEMENTS" and line:match('^%s*"[^"]+"%s*=%s*{') then
      local was = false
      line = line:gsub("([Uu][Nn][Ll][Oo][Cc][Kk][Ee][Dd]%s*=%s*)([%w]+)", function(k, v)
        if truthy(v) then was = true end
        return k .. "false"
      end)
      line = line:gsub("([Tt][Ii][Mm][Ee]%s*=%s*)(%d+)", "%10")
      if was then cleared = cleared + 1 end
    end
    out[#out + 1] = line .. nl
  end
  return table.concat(out), cleared
end

--- The AppID in a tenoke.ini, or nil.
function M.appid_from_ini(raw)
  for line in (text.decode(raw) .. "\n"):gmatch("([^\r\n]*)\r?\n") do
    local id = line:lower():match("^%s*id%s*=%s*(%d+)")
    if id then return tonumber(id) end
  end
  return nil
end

return M
