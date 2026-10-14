-- No backend file reads a global it never declared.
--
--   lua tests\test_globals.lua
--
-- Millennium's modules (fs, http, utils, millennium, logger, json, ...) are preloaded, not globals: they must be
-- required. A file that reads `fs` without `local fs = require("fs")` raises "attempt to index global 'fs'", and in
-- Millennium 3.5.0's Lua host a type error raised from an operator (an index or arithmetic on the wrong type) kills the
-- whole backend even inside pcall (only error() and a call of nil are caught). That is how manual_cover_store.lua
-- took the backend down on every manual (2026-10-01, git show 6ece444:docs/plans/steam-cartridges-community-crash-and-speed-investigation.md).
--
-- The check reads each file's LuaJIT bytecode without running it: every GGET (a global read) must name a standard Lua
-- global. Writes (the RPC functions main.lua exports) are GSET and are not checked.

local here = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or ".")
local backend = here .. "/../backend"

local ok_util, jutil = pcall(require, "jit.util")
if not ok_util then
  print("  SKIP  needs LuaJIT (jit.util): " .. tostring(jutil))
  print("\nALL PASS")
  os.exit(0)
end
local bit = require("bit")

local STANDARD = {}
for name in ([[_G _VERSION assert collectgarbage coroutine debug dofile error gcinfo getfenv getmetatable io ipairs jit
  bit load loadfile loadstring math module newproxy next os package pairs pcall print rawequal rawget rawlen rawset
  require select setfenv setmetatable string table tonumber tostring type unpack xpcall]]):gmatch("%S+") do
  STANDARD[name] = true
end

--- GGET's opcode, read from a probe instead of hardcoded (it differs between LuaJIT versions).
local function gget_op()
  local probe = loadstring("return __globals_probe__")
  for pc = 1, 64 do
    local ins = jutil.funcbc(probe, pc)
    if not ins then break end
    local d = bit.rshift(ins, 16)
    local ok, k = pcall(jutil.funck, probe, -d - 1)
    if ok and k == "__globals_probe__" then return bit.band(ins, 0xff) end
  end
  error("could not find GGET in the probe's bytecode")
end
local GGET = gget_op()

--- Every global read in `fn` and the functions it defines: { name = line }.
local function global_reads(fn, out)
  local info = jutil.funcinfo(fn)
  for pc = 1, info.bytecodes or 1e6 do
    local ins = jutil.funcbc(fn, pc)
    if not ins then break end
    if bit.band(ins, 0xff) == GGET then
      local name = jutil.funck(fn, -bit.rshift(ins, 16) - 1)
      if type(name) == "string" and out[name] == nil then
        out[name] = (jutil.funcinfo(fn, pc) or {}).currentline or info.linedefined
      end
    end
  end
  for i = 1, info.gcconsts or 0 do
    local k = jutil.funck(fn, -i)
    if type(k) == "proto" then global_reads(k, out) end
  end
  return out
end

local failures, files = 0, 0
local function check(label, cond, detail)
  print((cond and "  PASS  " or "  FAIL  ") .. label .. (detail and ("  -> " .. detail) or ""))
  if not cond then failures = failures + 1 end
end

local list = io.popen('dir /b "' .. backend:gsub("/", "\\") .. '\\*.lua" 2>nul') or io.popen('ls "' .. backend .. '"/*.lua 2>/dev/null')
for line in list:lines() do
  local file = line:match("([^/\\]+%.lua)$")
  if file then
    files = files + 1
    local chunk, err = loadfile(backend .. "/" .. file)
    if not chunk then
      check(file .. " compiles", false, err)
    else
      local bad = {}
      for name, at in pairs(global_reads(chunk, {})) do
        if not STANDARD[name] and not name:match("^MILLENNIUM_") then bad[#bad + 1] = name .. " (line " .. tostring(at) .. ")" end
      end
      table.sort(bad)
      if #bad > 0 then check(file .. " reads only declared globals", false, table.concat(bad, ", ")) end
    end
  end
end
list:close()
check("scanned the backend's files", files > 10, files .. " files")
check("every backend file reads only standard globals (Millennium modules are required)", failures == 0)

print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
