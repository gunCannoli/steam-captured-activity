package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
require("harness")
local T = require("check")
local search = require("file_search")

print("=== file_search ===")
local root = T.tempdir("fs")

-- An Online-Fix game folder: Stats/achievements.ini is an unlock file, Stats.ini never.
local of = root .. "/OnlineFixGame"
T.mkdir(of .. "/Stats")
T.write(of .. "/Stats/achievements.ini", "[ACH_A]\nAchieved=1\n")
T.write(of .. "/Stats.ini", "[Stats]\nKILLS=5\n")
T.write(of .. "/game.exe", "")
local files = search.candidates({ appid = 1, exe = of .. "/game.exe" })
local has_stats_dir, has_stats_ini = false, false
for _, f in ipairs(files) do
  local p = f.path:gsub("\\", "/"):lower()
  if p:match("/stats/achievements%.ini$") then has_stats_dir = true end
  if p:match("/stats%.ini$") then has_stats_ini = true end
end
T.check("Online-Fix: Stats/achievements.ini is found", has_stats_dir)
T.check("Online-Fix: Stats.ini is never a candidate", not has_stats_ini)

-- A Tenoke game: tenoke.ini names the AppID, SteamData/user_stats.ini holds unlocks.
local tk = root .. "/TenokeGame"
T.mkdir(tk .. "/SteamData")
T.write(tk .. "/tenoke.ini", "[TENOKE]\nid = 123\n")
T.write(tk .. "/SteamData/user_stats.ini", '[ACHIEVEMENTS]\n"ACH_A" = {unlocked = true, time = 1}\n')
T.write(tk .. "/game.exe", "")
local tfiles, tids = search.candidates({ appid = 2, exe = '"' .. tk .. '/game.exe"' })
T.check("Tenoke: user_stats.ini found with format tenoke",
  #tfiles == 1 and tfiles[1].format == "tenoke" and tfiles[1].label == "Tenoke", #tfiles)
local has123 = false
for _, id in ipairs(tids) do if id == "123" then has123 = true end end
T.check("Tenoke: the AppID from tenoke.ini is tried", has123)

-- steam_appid.txt names the AppID; a global root then finds <root>/<id>/achievements.json.
local sa = root .. "/SteamAppIdGame"
T.mkdir(sa)
T.write(sa .. "/steam_appid.txt", "456\n")
T.write(sa .. "/game.exe", "")
local groot = root .. "/GlobalRoot"
T.mkdir(groot .. "/456")
T.write(groot .. "/456/achievements.json", '{"ACH_A":{"earned":true}}')
local saved_roots = search.roots
search.roots = function() return { { groot, "Goldberg" } } end
local gfiles = search.candidates({ appid = 3, exe = sa .. "/game.exe" })
search.roots = saved_roots
T.check("a steam_appid.txt id is tried in the global roots",
  #gfiles == 1 and gfiles[1].format == "goldberg" and gfiles[1].label == "Goldberg", #gfiles)

-- A SOVEREIGN.ini naming another AppID than the mapped one is rejected.
local sv = root .. "/SovGame"
T.mkdir(sv)
T.write(sv .. "/SOVEREIGN.ini", "[Game]\nAppID=999\n[Achievements]\nACH=1\n")
T.write(sv .. "/game.exe", "")
T.check("SOVEREIGN with another AppID than the mapped one is rejected",
  #search.candidates({ appid = 4, exe = sv .. "/game.exe", native = 111 }) == 0)
search.invalidate(4)
T.check("SOVEREIGN accepted when the shortcut has no mapping", #search.candidates({ appid = 4, exe = sv .. "/game.exe" }) == 1)

-- Results are cached; invalidate forgets them.
T.write(of .. "/achievements.ini", "[ACH_B]\nAchieved=1\n")
T.check("results are cached for a minute", #search.candidates({ appid = 1, exe = of .. "/game.exe" }) == #files)
search.invalidate(1)
T.check("invalidate forgets the cache", #search.candidates({ appid = 1, exe = of .. "/game.exe" }) == #files + 1)

-- No machine-specific path, no other plugin's file (ADR-0011, plugins.md § Layout).
local bad = {}
for _, name in ipairs({ "file_search.lua", "main.lua", "watcher.lua", "engine_logs.lua", "appid_discovery.lua", "data_dir.lua" }) do
  local src = T.read("backend/" .. name) or ""
  for _, needle in ipairs({ "83513586", "C:/game", "C:\\game", "steam_store.json", "shortcuts.vdf" }) do
    if src:find(needle, 1, true) then bad[#bad + 1] = name .. ": " .. needle end
  end
end
T.check("no hardcoded user id, Steam path or core data file in the backend", #bad == 0, table.concat(bad, "; "))

-- Real Wuchang (skipped when absent): found from its exe with its mapped AppID.
local wexe = [[D:\Games\WUCHANG - Fallen Feathers\Project_Plague\Binaries\Win64\Project_Plague-Win64-Shipping.exe]]
local wf = io.open(wexe, "rb")
if wf then
  wf:close()
  local w = search.candidates({ appid = 3135033888, exe = wexe, native = 2277560 })
  T.check("Wuchang: SOVEREIGN.ini found from the exe", #w >= 1 and w[1].label == "SOVEREIGN", #w)
else
  print("  SKIP  Wuchang not installed")
end

T.cleanup()
T.finish("file_search tests")
