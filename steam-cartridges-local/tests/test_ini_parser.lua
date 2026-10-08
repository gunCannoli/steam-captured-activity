package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
require("harness")
local T = require("check")
local ini = require("ini_parser")
local goldberg = require("goldberg_parser")

print("=== ini_parser ===")
-- Type 2 (CODEX)
local fmtA = "[ACH_1]\nAchieved=1\nUnlockTime=1700000000\n\n[ACH_2]\nAchieved=0\n"
local a = ini.parse_ini(fmtA)
T.check("Type 2: unlocked with its time", a.ACH_1 and a.ACH_1.unlocked_time == 1700000000)
T.check("Type 2: Achieved=0 is locked", a.ACH_2 == nil)
local noTime = ini.parse_ini("[ACH_X]\nAchieved=1\n")
T.check("Type 2 without a time: time 0, never now", noTime.ACH_X and noTime.ACH_X.unlocked_time == 0)
local ms = ini.parse_ini("[ACH_M]\nAchieved=1\nUnlockTime=1700000000000\n")
T.check("a millisecond time is divided down", ms.ACH_M and ms.ACH_M.unlocked_time == 1700000000)
local mixed = ini.parse_ini("[ACH_P]\nAchieved=0\nCurProgress=10\nMaxProgress=10\nUnlockTime=0\n")
T.check("Type 2 wins over Type 1 keys in the same section", mixed.ACH_P == nil)

-- Type 1 hex
local t1 = ini.parse_ini("[ACH_B]\nState=01000000\nTime=00f15365\n[ACH_C]\nState=00000000\nTime=00000000\n")
T.check("Type 1 hex: State=01000000 unlocks, Time=00f15365 is 1700000000",
  t1.ACH_B and t1.ACH_B.unlocked_time == 1700000000, t1.ACH_B and t1.ACH_B.unlocked_time)
T.check("Type 1 hex: State=00000000 is locked", t1.ACH_C == nil)
T.check("a 10-digit decimal is never read as hex", ini._type1_number("1700000000") == 1700000000)

-- Format B (SOVEREIGN / RUNE)
local b = ini.parse_ini("[Achievements]\nACH_C=1750000000\nACH_D=1\nACH_E=0\nACH_F=true\n=1\n")
T.check("Format B: a Unix time", b.ACH_C and b.ACH_C.unlocked_time == 1750000000)
T.check("Format B: 1 is unlocked with time 0", b.ACH_D and b.ACH_D.unlocked_time == 0)
T.check("Format B: 0 is locked", b.ACH_E == nil)
T.check("Format B: true is unlocked", b.ACH_F ~= nil)
T.check("Format B: a key-less '=1' line is ignored", b[""] == nil)

-- [SteamAchievements]
local s = ini.parse_ini("[SteamAchievements]\nCount=1\n0=ACH_E\n")
T.check("[SteamAchievements] lists an unlocked id", s.ACH_E ~= nil and s.Count == nil)

-- Ignored sections
local g = ini.parse_ini("[Game]\nAppID=2277560\n[Profile]\nSteamID=1\n")
T.check("[Game] and [Profile] are not achievements", next(g) == nil)

-- UTF-16LE file, with and without BOM
local u16 = ("[Achievements]\nACH_U=1\n"):gsub(".", function(c) return c .. "\0" end)
T.check("a UTF-16LE file is read with and without BOM",
  ini.parse_ini(string.char(0xFF, 0xFE) .. u16).ACH_U ~= nil and ini.parse_ini(u16).ACH_U ~= nil)

-- lock_all
local locked, count = ini.lock_all(fmtA)
T.check("lock_all clears one Type 2 unlock", count == 1 and locked:find("Achieved=0", 1, true) ~= nil)
T.check("after lock_all nothing is unlocked", next(ini.parse_ini(locked)) == nil)
local hexLocked, hexCount = ini.lock_all("[ACH_B]\nState=01000000\nTime=00f15365\n")
T.check("lock_all zeroes Type 1 hex, keeping its width", hexCount == 1
  and hexLocked:find("State=00000000", 1, true) ~= nil and hexLocked:find("Time=00000000", 1, true) ~= nil, hexLocked)

local sovFmt = table.concat({
  "[Game]", "AppID=2277560", "UnlockAllDLCs=0", "",
  "[Achievements]",
  "; Fallen Feathers: Earn all achievements", "ACH_PLATINUM_01_F=0",
  "; Dream's Sweet Deceit: No description", "ACH_GOLDEN_01_F=1",
  "; Successor of the Bo: No description", "ACH_SILVER_01_F=1750000000",
  "; Comment with equal sign: foo=bar", "ACH_COPPER_01_F=0", "",
  "[Experimental]", "Overlay=0", "",
}, "\n")
local sov = ini.parse_ini(sovFmt)
T.check("SOVEREIGN: comments are skipped, unlocks read", sov.ACH_GOLDEN_01_F ~= nil and sov.ACH_SILVER_01_F ~= nil
  and sov.ACH_SILVER_01_F.unlocked_time == 1750000000 and sov.ACH_PLATINUM_01_F == nil and sov.foo == nil)
local sovLocked, sovCount = ini.lock_all(sovFmt)
T.check("SOVEREIGN lock_all clears 2 and keeps comments and sections", sovCount == 2
  and sovLocked:find("; Fallen Feathers: Earn all achievements", 1, true) ~= nil
  and sovLocked:find("[Experimental]", 1, true) ~= nil
  and sovLocked:find("AppID=2277560", 1, true) ~= nil and sovLocked:find("Overlay=0", 1, true) ~= nil)
T.check("SOVEREIGN after lock_all nothing is unlocked", next(ini.parse_ini(sovLocked)) == nil)

-- Goldberg
local gb = goldberg.parse_goldberg('{"ACH_GB1": {"earned": true, "earned_time": 1720000000}, "ACH_GB2": {"earned": false}, "ACH_GB3": {"earned": true}}')
T.check("Goldberg object: earned with its time", gb.ACH_GB1 and gb.ACH_GB1.unlocked_time == 1720000000)
T.check("Goldberg object: unearned is locked", gb.ACH_GB2 == nil)
T.check("Goldberg object: no time is 0", gb.ACH_GB3 and gb.ACH_GB3.unlocked_time == 0)
local gba = goldberg.parse_goldberg('["ACH_1","ACH_2"]')
T.check("Goldberg array: ids unlocked with time 0", gba.ACH_1 and gba.ACH_1.unlocked_time == 0 and gba.ACH_2 ~= nil)

-- Census against the real Wuchang file (skipped when absent): a naive scan shares no code with the parser.
local realPath = [[D:\Games\WUCHANG - Fallen Feathers\Engine\Binaries\ThirdParty\Steamworks\Steamv155\Win64\SOVEREIGN.ini]]
local rf = io.open(realPath, "rb")
if rf then
  local raw = rf:read("*a")
  rf:close()
  local in_ach, keys, unlocked = false, 0, 0
  for line in raw:gmatch("[^\r\n]+") do
    if line:match("^%[") then
      in_ach = line:match("^%[Achievements%]") ~= nil
    elseif in_ach then
      local v = line:match("^ACH_[%w_]+=(.*)$")
      if v then
        keys = keys + 1
        if v ~= "0" then unlocked = unlocked + 1 end
      end
    end
  end
  local parsed, n = ini.parse_ini(raw), 0
  for k in pairs(parsed) do if k:match("^ACH_") then n = n + 1 end end
  print(string.format("  census: %d ACH_ keys, %d not 0", keys, unlocked))
  T.check("census: keys found", keys > 0)
  T.check("Wuchang: the parser unlocks exactly the keys whose value is not 0", n == unlocked, n .. " vs " .. unlocked)
else
  print("  SKIP  Wuchang SOVEREIGN.ini not on this machine")
end

T.finish("steam-cartridges-local")
