package.path = package.path .. ";./backend/?.lua;./backend/_lib/?.lua;./tests/?.lua"
require("harness")
local T = require("check")
local text = require("text")

print("=== text ===")
-- "ÉTÉ" in UTF-16LE with a BOM.
local le_bom = string.char(0xFF, 0xFE, 0xC9, 0x00, 0x54, 0x00, 0xC9, 0x00)
T.check("UTF-16LE with BOM keeps non-ASCII (ÉTÉ)", text.decode(le_bom) == string.char(0xC3, 0x89, 0x54, 0xC3, 0x89), text.decode(le_bom))
local le_nobom = ("[A]\n"):gsub(".", function(c) return c .. "\0" end)
T.check("UTF-16LE without BOM is detected by its NUL bytes", text.decode(le_nobom) == "[A]\n")
local pair = string.char(0xFF, 0xFE, 0x3C, 0xD8, 0xC6, 0xDF) -- U+1F3C6
T.check("a surrogate pair becomes 4 UTF-8 bytes", text.decode(pair) == string.char(0xF0, 0x9F, 0x8F, 0x86))
T.check("UTF-8 BOM is stripped", text.decode(string.char(0xEF, 0xBB, 0xBF) .. "x=1") == "x=1")
T.check("plain UTF-8 is unchanged", text.decode("a=1\r\n") == "a=1\r\n")
T.check("encode_like round-trips UTF-16LE with BOM", text.decode(text.encode_like(le_bom, "ÉTÉ")) == "ÉTÉ"
  and text.encode_like(le_bom, "x"):sub(1, 2) == string.char(0xFF, 0xFE))
T.check("encode_like keeps plain UTF-8 plain", text.encode_like("a=1", "b=2") == "b=2")
T.finish("text")
