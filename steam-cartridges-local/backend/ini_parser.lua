local M = {}

local function trim(s)
  return (s or ""):match("^%s*(.-)%s*$") or ""
end

--- Normalizes UTF-16LE / UTF-8 BOM text to UTF-8 string.
local function normalize_encoding(buf)
  if not buf or #buf == 0 then return "" end
  local b1, b2 = buf:byte(1, 2)
  if b1 == 0xFF and b2 == 0xFE then
    local chars = {}
    for i = 3, #buf - 1, 2 do
      local c1, c2 = buf:byte(i, i + 1)
      if c2 == 0 then chars[#chars + 1] = string.char(c1) end
    end
    return table.concat(chars)
  elseif b1 == 0xFE and b2 == 0xFF then
    local chars = {}
    for i = 3, #buf, 2 do
      local c1, c2 = buf:byte(i, i + 1)
      if c1 == 0 then chars[#chars + 1] = string.char(c2) end
    end
    return table.concat(chars)
  elseif #buf >= 3 and b1 == 0xEF and b2 == 0xBB and buf:byte(3) == 0xBF then
    return buf:sub(4)
  end
  return buf
end

--- Parses CODEX / RUNE / SOVEREIGN / OnlineFix / Tenoke / UniverseLAN style achievements.ini text.
--- Returns map: { [ach_id] = { unlocked_time = unix_timestamp, progress = number, max_progress = number } }
function M.parse_ini(raw_text)
  local text = normalize_encoding(raw_text)
  local unlocked = {}
  local current_section = nil
  for line in (text or ""):gmatch("[^\r\n]+") do
    line = trim(line)
    local section = line:match("^%[([^%]]+)%]$")
    if section then
      current_section = trim(section)
    elseif current_section and #current_section > 0 and not line:match("^[;#]") then
      local k, v = line:match("^([^=]+)=(.*)$")
      if k and v then
        k = trim(k)
        v = trim(v)
        local k_lower = k:lower()
        local v_lower = v:lower()
        local num = tonumber(v)

        if current_section:lower() == "achievements" then
          -- Format B (RUNE / SOVEREIGN / Goldberg / UniverseLAN): [Achievements]\nACH_ID=1
          if num and num > 1 then
            unlocked[k] = { unlocked_time = num }
          elseif num == 1 or v_lower == "true" or v_lower == "yes" then
            unlocked[k] = { unlocked_time = os.time() }
          end
        else
          -- Format A (CODEX / Skidrow / OnlineFix / Tenoke): [ACH_ID]\nAchieved=1\nUnlockTime=...
          local is_achieved_key = (k_lower == "achieved" or k_lower == "earned" or k_lower == "unlocked" or k_lower == "unlock" or k_lower == "state")
          local is_time_key = (k_lower == "unlocktime" or k_lower == "unlockedtime" or k_lower == "time" or k_lower == "timestamp" or k_lower == "earned_time" or k_lower == "earnedtime")

          if is_achieved_key and (v == "1" or v_lower == "true" or v_lower == "yes" or (num and num > 0)) then
            unlocked[current_section] = unlocked[current_section] or { unlocked_time = os.time() }
          elseif is_time_key and num and num > 0 then
            unlocked[current_section] = unlocked[current_section] or {}
            unlocked[current_section].unlocked_time = (num < 10000000000) and num or math.floor(num / 1000)
          elseif (k_lower == "curprogress" or k_lower == "progress") and num then
            unlocked[current_section] = unlocked[current_section] or {}
            unlocked[current_section].progress = num
          elseif (k_lower == "maxprogress" or k_lower == "max_progress") and num then
            unlocked[current_section] = unlocked[current_section] or {}
            unlocked[current_section].max_progress = num
          end

          -- If curprogress >= maxprogress, mark as earned
          local entry = unlocked[current_section]
          if entry and entry.progress and entry.max_progress and entry.max_progress > 0 and entry.progress >= entry.max_progress then
            entry.unlocked_time = entry.unlocked_time or os.time()
          end
        end
      end
    end
  end
  return unlocked
end

--- Clears all unlocks in achievements.ini text. Returns (new_text, cleared_count).
function M.lock_all(raw_text)
  local text = normalize_encoding(raw_text)
  local out, cleared = {}, 0
  local section = nil
  local nl = (text or ""):find("\r\n") and "\r\n" or "\n"
  for line in ((text or "") .. "\n"):gmatch("([^\n]*)\n") do
    line = line:gsub("\r$", "")
    local s = line:match("^%s*%[([^%]]+)%]%s*$")
    if s then
      section = s:lower()
      out[#out + 1] = line
    elseif line:match("^%s*[;#]") then
      -- Retain comments intact
      out[#out + 1] = line
    else
      local k, v = line:match("^%s*([^=]-)%s*=%s*(.-)%s*$")
      local key = k and k:lower()
      local v_lower = v and v:lower()
      local num = tonumber(v)
      local is_unlock_val = (v == "1" or v_lower == "true" or v_lower == "yes" or (num and num > 0))

      if section == "steamachievements" and key then
        if key == "count" then out[#out + 1] = line:gsub("=.*$", "=0") end
      elseif section == "achievements" and key and is_unlock_val then
        out[#out + 1] = line:gsub("=.*$", "=0")
        cleared = cleared + 1
      elseif section and (key == "achieved" or key == "earned" or key == "unlocked" or key == "unlock" or key == "state") and is_unlock_val then
        out[#out + 1] = line:gsub("=.*$", "=0")
        cleared = cleared + 1
      elseif section and (key == "unlocktime" or key == "unlockedtime" or key == "time" or key == "timestamp" or key == "earned_time" or key == "earnedtime") then
        out[#out + 1] = line:gsub("=.*$", "=0")
      else
        out[#out + 1] = line
      end
    end
  end
  if out[#out] == "" then out[#out] = nil end
  local body = table.concat(out, nl)
  if (text or ""):sub(-1) == "\n" then body = body .. nl end
  return body, cleared
end

return M
