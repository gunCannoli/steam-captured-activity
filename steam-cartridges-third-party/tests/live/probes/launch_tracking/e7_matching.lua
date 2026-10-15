-- Launch-tracking investigation, experiment E7 (git show ee3e9a0:docs/plans/steam-cartridges-store-launch-tracking-plan.md § 7): every
-- shortcut form, legacy and proposed, through store_service.detect and installed_games. The stubs are test_store.lua's;
-- the Epic games are this PC's manifests, the Xbox games hand-made from this PC's packages. Read-only, no network.
--
--   cd steam-cartridges; lua tests/live/probes/launch_tracking/e7_matching.lua

local here = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."):gsub("\\", "/") .. "/../../.."
package.path = here .. "/../backend/?.lua;" .. package.path

-- ---------- stubs ----------
local WARNS = 0
local logger = setmetatable({}, { __index = function(_, k) return function() if k == "warn" or k == "error" then WARNS = WARNS + 1 end end end })
package.loaded["logger"] = logger
local TMP = (os.getenv("TEMP") or os.getenv("TMPDIR") or "/tmp"):gsub("\\", "/")
package.loaded["millennium"] = { steam_path = function() return TMP end, ready = function() end }
package.loaded["fs"] = {
  is_directory = function() return true end,
  create_directories = function() return true end,
  join = function(...) return table.concat({ ... }, "/") end,
  is_file = function(p) local f = io.open(p, "rb"); if f then f:close() return true end return false end,
}
package.loaded["utils"] = {
  read_file = function(p) local f = io.open(p, "rb"); if not f then return nil, "nf" end local c = f:read("*a"); f:close(); return c end,
  write_file = function(p, c) local f, e = io.open(p, "wb"); if not f then return false, e end f:write(c); f:close(); return true end,
  base64_encode = function(s) return s end,
}
package.loaded["http"] = { get = function() error("network in test") end }

-- Full JSON codec (the shared harness decoder only handles flat payloads).
local json = {}
local function esc(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    local m = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
    return m[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end
function json.encode(v)
  local t = type(v)
  if t == "table" then
    if next(v) == nil then return "{}" end
    if #v > 0 then
      local p = {}
      for _, x in ipairs(v) do p[#p + 1] = json.encode(x) end
      return "[" .. table.concat(p, ",") .. "]"
    end
    local p = {}
    for k, x in pairs(v) do p[#p + 1] = esc(tostring(k)) .. ":" .. json.encode(x) end
    return "{" .. table.concat(p, ",") .. "}"
  elseif t == "string" then return esc(v)
  elseif t == "number" then return string.format("%.14g", v)
  elseif t == "boolean" then return tostring(v) end
  return "null"
end
function json.decode(s)
  local i = 1
  local function ws() i = s:find("%S", i) or #s + 1 end
  local value
  local function str()
    local out = {}
    i = i + 1
    while true do
      local c = s:sub(i, i)
      if c == '"' then i = i + 1 break end
      if c == "\\" then
        local n = s:sub(i + 1, i + 1)
        if n == "u" then
          local cp = tonumber(s:sub(i + 2, i + 5), 16)
          out[#out + 1] = utf8.char(cp); i = i + 6
        else
          out[#out + 1] = ({ n = "\n", r = "\r", t = "\t", b = "\b", f = "\f" })[n] or n; i = i + 2
        end
      else out[#out + 1] = c; i = i + 1 end
    end
    return table.concat(out)
  end
  function value()
    ws()
    local c = s:sub(i, i)
    if c == "{" then
      local o = {}; i = i + 1; ws()
      if s:sub(i, i) == "}" then i = i + 1 return o end
      while true do
        ws(); local k = str(); ws(); i = i + 1 -- ':'
        o[k] = value(); ws()
        local d = s:sub(i, i); i = i + 1
        if d == "}" then return o end
      end
    elseif c == "[" then
      local a = {}; i = i + 1; ws()
      if s:sub(i, i) == "]" then i = i + 1 return a end
      while true do
        a[#a + 1] = value(); ws()
        local d = s:sub(i, i); i = i + 1
        if d == "]" then return a end
      end
    elseif c == '"' then return str()
    elseif s:sub(i, i + 3) == "true" then i = i + 4 return true
    elseif s:sub(i, i + 4) == "false" then i = i + 5 return false
    elseif s:sub(i, i + 3) == "null" then i = i + 4 return nil end
    local num = s:match("^-?%d+%.?%d*[eE]?[+-]?%d*", i)
    i = i + #num
    return tonumber(num)
  end
  return value()
end
package.loaded["json"] = json

-- steam_paths / shortcuts stubs for resolve_identity's emulator guard.
local SHORTCUTS = {}
package.loaded["steam_paths"] = { resolve = function() return { shortcuts = "unused" } end }
package.loaded["shortcuts"] = {
  parse = function() return SHORTCUTS end,
  by_appid = function(entries) local ix = {} for _, e in ipairs(entries) do ix[e.appid] = e end return ix end,
}
package.loaded["rpc"] = { method = function(_, f)
  return function(payload)
    local ok, res = pcall(f, json.decode(payload))
    if not ok then return json.encode({ error = tostring(res) }) end
    if res == nil then return "null" end
    return json.encode(res)
  end
end }

-- ---------- helpers ----------
local failures = 0
local function check(label, cond, detail)
  print((cond and "  PASS  " or "  FAIL  ") .. label .. (detail and ("  -> " .. tostring(detail)) or ""))
  if not cond then failures = failures + 1 end
end
-- ======================================================================
-- E7 (launch-tracking plan): every shortcut form, legacy and proposed, through detect and installed_games.
-- Games are this PC's (real manifests and package roots, 2026-10-03); entries are hand-made shortcut shapes.
-- ======================================================================
local epic_local = require("store_epic_local")
local xbox_local = require("store_xbox_local")
local function readf(p) local f = io.open(p, "rb"); if not f then return nil end local c = f:read("*a"); f:close(); return c end
local EPIC = {}
local MDIR = [[C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests]]
local p = io.popen('dir /b "' .. MDIR .. [[\*.item" 2>nul]])
for f in p:lines() do local g = epic_local.parse_manifest(readf(MDIR .. [[\]] .. f)); if g then EPIC[#EPIC + 1] = g end end
p:close()
local J, B
for _, g in ipairs(EPIC) do if g.title:find("Jotunn") then J = g elseif g.title:find("BURIED") then B = g end end
check("census: this PC's Epic manifests give Jotunnslayer and BURIED STARS", J ~= nil and B ~= nil)
local MS = { pfn = "Microsoft.MicrosoftMinesweeper_8wekyb3d8bbwe", app_id = "App", title = "Microsoft Minesweeper",
  root = [[C:\Program Files\WindowsApps\Microsoft.MicrosoftMinesweeper_4.7.9021.0_x64__8wekyb3d8bbwe]] }
local FM = { pfn = "QubicGames.FortressMerge_e3x7kyz1wvfw4", app_id = "Game", title = "Fortress Merge",
  root = [[C:\Program Files\WindowsApps\QubicGames.FortressMerge_1.0.11.0_x64__e3x7kyz1wvfw4]] }
local XBOX = { MS, FM }

local L = [["C:\Program Files\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe"]]
local function link(g, dash) return (dash and "-" or "") .. "com.epicgames.launcher://apps/" .. g.namespace .. "%3A" .. g.item_id .. "%3A" .. g.app_name .. "?action=launch&silent=true" end
local W = [["C:\game\steam\millennium\plugins\steam-cartridges\data\store-launcher.exe"]]
local FORMS = {
  { "Epic: launcher + link without dash (legacy)", { exe = L, launch_options = link(J, false) } },
  { "Epic: launcher + dashed link (new shortcuts, R)", { exe = L, launch_options = link(J, true) } },
  { "Epic: direct game exe (BURIED STARS by hand)", { exe = '"' .. B.install_location .. [[\BURIED STARS.exe"]], launch_options = "" } },
  { "Epic: wrapper W with --link", { exe = W, launch_options = "epic --app " .. J.app_name .. ' --link "' .. link(J, true) .. '" --root "' .. J.install_location .. '"' } },
  { "Epic: wrapper W with --app only (no link)", { exe = W, launch_options = "epic --app " .. J.app_name .. ' --root "' .. J.install_location .. '"' } },
  { "Xbox: explorer shell:AppsFolder (legacy, current)", { exe = [["C:\Windows\explorer.exe"]], launch_options = [[shell:AppsFolder\]] .. MS.pfn .. "!App" } },
  { "Xbox: wrapper U1/C with --aumid", { exe = W, launch_options = "xbox --aumid " .. MS.pfn .. '!App --root "' .. MS.root .. '"' } },
  { "Xbox: wrapper U1/C with shell:AppsFolder in its args", { exe = W, launch_options = [[xbox shell:AppsFolder\]] .. MS.pfn .. "!App" } },
  { "Xbox: U0 packaged exe (WindowsApps path)", { exe = '"' .. MS.root .. [[\Minesweeper.exe"]], launch_options = "" } },
  { "Xbox: U0 after an app update (old version in path)", { exe = [["C:\Program Files\WindowsApps\Microsoft.MicrosoftMinesweeper_4.7.8000.0_x64__8wekyb3d8bbwe\Minesweeper.exe"]], launch_options = "" } },
  { "GDK: direct exe in the library folder (G)", { exe = [["C:\game\gamepass\Fortress Merge\Content\Fortress Merge.exe"]], launch_options = "" } },
  { "GDK: wrapper U1 with --aumid", { exe = W, launch_options = "xbox --aumid " .. FM.pfn .. [[!Game --root "C:\game\gamepass\Fortress Merge\Content"]] } },
}

local svc = require("store_service")
svc.deps.epic_local = setmetatable({ installed = function() return EPIC end, launcher_exe = function() return (L:gsub('"', "")) end }, { __index = epic_local })
svc.deps.xbox_local = setmetatable({ installed = function() return XBOX end }, { __index = xbox_local })
print("E7 detect, one form at a time")
for _, f in ipairs(FORMS) do
  svc._reset()
  local c = svc.detect(f[2])
  local key = c and (c.kind == "epic" and c.appName or c.pfn)
  print(string.format("  %-55s -> %s", f[1], c and (c.kind .. " " .. tostring(key):sub(1, 40) .. " via " .. tostring(c.via)) or "NOT MATCHED (auto-add would add a duplicate)"))
end
print("E7 installed_games with every form present at once (each game listed once, in the library)")
local ENTRIES = {}
for i, f in ipairs(FORMS) do ENTRIES[#ENTRIES + 1] = { appid = 3000000000 + i, exe = f[2].exe, launch_options = f[2].launch_options } end
svc.deps.entries = function() return ENTRIES end
svc.deps.entry = function(appid) for _, e in ipairs(ENTRIES) do if e.appid == appid then return e end end end
svc._reset()
local list = svc.installed_games({ allowXbox = false })
for _, kind in ipairs({ "epic", "xbox" }) do
  local seen = {}
  for _, g in ipairs(list[kind]) do
    check(kind .. " " .. tostring(g.title) .. " listed once and in the library", not seen[g.key] and g.inLibrary ~= nil, g.inLibrary)
    seen[g.key] = true
  end
end
print(failures == 0 and "E7 ALL PASS" or ("E7 FAILURES: " .. failures))
