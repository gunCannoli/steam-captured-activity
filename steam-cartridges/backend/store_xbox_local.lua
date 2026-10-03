--- Xbox (PC Game Pass / Microsoft Store) copies on this PC (ADR-0056): the installed packages from the registry and the
--- Xbox Live game config each game ships. Disk and registry reads only, never the network.
---
--- Facts verified on this machine (2026-10-02, docs/plans/steam-cartridges-store-copies-plan.md § 4.7):
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

--- AppxManifest.xml text -> { app_id, executable, title } (pure). The title may be an ms-resource reference: nil then.
function M.parse_appx_manifest(text)
  if not text then return nil end
  local app = text:match("<Application%s[^>]-Id=\"([^\"]+)\"")
  local exe = text:match("<Application%s[^>]-Executable=\"([^\"]+)\"")
  local title = text:match("<DisplayName>%s*([^<]-)%s*</DisplayName>")
  if title and title:match("^ms%-resource:") then title = nil end
  -- An Xbox Live game that ships no game config (Microsoft Sudoku, found 2026-10-03) registers a protocol
  -- `xboxliveapp-<number>`: the one local mark that its achievements exist. Its title id comes from the catalog.
  local live = text:find('Name="xboxliveapp%-%d+"') ~= nil
  return { app_id = app, executable = exe, title = title, xbox_live = live }
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

--- The package family name a shell:AppsFolder target names, or nil (pure).
function M.pfn_from_target(text)
  return tostring(text or ""):match("[Ss][Hh][Ee][Ll][Ll]:[Aa][Pp][Pp][Ss][Ff][Oo][Ll][Dd][Ee][Rr]\\([^!%s\"]+)!")
end

--- The installed game a shortcut runs (pure over `games`): its shell:AppsFolder target, else its exe inside a
--- package folder. Returns the game and how it matched ("launch-link" | "package"), or nil.
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
  return nil
end

--- How a shortcut for an installed game is set up (ADR-0056): Windows Explorer opening the package's app, the way the
--- Xbox app and the Start menu start it (the game's own exe cannot be run directly from a protected package folder).
function M.launch_spec(game)
  if not game or not game.pfn then return nil end
  local windir = getenv("SystemRoot") or getenv("windir")
  if not windir or windir == "" then return nil end
  return {
    exe = '"' .. windir .. '\\explorer.exe"',
    start_dir = '"' .. windir .. '\\"',
    launch_options = "shell:AppsFolder\\" .. game.pfn .. "!" .. (game.app_id or "App"),
  }
end

return M
