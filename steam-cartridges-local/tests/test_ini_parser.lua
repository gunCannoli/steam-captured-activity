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

print("ALL PASS (steam-cartridges-local)")
