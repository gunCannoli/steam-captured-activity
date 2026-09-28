--- steam-cartridges - RetroAchievements provider (Phase 5).
---
--- Integrates RetroAchievements for retro games launched through RetroArch, DuckStation, PCSX2, Dolphin, PPSSPP, etc.
--- Key features:
---   1. Auto-discovers credentials from local emulator configs (RetroArch, DuckStation, PCSX2, Dolphin, PPSSPP) keylessly.
---   2. Hashes ROM/disc files (ra_hasher.js) to discover canonical RetroAchievements GameID.
---   3. Fallback console detection and title matching for compressed disc formats (.chd) and arcade romsets.
---   4. Queries dorequest.php for official achievement schemas (titles, descriptions, points, badge URLs)
---      and user unlock history.
---   5. Caches schemas and unlocks in achievements.json so they render in Steam's native UI sinks.

local json        = require("json")
local utils       = require("utils")
local http        = require("http")
local logger      = require("logger")
local data_dir    = require("data_dir")
local steam_paths = require("steam_paths")
local shortcuts   = require("shortcuts")
local store       = require("achievements_store")

local M = {}

--- Default RetroArch install directory on this machine
local DEFAULT_RA_DIR = "C:/emu/RetroArch"

local function count_keys(tbl)
  local c = 0
  for _ in pairs(tbl or {}) do c = c + 1 end
  return c
end

local function file_exists(p)
  if not p or #p == 0 then return false end
  local f = io.open(p, "rb")
  if f then
    f:close()
    return true
  end
  return false
end

--- Parses standard INI text into a 2D map: data[section_name][key_name] = value
function M.parse_ini(text)
  local data = {}
  local current_section = ""
  for line in (text or ""):gmatch("[^\r\n]+") do
    line = line:gsub("^%s+", ""):gsub("%s+$", "")
    if line:sub(1, 1) == "[" and line:sub(-1) == "]" then
      current_section = line:sub(2, -2):lower()
      data[current_section] = data[current_section] or {}
    elseif #current_section > 0 then
      local k, v = line:match("^([^=]+)=(.*)$")
      if k and v then
        k = k:gsub("^%s+", ""):gsub("%s+$", ""):lower()
        v = v:gsub("^%s+", ""):gsub("%s+$", "")
        if v:sub(1, 1) == '"' and v:sub(-1) == '"' then
          v = v:sub(2, -2)
        end
        data[current_section][k] = v
      end
    end
  end
  return data
end

--- Locate retroarch.cfg and parse credentials + paths
function M.get_retroarch_config()
  local candidates = {
    DEFAULT_RA_DIR .. "/retroarch.cfg",
    (os.getenv("APPDATA") or "") .. "/RetroArch/retroarch.cfg",
  }

  local cfg_path = nil
  for _, p in ipairs(candidates) do
    local f = io.open(p, "r")
    if f then
      f:close()
      cfg_path = p
      break
    end
  end

  if not cfg_path then
    return nil, "retroarch.cfg not found"
  end

  local base_dir = cfg_path:match("^(.*)[/\\][^/\\]+$") or DEFAULT_RA_DIR
  local text = utils.read_file(cfg_path)
  if not text then
    return nil, "cannot read retroarch.cfg"
  end

  local conf = {
    base_dir = base_dir,
    cfg_path = cfg_path,
    username = nil,
    token = nil,
    enabled = false,
    log_dir = base_dir .. "/logs",
    screenshots_dir = base_dir .. "/screenshots",
  }

  for line in text:gmatch("[^\r\n]+") do
    local k, v = line:match('^([%w_]+)%s*=%s*"([^"]*)"')
    if k and v then
      if k == "cheevos_username" and #v > 0 then
        conf.username = v
      elseif k == "cheevos_token" and #v > 0 then
        conf.token = v
      elseif k == "cheevos_enable" then
        conf.enabled = (v == "true")
      elseif k == "log_dir" then
        -- Expand ":\" to base_dir
        local p = v:gsub("^:[/\\]", base_dir .. "/")
        conf.log_dir = p
      elseif k == "screenshot_directory" then
        local p = v:gsub("^:[/\\]", base_dir .. "/")
        conf.screenshots_dir = p
      end
    end
  end

  return conf
end

--- Discovers RetroAchievements credentials from installed emulators
--- (RetroArch, DuckStation, PCSX2, Dolphin, PPSSPP).
function M.get_credentials(exe_hint)
  local appdata = os.getenv("APPDATA") or ""
  local localappdata = os.getenv("LOCALAPPDATA") or ""
  local userprofile = os.getenv("USERPROFILE") or ""
  local exe_str = tostring(exe_hint or ""):lower():gsub("\\", "/")
  local exe_dir = exe_str:match("^(.*)/[^/]+$") or ""

  local function read_ra()
    local conf = M.get_retroarch_config()
    if conf and conf.username and #conf.username > 0 and conf.token and #conf.token > 0 then
      return {
        username = conf.username,
        token = conf.token,
        emulator = "retroarch",
        cfg_path = conf.cfg_path,
      }
    end
    return nil
  end

  local function read_duckstation()
    local candidates = {
      #exe_dir > 0 and (exe_dir .. "/settings.ini"),
      "C:/emu/duckstation/settings.ini",
      #userprofile > 0 and (userprofile .. "/Documents/DuckStation/settings.ini"),
      #appdata > 0 and (appdata .. "/DuckStation/settings.ini"),
      #localappdata > 0 and (localappdata .. "/DuckStation/settings.ini"),
    }
    for _, p in ipairs(candidates) do
      if p then
        local text = utils.read_file(p)
        if text then
          local ini = M.parse_ini(text)
          local cheevos = ini["cheevos"] or ini["achievements"]
          if cheevos then
            local u = cheevos["username"]
            local t = cheevos["token"] or cheevos["usertoken"]
            if u and #u > 0 and t and #t > 0 then
              return {
                username = u,
                token = t,
                emulator = "duckstation",
                cfg_path = p,
              }
            end
          end
        end
      end
    end
    return nil
  end

  local function read_pcsx2()
    local candidates = {
      #exe_dir > 0 and (exe_dir .. "/inis/PCSX2.ini"),
      "C:/emu/PCSX2/inis/PCSX2.ini",
      #userprofile > 0 and (userprofile .. "/Documents/PCSX2/inis/PCSX2.ini"),
      #appdata > 0 and (appdata .. "/PCSX2/inis/PCSX2.ini"),
      #localappdata > 0 and (localappdata .. "/PCSX2/inis/PCSX2.ini"),
    }
    for _, p in ipairs(candidates) do
      if p then
        local text = utils.read_file(p)
        if text then
          local ini = M.parse_ini(text)
          local cheevos = ini["achievements"]
          if cheevos then
            local u = cheevos["username"]
            local t = cheevos["token"]
            if u and #u > 0 and t and #t > 0 then
              return {
                username = u,
                token = t,
                emulator = "pcsx2",
                cfg_path = p,
              }
            end
          end
        end
      end
    end
    return nil
  end

  local function read_dolphin()
    local candidates = {
      #exe_dir > 0 and (exe_dir .. "/User/Config/RetroAchievements.ini"),
      #exe_dir > 0 and (exe_dir .. "/User/Config/Dolphin.ini"),
      "C:/emu/Primehack/User/Config/RetroAchievements.ini",
      "C:/emu/Primehack/User/Config/Dolphin.ini",
      #appdata > 0 and (appdata .. "/Dolphin Emulator/Config/RetroAchievements.ini"),
      #appdata > 0 and (appdata .. "/Dolphin Emulator/Config/Dolphin.ini"),
      #userprofile > 0 and (userprofile .. "/Documents/Dolphin Emulator/Config/RetroAchievements.ini"),
      #userprofile > 0 and (userprofile .. "/Documents/Dolphin Emulator/Config/Dolphin.ini"),
    }
    for _, p in ipairs(candidates) do
      if p then
        local text = utils.read_file(p)
        if text then
          local ini = M.parse_ini(text)
          local cheevos = ini["achievements"]
          if cheevos then
            local u = cheevos["username"]
            local t = cheevos["token"]
            if u and #u > 0 and t and #t > 0 then
              return {
                username = u,
                token = t,
                emulator = "dolphin",
                cfg_path = p,
              }
            end
          end
        end
      end
    end
    return nil
  end

  local function read_ppsspp()
    local candidates = {
      #exe_dir > 0 and (exe_dir .. "/memstick/PSP/SYSTEM/ppsspp.ini"),
      "C:/emu/PPSSPP/memstick/PSP/SYSTEM/ppsspp.ini",
      #appdata > 0 and (appdata .. "/PPSSPP/PSP/SYSTEM/ppsspp.ini"),
    }
    for _, p in ipairs(candidates) do
      if p then
        local text = utils.read_file(p)
        if text then
          local ini = M.parse_ini(text)
          local cheevos = ini["achievements"]
          if cheevos then
            local u = cheevos["achievementsusername"] or cheevos["username"]
            local t = cheevos["achievementsusertoken"] or cheevos["token"]
            if u and #u > 0 and t and #t > 0 then
              return {
                username = u,
                token = t,
                emulator = "ppsspp",
                cfg_path = p,
              }
            end
          end
        end
      end
    end
    return nil
  end

  -- If exe_hint matches an emulator, test that emulator first
  local prioritized = nil
  if exe_str:find("duckstation") then
    prioritized = read_duckstation
  elseif exe_str:find("pcsx") then
    prioritized = read_pcsx2
  elseif exe_str:find("dolphin") or exe_str:find("primehack") then
    prioritized = read_dolphin
  elseif exe_str:find("ppsspp") then
    prioritized = read_ppsspp
  elseif exe_str:find("retroarch") then
    prioritized = read_ra
  end

  if prioritized then
    local res = prioritized()
    if res then return res end
  end

  -- Check all candidates in order
  local all = { read_ra, read_duckstation, read_pcsx2, read_dolphin, read_ppsspp }
  for _, fn in ipairs(all) do
    if fn ~= prioritized then
      local res = fn()
      if res then return res end
    end
  end

  -- Check .env credentials if no emulator config had tokens
  local web_cfg = require("web_config")
  local env_creds = web_cfg.get_retroachievements_credentials and web_cfg.get_retroachievements_credentials()
  if env_creds and env_creds.token and #env_creds.token > 0 then
    return {
      username = env_creds.username,
      token = env_creds.token,
      emulator = "env",
      cfg_path = ".env",
    }
  end

  return { username = nil, token = nil, emulator = nil }
end

--- Extracts the ROM path from a shortcut's command line or launch options
function M.extract_rom_path(cmd, launch_options)
  local full = tostring(cmd or "") .. " " .. tostring(launch_options or "")
  
  -- Scan all quoted arguments in reverse
  local quoted = {}
  for q in full:gmatch('"([^"]+)"') do
    table.insert(quoted, q)
  end

  for i = #quoted, 1, -1 do
    local s = quoted[i]:lower()
    if not s:find("%.exe$") and not s:find("%.dll$") and not s:match("^%-") then
      local f = io.open(quoted[i], "rb")
      if f then
        f:close()
        return quoted[i]
      end
    end
  end

  -- Fallback to last unquoted token
  local last_token = full:match("(%S+)$")
  if last_token then
    local cleaned = last_token:gsub('^"', ''):gsub('"$', '')
    if not cleaned:lower():find("%.exe$") and not cleaned:lower():find("%.dll$") then
      local f = io.open(cleaned, "rb")
      if f then
        f:close()
        return cleaned
      end
    end
  end

  return nil
end

local silent_exec = require("silent_exec")
local rom_md5_cache = {}

--- Computes the ROM MD5 using ra_hasher.js helper silently (no cmd window)
function M.compute_rom_md5(rom_path)
  if not rom_path then return nil, "missing rom path" end
  if rom_md5_cache[rom_path] then return rom_md5_cache[rom_path] end
  
  -- Find ra_hasher.js in the backend directory
  local millennium = require("millennium")
  local sp = millennium and millennium.steam_path and millennium.steam_path() or "C:/game/steam"
  local candidates = {
    "steam-cartridges/backend/ra_hasher.js",
    "C:/game/millennium/steam-cartridges/backend/ra_hasher.js",
    sp .. "/millennium/plugins/steam-cartridges-dev/backend/ra_hasher.js",
    sp .. "/millennium/plugins/steam-cartridges/backend/ra_hasher.js",
  }
  local script_path = nil
  for _, p in ipairs(candidates) do
    local f = io.open(p, "r")
    if f then
      f:close()
      script_path = p
      break
    end
  end
  if not script_path then
    script_path = "steam-cartridges/backend/ra_hasher.js"
  end

  local cmd = string.format('node "%s" "%s"', script_path, rom_path)
  local output, err = silent_exec.run(cmd)
  if not output or #output == 0 then
    return nil, err or "empty hasher output"
  end

  local ok, data = pcall(json.decode, output)
  if not ok or type(data) ~= "table" then
    return nil, "invalid hasher output: " .. tostring(output)
  end

  if data.error then
    return nil, data.error
  end

  if type(data.md5) == "string" and #data.md5 > 0 then
    rom_md5_cache[rom_path] = data.md5
    return data.md5
  end
  return nil
end

--- Queries RetroAchievements for the GameID corresponding to a ROM MD5
function M.get_game_id_by_md5(md5)
  if not md5 or #md5 == 0 then return nil, "missing md5" end
  local url = "https://retroachievements.org/dorequest.php?r=gameid&m=" .. tostring(md5)
  
  local ok, res = pcall(http.get, url, {
    user_agent = "RetroArch/1.19.0",
    headers = {
      ["User-Agent"] = "RetroArch/1.19.0",
      ["Accept"] = "application/json",
    },
    timeout = 10,
  })

  if not ok or not res or res.status ~= 200 or not res.body then
    return nil, "http request failed"
  end

  local decode_ok, data = pcall(json.decode, res.body)
  if not decode_ok or type(data) ~= "table" or not data.Success or not data.GameID or data.GameID == 0 then
    return nil, "game not found on RetroAchievements"
  end

  return data.GameID
end

local games_list_cache = {}

--- Detects RetroAchievements console ID from shortcut exe or launch options
function M.detect_console_id(cmd, launch_options)
  local full = (tostring(cmd or "") .. " " .. tostring(launch_options or "")):lower()
  if full:find("swanstation") or full:find("duckstation") or full:find("pcsx") or full:find("[/\\]psx[/\\]") or full:find("%.chd") then
    return 12 -- PlayStation
  elseif full:find("snes9x") or full:find("bsnes") or full:find("[/\\]snes[/\\]") or full:find("%.sfc") or full:find("%.smc") then
    return 3  -- SNES
  elseif full:find("mgba") or full:find("vba") or full:find("[/\\]gba[/\\]") or full:find("%.gba") then
    return 5  -- GBA
  elseif full:find("fbneo") or full:find("mame") or full:find("[/\\]fbneo[/\\]") or full:find("[/\\]arcade[/\\]") then
    return 27 -- Arcade
  elseif full:find("genesis") or full:find("picodrive") or full:find("[/\\]genesis[/\\]") or full:find("[/\\]megadrive[/\\]") or full:find("%.smd") or full:find("%.gen") then
    return 1  -- Sega Genesis
  elseif full:find("mupen64") or full:find("parallel_n64") or full:find("[/\\]n64[/\\]") or full:find("%.z64") or full:find("%.v64") or full:find("%.n64") then
    return 2  -- Nintendo 64
  elseif full:find("mesen") or full:find("fceumm") or full:find("nestopia") or full:find("[/\\]nes[/\\]") or full:find("%.nes") then
    return 7  -- NES
  elseif full:find("dolphin") or full:find("primehack") or full:find("[/\\]gc[/\\]") or full:find("[/\\]gamecube[/\\]") then
    return 16 -- GameCube
  elseif full:find("ppsspp") or full:find("[/\\]psp[/\\]") then
    return 41 -- PSP
  end
  return nil
end

--- Normalizes a string for title comparison (lowercase, alphanumeric only)
local function normalize_title(s)
  return (tostring(s or ""):lower():gsub("[^%w]", ""))
end

--- Queries RetroAchievements games list for a console and matches by title
function M.find_game_id_by_title(target_title, cmd, launch_options)
  if not target_title or #target_title == 0 then return nil end
  local console_id = M.detect_console_id(cmd, launch_options)
  if not console_id then return nil end

  local list = games_list_cache[console_id]
  if not list then
    local url = "https://retroachievements.org/dorequest.php?r=gameslist&c=" .. tostring(console_id)
    local ok, res = pcall(http.get, url, {
      user_agent = "RetroArch/1.19.0",
      headers = {
        ["User-Agent"] = "RetroArch/1.19.0",
        ["Accept"] = "application/json",
      },
      timeout = 10,
    })
    if ok and res and res.status == 200 and res.body then
      local decode_ok, data = pcall(json.decode, res.body)
      if decode_ok and type(data) == "table" and type(data.Response) == "table" then
        list = data.Response
        games_list_cache[console_id] = list
      end
    end
  end

  if not list or type(list) ~= "table" then return nil end

  local norm_target = normalize_title(target_title)
  if #norm_target == 0 then return nil end

  local function extract_entry(k, v)
    if type(v) == "table" then
      return tonumber(v.ID or v.id or k), tostring(v.Title or v.title or "")
    elseif type(v) == "string" then
      return tonumber(k), v
    end
    return nil, ""
  end

  -- 1. Exact match on normalized title
  for k, v in pairs(list) do
    local gid, gtitle = extract_entry(k, v)
    if gid and normalize_title(gtitle) == norm_target then
      return gid
    end
  end

  -- 2. Substring match (either target inside title or title inside target)
  for k, v in pairs(list) do
    local gid, gtitle = extract_entry(k, v)
    if gid then
      local norm_g = normalize_title(gtitle)
      if #norm_g >= 5 and (norm_target:find(norm_g, 1, true) or norm_g:find(norm_target, 1, true)) then
        return gid
      end
    end
  end

  return nil
end

--- Fetches full game schema and user unlocks from RetroAchievements
function M.fetch_game_data(game_id, username, token, hardcore)
  local gid = tonumber(game_id) or 0
  if gid <= 0 then return nil, "invalid game id" end
  local u = tostring(username or "")
  local t = tostring(token or "")
  local is_hardcore = (hardcore ~= false)
  local h_val = is_hardcore and 1 or 0

  -- 1. Fetch Game Schema (Titles, Badges, Points, Conditions)
  local patch_url = "https://retroachievements.org/dorequest.php?r=patch&g=" .. tostring(gid)
  if #u > 0 and #t > 0 then
    patch_url = patch_url .. "&u=" .. utils.url_encode(u) .. "&t=" .. utils.url_encode(t)
  end
  local p_ok, p_res = pcall(http.get, patch_url, {
    user_agent = "RetroArch/1.19.0",
    headers = {
      ["User-Agent"] = "RetroArch/1.19.0",
      ["Accept"] = "application/json",
    },
    timeout = 10,
  })

  if not p_ok or not p_res or p_res.status ~= 200 or not p_res.body then
    return nil, "cannot fetch game patch"
  end

  local ok_patch, patch_data = pcall(json.decode, p_res.body)
  if not ok_patch or type(patch_data) ~= "table" or not patch_data.Success or not patch_data.PatchData then
    return nil, "invalid patch response"
  end

  local patch = patch_data.PatchData
  local achievements = {}
  local raw_achs = patch.Achievements or {}

  for _, a in ipairs(raw_achs) do
    table.insert(achievements, {
      id = tostring(a.ID),
      name = tostring(a.Title or ""),
      description = tostring(a.Description or ""),
      icon = a.BadgeURL or string.format("https://media.retroachievements.org/Badge/%s.png", a.BadgeName or "00000"),
      icon_locked = a.BadgeLockedURL or string.format("https://media.retroachievements.org/Badge/%s_lock.png", a.BadgeName or "00000"),
      points = tonumber(a.Points) or 0,
      global_pct = tonumber(a.Points) or 10,
    })
  end

  -- 2. Fetch User Unlocks (h=1 for Hardcore, h=0 for Softcore)
  local unlocks = {}
  if #u > 0 and #t > 0 then
    local unl_url = string.format(
      "https://retroachievements.org/dorequest.php?r=unlocks&g=%d&h=%d&u=%s&t=%s",
      gid, h_val, utils.url_encode(u), utils.url_encode(t)
    )
    local u_ok, u_res = pcall(http.get, unl_url, {
      headers = { ["User-Agent"] = "RetroArch/1.19.0" },
      timeout = 10,
    })

    if u_ok and u_res and u_res.status == 200 and u_res.body then
      local ok_unl, u_data = pcall(json.decode, u_res.body)
      if ok_unl and type(u_data) == "table" and type(u_data.UserUnlocks) == "table" then
        for _, ach_id in ipairs(u_data.UserUnlocks) do
          unlocks[tostring(ach_id)] = {
            unlocked_time = os.time(),
          }
        end
      end
    end
  end

  local schema = {
    ra_game_id = gid,
    native_appid = 0,
    title = patch.Title or "",
    total = #achievements,
    fetched_at = os.time(),
    hardcore = is_hardcore,
    achievements = achievements,
  }

  return schema, unlocks
end

--- Main entry point: gets cached or fetches RetroAchievements data for a shortcut
function M.get_or_fetch(shortcut_appid, hardcore)
  local s_appid = tonumber(shortcut_appid) or 0
  if s_appid == 0 then return nil, "invalid shortcut_appid" end
  if s_appid < 0 then s_appid = s_appid + 0x100000000 end
  local is_hardcore = (hardcore ~= false)

  -- 1. Check existing state in achievements.json
  local st = store.get_state(s_appid)
  if st and st.schema and st.schema.ra_game_id and st.schema.ra_game_id > 0 then
    if st.schema.hardcore == nil or st.schema.hardcore == is_hardcore then
      return st
    end
  end

  -- 2. Resolve shortcut from shortcuts.vdf
  local paths, p_err = steam_paths.resolve()
  if not paths or not paths.shortcuts then
    return nil, "cannot resolve steam shortcuts path"
  end

  local list = shortcuts.parse(paths.shortcuts) or {}
  local sc = nil
  for _, entry in ipairs(list) do
    if entry.appid == s_appid then
      sc = entry
      break
    end
  end

  if not sc then
    return nil, "shortcut not found in shortcuts.vdf"
  end

  -- 3. Read Emulator credentials (using shortcut exe as hint)
  local creds = M.get_credentials(sc.exe)

  -- 4. Extract ROM path
  local rom_path = M.extract_rom_path(sc.exe, sc.launch_options)
  if not rom_path then
    return nil, "cannot extract rom path from shortcut"
  end

  -- 5. Compute ROM MD5
  local md5, md5_err = M.compute_rom_md5(rom_path)

  -- 6. Query GameID from RetroAchievements
  local game_id = nil
  if type(md5) == "string" and #md5 > 0 then
    game_id = M.get_game_id_by_md5(md5)
  end

  if not game_id then
    -- Fallback: Title matching by detected console
    local title = sc.name or sc.appname or ""
    game_id = M.find_game_id_by_title(title, sc.exe, sc.launch_options)
    if not game_id then
      return nil, "cannot find game on RetroAchievements"
    end
  end

  -- 7. Fetch full Schema & Unlocks (works with or without credentials)
  local schema, unlocks = M.fetch_game_data(game_id, creds.username, creds.token, is_hardcore)
  if not schema then
    return nil, "cannot fetch game data"
  end

  -- 8. Save schema & unlocks in achievements_store
  local schema_key = "ra_" .. tostring(game_id)
  store.save_schema(schema_key, schema)
  store.bind_schema(s_appid, schema_key)

  -- Record shortcut mapping
  for id, info in pairs(unlocks) do
    store.unlock(s_appid, id, info.unlocked_time)
  end

  local final_state = store.get_state(s_appid)
  final_state.schema = schema
  final_state.unlocks = unlocks

  logger:info(string.format(
    "RetroAchievements: loaded '%s' (GameID %d, %s) via %s for shortcut %d: %d achievements, %d unlocked",
    schema.title, game_id, is_hardcore and "hardcore" or "softcore", creds.emulator or "public", s_appid, schema.total, count_keys(unlocks)
  ))

  return final_state
end

--- Returns detection and authentication status for all supported retro emulators
function M.get_emulator_status()
  local list = {}
  local appdata = (os.getenv("APPDATA") or ""):gsub("\\", "/")
  local localappdata = (os.getenv("LOCALAPPDATA") or ""):gsub("\\", "/")
  local userprofile = (os.getenv("USERPROFILE") or ""):gsub("\\", "/")

  -- 1. RetroArch
  local ra_conf = M.get_retroarch_config()
  local ra_detected = (ra_conf ~= nil) or file_exists("C:/emu/RetroArch/retroarch.exe") or file_exists(appdata .. "/RetroArch/retroarch.exe")
  local ra_auth = (ra_conf and ra_conf.username and #ra_conf.username > 0 and ra_conf.token and #ra_conf.token > 0) or false
  table.insert(list, {
    name = "RetroArch",
    detected = ra_detected,
    path = ra_conf and ra_conf.cfg_path or "C:/emu/RetroArch",
    username = ra_conf and ra_conf.username or nil,
    authenticated = ra_auth,
  })

  -- 2. DuckStation
  local duck_paths = {
    "C:/emu/duckstation/settings.ini",
    userprofile .. "/Documents/DuckStation/settings.ini",
    appdata .. "/DuckStation/settings.ini",
    localappdata .. "/DuckStation/settings.ini",
  }
  local duck_found, duck_user, duck_auth, duck_p = false, nil, false, nil
  for _, p in ipairs(duck_paths) do
    if file_exists(p) then
      duck_found = true
      duck_p = p
      local text = utils.read_file(p)
      if text then
        local ini = M.parse_ini(text)
        local cheevos = ini["cheevos"] or ini["achievements"]
        if cheevos and cheevos["username"] then
          duck_user = cheevos["username"]
          duck_auth = (cheevos["token"] or cheevos["usertoken"]) ~= nil
        end
      end
      break
    end
  end
  table.insert(list, {
    name = "DuckStation",
    detected = duck_found or file_exists("C:/emu/duckstation/duckstation-qt-x64-ReleaseLTCG.exe") or file_exists("C:/emu/duckstation/duckstation-nogui-x64-ReleaseLTCG.exe"),
    path = duck_p or "C:/emu/duckstation",
    username = duck_user,
    authenticated = duck_auth,
  })

  -- 3. PCSX2
  local pcsx2_paths = {
    "C:/emu/PCSX2/inis/PCSX2.ini",
    userprofile .. "/Documents/PCSX2/inis/PCSX2.ini",
    appdata .. "/PCSX2/inis/PCSX2.ini",
    localappdata .. "/PCSX2/inis/PCSX2.ini",
  }
  local pcsx2_found, pcsx2_user, pcsx2_auth, pcsx2_p = false, nil, false, nil
  for _, p in ipairs(pcsx2_paths) do
    if file_exists(p) then
      pcsx2_found = true
      pcsx2_p = p
      local text = utils.read_file(p)
      if text then
        local ini = M.parse_ini(text)
        local cheevos = ini["achievements"]
        if cheevos and cheevos["username"] then
          pcsx2_user = cheevos["username"]
          pcsx2_auth = cheevos["token"] ~= nil
        end
      end
      break
    end
  end
  table.insert(list, {
    name = "PCSX2",
    detected = pcsx2_found or file_exists("C:/emu/PCSX2/pcsx2-qtx64.exe"),
    path = pcsx2_p or "C:/emu/PCSX2",
    username = pcsx2_user,
    authenticated = pcsx2_auth,
  })

  -- 4. Dolphin / Primehack
  local dol_paths = {
    "C:/emu/Primehack/User/Config/RetroAchievements.ini",
    "C:/emu/Primehack/User/Config/Dolphin.ini",
    appdata .. "/Dolphin Emulator/Config/RetroAchievements.ini",
    userprofile .. "/Documents/Dolphin Emulator/Config/RetroAchievements.ini",
  }
  local dol_found, dol_user, dol_auth, dol_p = false, nil, false, nil
  for _, p in ipairs(dol_paths) do
    if file_exists(p) then
      dol_found = true
      dol_p = p
      local text = utils.read_file(p)
      if text then
        local ini = M.parse_ini(text)
        local cheevos = ini["achievements"]
        if cheevos and cheevos["username"] then
          dol_user = cheevos["username"]
          dol_auth = cheevos["token"] ~= nil
        end
      end
      break
    end
  end
  table.insert(list, {
    name = "Dolphin / Primehack",
    detected = dol_found or file_exists("C:/emu/Primehack/Dolphin.exe"),
    path = dol_p or "C:/emu/Primehack",
    username = dol_user,
    authenticated = dol_auth,
  })

  -- 5. PPSSPP
  local ppsspp_paths = {
    "C:/emu/PPSSPP/memstick/PSP/SYSTEM/ppsspp.ini",
    appdata .. "/PPSSPP/PSP/SYSTEM/ppsspp.ini",
  }
  local ppsspp_found, ppsspp_user, ppsspp_auth, ppsspp_p = false, nil, false, nil
  for _, p in ipairs(ppsspp_paths) do
    if file_exists(p) then
      ppsspp_found = true
      ppsspp_p = p
      local text = utils.read_file(p)
      if text then
        local ini = M.parse_ini(text)
        local cheevos = ini["achievements"]
        if cheevos and (cheevos["achievementsusername"] or cheevos["username"]) then
          ppsspp_user = cheevos["achievementsusername"] or cheevos["username"]
          ppsspp_auth = (cheevos["achievementsusertoken"] or cheevos["token"]) ~= nil
        end
      end
      break
    end
  end
  table.insert(list, {
    name = "PPSSPP",
    detected = ppsspp_found or file_exists("C:/emu/PPSSPP/PPSSPPWindows64.exe"),
    path = ppsspp_p or "C:/emu/PPSSPP",
    username = ppsspp_user,
    authenticated = ppsspp_auth,
  })

  -- 6. RPCS3 (PS3)
  local rpcs3_paths = {
    "C:/emu/rpcs3/dev_hdd0/home/00000001/trophy",
    appdata .. "/rpcs3/dev_hdd0/home/00000001/trophy",
    "C:/emu/rpcs3/rpcs3.exe",
    appdata .. "/rpcs3/rpcs3.exe",
  }
  local rpcs3_found, rpcs3_p = false, nil
  for _, p in ipairs(rpcs3_paths) do
    if file_exists(p) then
      rpcs3_found = true
      rpcs3_p = p
      break
    end
  end
  table.insert(list, {
    name = "RPCS3 (PS3)",
    detected = rpcs3_found,
    path = rpcs3_p or "C:/emu/rpcs3",
    username = rpcs3_found and "Local Trophy DB" or nil,
    authenticated = rpcs3_found,
  })

  -- 7. shadPS4 (PS4)
  local shad_paths = {
    "C:/emu/shadps4/user/trophy",
    appdata .. "/shadps4/user/trophy",
    appdata .. "/shadps4/home/1000/trophy",
    "C:/emu/shadps4/shadps4.exe",
    appdata .. "/shadps4/shadps4.exe",
    localappdata .. "/shadps4/shadps4.exe",
  }
  local shad_found, shad_p = false, nil
  for _, p in ipairs(shad_paths) do
    if file_exists(p) then
      shad_found = true
      shad_p = p
      break
    end
  end
  table.insert(list, {
    name = "shadPS4 (PS4)",
    detected = shad_found,
    path = shad_p or "C:/emu/shadps4",
    username = shad_found and "Local Trophy DB" or nil,
    authenticated = shad_found,
  })

  -- Check .env fallback
  local web_cfg = require("web_config")
  local env_creds = web_cfg.get_retroachievements_credentials and web_cfg.get_retroachievements_credentials()
  local env_fallback = (env_creds and env_creds.token ~= nil and #env_creds.token > 0) or false
  local env_username = env_creds and env_creds.username or nil

  return {
    emulators = list,
    env_fallback = env_fallback,
    env_username = env_username,
  }
end

return M
