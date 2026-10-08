--- steam-cartridges-local - where a game's emulator achievement files are (ADR-0063).
---
--- Input is what steam-cartridges tells extensions about a shortcut (AppContext): its exe, start folder, the Steam
--- app it maps to (`native`) and the schema's ids. Nothing here reads Steam's shortcut list or another plugin's files, and no
--- drive, Steam folder or user id is hardcoded (ADR-0011): roots come from %PUBLIC%, %APPDATA% and %LOCALAPPDATA%.
---
--- Two places are searched (layouts and roots from PSerban93/Achievements, MIT, and this plugin's own findings):
---   1. the game's folder, walking up from the exe (SOVEREIGN, Online-Fix, Tenoke, UniverseLAN, in-folder Goldberg)
---   2. global save roots x the per-AppID layouts many emulators share, for the mapped AppID and any AppID the game
---      folder names (steam_appid.txt, SOVEREIGN.ini, UniverseLAN.ini, tenoke.ini)
--- Online-Fix's Stats.ini holds progress only and is never an unlock file.

local fs        = require("fs")
local text      = require("text")
local discovery = require("appid_discovery")

local M = {}

local CACHE_SECONDS = 60
M._cache = {}

local MAX_LEVELS = 4

local function clean(p)
  if type(p) ~= "string" then return "" end
  p = p:gsub('^%s*"', ""):gsub('"%s*$', ""):gsub("\\", "/"):gsub("/+$", "")
  return p
end

local function parent(dir)
  local up = dir:match("^(.*)/[^/]+$")
  if not up or up == dir or #up < 2 then return nil end
  return up
end

local function subdirs(dir)
  local ok, entries = pcall(fs.list, (dir:gsub("/", "\\")))
  local out = {}
  if not ok or type(entries) ~= "table" then return out end
  for _, e in ipairs(entries) do
    if type(e) == "table" and e.is_directory and type(e.name) == "string" then out[#out + 1] = e.name end
  end
  return out
end

local function format_of(path)
  local l = path:lower()
  if l:match("%.json$") then return "goldberg" end
  if l:match("stats%.bin$") then return "stats_bin" end
  if l:match("user_stats%.ini$") then return "tenoke" end
  return "ini"
end

--- Global roots: { dir, label }.
function M.roots()
  local public = (os.getenv("PUBLIC") or ""):gsub("\\", "/")
  local appdata = (os.getenv("APPDATA") or ""):gsub("\\", "/")
  local localappdata = (os.getenv("LOCALAPPDATA") or ""):gsub("\\", "/")
  local out = {}
  local function add(base, rel, label)
    if #base > 0 then out[#out + 1] = { base .. "/" .. rel, label } end
  end
  local docs = #public > 0 and (public .. "/Documents") or ""
  add(docs, "Steam/CODEX", "CODEX")
  add(docs, "Steam/RUNE", "RUNE")
  add(docs, "Steam/RLD!", "RELOADED")
  add(docs, "Steam/SOVEREIGN", "SOVEREIGN")
  add(docs, "Steam", "GSE")
  add(docs, "OnlineFix", "Online-Fix")
  add(docs, "EMPRESS", "EMPRESS")
  add(docs, "SkidRow", "SkidRow")
  add(docs, "SmartSteamEmu", "SmartSteamEmu")
  add(appdata, "Steam/CODEX", "CODEX")
  add(appdata, "Steam/RUNE", "RUNE")
  add(appdata, "Steam/RLD!", "RELOADED")
  add(appdata, "Steam/SOVEREIGN", "SOVEREIGN")
  add(appdata, "Steam", "GSE")
  add(appdata, "GSE Saves", "GSE")
  add(appdata, "Goldberg SteamEmu Saves", "Goldberg")
  add(appdata, "OnlineFix", "Online-Fix")
  add(appdata, "SkidRow", "SkidRow")
  add(appdata, "EMPRESS", "EMPRESS")
  add(appdata, "SmartSteamEmu", "SmartSteamEmu")
  add(appdata, "SOVEREIGN/Storage/SOVEREIGN", "SOVEREIGN")
  add(appdata, "SOVEREIGN", "SOVEREIGN")
  add(localappdata, "SKIDROW", "SkidRow")
  return out
end

--- Per-AppID layouts under a root (F9).
local function layouts(root, id)
  local b = root .. "/" .. id
  return {
    b .. "/achievements.ini",
    b .. "/achievements.json",
    b .. "/SOVEREIGN.ini",
    b .. "/Stats/achievements.ini",
    b .. "/SteamData/user_stats.ini",
    b .. "/user_stats.ini",
    b .. "/stats.bin",
    b .. "/remote/" .. id .. "/achievements.json",
    b .. "/steam_settings/" .. id .. "/achievements.json",
  }
end

--- Files to check in one level of the game folder: { path, label }.
local function folder_files(d, ids)
  local list = {
    { d .. "/SOVEREIGN.ini", "SOVEREIGN" },
    { d .. "/Binaries/Win64/SOVEREIGN.ini", "SOVEREIGN" },
    { d .. "/achievements.ini", "achievements.ini" },
    { d .. "/Stats/achievements.ini", "Online-Fix" },
    { d .. "/user_stats.ini", "Tenoke" },
    { d .. "/SteamData/user_stats.ini", "Tenoke" },
    { d .. "/UniverseLANData/Achievements.ini", "UniverseLAN" },
  }
  for _, id in ipairs(ids) do
    list[#list + 1] = { d .. "/steam_settings/" .. id .. "/achievements.json", "Goldberg" }
  end
  local steamworks = d .. "/Engine/Binaries/ThirdParty/Steamworks"
  for _, ver in ipairs(subdirs(steamworks)) do
    list[#list + 1] = { steamworks .. "/" .. ver .. "/Win64/SOVEREIGN.ini", "SOVEREIGN" }
  end
  return list
end

--- A SOVEREIGN.ini in the game folder belongs to this game unless it names another AppID than the mapped one.
local function accepted(path, native)
  if not path:lower():match("sovereign%.ini$") or not native or native <= 0 then return true end
  local t = text.read(path)
  local id = t and tonumber(discovery.ini_value(t, "Game", "AppID"))
  return id == nil or id == native
end

local function search(ctx)
  local native = tonumber(ctx.native) or 0
  local out, seen, ids, id_seen = {}, {}, {}, {}
  local function add_id(id)
    id = tonumber(id)
    if id and id > 0 and not id_seen[id] then id_seen[id] = true; ids[#ids + 1] = tostring(math.floor(id)) end
  end
  local function add(path, label)
    local key = path:lower()
    if seen[key] or not text.exists(path) then return end
    seen[key] = true
    out[#out + 1] = { path = path:gsub("/", "\\"), label = label, format = format_of(path) }
  end
  add_id(native)

  -- 1. The game folder, from the exe (or the start folder) up.
  local start = clean(ctx.exe)
  if #start > 0 then start = start:match("^(.*)/[^/]+$") or start else start = clean(ctx.start_dir) end
  local levels = {}
  local d = #start > 0 and start or nil
  while d and #levels <= MAX_LEVELS do
    levels[#levels + 1] = d
    d = parent(d)
  end
  for _, dir in ipairs(levels) do add_id(discovery.from_folder(dir)) end
  for _, dir in ipairs(levels) do
    for _, f in ipairs(folder_files(dir, ids)) do
      if accepted(f[1], native) then add(f[1], f[2]) end
    end
  end

  -- 2. Global roots, for every AppID known.
  for _, root in ipairs(M.roots()) do
    for _, id in ipairs(ids) do
      for _, p in ipairs(layouts(root[1], id)) do add(p, root[2]) end
    end
  end
  return out, ids
end

--- Existing achievement files for a shortcut: { { path, label, format } }, and the AppIDs tried.
--- Kept 60 s per shortcut, exe and mapped app.
function M.candidates(ctx)
  ctx = type(ctx) == "table" and ctx or {}
  local key = tostring(ctx.appid or 0) .. "|" .. tostring(ctx.native or 0) .. "|" .. clean(ctx.exe) .. "|" .. clean(ctx.start_dir)
  local hit = M._cache[key]
  if hit and os.time() - hit.at < CACHE_SECONDS then return hit.files, hit.ids end
  local files, ids = search(ctx)
  M._cache[key] = { at = os.time(), files = files, ids = ids }
  return files, ids
end

--- Forget the cached search of a shortcut (all its keys).
function M.invalidate(appid)
  local prefix = tostring(appid or 0) .. "|"
  for k in pairs(M._cache) do
    if k:sub(1, #prefix) == prefix then M._cache[k] = nil end
  end
end

return M
