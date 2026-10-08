--- steam-cartridges-local - SmartSteamEmu stats.bin (layout from PSerban93/Achievements parseStatsBin.js, MIT).
---
--- int32 count, then `count` records of 24 bytes, little-endian:
---   0-3  CRC32 of the achievement's API name     8-11  unlock time     20-23  achieved (0 / 1; > 1 = a stat)
--- Names are not in the file, so the schema's ids are needed to read it. Read only: never reset.

local bit = require("bit")

local M = {}

local CRC_TABLE = nil
local function crc_table()
  if CRC_TABLE then return CRC_TABLE end
  CRC_TABLE = {}
  for i = 0, 255 do
    local c = i
    for _ = 1, 8 do
      if bit.band(c, 1) == 1 then c = bit.bxor(bit.rshift(c, 1), 0xEDB88320) else c = bit.rshift(c, 1) end
    end
    CRC_TABLE[i] = c
  end
  return CRC_TABLE
end

--- IEEE CRC32 of a string, as an unsigned number.
function M.crc32(s)
  local t = crc_table()
  local c = 0xFFFFFFFF
  for i = 1, #s do
    c = bit.bxor(t[bit.band(bit.bxor(c, s:byte(i)), 0xFF)], bit.rshift(c, 8))
  end
  c = bit.bnot(c)
  if c < 0 then c = c + 0x100000000 end
  return c
end

local function u32(data, pos)
  local a, b, c, d = data:byte(pos, pos + 3)
  if not d then return nil end
  return a + b * 0x100 + c * 0x10000 + d * 0x1000000
end

local function i32(data, pos)
  local n = u32(data, pos)
  if n and n >= 0x80000000 then n = n - 0x100000000 end
  return n
end

--- { [id] = { unlocked_time } } for the achieved records whose CRC matches one of `ids`.
function M.parse(bytes, ids)
  local out = {}
  if type(bytes) ~= "string" or #bytes < 4 or type(ids) ~= "table" then return out end
  local count = i32(bytes, 1) or -1
  if count < 0 or #bytes ~= 4 + 24 * count then return out end
  local by_crc = {}
  for _, id in ipairs(ids) do
    if type(id) == "string" and #id > 0 then by_crc[M.crc32(id)] = id end
  end
  for r = 0, count - 1 do
    local off = 5 + r * 24
    local id = by_crc[u32(bytes, off)]
    if id and i32(bytes, off + 20) == 1 then
      local t = i32(bytes, off + 8) or 0
      out[id] = { unlocked_time = t > 0 and t or 0 }
    end
  end
  return out
end

return M
