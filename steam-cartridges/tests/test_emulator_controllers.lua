-- Controller inference tests (parity plan Part F, ADR-0038 addendum). Hermetic:
-- pure modules only, no Steam install.
--
--   lua tests/test_emulator_controllers.lua   (any Lua 5.1-5.5; lupa works too)

local here = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."):gsub("\\", "/")
package.path = here .. "/../backend/?.lua;" .. package.path

local emulators = require("steam_store_emulators")
local controllers = require("emulator_controllers")

local failures = 0
local function check(label, cond, detail)
  print((cond and "  PASS  " or "  FAIL  ") .. label .. (detail ~= nil and ("  -> " .. tostring(detail)) or ""))
  if not cond then failures = failures + 1 end
end

-- Exe fields as Steam stores them on the dev machine (shortcuts.vdf, 2026-09-25).
local SNES = [["C:\emu\RetroArch\retroarch.exe" -L cores\snes9x_libretro.dll "C:\emu\roms\snes\Zombies Ate My Neighbors (USA).zip"]]
local AM2R = [["C:\emu\am2r\AM2RLauncher_2.3.0_win_DownloadMe\Profiles\Community Updates (Latest)\AM2R.exe"]]

print("program / emulator guard")
check("program of a full RetroArch command", emulators.program(SNES) == "retroarch", emulators.program(SNES))
check("the guard sees RetroArch in a full command", emulators.is_emulator(SNES))
check("unquoted path with spaces", emulators.program([[C:\Program Files\Cemu\Cemu.exe -g game.rpx]]) == "cemu")
check("a native game is not an emulator", not emulators.is_emulator(AM2R))

print("core")
check("-L core", controllers.core(SNES) == "snes9x", controllers.core(SNES))
check("quoted -L core with a hyphen", controllers.core([[-L "C:/RA/cores/mesen-s_libretro.dll" rom.sfc]]) == "mesen-s")
check("--libretro=", controllers.core("retroarch --libretro=cores/fbneo_libretro.dll x.zip") == "fbneo")
check("no core", controllers.core([["C:\emu\RetroArch\retroarch.exe"]]) == nil)

print("infer")
check("installed cores: snes9x", controllers.infer({ exe = SNES }) == true)
for _, core in ipairs({ "mgba", "fbneo", "swanstation" }) do
  local exe = [["C:\emu\RetroArch\retroarch.exe" -L cores\]] .. core .. [[_libretro.dll "C:\roms\x.zip"]]
  check("installed cores: " .. core, controllers.infer({ exe = exe }) == true)
end
check("core in launch options", controllers.infer({ exe = [["C:\emu\RetroArch\retroarch.exe"]], launch_options = [[-L cores\mgba_libretro.dll "x.gba"]] }) == true)
check("keyboard system: dosbox_pure", controllers.infer({ exe = [["C:\RA\retroarch.exe" -L cores\dosbox_pure_libretro.dll "doom.zip"]] }) == false)
check("keyboard system: scummvm", controllers.infer({ exe = [["C:\RA\retroarch.exe" -L cores\scummvm_libretro.dll "x.scummvm"]] }) == false)
check("unknown core is not inferred", controllers.infer({ exe = [["C:\RA\retroarch.exe" -L cores\vice_x64_libretro.dll "x.d64"]] }) == nil)
check("RetroArch without a core is not inferred", controllers.infer({ exe = [["C:\emu\RetroArch\retroarch.exe"]] }) == nil)
check("standalone emulator: cemu", controllers.infer({ exe = [["C:\emu\cemu\Cemu.exe"]] }) == true)
check("standalone emulator: primehack's dolphin.exe", controllers.infer({ exe = [["C:\emu\primehack\Dolphin.exe"]] }) == true)
check("suffixed build: dolphin-x64", controllers.infer({ exe = "D:/games/Dolphin-x64.exe" }) == true)
check("mame is not inferred (it also runs computers)", controllers.infer({ exe = [["C:\mame\mame.exe" sf2]] }) == nil)
check("a native game is not inferred", controllers.infer({ exe = AM2R }) == nil)
check("tables are disjoint", (function()
  for core in pairs(controllers.CORES_WITHOUT_CONTROLLER) do
    if controllers.CORES_WITH_CONTROLLER[core] then return false end
  end
  return true
end)())

print("for_entries")
local map = controllers.for_entries({
  { appid = 3224687354, exe = SNES },
  { appid = 4263274102, exe = AM2R },
  { appid = 1, exe = [["C:\RA\retroarch.exe" -L cores\scummvm_libretro.dll "x"]] },
})
check("inferred games are keyed by appid string", map["3224687354"] == true and map["1"] == false)
check("unknown games are left out", map["4263274102"] == nil)

print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
