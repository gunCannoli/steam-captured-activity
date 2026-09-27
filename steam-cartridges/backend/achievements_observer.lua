--- steam-cartridges - In-game achievement observer (Phase 5).
---
--- Detects unlocks out-of-process from:
---   1. Local emulator saves:
---      - Goldberg (achievements.json)
---      - CODEX / RUNE / GSE (.ini formats)
---   2. Engine runtime logs:
---      - Unity (Player.log in %USERPROFILE%\AppData\LocalLow\...)
---      - Godot (godot.log in %APPDATA%\Godot\app_userdata\...)
---      - Unreal (Saved\Logs\*.log in %LOCALAPPDATA%\...)
---
--- Matches observed tokens against the mirrored Steam schema (achievements_store)
--- and registers new unlocks without requiring third-party storefront APIs or DLL injection.

local json   = require("json")
local logger = require("logger")
local store  = require("achievements_store")

local M = {}

--- Track log file byte offsets for incremental tailing.
local log_offsets = {}

local function trim(s)
  return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function normalize(s)
  return tostring(s or ""):lower():gsub("[^%w]", "")
end

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  return content
end

local function file_exists(path)
  local f = io.open(path, "rb")
  if f then
    f:close()
    return true
  end
  return false
end

--- Parses CODEX / RUNE style achievements.ini.
--- Supports both Format A (section-per-achievement) and Format B ([Achievements] map).
function M.parse_ini_achievements(text)
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

--- Parses Goldberg SteamEmu achievements.json.
--- Supports both JSON array and key-value object formats.
function M.parse_goldberg_achievements(text)
  local ok, data = pcall(json.decode, text or "")
  if not ok or type(data) ~= "table" then return {} end
  local unlocked = {}
  if #data > 0 then
    -- Array format: [ "ACH_1", "ACH_2" ]
    for _, id in ipairs(data) do
      if type(id) == "string" and #id > 0 then
        unlocked[id] = { unlocked_time = os.time() }
      end
    end
  else
    -- Object format: { "ACH_1": { "earned": true, "earned_time": 172... } }
    for k, v in pairs(data) do
      if type(v) == "table" then
        if v.earned == true or v.achieved == true or v.earned == 1 or v.achieved == 1 then
          unlocked[k] = { unlocked_time = tonumber(v.earned_time or v.unlock_time) or os.time() }
        end
      elseif v == 1 or v == true or v == "1" then
        unlocked[k] = { unlocked_time = os.time() }
      end
    end
  end
  return unlocked
end

--- Tails an engine log file incrementally from the last known byte offset.
function M.scan_log_for_unlocks(filepath)
  local f = io.open(filepath, "rb")
  if not f then return {} end

  local current_size = f:seek("end")
  local last_offset = log_offsets[filepath] or 0

  if current_size < last_offset then
    -- File was truncated or rotated
    last_offset = 0
  end

  f:seek("set", last_offset)
  local new_bytes = f:read("*a")
  log_offsets[filepath] = f:seek()
  f:close()

  if not new_bytes or #new_bytes == 0 then
    return {}
  end

  local detected = {}
  for line in new_bytes:gmatch("[^\r\n]+") do
    -- Search for common achievement trigger patterns across Unity / Godot / Unreal / RetroArch / DuckStation / PCSX2 / Dolphin / PPSSPP
    local ach = line:match("%[RCHEEVOS%]%s*Awarded achievement%s*(%d+)")
             or line:match("%[CHEEVOS%]%s*Awarded achievement%s*(%d+)")
             or line:match("[aA]warded achievement%s*(%d+)")
             or line:match("%[Achievements%]%s*Unlocked%s*(%d+)")
             or line:match("%[Achievements%]%s*Awarded%s*(%d+)")
             or line:match("[aA]chievement%s*(%d+)%s*unlocked")
             or line:match("[aA]chievement%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
             or line:match("[aA]ward%a*%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
             or line:match("[uU]nlock%a*%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
             or line:match("[uU]nlock[aA]chievement%s*%(%s*['\"]([^'\"]+)['\"]")
             or line:match("[sS]et[aA]chievement%s*%(%s*['\"]([^'\"]+)['\"]")
             or line:match("[tT]rophy [uU]nlocked:%s*[%w_]+%s*%[(%d+)%]")
             or line:match("%{Emu%.Trophy%}%s*[tT]rophy%s*[uU]nlocked:%s*[%w_]+%s*%[(%d+)%]")
             or line:match("[tT]rophy [uU]nlocked:%s*([%w_%-]+)")
             or line:match("[tT]rophy%s*(%d+)%s*[uU]nlocked")
    if ach and #ach > 0 then
      detected[ach] = { unlocked_time = os.time() }
    end
  end

  return detected
end

--- Resolves a raw token (ID or display name) to a canonical schema achievement item.
function M.resolve_canonical_item(token, schema_achievements)
  if not token or not schema_achievements then return nil end
  local str_token = tostring(token)
  local token_norm = normalize(str_token)

  -- 1. Exact ID
  for _, item in ipairs(schema_achievements) do
    if item.id == str_token then return item end
  end

  -- 2. Case-insensitive ID
  for _, item in ipairs(schema_achievements) do
    if item.id:lower() == str_token:lower() then return item end
  end

  -- 3. Exact Name
  for _, item in ipairs(schema_achievements) do
    if item.name:lower() == str_token:lower() then return item end
  end

  -- 4. Normalized match (alphanumeric only)
  for _, item in ipairs(schema_achievements) do
    if normalize(item.name) == token_norm or normalize(item.id) == token_norm then
      return item
    end
  end

  return nil
end

--- Scans all local emulator and log sources for a running game.
--- Updates achievements_store and returns newly unlocked items.
function M.check_unlocks(shortcut_appid, native_appid, game_title)
  local s_appid = tonumber(shortcut_appid) or 0
  local n_appid = tonumber(native_appid) or 0
  if s_appid <= 0 then
    return { new_unlocks = {} }
  end

  local st = store.get_state(s_appid)
  if not st or not st.schema or not st.schema.achievements then
    if n_appid > 0 then
      st = store.get_or_fetch(s_appid, n_appid)
    end
  end
  if not st or not st.schema or not st.schema.achievements then
    local ps3 = require("ps3_trophies")
    st = ps3.get_or_fetch(s_appid)
  end
  if not st or not st.schema or not st.schema.achievements then
    local ra = require("retroachievements")
    st = ra.get_or_fetch(s_appid)
  end
  if not st or not st.schema or not st.schema.achievements then
    return { new_unlocks = {} }
  end

  local schema_achievements = st.schema.achievements
  local existing_unlocks = st.unlocks or {}
  local candidate_unlocks = {}

  local public_dir = os.getenv("PUBLIC") or "C:\\Users\\Public"
  local appdata = os.getenv("APPDATA") or ""
  local localappdata = os.getenv("LOCALAPPDATA") or ""
  local userprofile = os.getenv("USERPROFILE") or ""

  -- 1. Check Emulator INI / JSON Paths (if native_appid > 0)
  if n_appid > 0 then
    local emu_files = {
      -- CODEX
      public_dir .. "\\Documents\\Steam\\CODEX\\" .. tostring(n_appid) .. "\\achievements.ini",
      appdata .. "\\Steam\\CODEX\\" .. tostring(n_appid) .. "\\achievements.ini",
      -- RUNE
      public_dir .. "\\Documents\\Steam\\RUNE\\" .. tostring(n_appid) .. "\\achievements.ini",
      appdata .. "\\Steam\\RUNE\\" .. tostring(n_appid) .. "\\achievements.ini",
      -- Generic / GSE
      public_dir .. "\\Documents\\Steam\\" .. tostring(n_appid) .. "\\achievements.ini",
      appdata .. "\\Steam\\" .. tostring(n_appid) .. "\\achievements.ini",
      -- Goldberg JSON
      appdata .. "\\Goldberg SteamEmu Saves\\" .. tostring(n_appid) .. "\\achievements.json",
    }

    for _, path in ipairs(emu_files) do
      if file_exists(path) then
        local content = read_file(path)
        if content then
          local parsed = path:match("%.json$")
            and M.parse_goldberg_achievements(content)
            or M.parse_ini_achievements(content)
          for id, info in pairs(parsed) do
            candidate_unlocks[id] = info
          end
        end
      end
    end
  end

  -- 2. Check RetroArch, DuckStation, PCSX2, Dolphin, PPSSPP, RPCS3 Runtime Logs & Trophies
  local exe_dir = ""
  local sc_match = nil
  local steam_paths = require("steam_paths")
  local shortcuts = require("shortcuts")
  local sp_paths = steam_paths.resolve()
  if sp_paths and sp_paths.shortcuts then
    local list = shortcuts.parse(sp_paths.shortcuts) or {}
    for _, sc in ipairs(list) do
      if sc.appid == s_appid and sc.exe then
        sc_match = sc
        local s = tostring(sc.exe):gsub("\\", "/")
        exe_dir = s:match("^(.*)/[^/]+$") or ""
        break
      end
    end
  end

  -- Check RPCS3 local TROPUSR.DAT if PS3 title
  if st.schema.ps3_title_id then
    local ps3 = require("ps3_trophies")
    local trop_dir = ps3.find_trophy_dir(sc_match and sc_match.exe or exe_dir, sc_match and sc_match.launch_options)
    if trop_dir then
      local usr_path = trop_dir .. "/TROPUSR.DAT"
      if file_exists(usr_path) then
        local usr_data = read_file(usr_path)
        local parsed = usr_data and ps3.parse_tropusr(usr_data) or {}
        for id, info in pairs(parsed) do
          candidate_unlocks[id] = info
        end
      end
    end
  end

  -- Check shadPS4 local TROPUSR.DAT if PS4 title
  if st.schema.ps4_title_id then
    local ps4 = require("ps4_trophies")
    local trop_dir = ps4.find_trophy_dir(sc_match and sc_match.exe or exe_dir, sc_match and sc_match.launch_options)
    if trop_dir then
      local usr_path = trop_dir .. "/TROPUSR.DAT"
      if file_exists(usr_path) then
        local usr_data = read_file(usr_path)
        local parsed = usr_data and ps4.parse_tropusr(usr_data) or {}
        for id, info in pairs(parsed) do
          candidate_unlocks[id] = info
        end
      end
    end
  end

  local emu_logs = {
    -- Dynamic log path next to emulator exe
    #exe_dir > 0 and (exe_dir .. "/duckstation.log"),
    #exe_dir > 0 and (exe_dir .. "/logs/duckstation.log"),
    #exe_dir > 0 and (exe_dir .. "/logs/retroarch.log"),
    #exe_dir > 0 and (exe_dir .. "/User/Logs/dolphin.log"),
    #exe_dir > 0 and (exe_dir .. "/Logs/dolphin.log"),
    #exe_dir > 0 and (exe_dir .. "/logs/emulog.txt"),
    #exe_dir > 0 and (exe_dir .. "/emulog.txt"),
    #exe_dir > 0 and (exe_dir .. "/ppsspp.log"),
    #exe_dir > 0 and (exe_dir .. "/RPCS3.log"),
    #exe_dir > 0 and (exe_dir .. "/rpcs3.log"),
    #exe_dir > 0 and (exe_dir .. "/user/log/shadps4.log"),
    #exe_dir > 0 and (exe_dir .. "/shadps4.log"),
    -- Standard known install locations
    "C:\\emu\\RetroArch\\logs\\retroarch.log",
    appdata .. "\\RetroArch\\logs\\retroarch.log",
    "C:\\emu\\duckstation\\duckstation.log",
    userprofile .. "\\Documents\\DuckStation\\duckstation.log",
    appdata .. "\\duckstation\\duckstation.log",
    localappdata .. "\\duckstation\\duckstation.log",
    "C:\\emu\\PCSX2\\logs\\emulog.txt",
    userprofile .. "\\Documents\\PCSX2\\logs\\emulog.txt",
    appdata .. "\\PCSX2\\logs\\emulog.txt",
    localappdata .. "\\PCSX2\\logs\\emulog.txt",
    "C:\\emu\\Primehack\\User\\Logs\\dolphin.log",
    userprofile .. "\\Documents\\Dolphin Emulator\\Logs\\dolphin.log",
    appdata .. "\\Dolphin Emulator\\Logs\\dolphin.log",
    "C:\\emu\\PPSSPP\\memstick\\PSP\\SYSTEM\\ppsspp.log",
    appdata .. "\\PPSSPP\\PSP\\SYSTEM\\ppsspp.log",
    "C:\\emu\\rpcs3\\RPCS3.log",
    appdata .. "\\rpcs3\\RPCS3.log",
    localappdata .. "\\rpcs3\\RPCS3.log",
    "C:\\emu\\shadps4\\user\\log\\shadps4.log",
    appdata .. "\\shadps4\\user\\log\\shadps4.log",
    localappdata .. "\\shadps4\\user\\log\\shadps4.log",
  }
  for _, logpath in ipairs(emu_logs) do
    if logpath and file_exists(logpath) then
      local detected = M.scan_log_for_unlocks(logpath)
      for id, info in pairs(detected) do
        candidate_unlocks[id] = info
      end
    end
  end

  -- 3. Check Engine Logs (Unity / Godot) if game_title provided
  if game_title and #game_title > 0 and userprofile and #userprofile > 0 then
    local possible_logs = {
      userprofile .. "\\AppData\\LocalLow\\" .. game_title .. "\\Player.log",
      appdata .. "\\Godot\\app_userdata\\" .. game_title .. "\\logs\\godot.log",
    }
    for _, logpath in ipairs(possible_logs) do
      if file_exists(logpath) then
        local detected = M.scan_log_for_unlocks(logpath)
        for id, info in pairs(detected) do
          candidate_unlocks[id] = info
        end
      end
    end
  end

  -- 3. Match Candidates Against Schema & Record Unlocks
  local new_unlocks = {}
  for raw_id, info in pairs(candidate_unlocks) do
    local canonical = M.resolve_canonical_item(raw_id, schema_achievements)
    if canonical and not existing_unlocks[canonical.id] then
      local unlock_time = info.unlocked_time or os.time()
      store.unlock(s_appid, canonical.id, unlock_time)
      existing_unlocks[canonical.id] = { unlocked_time = unlock_time }

      table.insert(new_unlocks, {
        id = canonical.id,
        name = canonical.name,
        description = canonical.description,
        icon = canonical.icon,
        global_pct = canonical.global_pct,
        rtime_unlocked = unlock_time,
      })
    end
  end

  if #new_unlocks > 0 then
    logger:info(string.format("Observer detected %d new unlock(s) for shortcut %d", #new_unlocks, s_appid))
  end

  return { new_unlocks = new_unlocks }
end

return M
