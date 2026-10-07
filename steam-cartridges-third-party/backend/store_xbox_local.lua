--- Xbox (PC Game Pass / Microsoft Store) copies on this PC (ADR-0056): the installed packages from the registry and the
--- Xbox Live game config each game ships. Disk and registry reads only, never the network.
---
--- Facts verified on this machine (2026-10-02, git show 9a7df2b:docs/plans/steam-cartridges-store-copies-plan.md § 4.7):
---   reg query "HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages"
---       /s /v PackageRootFolder  lists every installed package (361 here) with its folder, in about 0.2 s.
---   <folder>\xboxservices.config     a UWP Xbox Live game (Microsoft Jigsaw): JSON with TitleId (decimal).
---   <folder>\MicrosoftGame.config    a GDK game: XML with <TitleId> (hex) and <StoreId>. Not seen on a real install yet.
---   <folder>\AppxManifest.xml        <Application Id="App" Executable="Jigsaw.exe">, <DisplayName>.
---   A package full name is Name_Version_Arch_ResourceId_PublisherId; its family name is Name_PublisherId, and the
---   launch target is shell:AppsFolder\<family name>!<application id>.

local json = require("json")

local M = {}

M.PACKAGES_KEY = [[HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages]]

--- Injectable for tests. nil = the real dependency.
M.deps = {
  run = nil,    -- fun(cmd) -> string | nil ; nil = silent_exec.run
  read = nil,   -- fun(path) -> string | nil ; nil = io.open
  getenv = nil, -- fun(name) -> string | nil ; nil = os.getenv
}

local function run(cmd)
  if M.deps.run then return M.deps.run(cmd) end
  local ok, out = pcall(function() return require("silent_exec").run(cmd) end)
  return ok and out or nil
end

local function read(path)
  if M.deps.read then return M.deps.read(path) end
  local f = io.open(path, "rb")
  if not f then return nil end
  local c = f:read("*a")
  f:close()
  return c
end

local function getenv(name) return (M.deps.getenv or os.getenv)(name) end

--- `reg query ... /s /v PackageRootFolder` output -> { { full_name, root } } (pure).
function M.parse_packages(output)
  local out, current = {}, nil
  for line in tostring(output or ""):gmatch("[^\r\n]+") do
    local key = line:match("\\Packages\\([^\\]+)%s*$")
    if key then
      current = key
    else
      local root = line:match("PackageRootFolder%s+REG_SZ%s+(.-)%s*$")
      if root and current then out[#out + 1] = { full_name = current, root = root } end
    end
  end
  return out
end

--- Name_Version_Arch_ResourceId_PublisherId -> Name_PublisherId (pure).
function M.family_name(full_name)
  local parts = {}
  for p in tostring(full_name or ""):gmatch("[^_]+") do parts[#parts + 1] = p end
  if #parts < 2 then return nil end
  return parts[1] .. "_" .. parts[#parts]
end

--- xboxservices.config text -> title id (decimal string) | nil (pure).
function M.parse_services_config(text)
  if not text then return nil end
  text = text:gsub("^\239\187\191", "") -- UTF-8 byte order mark
  local ok, c = pcall(json.decode, text)
  if not ok or type(c) ~= "table" or c.TitleId == nil then return nil end
  local n = tonumber(c.TitleId)
  if not n or n <= 0 then return nil end
  return string.format("%d", n)
end

--- MicrosoftGame.config text -> { title_id (decimal string), store_id, name } | nil (pure). The TitleId is hex.
function M.parse_game_config(text)
  if not text then return nil end
  local hex = text:match("<TitleId>%s*(%x+)%s*</TitleId>")
  if not hex then return nil end
  local n = tonumber(hex, 16)
  if not n or n <= 0 then return nil end
  return {
    title_id = string.format("%d", n),
    store_id = text:match("<StoreId>%s*([%w]+)%s*</StoreId>"),
    name = text:match('<Identity[^>]-Name="([^"]+)"'),
  }
end

--- AppxManifest.xml text -> { app_id, executable, entry_point, title } (pure). The title may be an ms-resource reference: nil
--- then. entry_point is an app class for a UWP app, "Windows.FullTrustApplication" for a Win32/GDK one.
function M.parse_appx_manifest(text)
  if not text then return nil end
  local app = text:match("<Application%s[^>]-Id=\"([^\"]+)\"")
  local exe = text:match("<Application%s[^>]-Executable=\"([^\"]+)\"")
  local entry = text:match("<Application%s[^>]-EntryPoint=\"([^\"]+)\"")
  local title = text:match("<DisplayName>%s*([^<]-)%s*</DisplayName>")
  if title and title:match("^ms%-resource:") then title = nil end
  -- An Xbox Live game that ships no game config (Microsoft Sudoku, found 2026-10-03) registers a protocol
  -- `xboxliveapp-<number>`: the one local mark that its achievements exist. Its title id comes from the catalog.
  local live = text:find('Name="xboxliveapp%-%d+"') ~= nil
  return { app_id = app, executable = exe, entry_point = entry, title = title, xbox_live = live }
end

--- Every installed Xbox Live game: a package with an Xbox game config, or an `xboxliveapp-` protocol in its manifest.
--- Registry and disk only. { { pfn, full_name, root, title_id?, store_id?, app_id, executable?, title?, via = "config" | "protocol" } }
function M.installed()
  local out = {}
  for _, p in ipairs(M.parse_packages(run('reg query "' .. M.PACKAGES_KEY .. '" /s /v PackageRootFolder'))) do
    local title_id, store_id
    local services = M.parse_services_config(read(p.root .. "\\xboxservices.config"))
    if services then
      title_id = services
    else
      local game = M.parse_game_config(read(p.root .. "\\MicrosoftGame.config"))
      if game then title_id, store_id = game.title_id, game.store_id end
    end
    local manifest = M.parse_appx_manifest(read(p.root .. "\\AppxManifest.xml")) or {}
    if title_id or manifest.xbox_live then
      out[#out + 1] = {
        pfn = M.family_name(p.full_name),
        full_name = p.full_name,
        root = p.root,
        title_id = title_id,
        store_id = store_id,
        app_id = manifest.app_id or "App",
        executable = manifest.executable,
        -- UWP (an app class as entry point): Windows starts it by activation whatever runs it, and its exe can be the
        -- shortcut's (U0, ADR-0058). A GDK/Win32 package relaunches itself outside Steam's tree from its exe (plan F18).
        uwp = manifest.entry_point ~= nil and manifest.entry_point ~= "Windows.FullTrustApplication",
        title = manifest.title,
        via = title_id and "config" or "protocol",
      }
    end
  end
  table.sort(out, function(a, b) return (a.title or a.pfn or ""):lower() < (b.title or b.pfn or ""):lower() end)
  return out
end

local function norm_path(p)
  local s = tostring(p or ""):gsub('"', ""):gsub("/", "\\"):lower()
  return (s:gsub("^%s+", ""):gsub("%s+$", ""):gsub("\\+$", ""))
end

--- The package family name a shell:AppsFolder target or --aumid parameter names, or nil (pure).
function M.pfn_from_target(text)
  local s = tostring(text or "")
  local shell_pfn = s:match("[Ss][Hh][Ee][Ll][Ll]:[Aa][Pp][Pp][Ss][Ff][Oo][Ll][Dd][Ee][Rr]\\([^!%s\"]+)!")
  if shell_pfn then return shell_pfn end
  local aumid_pfn = s:match("%-%-aumid%s+[\"']?([^!%s\"']+)!")
  if aumid_pfn then return aumid_pfn end
  return nil
end

--- The package family name of an exe inside a WindowsApps package folder, whatever its version, or nil (pure):
--- ...\WindowsApps\Microsoft.MicrosoftMinesweeper_4.7.9021.0_x64__8wekyb3d8bbwe\Minesweeper.exe -> Microsoft.MicrosoftMinesweeper_8wekyb3d8bbwe.
--- A shortcut made for an older version still names its game after an app update.
function M.pfn_from_path(text)
  local full = tostring(text or ""):gsub("/", "\\"):match("[Ww][Ii][Nn][Dd][Oo][Ww][Ss][Aa][Pp][Pp][Ss]\\([^\\\"]+)\\")
  if not full or not full:find("_", 1, true) then return nil end
  return M.family_name(full)
end

--- The installed game a shortcut runs (pure over `games`): its shell:AppsFolder target, else its exe inside a
--- package folder (the current one, or an older version's). Returns the game and how it matched ("launch-link" |
--- "package"), or nil.
function M.match(entry, games)
  if type(entry) ~= "table" then return nil end
  local pfn = M.pfn_from_target(entry.launch_options) or M.pfn_from_target(entry.exe)
  if pfn then
    for _, g in ipairs(games or {}) do
      if g.pfn and g.pfn:lower() == pfn:lower() then return g, "launch-link" end
    end
  end
  local exe = norm_path(entry.exe)
  if exe == "" then return nil end
  for _, g in ipairs(games or {}) do
    local root = norm_path(g.root)
    if root ~= "" and exe:sub(1, #root + 1) == root .. "\\" then return g, "package" end
  end
  local from_path = M.pfn_from_path(entry.exe)
  if from_path then
    for _, g in ipairs(games or {}) do
      if g.pfn and g.pfn:lower() == from_path:lower() then return g, "package" end
    end
  end
  return nil
end

--- U0 (ADR-0058): the shortcut of a UWP game runs the game's own exe in its package folder. Windows then starts
--- SystemUWPLauncher, which activates the game and lives exactly as long as it, so Steam shows the game running,
--- counts its playtime and keeps a timeline (launch-tracking plan F16, E3c). nil for a GDK/Win32 package or a package
--- whose manifest names no exe.
function M.u0_spec(game)
  if not game or not game.uwp or not game.executable or not game.root or game.root == "" then return nil end
  local root = tostring(game.root):gsub("\\+$", "")
  return { exe = '"' .. root .. "\\" .. tostring(game.executable):gsub("/", "\\") .. '"', start_dir = '"' .. root .. '\\"', launch_options = "" }
end

--- Resolves the path to uwp_presenter.exe if available on this machine.
function M.presenter_path()
  if M.deps.presenter_path then return M.deps.presenter_path() end
  local ok_fs, fs = pcall(require, "fs")
  if not ok_fs or not fs then return nil end

  local src = debug.getinfo(1, "S").source
  local dir = src:match("^@?(.*)[/\\][^/\\]+$")
  if dir then
    local p = fs.join(dir, "..", "bin", "uwp_presenter.exe")
    if fs.is_file(p) then return p end
  end

  local ok, root = pcall(function() return require("millennium").steam_path() end)
  if ok and root and root ~= "" then
    local p1 = fs.join(root, "millennium", "plugins", "steam-cartridges-third-party", "bin", "uwp_presenter.exe")
    if fs.is_file(p1) then return p1 end
    local p2 = fs.join(root, "millennium", "plugins", "steam-cartridges-third-party-dev", "bin", "uwp_presenter.exe")
    if fs.is_file(p2) then return p2 end
  end
  return nil
end

--- UWP Presenter Spec: launches the zero-copy presentation wrapper (Windows.Graphics.Capture)
--- hooked by Steam Overlay and Game Recording.
function M.presenter_spec(game, p_path)
  if not game or not game.pfn then return nil end
  local p = p_path or M.presenter_path()
  if not p or p == "" then return nil end
  local root = tostring(game.root or ""):gsub("\\+$", "")
  local aumid = game.pfn .. "!" .. (game.app_id or "App")
  local title_arg = game.title and (' --title "' .. tostring(game.title):gsub('"', '') .. '"') or ""
  return {
    exe = '"' .. p .. '"',
    start_dir = root ~= "" and ('"' .. root .. '\\"') or '""',
    launch_options = '--aumid "' .. aumid .. '"' .. title_arg,
  }
end

--- How a shortcut for an installed game is set up:
---   1. If overlay option is requested and presenter is available, uses uwp_presenter (Option 1).
---   2. Otherwise for UWP games runs its own exe (U0, ADR-0058).
---   3. For any other package (GDK/Win32) opens via Windows Explorer (ADR-0056).
function M.launch_spec(game, opts)
  if not game or not game.pfn then return nil end
  if opts and opts.overlay then
    local pres = M.presenter_spec(game)
    if pres then return pres end
  end
  local u0 = M.u0_spec(game)
  if u0 then return u0 end
  local windir = getenv("SystemRoot") or getenv("windir")
  if not windir or windir == "" then return nil end
  return {
    exe = '"' .. windir .. '\\explorer.exe"',
    start_dir = '"' .. windir .. '\\"',
    launch_options = "shell:AppsFolder\\" .. game.pfn .. "!" .. (game.app_id or "App"),
  }
end

return M
