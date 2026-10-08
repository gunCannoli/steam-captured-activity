-- Reset Achievements backend tests (ADR-0054): the file editors (achievement_files.lua), the
-- persisted log offsets (achievements_observer.lua) and the reset flow (achievements_reset.lua).
-- Hermetic: temp files only, no Steam install, no network.
--
--   lua tests/test_achievements_reset.lua

local here = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."):gsub("\\", "/")
package.path = here .. "/../backend/?.lua;" .. package.path

local TMP = (os.getenv("TEMP") or os.getenv("TMPDIR") or "/tmp"):gsub("\\", "/") .. "/sc_reset_test_" .. tostring(os.time())
os.execute((package.config:sub(1, 1) == "\\" and 'mkdir "' .. TMP:gsub("/", "\\") .. '"' or 'mkdir -p "' .. TMP .. '"'))

package.loaded["logger"] = setmetatable({}, { __index = function() return function() end end })
package.loaded["millennium"] = { steam_path = function() return TMP end, ready = function() end }
package.loaded["fs"] = {
  is_directory = function() return false end,
  create_directories = function() return true end,
  join = function(...) return table.concat({ ... }, "/") end,
  is_file = function(p) local f = io.open(p, "rb"); if f then f:close() return true end return false end,
  list = function() return {} end,
}
package.loaded["utils"] = {
  read_file = function(p) local f = io.open(p, "rb"); if not f then return nil end local c = f:read("*a"); f:close(); return c end,
  write_file = function(p, c) local f, e = io.open(p, "wb"); if not f then return false, e end f:write(c); f:close(); return true end,
}
-- A small JSON codec: enough for the offsets map and the store's flat shapes.
local json = {}
function json.encode(v)
  if type(v) == "table" then
    local parts = {}
    for k, x in pairs(v) do parts[#parts + 1] = string.format("%q:%s", tostring(k), json.encode(x)) end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif type(v) == "string" then return string.format("%q", v)
  elseif v == nil then return "null" end
  return tostring(v)
end
function json.decode(s)
  local lua = s:gsub('"([^"]-)":', '["%1"]='):gsub("%[%]", "{}"):gsub("null", "nil")
  local f = (loadstring or load)("return " .. lua)
  return f and f() or {}
end
package.loaded["json"] = json
package.loaded["data_dir"] = { file = function(n) return TMP .. "/" .. n end, path = function() return TMP end }
package.loaded["steam_paths"] = { resolve = function() return nil end }
package.loaded["shortcuts"] = { parse = function() return {} end }
package.loaded["http"] = { get = function() error("network in test") end }

local pass, fail = 0, 0
local function check(name, cond, detail)
  if cond then pass = pass + 1; print("PASS  " .. name)
  else fail = fail + 1; print("FAIL  " .. name .. (detail and ("  (" .. tostring(detail) .. ")") or "")) end
end
local function writef(p, c) local f = assert(io.open(p, "wb")); f:write(c); f:close() end
local function readf(p) local f = io.open(p, "rb"); if not f then return nil end local c = f:read("*a"); f:close(); return c end

local files = require("achievement_files")

-- Steam API emulator INI / JSON files are steam-cartridges-local's (ADR-0063); its suites test them.
local observer = require("achievements_observer")

-- ---------- RPCS3 TROPUSR.DAT (layout of rpcs3/Loader/TROPUSR.h) ----------
local function be32(v) return string.char(math.floor(v / 16777216) % 256, math.floor(v / 65536) % 256, math.floor(v / 256) % 256, v % 256) end
local function be64(v) return be32(math.floor(v / 4294967296)) .. be32(v % 4294967296) end
local PAD = string.char(0xAB)
local function tropusr(states)
  local header = be32(0x818F54AD) .. be32(0x10000) .. be32(2) .. be32(0) .. string.rep("\0", 32)
  local n = #states
  local off4 = 48 + 2 * 32
  local off6 = off4 + n * 0x60
  local th4 = be32(4) .. be32(0x50) .. be32(1) .. be32(n) .. be64(off4) .. be64(0)
  local th6 = be32(6) .. be32(0x60) .. be32(1) .. be32(n) .. be64(off6) .. be64(0)
  local t4, t6 = {}, {}
  for i, st in ipairs(states) do
    t4[#t4 + 1] = be32(4) .. be32(0x50) .. be32(i - 1) .. be32(0) .. be32(i - 1) .. be32(4) .. be32(0xFFFFFFFF) .. string.rep("\0", 68)
    local ts = st and 63900000000000000 or 0 -- PS3 ticks
    t6[#t6 + 1] = be32(6) .. be32(0x60) .. be32(i - 1) .. be32(0) .. be32(i - 1) .. be32(st and 1 or 0) .. be32(7) .. be32(0)
      .. be64(ts) .. be64(ts) .. string.rep(PAD, 64)
  end
  return header .. th4 .. th6 .. table.concat(t4) .. table.concat(t6)
end
local dat = tropusr({ true, false, true })
local un = files.rpcs3_unlocked(dat)
check("rpcs3: unlocked ids read", un["0"] and un["002"] and not un["1"], "")
check("rpcs3: tick timestamp to unix", un["0"] and un["0"].unlocked_time == math.floor(63900000000000000 / 1000000) - 62135596800, un["0"] and un["0"].unlocked_time)
local locked, ln = files.rpcs3_lock_all(dat)
check("rpcs3: two trophies locked, size kept", ln == 2 and #locked == #dat, tostring(ln))
check("rpcs3: none unlocked after", next(files.rpcs3_unlocked(locked)) == nil)
check("rpcs3: other bytes untouched (unk4, unk6)", locked:find(be32(7), 1, true) and select(2, locked:gsub(PAD, "")) == 3 * 64)
local bad, bn, why = files.rpcs3_lock_all("not a tropusr file at all, just text, long enough to pass size")
check("rpcs3: a foreign file is refused", bad == nil and bn == 0 and why ~= nil, why)
check("ps3_trophies.parse_tropusr uses the real format", require("ps3_trophies").parse_tropusr(dat)["002"] ~= nil)

-- ---------- shadPS4 XML ----------
local xml = '<trophyconf><trophy id="0" hidden="no" ttype="B" unlockstate="true" timestamp="1790000000000"><name>A</name></trophy>'
  .. '<trophy id="1" ttype="S" unlockstate="false"><name>B</name></trophy><trophy id="2" ttype="G"><name>C</name></trophy></trophyconf>'
local su = files.shadps4_unlocked(xml)
check("shadps4: unlocked read, ms timestamp to seconds", su["0"] and su["000"] and su["0"].unlocked_time == 1790000000 and not su["1"])
local sx, sn = files.shadps4_lock_all(xml)
check("shadps4: one locked, timestamp removed", sn == 1 and not sx:find("timestamp=", 1, true) and not sx:find('unlockstate="true"', 1, true), sx)
check("shadps4: names untouched", sx:find("<name>A</name>", 1, true) and sx:find('<trophy id="2" ttype="G">', 1, true))

-- ---------- persisted log offsets ----------
observer._offsets_path = TMP .. "/log_offsets.json"
observer._reset_offsets()
local log = TMP .. "/game.log"
writef(log, "[RCHEEVOS] Awarded achievement 101\n")
check("log: first read detects", observer.scan_log_for_unlocks(log)["101"] ~= nil)
observer.check_unlocks(0) -- no-op guard
-- A scan alone does not save; check_unlocks and mark_logs_read do. Simulate a restart after a save:
local function restart() observer._reset_offsets() end
writef(log, "[RCHEEVOS] Awarded achievement 101\n[RCHEEVOS] Awarded achievement 102\n")
-- mark read (no shortcut entry: log_paths only finds known locations), so mark this log by hand:
observer.scan_log_for_unlocks(log)
do -- force a save through mark_logs_read's path
  local saved = observer.log_paths
  observer.log_paths = function() return { log } end
  observer.mark_logs_read(1, "x")
  observer.log_paths = saved
end
restart()
check("log: after a restart, old lines are not read again", next(observer.scan_log_for_unlocks(log)) == nil)
writef(log, readf(log) .. "[RCHEEVOS] Awarded achievement 103\n")
local fresh = observer.scan_log_for_unlocks(log)
check("log: new lines still detected", fresh["103"] ~= nil and fresh["101"] == nil)
writef(log, "[RCHEEVOS] Awarded achievement 104\n")
check("log: a rotated (shorter) log is read from the start", observer.scan_log_for_unlocks(log)["104"] ~= nil)

-- RetroArch 1.17+ (rcheevos client), the lines from the user's Metroid Fusion unlock (2026-10-06):
writef(log, "[INFO] [RCHEEVOS] You have 0 of 43 achievements unlocked\n"
  .. "[INFO] [RCHEEVOS] Awarding achievement 4615: Explosive Chamber\n"
  .. "[INFO] [RCHEEVOS] Captured screenshot for achievement 4615\n"
  .. "[INFO] [RCHEEVOS] Achievement 4615 awarded, new score: 7\n")
observer._reset_offsets()
local rc = observer.scan_log_for_unlocks(log)
local rc_n = 0
for _ in pairs(rc) do rc_n = rc_n + 1 end
check("log: rcheevos 'Awarding achievement N' detected, nothing else", rc["4615"] ~= nil and rc_n == 1)
writef(log, "[INFO] [RCHEEVOS] Achievement 4616 awarded, new score: 12\n")
check("log: rcheevos 'Achievement N awarded' detected", observer.scan_log_for_unlocks(log)["4616"] ~= nil)

-- RetroArch with log_to_file_timestamp: the newest retroarch__<stamp>.log of the folder.
do
  local fs = package.loaded["fs"]
  local saved_dir, saved_list = fs.is_directory, fs.list
  fs.is_directory = function(p) return p == "D:/RA/logs" end
  fs.list = function() return {
    { name = "retroarch__2026_10_06__23_46_44.log" }, { name = "retroarch__2026_10_06__23_51_59.log" },
    { name = "retroarch__2026_09_30__08_00_00.log" }, { name = "swanstation_test.log" }, { name = "retroarch.log" },
  } end
  check("retroarch: newest timestamped log picked", observer.newest_retroarch_log("D:/RA/logs") == "D:/RA/logs/retroarch__2026_10_06__23_51_59.log",
    observer.newest_retroarch_log("D:/RA/logs"))
  check("retroarch: missing folder gives nil", observer.newest_retroarch_log("D:/nope") == nil)
  fs.is_directory, fs.list = saved_dir, saved_list
end

-- ---------- reset flow ----------
local store = require("achievements_store")
store._path = TMP .. "/achievements.json"
store._reset()
local reset = require("achievements_reset")
reset.deps.now = function() return 1790000000 end
store.unlock(3135033888, "ACH_A", 1)

local src = reset.sources(3135033888, 2277560).sources
check("sources: no Steam API emulator source in the core (ADR-0063)", #src == 0, #src)
local r = reset.reset(3135033888, 2277560, { "local" }, "Wuchang")
check("reset: an unknown source id is ignored", r.ok and #r.sources == 0)
check("reset: plugin unlocks cleared", next((store.get_state(3135033888) or {}).unlocks or {}) == nil)

-- RetroAchievements is listed, never resettable.
store._reset()
local st = store.get_state(42) or {}
reset.deps.entry = function() return nil, "" end
local real_get = store.get_state
store.get_state = function(id) if id == 42 then return { schema = { ra_game_id = 99 }, unlocks = { a = {}, b = {} } } end return real_get(id) end
local ra = reset.sources(42, 0).sources
check("sources: RetroAchievements listed as not resettable, with its game page", #ra == 1 and ra[1].id == "retroachievements" and ra[1].resettable == false and ra[1].unlocked == 2 and ra[1].url == "https://retroachievements.org/game/99", ra[1] and ra[1].url)
r = reset.reset(42, 0, { "retroachievements" }, "x")
check("reset: a non-resettable source is skipped", #r.sources == 0)
store.get_state = real_get

print(string.format("\n%d passed, %d failed", pass, fail))
os.exit(fail == 0 and 0 or 1)
