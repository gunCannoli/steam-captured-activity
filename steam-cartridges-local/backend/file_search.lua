local M = {}

local function file_exists(path)
  if not path or #path == 0 then return false end
  local f = io.open(path, "rb")
  if f then
    f:close()
    return true
  end
  return false
end

local function clean_path(p)
  if not p then return "" end
  return p:gsub('^["\']', ''):gsub('["\']$', ''):gsub('\\', '/')
end

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  return content
end

--- Reads [Game] AppID from an INI file (such as SOVEREIGN.ini).
local function read_game_appid(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local in_game = false
  for line in f:lines() do
    local s = line:match("^%s*%[([^%]]+)%]%s*$")
    if s then
      in_game = (s:lower() == "game")
    elseif in_game and not line:match("^[;#]") then
      local k, v = line:match("^%s*([^=]+)%s*=%s*(.-)%s*$")
      if k and k:lower() == "appid" then
        f:close()
        return tonumber(v)
      end
    end
  end
  f:close()
  return nil
end

--- Determine Steam root directory.
local function find_steam_root()
  local ok, millennium = pcall(require, "millennium")
  if ok and millennium and millennium.steam_path then
    local p = millennium.steam_path()
    if p and #p > 0 and (file_exists(p .. "/steam.exe") or file_exists(p .. "/userdata")) then
      return p:gsub('\\', '/')
    end
  end
  local env_root = os.getenv("NSGA_STEAM_ROOT")
  if env_root and #env_root > 0 and (file_exists(env_root .. "/steam.exe") or file_exists(env_root .. "/userdata")) then
    return env_root:gsub('\\', '/')
  end
  if file_exists("C:/game/steam/steam.exe") then
    return "C:/game/steam"
  end
  return "C:/Program Files (x86)/Steam"
end

--- Locate user config directory (<steam_root>/userdata/<user_id>/config).
local function find_user_config_dir(steam_root)
  local userdata = steam_root .. "/userdata"
  local loginusers = read_file(steam_root .. "/config/loginusers.vdf")
  if loginusers then
    local current = nil
    for line in loginusers:gmatch("[^\r\n]+") do
      local id = line:match('^%s*"(%d%d+)"%s*$')
      if id then
        current = id
      else
        local most_recent = line:match('"MostRecent"%s*"(%d)"')
        if most_recent == "1" and current then
          local account = tonumber(current) % 4294967296
          local cfg_dir = string.format("%s/%d/config", userdata, account)
          if file_exists(cfg_dir .. "/shortcuts.vdf") then
            return cfg_dir
          end
        end
      end
    end
  end

  if file_exists(userdata .. "/83513586/config/shortcuts.vdf") then
    return userdata .. "/83513586/config"
  end

  return nil
end

--- Read 32-bit int from binary string.
local function read_int32(data, offset)
  local b1, b2, b3, b4 = data:byte(offset, offset + 3)
  if not b4 then return 0 end
  return b1 + b2 * 0x100 + b3 * 0x10000 + b4 * 0x1000000
end

--- Parse shortcuts from Steam shortcuts.vdf binary.
local function parse_shortcuts_vdf(path)
  local data = read_file(path)
  if not data then return {} end

  local entries = {}
  local current = nil
  local i, len = 1, #data
  while i <= len do
    local t = data:byte(i)
    if t == 1 or t == 2 then
      local key_end = data:find("\0", i + 1, true)
      if not key_end then break end
      local key = data:sub(i + 1, key_end - 1):lower()
      if t == 2 then
        local val = read_int32(data, key_end + 1)
        i = key_end + 5
        if key == "appid" then
          current = { appid = val }
          entries[#entries + 1] = current
        end
      else
        local val_end = data:find("\0", key_end + 1, true)
        if not val_end then break end
        local val = data:sub(key_end + 1, val_end - 1)
        if current then
          if key == "appname" then current.name = val
          elseif key == "exe" then current.exe = val
          elseif key == "startdir" then current.start_dir = val
          end
        end
        i = val_end + 1
      end
    else
      i = i + 1
    end
  end
  return entries
end

--- Read steam_store mappings if available.
local function read_steam_store_mappings(steam_root)
  local candidates = {
    steam_root .. "/millennium/config/steam-cartridges/steam_store.json",
    "C:/game/steam/millennium/config/steam-cartridges/steam_store.json",
  }
  local json_ok, json = pcall(require, "json")
  if not json_ok or not json or not json.decode then return {} end

  for _, path in ipairs(candidates) do
    local text = read_file(path)
    if text then
      local ok, data = pcall(json.decode, text)
      if ok and type(data) == "table" and type(data.mappings) == "table" then
        return data.mappings
      end
    end
  end
  return {}
end

--- Find SOVEREIGN.ini candidates by walking up from executable path.
local function find_sovereign_from_exe(exe_path)
  local clean = clean_path(exe_path)
  if #clean == 0 then return {} end
  local dir = clean:match("^(.*)/[^/]+$") or clean
  local found = {}

  local cur = dir
  local checked_dirs = {}
  while cur and #cur >= 3 do
    checked_dirs[#checked_dirs + 1] = cur
    local parent = cur:match("^(.*)/[^/]+$")
    if parent == cur then break end
    cur = parent
  end

  local steamworks_versions = {
    "Steamv155", "Steamv154", "Steamv153", "Steamv152", "Steamv151",
    "Steamv150", "Steamv148", "Steamv147", "Steamv144", "Steamv142", "Steamv138"
  }

  for _, d in ipairs(checked_dirs) do
    local paths = {
      d .. "/SOVEREIGN.ini",
      d .. "/sovereign.ini",
      d .. "/user_stats.ini",
      d .. "/Stats.ini",
      d .. "/achievements.ini",
      d .. "/UniverseLANData/Achievements.ini",
      d .. "/Binaries/Win64/SOVEREIGN.ini",
      d .. "/Binaries/Win64/sovereign.ini",
      d .. "/Binaries/Win64/user_stats.ini",
      d .. "/Binaries/Win64/Stats.ini",
      d .. "/Binaries/Win64/achievements.ini",
      d .. "/Binaries/Win32/SOVEREIGN.ini",
      d .. "/Engine/Binaries/ThirdParty/Steamworks/Win64/SOVEREIGN.ini",
    }
    for _, ver in ipairs(steamworks_versions) do
      paths[#paths + 1] = d .. "/Engine/Binaries/ThirdParty/Steamworks/" .. ver .. "/Win64/SOVEREIGN.ini"
      paths[#paths + 1] = d .. "/Engine/Binaries/ThirdParty/Steamworks/" .. ver .. "/Win64/sovereign.ini"
      paths[#paths + 1] = d .. "/Engine/Binaries/ThirdParty/Steamworks/" .. ver .. "/Win32/SOVEREIGN.ini"
    end

    for _, p in ipairs(paths) do
      if file_exists(p) then
        found[#found + 1] = p:gsub("/", "\\")
      end
    end
  end

  return found
end

--- Returns candidate paths for a given Steam AppID: { path, emulator, exists = boolean }
--- options may be:
---   nil
---   string: exe path or file path
---   table: { exe = ..., start_dir = ..., path = ..., steam_appid = ... }
function M.find_candidates(n_appid, options)
  n_appid = tonumber(n_appid) or 0

  local exe_opt, path_opt, start_dir_opt, steam_appid_opt
  if type(options) == "string" then
    if options:lower():match("%.ini$") or options:lower():match("%.json$") then
      path_opt = options
    else
      exe_opt = options
    end
  elseif type(options) == "table" then
    exe_opt = options.exe
    path_opt = options.path or options.file
    start_dir_opt = options.start_dir or options.startdir
    steam_appid_opt = tonumber(options.steam_appid or options.native or options.native_appid)
  end

  local candidates = {}
  local seen = {}

  local function add_candidate(path, emulator)
    if not path or #path == 0 then return end
    local norm = path:lower():gsub("/", "\\")
    if seen[norm] then return end
    if file_exists(path) then
      seen[norm] = true
      candidates[#candidates + 1] = {
        path = path:gsub("/", "\\"),
        emulator = emulator,
        exists = true,
      }
    end
  end

  -- 1. Direct path override
  if path_opt and #path_opt > 0 then
    local emu = "SOVEREIGN"
    if path_opt:lower():match("goldberg") or path_opt:lower():match("%.json$") then
      emu = "Goldberg"
    elseif path_opt:lower():match("codex") then
      emu = "CODEX"
    elseif path_opt:lower():match("rune") then
      emu = "RUNE"
    elseif path_opt:lower():match("gse") then
      emu = "GSE"
    elseif path_opt:lower():match("sovereign%.ini$") then
      emu = "SOVEREIGN"
    end
    add_candidate(path_opt, emu)
  end

  -- 2. Shortcuts lookup to find executable / mapped steam appid if not provided
  local steam_root = find_steam_root()
  local config_dir = find_user_config_dir(steam_root)
  local mappings = read_steam_store_mappings(steam_root)

  if (not exe_opt or not steam_appid_opt) and config_dir then
    local vdf_path = config_dir .. "/shortcuts.vdf"
    local shortcuts = parse_shortcuts_vdf(vdf_path)
    for _, sc in ipairs(shortcuts) do
      local sc_mapped = mappings[tostring(sc.appid)] and tonumber(mappings[tostring(sc.appid)].steam_appid)
      local is_match = false
      if n_appid > 0 and sc.appid == n_appid then
        is_match = true
      elseif n_appid > 0 and sc_mapped == n_appid then
        is_match = true
      end

      if is_match then
        if not exe_opt and sc.exe and #sc.exe > 0 then
          exe_opt = sc.exe
        end
        if not start_dir_opt and sc.start_dir and #sc.start_dir > 0 then
          start_dir_opt = sc.start_dir
        end
        if not steam_appid_opt and sc_mapped then
          steam_appid_opt = sc_mapped
        end
        break
      end
    end
  end

  -- Also check mappings if n_appid itself is a shortcut in mappings
  if not steam_appid_opt and n_appid > 0 then
    local m = mappings[tostring(n_appid)]
    if m and tonumber(m.steam_appid) then
      steam_appid_opt = tonumber(m.steam_appid)
    end
  end

  -- 3. Search game directory for SOVEREIGN.ini
  local exe_to_search = exe_opt or start_dir_opt
  if exe_to_search and #exe_to_search > 0 then
    local sov_paths = find_sovereign_from_exe(exe_to_search)
    for _, sp in ipairs(sov_paths) do
      local game_id = read_game_appid(sp)
      local accepted = false
      if n_appid <= 0 and not steam_appid_opt then
        accepted = true
      elseif game_id then
        if game_id == n_appid or (steam_appid_opt and game_id == steam_appid_opt) then
          accepted = true
        end
      else
        -- No AppID key in INI, but file resides in game root
        accepted = true
      end

      if accepted then
        local emu = "SOVEREIGN"
        local lower_sp = sp:lower()
        if lower_sp:match("user_stats%.ini$") then
          emu = "Tenoke"
        elseif lower_sp:match("stats%.ini$") then
          emu = "OnlineFix"
        elseif lower_sp:match("universelan") then
          emu = "UniverseLAN"
        elseif lower_sp:match("sovereign%.ini$") then
          emu = "SOVEREIGN"
        end
        add_candidate(sp, emu)
      end
    end
  end

  -- 4. Global %PUBLIC% and %APPDATA% emulator saves
  local public_dir = os.getenv("PUBLIC") or "C:\\Users\\Public"
  local appdata = os.getenv("APPDATA") or ""

  local ids_to_check = {}
  if n_appid > 0 then ids_to_check[#ids_to_check + 1] = tostring(math.floor(n_appid)) end
  if steam_appid_opt and steam_appid_opt > 0 and steam_appid_opt ~= n_appid then
    ids_to_check[#ids_to_check + 1] = tostring(math.floor(steam_appid_opt))
  end

  for _, id in ipairs(ids_to_check) do
    local list = {
      { path = public_dir .. "\\Documents\\Steam\\CODEX\\" .. id .. "\\achievements.ini", emulator = "CODEX" },
      { path = appdata .. "\\Steam\\CODEX\\" .. id .. "\\achievements.ini", emulator = "CODEX" },
      { path = public_dir .. "\\Documents\\Steam\\RUNE\\" .. id .. "\\achievements.ini", emulator = "RUNE" },
      { path = appdata .. "\\Steam\\RUNE\\" .. id .. "\\achievements.ini", emulator = "RUNE" },
      { path = public_dir .. "\\Documents\\Steam\\RLD!\\" .. id .. "\\achievements.ini", emulator = "RLD!" },
      { path = appdata .. "\\Steam\\RLD!\\" .. id .. "\\achievements.ini", emulator = "RLD!" },
      { path = public_dir .. "\\Documents\\Steam\\" .. id .. "\\achievements.ini", emulator = "GSE" },
      { path = appdata .. "\\Steam\\" .. id .. "\\achievements.ini", emulator = "GSE" },
      { path = public_dir .. "\\Documents\\SmartSteamEmu\\" .. id .. "\\achievements.ini", emulator = "SmartSteamEmu" },
      { path = appdata .. "\\SmartSteamEmu\\" .. id .. "\\achievements.ini", emulator = "SmartSteamEmu" },
      { path = appdata .. "\\GSE Saves\\" .. id .. "\\achievements.ini", emulator = "GSE" },
      { path = appdata .. "\\Goldberg SteamEmu Saves\\" .. id .. "\\achievements.json", emulator = "Goldberg" },
      { path = public_dir .. "\\Documents\\OnlineFix\\" .. id .. "\\achievements.ini", emulator = "OnlineFix" },
      { path = public_dir .. "\\Documents\\OnlineFix\\" .. id .. "\\Stats.ini", emulator = "OnlineFix" },
      { path = appdata .. "\\OnlineFix\\" .. id .. "\\achievements.ini", emulator = "OnlineFix" },
      { path = appdata .. "\\OnlineFix\\" .. id .. "\\Stats.ini", emulator = "OnlineFix" },
      { path = public_dir .. "\\Documents\\SkidRow\\" .. id .. "\\achievements.ini", emulator = "SkidRow" },
      { path = appdata .. "\\SkidRow\\" .. id .. "\\achievements.ini", emulator = "SkidRow" },
      { path = public_dir .. "\\Documents\\EMPRESS\\" .. id .. "\\achievements.ini", emulator = "EMPRESS" },
      { path = appdata .. "\\EMPRESS\\" .. id .. "\\achievements.ini", emulator = "EMPRESS" },
      { path = public_dir .. "\\Documents\\Steam\\SOVEREIGN\\" .. id .. "\\SOVEREIGN.ini", emulator = "SOVEREIGN" },
      { path = public_dir .. "\\Documents\\Steam\\SOVEREIGN\\" .. id .. "\\achievements.ini", emulator = "SOVEREIGN" },
      { path = appdata .. "\\Steam\\SOVEREIGN\\" .. id .. "\\SOVEREIGN.ini", emulator = "SOVEREIGN" },
      { path = appdata .. "\\Steam\\SOVEREIGN\\" .. id .. "\\achievements.ini", emulator = "SOVEREIGN" },
      { path = appdata .. "\\SOVEREIGN\\Storage\\SOVEREIGN\\" .. id .. "\\SOVEREIGN.ini", emulator = "SOVEREIGN" },
      { path = appdata .. "\\SOVEREIGN\\Storage\\SOVEREIGN\\" .. id .. "\\achievements.ini", emulator = "SOVEREIGN" },
      { path = appdata .. "\\SOVEREIGN\\" .. id .. "\\SOVEREIGN.ini", emulator = "SOVEREIGN" },
    }
    for _, item in ipairs(list) do
      add_candidate(item.path, item.emulator)
    end
  end

  return candidates
end

return M
