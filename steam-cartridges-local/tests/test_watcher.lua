package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
require("harness")
local T = require("check")
local search = require("file_search")
local logs = require("engine_logs")
local watcher = require("watcher")

print("=== watcher ===")
local dir = T.tempdir("watch")
logs._offsets_path = dir .. "/log_offsets.json"
logs._reset()
local game = dir .. "/Game"
T.mkdir(game)
T.write(game .. "/game.exe", "")
T.write(game .. "/achievements.ini", "[ACH_A]\nAchieved=1\nUnlockTime=100\n")
local ctx = { appid = 10, exe = game .. "/game.exe", title = "", ids = {} }

local s = watcher.start(ctx)
T.check("start reads the file's unlock", #s.unlocks == 1 and s.unlocks[1].id == "ACH_A" and s.unlocks[1].unlockedAt == 100)
local p = watcher.poll(10)
T.check("a poll without change reports nothing", p.changed == false and #p.unlocks == 0)
T.write(game .. "/achievements.ini", "[ACH_A]\nAchieved=1\nUnlockTime=100\n[ACH_B]\nAchieved=1\nUnlockTime=200\n")
p = watcher.poll(10)
T.check("a changed file reports the whole snapshot", p.changed == true and #p.unlocks == 2, #p.unlocks)
local stop = watcher.stop(10)
T.check("stop polls once more and forgets the session", stop.changed == false and #watcher.poll(10).unlocks == 0)

-- A file created after the game started is found within 8 polls.
local late = dir .. "/LateGame"
T.mkdir(late)
T.write(late .. "/game.exe", "")
local lctx = { appid = 11, exe = late .. "/game.exe", title = "", ids = {} }
T.check("start with no file watches nothing", #watcher.start(lctx).unlocks == 0 and #watcher._watched(11) == 0)
T.write(late .. "/SOVEREIGN.ini", "[Achievements]\nACH_L=1\n")
local seen = false
for _ = 1, 8 do
  local r = watcher.poll(11)
  if r.changed then seen = r.unlocks[1] ~= nil and r.unlocks[1].id == "ACH_L" end
end
T.check("a late-created file is watched within 8 polls", seen and #watcher._watched(11) == 1)
watcher.stop(11)
search.invalidate(10)
search.invalidate(11)
T.cleanup()
T.finish("watcher")
