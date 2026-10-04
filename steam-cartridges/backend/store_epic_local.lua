--- Epic Games Store copies on this PC (ADR-0056): the launcher's install manifests, its URL handler and the account
--- the launcher is signed in with. Disk and registry reads only, never the network. Every path comes from the
--- environment (%ProgramData%, %LOCALAPPDATA%) or the registry, never a hardcoded install folder (ADR-0011).
---
--- Facts verified on this machine (2026-10-02, docs/plans/steam-cartridges-store-copies-plan.md § 4):
---   %ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item  one JSON per installed game: InstallLocation,
---       LaunchExecutable, DisplayName, CatalogNamespace (= the achievement sandbox), CatalogItemId, AppName;
---       MainGameCatalogNamespace / MainGameAppName are set for an add-on and empty for a game.
---   %LOCALAPPDATA%\EpicGamesLauncher\Saved\Data\<32 hex>.dat     the file name is the signed-in account id.
---   HKCR\com.epicgames.launcher\shell\open\command (Default)      "<launcher exe>" %1
---   A shortcut may run the game's exe directly (Jotunnslayer) or the launcher link com.epicgames.launcher://apps/<id>.

local json = require("json")

local M = {}

--- Injectable for tests. nil = the real dependency.
M.deps = {
  getenv = nil, -- fun(name) -> string | nil                  ; nil = os.getenv
  list = nil,   -- fun(dir) -> { { name, path, is_file } }     ; nil = fs.list
  read = nil,   -- fun(path) -> string | nil                   ; nil = io.open
  mtime = nil,  -- fun(path) -> number                         ; nil = fs.last_write_time
  run = nil,    -- fun(cmd) -> string | nil                    ; nil = silent_exec.run
}

local function getenv(name) return (M.deps.getenv or os.getenv)(name) end

local function read(path)
  if M.deps.read then return M.deps.read(path) end
  local f = io.open(path, "rb")
  if not f then return nil end
  local c = f:read("*a")
  f:close()
  return c
end

local function list(dir)
  if M.deps.list then return M.deps.list(dir) end
  local ok, entries = pcall(function() return require("fs").list(dir) end)
  return ok and type(entries) == "table" and entries or {}
end

local function mtime(path)
  if M.deps.mtime then return M.deps.mtime(path) end
  local ok, t = pcall(function() return require("fs").last_write_time(path) end)
  return ok and tonumber(t) or 0
end

local function run(cmd)
  if M.deps.run then return M.deps.run(cmd) end
  local ok, out = pcall(function() return require("silent_exec").run(cmd) end)
  return ok and out or nil
end

--- A path for comparison: no quotes, backslashes, lower case, no trailing separator.
function M.norm_path(p)
  local s = tostring(p or ""):gsub('"', ""):gsub("/", "\\"):lower()
  s = s:gsub("^%s+", ""):gsub("%s+$", ""):gsub("\\+$", "")
  return s
end

--- The manifests folder, or nil when %ProgramData% is unknown.
function M.manifests_dir()
  local base = getenv("ProgramData") or getenv("PROGRAMDATA")
  if not base or base == "" then return nil end
  return base .. "\\Epic\\EpicGamesLauncher\\Data\\Manifests"
end

--- One manifest's text -> { app_name, title, install_location, launch_exe, namespace, item_id, addon, incomplete } | nil (pure).
function M.parse_manifest(text)
  local ok, m = pcall(json.decode, text or "")
  if not ok or type(m) ~= "table" then return nil end
  local ns = tostring(m.CatalogNamespace or "")
  local app = tostring(m.AppName or "")
  if ns == "" or app == "" or not m.InstallLocation then return nil end
  local main_ns = tostring(m.MainGameCatalogNamespace or "")
  local main_app = tostring(m.MainGameAppName or "")
  return {
    app_name = app,
    title = tostring(m.DisplayName or ""),
    install_location = tostring(m.InstallLocation),
    launch_exe = tostring(m.LaunchExecutable or ""),
    namespace = ns,
    item_id = tostring(m.CatalogItemId or ""),
    -- The launcher writes the manifest when a download starts; until it ends the game is not installed yet.
    incomplete = m.bIsIncompleteInstall == true,
    -- An add-on (DLC) names its game; the game itself leaves both fields empty (or names itself).
    addon = (main_app ~= "" and main_app ~= app) or (main_ns ~= "" and main_ns ~= ns),
  }
end

--- Every installed game (add-ons left out), from the manifests folder. Disk only.
function M.installed()
  local dir = M.manifests_dir()
  if not dir then return {} end
  local out = {}
  for _, e in ipairs(list(dir)) do
    local name = tostring(e.name or "")
    if name:lower():match("%.item$") and e.is_file ~= false then
      local m = M.parse_manifest(read(e.path or (dir .. "\\" .. name)))
      if m and not m.addon and not m.incomplete then out[#out + 1] = m end
    end
  end
  table.sort(out, function(a, b) return a.title:lower() < b.title:lower() end)
  return out
end

local function url_decode(s)
  return (s:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
end

--- The AppName a launcher link names (pure): com.epicgames.launcher://apps/<AppName>?..., or the newer
--- apps/<namespace>%3A<item>%3A<AppName>?... form. nil when the text has no launcher link.
function M.app_name_from_link(text)
  local id = tostring(text or ""):match("com%.epicgames%.launcher://apps/([^%?&%s\"]+)")
  if not id then return nil end
  id = url_decode(id)
  return id:match("([^:]+)$") or id
end

--- The installed game a shortcut runs (pure over `games`): its launcher link, else its exe inside an install folder.
--- Returns the manifest and how it matched ("launch-link" | "manifest"), or nil.
function M.match(entry, games)
  if type(entry) ~= "table" then return nil end
  local app = M.app_name_from_link(entry.launch_options) or M.app_name_from_link(entry.exe)
  if app then
    for _, g in ipairs(games or {}) do
      if g.app_name == app then return g, "launch-link" end
    end
  end
  local exe = M.norm_path(entry.exe)
  if exe == "" then return nil end
  for _, g in ipairs(games or {}) do
    local root = M.norm_path(g.install_location)
    if root ~= "" and exe:sub(1, #root + 1) == root .. "\\" then return g, "manifest" end
  end
  return nil
end

--- The account the launcher is signed in with: the newest <32 hex>.dat in its Saved\Data folder, or nil.
function M.account_id()
  local base = getenv("LOCALAPPDATA")
  if not base or base == "" then return nil end
  local dir = base .. "\\EpicGamesLauncher\\Saved\\Data"
  local best, best_t = nil, -1
  for _, e in ipairs(list(dir)) do
    local id = tostring(e.name or ""):lower():match("^(%x+)%.dat$")
    if id and #id == 32 then
      local t = mtime(e.path or (dir .. "\\" .. tostring(e.name)))
      if t > best_t then best, best_t = id, t end
    end
  end
  return best
end

--- The launcher's exe from its URL handler (pure parse of `reg query ... /ve` output).
function M.parse_handler(output)
  local cmd = tostring(output or ""):match("REG_SZ%s+([^\r\n]+)")
  if not cmd then return nil end
  return cmd:match('^%s*"([^"]+)"') or cmd:match("^%s*(%S+)")
end

--- The launcher's exe, or nil (registry read once per call; the caller caches).
function M.launcher_exe()
  return M.parse_handler(run('reg query "HKCR\\com.epicgames.launcher\\shell\\open\\command" /ve'))
end

--- How a shortcut for an installed game is set up (ADR-0056): the launcher, with the game's launch link as its
--- argument, so the launcher's updates, cloud saves and overlay run as when the user starts it from Epic. The link carries a
--- leading dash (a command-line switch): verified live 2026-10-03, with the launcher closed first, Steam then tracks the launcher
--- AND the game it starts under the shortcut's id (gameprocess_log), so the Steam overlay and in-game toasts work; without the
--- dash the launcher only forwards the link and the game starts outside Steam's process tree.
function M.launch_spec(game, launcher)
  if not game or not launcher or launcher == "" then return nil end
  local dir = launcher:match("^(.*)\\[^\\]+$") or ""
  local link = "-com.epicgames.launcher://apps/" .. game.namespace .. "%3A" .. game.item_id .. "%3A" .. game.app_name
    .. "?action=launch&silent=true"
  return { exe = '"' .. launcher .. '"', start_dir = dir ~= "" and ('"' .. dir .. '\\"') or "", launch_options = link }
end

return M
