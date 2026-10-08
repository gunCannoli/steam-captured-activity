--- steam-cartridges-local - unlocks written to PC-game engine logs (moved from steam-cartridges, ADR-0063).
---
--- Unity (Player.log under LocalLow), Godot (godot.log under app_userdata) and Unreal (Saved\Logs) logs, found from
--- the game's title and its executable's project codename, tailed from where the last read stopped. The read
--- positions live in this plugin's data folder (log_offsets.json). A log seen for the first time is read from its
--- end, so moving the offsets out of steam-cartridges never replays old lines, and a reset stays a reset (ADR-0054).

local json     = require("json")
local fs       = require("fs")
local data_dir = require("data_dir")

local M = {}

local offsets = nil
local dirty = false
M._offsets_path = nil

local function offsets_path()
  return M._offsets_path or data_dir.file("log_offsets.json")
end

local function load_offsets()
  if offsets then return end
  offsets = {}
  local f = io.open(offsets_path(), "rb")
  if not f then return end
  local ok, data = pcall(json.decode, f:read("*a") or "")
  f:close()
  if ok and type(data) == "table" then
    for k, v in pairs(data) do
      if type(k) == "string" and tonumber(v) then offsets[k] = tonumber(v) end
    end
  end
end

function M.save()
  if not dirty then return end
  dirty = false
  local f = io.open(offsets_path(), "wb")
  if not f then return end
  f:write(json.encode(offsets or {}))
  f:close()
end

--- Tests: forget the offsets held in memory.
function M._reset() offsets, dirty = nil, false end

local function file_exists(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

local function trim(s)
  return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

--- Strips an Unreal Engine "-Win64-Shipping" / "-Win64-Test" / "-Win64-Debug"
--- suffix from a shipping binary name, leaving the bare project codename.
local function strip_shipping_suffix(basename)
  return (basename:gsub("%-[Ww]in64%-%a+$", ""):gsub("%-[Ww]in32%-%a+$", ""))
end

--- Extracts the executable base name from a full path: strips directories,
--- surrounding quotes, and the ".exe" extension.
--- "D:\Games\Wuchang\Project_Plague-Win64-Shipping.exe" -> "Project_Plague"
local function exe_basename(exe_path)
  if not exe_path or #exe_path == 0 then return nil end
  local p = tostring(exe_path):gsub('^"(.*)"$', "%1")
  p = p:gsub("\\", "/")
  local base = p:match("([^/]+)$") or p
  base = base:gsub("%.[Ee][Xx][Ee]$", "")
  base = strip_shipping_suffix(base)
  if #base == 0 then return nil end
  return base
end

--- Builds a de-duplicated list of candidate folder names for engine log
--- discovery (e.g. %LOCALAPPDATA%\<Candidate>\Saved\Logs\<Candidate>.log),
--- covering both the game's Steam title and its internal Unreal/Unity
--- project codename derived from the shortcut's executable path.
---
--- Handles the case where a game's public title ("WUCHANG: Fallen Feathers")
--- does not match the internal project folder name ("Project_Plague"),
--- which the log/save folder is actually named after.
function M.get_possible_folder_names(game_title, exe_path)
  local candidates = {}
  local seen = {}

  local function add(name)
    if name and #name > 0 and not seen[name] then
      seen[name] = true
      candidates[#candidates + 1] = name
    end
  end

  -- 1. Executable / internal project codename (most reliable for UE titles).
  add(exe_basename(exe_path))

  local title = trim(game_title)
  if #title > 0 then
    -- 2. Exact title.
    add(title)

    -- 3. Punctuation normalized to a single delimiter or stripped.
    -- (the byte-string literals below are UTF-8 en dash \xe2\x80\x93 and em dash \xe2\x80\x94)
    -- K7: the dashes are multi-byte sequences, so substitute whole sequences (a byte class
    -- would match their single bytes and corrupt the string), then collapse the spaces.
    local dash = title:gsub(":", " - "):gsub("\xe2\x80\x93", " - "):gsub("\xe2\x80\x94", " - ")
    dash = trim((dash:gsub("%s+", " ")))
    add(dash)
    local stripped = title:gsub("[:%-\xe2\x80\x93\xe2\x80\x94]", "")
    stripped = stripped:gsub("%s+", " ")
    stripped = trim(stripped)
    add(stripped)
    add((stripped:gsub("%s+", "")))

    -- 4. snake_case / Snake_Case variants.
    local snake = trim(title):gsub("[^%w]+", "_"):gsub("^_+", ""):gsub("_+$", "")
    add(snake)

    -- 5. Prefix before the first colon/dash (e.g. "Wuchang").
    local prefix = title:match("^([^:%-\xe2\x80\x93\xe2\x80\x94]+)")
    if prefix then add(trim(prefix)) end
  end

  return candidates
end

--- Engine logs of a game that exist: from its title and its executable's codename.
function M.paths(game_title, exe_path)
  local appdata = os.getenv("APPDATA") or ""
  local localappdata = os.getenv("LOCALAPPDATA") or ""
  local userprofile = os.getenv("USERPROFILE") or ""
  local out, seen = {}, {}
  local function add(p)
    if p and not seen[p] and file_exists(p) then
      seen[p] = true
      out[#out + 1] = p
    end
  end
  -- Unreal Engine games are often shipped under an internal project name distinct from their store title
  -- ("Project_Plague.exe" for "WUCHANG: Fallen Feathers"), so the executable's codename is tried too.
  if (game_title and #game_title > 0 or exe_path) and #userprofile > 0 then
    local folder_candidates = M.get_possible_folder_names(game_title, exe_path)
    for _, name in ipairs(folder_candidates) do
      add(userprofile .. "/AppData/LocalLow/" .. name .. "/Player.log")
      add(appdata .. "/Godot/app_userdata/" .. name .. "/logs/godot.log")
      add(localappdata .. "/" .. name .. "/Saved/Logs/" .. name .. ".log")
    end
    -- Fallback: a Saved\Logs folder without "<Project>.log": the most recently written *.log.
    if fs.list and fs.is_directory then
      for _, name in ipairs(folder_candidates) do
        local log_dir = localappdata .. "/" .. name .. "/Saved/Logs"
        if not file_exists(log_dir .. "/" .. name .. ".log") and fs.is_directory(log_dir) then
          local ok, entries = pcall(fs.list, log_dir)
          local newest_path, newest_mtime = nil, -1
          for _, entry in ipairs(ok and type(entries) == "table" and entries or {}) do
            local ename = entry.name or entry.path
            if ename and tostring(ename):match("%.[Ll][Oo][Gg]$") then
              local full = entry.path or (log_dir .. "/" .. ename)
              local mtime = (fs.last_write_time and fs.last_write_time(full)) or 0
              if mtime > newest_mtime then newest_mtime, newest_path = mtime, full end
            end
          end
          add(newest_path)
        end
      end
    end
  end
  return out
end

--- An achievement token in one engine log line, or nil.
function M.match_line(line)
  return line:match("[aA]chievement%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
      or line:match("[aA]ward%a*%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
      or line:match("[uU]nlock%a*%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
      or line:match("[uU]nlock[aA]chievement%s*%(%s*['\"]([^'\"]+)['\"]")
      or line:match("[sS]et[aA]chievement%s*%(%s*['\"]([^'\"]+)['\"]")
end

--- New tokens in a log since the last read: { [token] = { unlocked_time = now } }. A log never seen before is only
--- marked at its end. A shorter log (rotated) is read from the start.
function M.scan(path)
  local f = io.open(path, "rb")
  if not f then return {} end
  load_offsets()
  local size = f:seek("end")
  local last = offsets[path]
  if last == nil then
    offsets[path] = size
    dirty = true
    f:close()
    return {}
  end
  if size < last then last = 0 end
  f:seek("set", last)
  local fresh = f:read("*a") or ""
  local read_to = f:seek()
  f:close()
  if offsets[path] ~= read_to then
    offsets[path] = read_to
    dirty = true
  end
  local found = {}
  for line in fresh:gmatch("[^\r\n]+") do
    local token = M.match_line(line)
    if token and #token > 0 then found[token] = { unlocked_time = os.time() } end
  end
  return found
end

--- Marks every engine log of a game as read to its end (after a reset). Saved at once.
function M.mark_read(game_title, exe_path)
  load_offsets()
  for _, p in ipairs(M.paths(game_title, exe_path)) do
    local f = io.open(p, "rb")
    if f then
      offsets[p] = f:seek("end")
      dirty = true
      f:close()
    end
  end
  M.save()
end

return M
