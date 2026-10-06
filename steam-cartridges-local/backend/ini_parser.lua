local M = {}

local function trim(s)
  return (s or ""):match("^%s*(.-)%s*$") or ""
end

--- Parses CODEX / RUNE style achievements.ini text.
--- Returns map: { [ach_id] = { unlocked_time = unix_timestamp } }
function M.parse_ini(text)
  local unlocked = {}
  local current_section = nil
  for line in (text or ""):gmatch("[^\r\n]+") do
    line = trim(line)
    local section = line:match("^%[([^%]]+)%]$")
    if section then
      current_section = trim(section)
    elseif current_section and #current_section > 0 then
      local k, v = line:match("^([^=]+)=(.*)$")
      if k and v then
        k = trim(k)
        v = trim(v)
        if current_section:lower() == "achievements" then
          -- Format B: [Achievements]\nACH_ID=1
          if v == "1" or v:lower() == "true" then
            unlocked[k] = { unlocked_time = os.time() }
          end
        else
          -- Format A: [ACH_ID]\nAchieved=1\nUnlockTime=1760846000
          if k:lower() == "achieved" and (v == "1" or v:lower() == "true") then
            unlocked[current_section] = unlocked[current_section] or { unlocked_time = os.time() }
          elseif k:lower() == "unlocktime" and tonumber(v) and tonumber(v) > 0 then
            unlocked[current_section] = unlocked[current_section] or {}
            unlocked[current_section].unlocked_time = tonumber(v)
          end
        end
      end
    end
  end
  return unlocked
end

--- Clears all unlocks in achievements.ini text. Returns (new_text, cleared_count).
function M.lock_all(text)
  local out, cleared = {}, 0
  local section = nil
  local nl = (text or ""):find("\r\n") and "\r\n" or "\n"
  for line in ((text or "") .. "\n"):gmatch("([^\n]*)\n") do
    line = line:gsub("\r$", "")
    local s = line:match("^%s*%[([^%]]+)%]%s*$")
    if s then
      section = s:lower()
      out[#out + 1] = line
    else
      local k, v = line:match("^%s*([^=]-)%s*=%s*(.-)%s*$")
      local key = k and k:lower()
      if section == "steamachievements" and key then
        if key == "count" then out[#out + 1] = line:gsub("=.*$", "=0") end
      elseif section == "achievements" and key and (v == "1" or v:lower() == "true") then
        out[#out + 1] = line:gsub("=.*$", "=0")
        cleared = cleared + 1
      elseif section and key == "achieved" and (v == "1" or v:lower() == "true") then
        out[#out + 1] = line:gsub("=.*$", "=0")
        cleared = cleared + 1
      elseif section and key == "unlocktime" then
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
