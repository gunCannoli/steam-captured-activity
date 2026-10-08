--- steam-cartridges-local - reading save files as UTF-8 text.
---
--- Emulators write UTF-8, UTF-8 with a BOM, UTF-16LE with or without a BOM (UniverseLAN writes it without one: the
--- NUL bytes give it away) and, rarely, UTF-16BE. Every character is kept: UTF-16 is transcoded to UTF-8, surrogate
--- pairs included.

local bit = require("bit")

local M = {}

local function utf8_char(cp)
  if cp < 0x80 then return string.char(cp) end
  if cp < 0x800 then
    return string.char(0xC0 + bit.rshift(cp, 6), 0x80 + bit.band(cp, 0x3F))
  end
  if cp < 0x10000 then
    return string.char(0xE0 + bit.rshift(cp, 12), 0x80 + bit.band(bit.rshift(cp, 6), 0x3F), 0x80 + bit.band(cp, 0x3F))
  end
  return string.char(0xF0 + bit.rshift(cp, 18), 0x80 + bit.band(bit.rshift(cp, 12), 0x3F),
    0x80 + bit.band(bit.rshift(cp, 6), 0x3F), 0x80 + bit.band(cp, 0x3F))
end

local function from_utf16(bytes, start, little)
  local out, i, n = {}, start, #bytes
  while i + 1 <= n do
    local a, b = bytes:byte(i, i + 1)
    local u = little and (a + b * 256) or (a * 256 + b)
    i = i + 2
    if u >= 0xD800 and u <= 0xDBFF and i + 1 <= n then
      local c, d = bytes:byte(i, i + 1)
      local lo = little and (c + d * 256) or (c * 256 + d)
      if lo >= 0xDC00 and lo <= 0xDFFF then
        u = 0x10000 + (u - 0xD800) * 0x400 + (lo - 0xDC00)
        i = i + 2
      end
    end
    out[#out + 1] = utf8_char(u)
  end
  return table.concat(out)
end

--- Bytes of a file -> UTF-8 text.
function M.decode(bytes)
  if type(bytes) ~= "string" or #bytes == 0 then return "" end
  local b1, b2, b3 = bytes:byte(1, 3)
  if b1 == 0xFF and b2 == 0xFE then return from_utf16(bytes, 3, true) end
  if b1 == 0xFE and b2 == 0xFF then return from_utf16(bytes, 3, false) end
  if b1 == 0xEF and b2 == 0xBB and b3 == 0xBF then return bytes:sub(4) end
  if bytes:sub(1, 4096):find("\0", 1, true) then return from_utf16(bytes, 1, true) end
  return bytes
end

--- UTF-8 text -> UTF-16LE bytes (no BOM).
local function to_utf16le(s)
  local out, i, n = {}, 1, #s
  local function unit(u) out[#out + 1] = string.char(bit.band(u, 0xFF), bit.rshift(u, 8)) end
  while i <= n do
    local c = s:byte(i)
    local cp, len
    if c < 0x80 then cp, len = c, 1
    elseif c < 0xE0 then cp, len = bit.band(c, 0x1F), 2
    elseif c < 0xF0 then cp, len = bit.band(c, 0x0F), 3
    else cp, len = bit.band(c, 0x07), 4 end
    for k = 1, len - 1 do cp = cp * 64 + bit.band(s:byte(i + k) or 0x80, 0x3F) end
    i = i + len
    if cp >= 0x10000 then
      cp = cp - 0x10000
      unit(0xD800 + bit.rshift(cp, 10))
      unit(0xDC00 + bit.band(cp, 0x3FF))
    else
      unit(cp)
    end
  end
  return table.concat(out)
end

--- UTF-8 text back in the encoding `original` (a file's bytes) was in: UTF-16LE (with its BOM if it had one),
--- UTF-8 with a BOM, or plain.
function M.encode_like(original, utf8)
  if type(original) ~= "string" then return utf8 end
  local b1, b2, b3 = original:byte(1, 3)
  if b1 == 0xFF and b2 == 0xFE then return string.char(0xFF, 0xFE) .. to_utf16le(utf8) end
  if b1 == 0xEF and b2 == 0xBB and b3 == 0xBF then return string.char(0xEF, 0xBB, 0xBF) .. utf8 end
  if not (b1 == 0xFE and b2 == 0xFF) and original:sub(1, 4096):find(string.char(0), 1, true) then return to_utf16le(utf8) end
  return utf8
end

--- Raw bytes of a file, or nil.
function M.read_bytes(path)
  if type(path) ~= "string" or #path == 0 then return nil end
  local f = io.open(path, "rb")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

--- A file as UTF-8 text, or nil.
function M.read(path)
  local data = M.read_bytes(path)
  if not data then return nil end
  return M.decode(data)
end

function M.exists(path)
  if type(path) ~= "string" or #path == 0 then return false end
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

return M
