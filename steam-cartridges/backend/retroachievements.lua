--- steam-cartridges - RetroAchievements provider (Phase 5).
---
--- Integrates RetroAchievements for retro games launched through RetroArch, DuckStation, PCSX2, etc.
--- Key features:
---   1. Uses local credentials from retroarch.cfg (cheevos_username + cheevos_token) keylessly.
---   2. Hashes ROM files to discover the canonical RetroAchievements GameID.
---   3. Queries dorequest.php for official achievement schemas (titles, descriptions, points, badge URLs)
---      and user unlock history.
---   4. Caches schemas and unlocks in achievements.json so they render in Steam's native UI sinks.

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
    if not s:find("retroarch%.exe") and not s:find("_libretro%.dll") and not s:match("^%-") then
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
    local f = io.open(cleaned, "rb")
    if f then
      f:close()
      return cleaned
    end
  end

  return nil
end

--- Computes the ROM MD5 using ra_hasher.js helper
function M.compute_rom_md5(rom_path)
  if not rom_path then return nil, "missing rom path" end
  
  -- Find ra_hasher.js in the backend directory
  local script_path = "steam-cartridges/backend/ra_hasher.js"
  local f = io.open(script_path, "r")
  if not f then
    -- Try relative to current script
    script_path = "C:/game/millennium/steam-cartridges/backend/ra_hasher.js"
  else
    f:close()
  end

  local cmd = string.format('node "%s" "%s"', script_path, rom_path)
  local pipe = io.popen(cmd)
  if not pipe then
    return nil, "failed to spawn hasher"
  end

  local output = pipe:read("*a")
  pipe:close()

  if not output or #output == 0 then
    return nil, "empty hasher output"
  end

  local ok, data = pcall(json.decode, output)
  if not ok or type(data) ~= "table" then
    return nil, "invalid hasher output: " .. tostring(output)
  end

  if data.error then
    return nil, data.error
  end

  return data.md5
end

--- Queries RetroAchievements for the GameID corresponding to a ROM MD5
function M.get_game_id_by_md5(md5)
  if not md5 or #md5 == 0 then return nil, "missing md5" end
  local url = "https://retroachievements.org/dorequest.php?r=gameid&m=" .. tostring(md5)
  
  local ok, res = pcall(http.get, url, {
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

--- Fetches full achievement schema and user unlocks for a RetroAchievements game
function M.fetch_game_data(game_id, username, token)
  local gid = tonumber(game_id)
  if not gid or gid <= 0 then return nil, "invalid game_id" end

  local u = tostring(username or "")
  local t = tostring(token or "")

  -- 1. Fetch Patch Data (Achievement Schema)
  local patch_url = string.format(
    "https://retroachievements.org/dorequest.php?r=patch&g=%d&u=%s&t=%s",
    gid, utils.url_encode(u), utils.url_encode(t)
  )

  local p_ok, p_res = pcall(http.get, patch_url, {
    headers = { ["User-Agent"] = "RetroArch/1.19.0" },
    timeout = 15,
  })

  if not p_ok or not p_res or p_res.status ~= 200 or not p_res.body then
    return nil, "failed to fetch achievement patch data"
  end

  local ok_patch, p_data = pcall(json.decode, p_res.body)
  if not ok_patch or type(p_data) ~= "table" or not p_data.PatchData then
    return nil, "invalid patch response"
  end

  local patch = p_data.PatchData
  local raw_achs = patch.Achievements or {}
  local achievements = {}

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

  -- 2. Fetch User Unlocks
  local unlocks = {}
  if #u > 0 and #t > 0 then
    local unl_url = string.format(
      "https://retroachievements.org/dorequest.php?r=unlocks&g=%d&h=0&u=%s&t=%s",
      gid, utils.url_encode(u), utils.url_encode(t)
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
    achievements = achievements,
  }

  return schema, unlocks
end

--- Main entry point: gets cached or fetches RetroAchievements data for a shortcut
function M.get_or_fetch(shortcut_appid)
  local s_appid = tonumber(shortcut_appid) or 0
  if s_appid <= 0 then return nil, "invalid shortcut_appid" end

  -- 1. Check existing state in achievements.json
  local st = store.get_state(s_appid)
  if st and st.schema and st.schema.ra_game_id and st.schema.ra_game_id > 0 then
    return st
  end

  -- 2. Read RetroArch config
  local conf, cfg_err = M.get_retroarch_config()
  if not conf then
    return nil, cfg_err
  end

  -- 3. Resolve shortcut from shortcuts.vdf
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

  -- 4. Extract ROM path
  local rom_path = M.extract_rom_path(sc.exe, sc.launch_options)
  if not rom_path then
    return nil, "cannot extract rom path from shortcut"
  end

  -- 5. Compute ROM MD5
  local md5, md5_err = M.compute_rom_md5(rom_path)
  if not md5 then
    return nil, "cannot compute rom md5: " .. tostring(md5_err)
  end

  -- 6. Query GameID from RetroAchievements
  local game_id, gid_err = M.get_game_id_by_md5(md5)
  if not game_id then
    return nil, "cannot find game on RetroAchievements: " .. tostring(gid_err)
  end

  -- 7. Fetch full Schema & Unlocks
  local schema, unlocks = M.fetch_game_data(game_id, conf.username, conf.token)
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
    "RetroAchievements: loaded '%s' (GameID %d) for shortcut %d: %d achievements, %d unlocked",
    schema.title, game_id, s_appid, schema.total, #utils.keys(unlocks)
  ))

  return final_state
end

return M
