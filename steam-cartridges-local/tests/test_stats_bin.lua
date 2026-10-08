package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
require("harness")
local T = require("check")
local sb = require("stats_bin")

print("=== stats_bin ===")
T.check("crc32 check value of 123456789 is 0xCBF43926", sb.crc32("123456789") == 0xCBF43926, string.format("%08x", sb.crc32("123456789")))

local function le32(n)
  if n < 0 then n = n + 0x100000000 end
  return string.char(n % 256, math.floor(n / 256) % 256, math.floor(n / 65536) % 256, math.floor(n / 16777216) % 256)
end
local function record(id, time, achieved)
  return le32(sb.crc32(id)) .. le32(0) .. le32(time) .. le32(0) .. le32(0) .. le32(achieved)
end
local bin = le32(2) .. record("ACH_A", 1700000000, 1) .. record("ACH_B", 0, 0)
T.check("a two-record file is 52 bytes", #bin == 52, #bin)
local u = sb.parse(bin, { "ACH_A", "ACH_B" })
T.check("the achieved record is read with its time", u.ACH_A and u.ACH_A.unlocked_time == 1700000000)
T.check("the unachieved record is not", u.ACH_B == nil)
T.check("a wrong length reads nothing", next(sb.parse(bin .. "x", { "ACH_A" })) == nil)
T.check("without ids nothing can be named", next(sb.parse(bin, {})) == nil)
T.finish("stats_bin")
