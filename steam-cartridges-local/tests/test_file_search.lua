package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
if io.open("C:/game/steam/steam.exe", "rb") then
  package.loaded["millennium"] = { steam_path = function() return "C:/game/steam" end }
end
require("harness")

local search = require("file_search")
local assert = assert

print("=== steam-cartridges-local file_search tests ===")

-- Test 1: Direct path discovery of SOVEREIGN.ini
local sov_path = [[D:\Games\WUCHANG - Fallen Feathers\Engine\Binaries\ThirdParty\Steamworks\Steamv155\Win64\SOVEREIGN.ini]]
local resDirect = search.find_candidates(0, { path = sov_path })
assert(#resDirect == 1, "Should find direct SOVEREIGN.ini path")
assert(resDirect[1].emulator == "SOVEREIGN", "Emulator should be SOVEREIGN")
print("  PASS  Direct path SOVEREIGN discovery")

-- Test 2: Discovery via game executable
local exe_path = [[D:\Games\WUCHANG - Fallen Feathers\Project_Plague\Binaries\Win64\Project_Plague-Win64-Shipping.exe]]
local resExe = search.find_candidates(2277560, { exe = exe_path })
assert(#resExe >= 1, "Should discover SOVEREIGN.ini from executable path")
assert(resExe[1].emulator == "SOVEREIGN", "Discovered emulator should be SOVEREIGN")
print("  PASS  Discovery via exe path parent traversal")

-- Test 3: Discovery via shortcut AppID auto-lookup
local resShortcut = search.find_candidates(3135033888)
assert(#resShortcut >= 1, "Should discover SOVEREIGN.ini from shortcut AppID auto-lookup")
assert(resShortcut[1].emulator == "SOVEREIGN", "Discovered emulator should be SOVEREIGN")
print("  PASS  Discovery via shortcut AppID auto-lookup (3135033888)")

-- Test 4: Discovery via native Steam AppID auto-lookup
local resNative = search.find_candidates(2277560)
assert(#resNative >= 1, "Should discover SOVEREIGN.ini from native Steam AppID auto-lookup")
assert(resNative[1].emulator == "SOVEREIGN", "Discovered emulator should be SOVEREIGN")
print("  PASS  Discovery via native Steam AppID auto-lookup (2277560)")

print("ALL PASS (file_search tests)")
