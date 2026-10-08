package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
require("harness")
local T = require("check")
local tenoke = require("tenoke")

print("=== tenoke ===")
local src = '[STATS]\n"STAT_KILLS" = 12\n[ACHIEVEMENTS]\n"ACH_A" = {unlocked = true, time = 1700000000}\n"ACH_B" = {unlocked = false, time = 0}\n'
local u = tenoke.parse(src)
T.check("an unlocked line is read with its time", u.ACH_A and u.ACH_A.unlocked_time == 1700000000)
T.check("a locked line is not unlocked", u.ACH_B == nil)
T.check("stats are never unlocks", u.STAT_KILLS == nil)
local locked, n = tenoke.lock_all(src)
T.check("lock_all clears one unlock", n == 1, n)
T.check("lock_all writes unlocked = false, time = 0", locked:find('"ACH_A" = {unlocked = false, time = 0}', 1, true) ~= nil, locked)
T.check("lock_all keeps the stats", locked:find('"STAT_KILLS" = 12', 1, true) ~= nil)
T.check("after lock_all nothing is unlocked", next(tenoke.parse(locked)) == nil)
T.check("appid_from_ini reads id =", tenoke.appid_from_ini("[TENOKE]\nid = 2277560\n") == 2277560)
T.finish("tenoke")
