package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
require("harness")
local T = require("check")
local logs = require("engine_logs")

print("=== engine_logs (moved from steam-cartridges, ADR-0063) ===")
local function contains(list, value)
  for _, v in ipairs(list) do if v == value then return true end end
  return false
end

-- Real-world case: "WUCHANG: Fallen Feathers" ships as Project_Plague.exe.
local candidates = logs.get_possible_folder_names("WUCHANG: Fallen Feathers",
  [[D:\Games\Local\Wuchang - Fallen Feathers\Project_Plague-Win64-Shipping.exe]])
T.check("derives Unreal project codename from shipping exe", contains(candidates, "Project_Plague"), table.concat(candidates, ", "))
T.check("keeps exact title as a candidate", contains(candidates, "WUCHANG: Fallen Feathers"))
T.check("keeps colon-to-dash normalized title", contains(candidates, "WUCHANG - Fallen Feathers"))
T.check("exe codename is checked first", candidates[1] == "Project_Plague", candidates[1])
local title_only = logs.get_possible_folder_names("Hollow Knight", nil)
T.check("falls back to title when exe path is missing", contains(title_only, "Hollow Knight"), table.concat(title_only, ", "))
T.check("no exe path yields no nil/empty candidate", #title_only > 0)
local plain_exe = logs.get_possible_folder_names("Some Game", [[C:\Games\SomeGame\SomeGame.exe]])
T.check("plain exe basename has extension stripped", contains(plain_exe, "SomeGame"), table.concat(plain_exe, ", "))
local names = logs.get_possible_folder_names("WUCHANG: Fallen Feathers", "")
T.check("colon becomes ' - ' with the spaces collapsed", contains(names, "WUCHANG - Fallen Feathers"))
local em = logs.get_possible_folder_names("Game \xe2\x80\x94 Sequel", "")
T.check("an em dash is replaced as a whole sequence, not byte by byte", contains(em, "Game - Sequel"), table.concat(em, " | "))

-- Tailing.
local dir = T.tempdir("logs")
logs._offsets_path = dir .. "/log_offsets.json"
logs._reset()
local log = dir .. "/Player.log"
T.write(log, 'old line SetAchievement("ACH_OLD")\n')
T.check("a log seen for the first time returns nothing (read from its end)", next(logs.scan(log)) == nil)
local f = io.open(log, "ab")
f:write('UnlockAchievement("ACH_X")\n')
f:close()
local found = logs.scan(log)
T.check("an appended line is detected", found.ACH_X ~= nil and found.ACH_OLD == nil)
logs.save()
logs._reset()
T.check("after a restart old lines are not read again", next(logs.scan(log)) == nil)
T.write(log, 'SetAchievement("ACH_R")\n')
T.check("a shorter (rotated) log is read from the start", logs.scan(log).ACH_R ~= nil)
T.check("a console-emulator line is not an engine token", logs.match_line("[RCHEEVOS] Awarding achievement 4615: Title") == nil)
T.cleanup()
T.finish("engine_logs")
