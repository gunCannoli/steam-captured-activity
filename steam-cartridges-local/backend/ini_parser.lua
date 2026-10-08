--- steam-cartridges-local - achievements.ini / SOVEREIGN.ini readers and the reset editor.
---
--- One reader for the INI shapes Steam API emulators write (format knowledge from PSerban93/Achievements, MIT):
---   [Achievements] map        ACH_ID=0 | 1 | true | <unix time>            (SOVEREIGN, RUNE, UniverseLAN)
---   [SteamAchievements] list  Count=1, 0=ACH_ID                             (CODEX)
---   one section per id, "Type 2": Achieved / Unlocked / Earned / UnlockTime  (CODEX, RELOADED, SkidRow, Online-Fix)
---   one section per id, "Type 1": State / Time / CurProgress / MaxProgress,
---                                  often little-endian 32-bit hex ("00f15365" = 1700000000)
--- A section with any Type 2 key is Type 2. An unlock whose time is unknown gets time 0, never "now".

local text = require("text")

local M = {}

local function trim(s)
  return (s or ""):match("^%s*(.-)%s*$") or ""
end

local IGNORED = {
  game = true, profile = true, downloadablecontent = true, experimental = true, stats = true,
  gamesettings = true, settings = true, user = true,
}
local FLAG_KEYS = { "achieved", "unlocked", "unlock", "earned" }
local TIME_KEYS = { "unlocktime", "unlockedtime", "time", "timestamp", "earned_time", "earnedtime" }

local function truthy(v)
  local l = tostring(v or ""):lower()
  return l == "1" or l == "true" or l == "yes"
end

--- Unix seconds from a time value (milliseconds are divided down); 0 when absent or not positive.
local function seconds(n)
  n = tonumber(n)
  if not n or n <= 0 then return 0 end
  if n > 1e10 then n = math.floor(n / 1000) end
  return math.floor(n)
end

--- A Type 1 value: little-endian 32-bit hex when it is 8 (or a multiple of 8) hex digits, else decimal.
--- A 10-digit decimal Unix time is therefore never read as hex.
local function type1_number(v)
  v = trim(v)
  if #v >= 8 and #v % 8 == 0 and v:match("^%x+$") then
    local b = {}
    for i = 1, 4 do b[i] = tonumber(v:sub(i * 2 - 1, i * 2), 16) end
    return b[1] + b[2] * 0x100 + b[3] * 0x10000 + b[4] * 0x1000000
  end
  return tonumber(v)
end
M._type1_number = type1_number

--- Sections in file order: { { name, lower, keys = { [lower key] = value }, order = { { key, value } } } }.
local function sections(raw)
  local out, cur = {}, nil
  for line in (text.decode(raw) .. "\n"):gmatch("([^\r\n]*)\r?\n") do
    line = trim(line)
    local s = line:match("^%[([^%]]+)%]$")
    if s then
      cur = { name = trim(s), lower = trim(s):lower(), keys = {}, order = {} }
      out[#out + 1] = cur
    elseif cur and #line > 0 and not line:match("^[;#]") then
      local k, v = line:match("^([^=]+)=(.*)$")
      if k then
        k, v = trim(k), trim(v)
        if #k > 0 then
          cur.keys[k:lower()] = v
          cur.order[#cur.order + 1] = { k, v }
        end
      end
    end
  end
  return out
end

--- { [id] = { unlocked_time = unix seconds or 0 } } for every unlocked achievement.
function M.parse_ini(raw)
  local unlocked = {}
  for _, sec in ipairs(sections(raw)) do
    if sec.lower == "achievements" then
      for _, kv in ipairs(sec.order) do
        local n = tonumber(kv[2])
        if n and n > 1 then
          unlocked[kv[1]] = { unlocked_time = seconds(n) }
        elseif truthy(kv[2]) then
          unlocked[kv[1]] = { unlocked_time = 0 }
        end
      end
    elseif sec.lower == "steamachievements" then
      for _, kv in ipairs(sec.order) do
        if kv[1]:match("^%d+$") and #kv[2] > 0 then unlocked[kv[2]] = unlocked[kv[2]] or { unlocked_time = 0 } end
      end
    elseif not IGNORED[sec.lower] then
      local keys = sec.keys
      local flag, has_type2 = nil, false
      for _, k in ipairs(FLAG_KEYS) do
        if keys[k] ~= nil then flag = flag or keys[k]; has_type2 = true end
      end
      if keys.unlocktime ~= nil or keys.unlockedtime ~= nil then has_type2 = true end
      if has_type2 then
        local t = 0
        for _, k in ipairs(TIME_KEYS) do
          if keys[k] ~= nil and seconds(keys[k]) > 0 then t = seconds(keys[k]); break end
        end
        local earned
        if flag ~= nil then earned = truthy(flag) or ((tonumber(flag) or 0) > 1) else earned = t > 0 end
        if earned then unlocked[sec.name] = { unlocked_time = t } end
      elseif keys.state ~= nil or keys.curprogress ~= nil or keys.maxprogress ~= nil or keys.time ~= nil then
        local state = type1_number(keys.state or "") or 0
        local cur = type1_number(keys.curprogress or "")
        local max = type1_number(keys.maxprogress or "")
        if state > 0 or (cur and max and max > 0 and cur >= max) then
          unlocked[sec.name] = { unlocked_time = seconds(type1_number(keys.time or "")) }
        end
      end
    end
  end
  return unlocked
end

local function is_hex8(v) return #v >= 8 and #v % 8 == 0 and v:match("^%x+$") ~= nil end

--- Clears every unlock. Sections, comments and other keys stay. Returns (new_text, cleared_count).
function M.lock_all(raw)
  local src = text.decode(raw)
  local out, cleared = {}, 0
  local section = nil
  local nl = src:find("\r\n") and "\r\n" or "\n"
  for line in (src .. "\n"):gmatch("([^\n]*)\n") do
    line = line:gsub("\r$", "")
    local s = line:match("^%s*%[([^%]]+)%]%s*$")
    if s then
      section = s:lower()
      out[#out + 1] = line
    elseif line:match("^%s*[;#]") then
      out[#out + 1] = line
    else
      local k, v = line:match("^%s*([^=]-)%s*=%s*(.-)%s*$")
      local key = k and k:lower()
      local num = tonumber(v)
      local unlock_val = v and (truthy(v) or (num and num > 0) or (is_hex8(v) and (type1_number(v) or 0) > 0))
      if section == "steamachievements" and key then
        if key == "count" then out[#out + 1] = line:gsub("=.*$", "=0") end
      elseif section == "achievements" and key and #key > 0 and unlock_val then
        out[#out + 1] = line:gsub("=.*$", "=0")
        cleared = cleared + 1
      elseif section and not IGNORED[section] and key
          and (key == "achieved" or key == "earned" or key == "unlocked" or key == "unlock" or key == "state") and unlock_val then
        out[#out + 1] = line:gsub("=.*$", is_hex8(v) and "=00000000" or "=0")
        cleared = cleared + 1
      elseif section and not IGNORED[section] and key
          and (key == "unlocktime" or key == "unlockedtime" or key == "time" or key == "timestamp"
            or key == "earned_time" or key == "earnedtime") then
        out[#out + 1] = line:gsub("=.*$", is_hex8(v) and "=00000000" or "=0")
      else
        out[#out + 1] = line
      end
    end
  end
  if out[#out] == "" then out[#out] = nil end
  local body = table.concat(out, nl)
  if src:sub(-1) == "\n" then body = body .. nl end
  return body, cleared
end

return M
