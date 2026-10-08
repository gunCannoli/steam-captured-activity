package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
require("harness")

local ini = require("ini_parser")
local goldberg = require("goldberg_parser")
local assert = assert

print("=== steam-cartridges-local tests ===")

-- Test 1: Format A
local fmtA = [[
[ACH_1]
Achieved=1
UnlockTime=1700000000

[ACH_2]
Achieved=0
]]
local parsedA = ini.parse_ini(fmtA)
assert(parsedA["ACH_1"] ~= nil, "ACH_1 should be unlocked")
assert(parsedA["ACH_1"].unlocked_time == 1700000000, "ACH_1 time should be 1700000000")
assert(parsedA["ACH_2"] == nil, "ACH_2 should be locked")
print("  PASS  Format A parsing")

-- Test 2: Format B
local fmtB = [[
[Achievements]
ACH_A=1
ACH_B=0
ACH_C=true
]]
local parsedB = ini.parse_ini(fmtB)
assert(parsedB["ACH_A"] ~= nil, "ACH_A should be unlocked")
assert(parsedB["ACH_B"] == nil, "ACH_B should be locked")
assert(parsedB["ACH_C"] ~= nil, "ACH_C should be unlocked")
print("  PASS  Format B parsing")

-- Test 3: Lock all ini
local locked, count = ini.lock_all(fmtA)
assert(count == 1, "Should have cleared 1 unlock")
assert(locked:find("Achieved=0"), "Should set Achieved=0")
local recheck = ini.parse_ini(locked)
assert(recheck["ACH_1"] == nil, "ACH_1 should be locked after lock_all")
print("  PASS  ini lock_all")

-- Test 4: Goldberg
local gbJson = '{"ACH_GB1": {"earned": true, "earned_time": 1720000000}, "ACH_GB2": {"earned": false}}'
local parsedGb = goldberg.parse_goldberg(gbJson)
assert(parsedGb["ACH_GB1"] ~= nil, "ACH_GB1 should be earned")
assert(parsedGb["ACH_GB1"].unlocked_time == 1720000000, "ACH_GB1 time match")
assert(parsedGb["ACH_GB2"] == nil, "ACH_GB2 should be locked")
print("  PASS  Goldberg parsing")

-- Test 5: SOVEREIGN.ini parsing with comments and mixed unlocks
local sovFmt = [[
[Game]
AppID=2277560
UnlockAllDLCs=0

[Achievements]
; Fallen Feathers: Earn all achievements
ACH_PLATINUM_01_F=0
; Dream's Sweet Deceit: No description
ACH_GOLDEN_01_F=1
; Successor of the Bo: No description
ACH_SILVER_01_F=1750000000
; Comment with equal sign: foo=bar
ACH_COPPER_01_F=0

[Experimental]
Overlay=0
]]
local parsedSov = ini.parse_ini(sovFmt)
assert(parsedSov["ACH_PLATINUM_01_F"] == nil, "ACH_PLATINUM_01_F should be locked")
assert(parsedSov["ACH_GOLDEN_01_F"] ~= nil, "ACH_GOLDEN_01_F should be unlocked")
assert(parsedSov["ACH_SILVER_01_F"] ~= nil, "ACH_SILVER_01_F should be unlocked")
assert(parsedSov["ACH_SILVER_01_F"].unlocked_time == 1750000000, "ACH_SILVER_01_F timestamp should match")
assert(parsedSov["ACH_COPPER_01_F"] == nil, "ACH_COPPER_01_F should be locked")
assert(parsedSov["foo"] == nil, "Comment should not be parsed as key")
print("  PASS  SOVEREIGN.ini parsing with comments and timestamps")

-- Test 6: SOVEREIGN.ini lock_all
local sovLocked, sovCount = ini.lock_all(sovFmt)
assert(sovCount == 2, "Should have cleared 2 unlocks in SOVEREIGN format")
assert(sovLocked:find("ACH_GOLDEN_01_F=0"), "ACH_GOLDEN_01_F should be 0")
assert(sovLocked:find("ACH_SILVER_01_F=0"), "ACH_SILVER_01_F should be 0")
assert(sovLocked:find("; Fallen Feathers: Earn all achievements"), "Comments should be preserved")
assert(sovLocked:find("%[Experimental%]"), "Other sections should remain")
local recheckSov = ini.parse_ini(sovLocked)
assert(next(recheckSov) == nil, "All unlocks should be locked after lock_all")
print("  PASS  SOVEREIGN.ini lock_all")

-- Test 7: Real Wuchang SOVEREIGN.ini (if present on disk)
local realPath = [[D:\Games\WUCHANG - Fallen Feathers\Engine\Binaries\ThirdParty\Steamworks\Steamv155\Win64\SOVEREIGN.ini]]
local rf = io.open(realPath, "rb")
if rf then
  local rtext = rf:read("*a")
  rf:close()
  local runlocks = ini.parse_ini(rtext)
  print("  PASS  Live Wuchang SOVEREIGN.ini readable (current unlocks: " .. tostring(#runlocks) .. ")")
end

print("ALL PASS (steam-cartridges-local)")
