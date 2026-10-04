-- Epic Steam Overlay Workaround (ADR-0057) backend tests: store_launch.lua's parsers, its prelaunch and its reaper.
-- Hermetic: every process command, the clock, the manifests and the launcher log are injected; nothing is started or ended.
--
--   lua tests/test_store_launch.lua

local here = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."):gsub("\\", "/")
package.path = here .. "/../backend/?.lua;" .. package.path

local LOGS = {}
package.loaded["logger"] = setmetatable({}, { __index = function(_, level) return function(_, msg) LOGS[#LOGS + 1] = level .. ": " .. tostring(msg) end end })

local failures = 0
local function check(label, cond, detail)
  print((cond and "  PASS  " or "  FAIL  ") .. label .. (detail and ("  -> " .. tostring(detail)) or ""))
  if not cond then failures = failures + 1 end
end

local L = require("store_launch")

-- ---------- pure parsers ----------
print("parsers")
check("image_of takes the file name of a LaunchExecutable", L.image_of("Binaries/Win64/Game.exe") == "Game.exe" and L.image_of("Jotunnslayer.exe") == "Jotunnslayer.exe")
local TASKLIST_YES = '"Jotunnslayer.exe","29572","Console","1","512,000 K"\r\n'
local TASKLIST_NO = "INFO: No tasks are running which match the specified criteria.\r\n"
check("parse_running finds the image in tasklist's CSV", L.parse_running(TASKLIST_YES, "Jotunnslayer.exe") == true)
check("... case-insensitively", L.parse_running(TASKLIST_YES, "jotunnslayer.EXE") == true)
check("... and not in tasklist's 'no tasks' answer", L.parse_running(TASKLIST_NO, "Jotunnslayer.exe") == false)
check("... nor a longer name that starts the same", L.parse_running('"Jotunnslayer.exe2","1"', "Jotunnslayer.exe") == false)
local ls = L.parse_launchers("30812 20261004000054\r\n5788 20261004003329\r\n")
check("parse_launchers reads pid and UTC start", #ls == 2 and ls[1].pid == 30812 and ls[2].started == "20261004003329")
local SYNC = "[2026.10.04-00.34.13:164][894]LogCloudSync: Cloud Sync: Upload Complete d8a3:193a:05cc03868360490aa4d7138723f4d99e\r\n"
check("has_sync_line matches Epic's cloud sync line for the game", L.has_sync_line(SYNC, "05cc03868360490aa4d7138723f4d99e"))
check("... not another game's", not L.has_sync_line(SYNC, "1712357717804dce97a6598c0d91d1d2"))
check("... not another LogCloudSync line", not L.has_sync_line("[x]LogCloudSync: Cloud Sync: Download Complete d8a3:193a:05cc03868360490aa4d7138723f4d99e", "05cc03868360490aa4d7138723f4d99e"))

-- ---------- a scripted PC ----------
local GAME = { title = "Jotunnslayer: Hordes of Hel", app_name = "05cc03868360490aa4d7138723f4d99e", launch_exe = "Jotunnslayer.exe" }
local pc
local function reset_pc()
  pc = {
    t = 1791074000, procs = {}, launchers = {}, pending = false, log = "", cmds = {},
    copy = { kind = "epic", appName = GAME.app_name, via = "launch-link" },
  }
end
local LOGFILE = (os.getenv("TEMP") or os.getenv("TMPDIR") or "/tmp"):gsub("\\", "/") .. "/sc_store_launch_test.log"
local function write_log() local f = io.open(LOGFILE, "wb"); f:write(pc.log); f:close() end
L.deps.now = function() return pc.t end
L.deps.sleep = function(ms) pc.t = pc.t + ms / 1000 end
L.deps.entry = function(appid) return appid == 1 and { appid = 1 } or nil end
L.deps.detect = function() return pc.copy end
L.deps.installed = function() return { GAME } end
L.deps.manifests = function() return { pending = pc.pending } end
L.deps.log_path = function() write_log(); return LOGFILE end
L.deps.run = function(cmd)
  pc.cmds[#pc.cmds + 1] = cmd
  local image = cmd:match('IMAGENAME eq ([^"]+)"')
  if image then
    if image == "EpicGamesLauncher.exe" then return #pc.launchers > 0 and '"EpicGamesLauncher.exe","1"' or TASKLIST_NO end
    return pc.procs[image] and ('"' .. image .. '","2"') or TASKLIST_NO
  end
  if cmd:match("^taskkill /T /F /IM EpicGamesLauncher%.exe") then pc.launchers = {}; return "SUCCESS" end
  local pid = cmd:match("^taskkill /T /F /PID (%d+)")
  if pid then
    local keep = {}
    for _, l in ipairs(pc.launchers) do if tostring(l.pid) ~= pid then keep[#keep + 1] = l end end
    pc.launchers = keep
    return "SUCCESS"
  end
  if cmd:match("^powershell") then
    local out = {}
    for _, l in ipairs(pc.launchers) do out[#out + 1] = l.pid .. " " .. l.started end
    return table.concat(out, "\r\n")
  end
  return ""
end
local function utc(t) return os.date("!%Y%m%d%H%M%S", t) end
local function killed(pid) for _, c in ipairs(pc.cmds) do if c == "taskkill /T /F /PID " .. pid then return true end end return false end
local function tick(n) local r for _ = 1, n or 1 do pc.t = pc.t + 3; r = L.reap(1, "tick") end return r end

-- ---------- prelaunch ----------
print("prelaunch")
reset_pc(); L._reset()
check("a shortcut that is no Epic launcher-link copy takes no part", L.prelaunch(2).epic == false)
pc.copy = { kind = "epic", appName = GAME.app_name, via = "manifest" }
check("... nor an Epic copy started by its exe (no launcher link)", L.prelaunch(1).epic == false)
reset_pc(); L._reset()
local r0 = L.prelaunch(1)
check("no launcher running: nothing to close", r0.epic and r0.closed == false and r0.reason == "not-running" and #pc.cmds == 1)
reset_pc(); L._reset()
pc.launchers = { { pid = 29420, started = utc(pc.t - 600) } }
local r1 = L.prelaunch(1)
check("a running launcher is closed (taskkill /T /F /IM)", r1.closed == true and pc.cmds[2] == "taskkill /T /F /IM EpicGamesLauncher.exe")
reset_pc(); L._reset()
pc.launchers = { { pid = 29420, started = utc(pc.t - 600) } }; pc.pending = true
local r2 = L.prelaunch(1)
check("a pending download: the launcher is left open", r2.closed == false and r2.reason == "pending" and #pc.launchers == 1)
reset_pc(); L._reset()
pc.launchers = { { pid = 29420, started = utc(pc.t - 600) } }
local r2b = L.prelaunch(1, (pc.t - 5) * 1000)
check("a request that waited past LATE closes nothing (Steam may have started its launcher already)", r2b.closed == false and r2b.reason == "late" and #pc.launchers == 1)
local r2c = L.prelaunch(1, (pc.t - 1) * 1000)
check("... a timely one closes it", r2c.closed == true)

-- ---------- reaper ----------
print("reaper")
reset_pc(); L._reset()
check("start: no watch for a shortcut that is no Epic launcher-link copy", L.reap(2, "start").active == false)
check("tick without a watch: idle", L.reap(1, "tick").phase == "idle")
L.prelaunch(1)
pc.launchers = { { pid = 16748, started = utc(pc.t + 1) } } -- the launcher Steam starts after the hold
check("start after prelaunch keeps its watch", L.reap(1, "start").phase == "waiting")
check("waiting while the game has not appeared", tick().phase == "waiting")
pc.procs["Jotunnslayer.exe"] = true
check("running once the game's image appears", tick().phase == "running")
pc.procs["Jotunnslayer.exe"] = nil
check("still running 3 s after the game vanished (a crash handler may restart it)", tick().phase == "running")
check("gone 6 s after", tick().phase == "gone")
pc.procs["Jotunnslayer.exe"] = true
check("back to running if the game comes back", tick().phase == "running")
pc.procs["Jotunnslayer.exe"] = nil
tick(2)
pc.log = pc.log .. SYNC
local done = tick()
check("Epic's cloud sync line ends the watch: done, synced", done.active == false and done.phase == "done" and done.reason == "synced", done.reason)
check("... and the launcher started for this launch is ended by pid", killed(16748))

reset_pc(); L._reset()
L.prelaunch(1)
pc.launchers = { { pid = 111, started = utc(pc.t - 3600) }, { pid = 222, started = utc(pc.t + 2) } }
pc.procs["Jotunnslayer.exe"] = true; tick()
pc.procs["Jotunnslayer.exe"] = nil; tick(2)
local r3 = tick(10)
check("no sync line within 30 s: done, sync-timeout", r3.phase == "done" and r3.reason == "sync-timeout", r3.reason)
check("... a launcher started before the launch is left alone; the new one is ended", not killed(111) and killed(222))

reset_pc(); L._reset()
L.prelaunch(1)
pc.launchers = { { pid = 333, started = utc(pc.t + 1) } }
pc.procs["Jotunnslayer.exe"] = true; tick()
pc.procs["Jotunnslayer.exe"] = nil; tick(2)
pc.pending = true; pc.log = SYNC
local r4 = tick()
check("a download pending when the game exits: refuse, nothing ended", r4.reason == "pending" and not killed(333))

reset_pc(); L._reset()
L.prelaunch(1)
local r5 = tick(61)
check("the game never appears within 180 s: done, no-game, the launcher left alone", r5.reason == "no-game" and #pc.cmds == 1 + 61, r5.reason)

reset_pc(); L._reset()
pc.launchers = { { pid = 444, started = utc(pc.t - 5) } } -- Steam started it before shortcut.launched arrived (no hold)
check("start without a hold (a desktop shortcut) watches from SLACK seconds before", L.reap(1, "start").active == true)
pc.procs["Jotunnslayer.exe"] = true; tick()
pc.procs["Jotunnslayer.exe"] = nil; tick(2); pc.log = SYNC
tick()
check("... and ends the launcher Steam started a few seconds before the event", killed(444))
check("stop forgets a watch", L.reap(1, "stop").active == false and L.reap(1, "tick").phase == "idle")

local leaked = false
for _, line in ipairs(LOGS) do if line:find("AUTH", 1, true) or line:find("-com.epicgames", 1, true) then leaked = true end end
check("no log line carries a command line or a launch link", not leaked)
os.remove(LOGFILE)

print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
