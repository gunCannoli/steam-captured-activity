-- Achievement resolution (ach_service.lua) backend tests (migration plan M6a).
-- Hermetic: no network, no Steam install.
--
--   lua tests/test_ach_service.lua        (any Lua 5.1-5.5; lupa works too)
--
-- Same stubs as test_identity.lua: hand-shaped fixtures, injected deps,
-- the real `http` module stubbed to throw so a test can never go online.

local here = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."):gsub("\\", "/")
package.path = here .. "/../backend/?.lua;" .. package.path

-- ---------- stubs ----------
local WARNS = 0
local logger = setmetatable({}, { __index = function(_, k) return function() if k == "warn" or k == "error" then WARNS = WARNS + 1 end end end })
package.loaded["logger"] = logger
local TMP = (os.getenv("TEMP") or os.getenv("TMPDIR") or "/tmp"):gsub("\\", "/")
package.loaded["millennium"] = { steam_path = function() return TMP end, ready = function() end }
package.loaded["fs"] = {
  is_directory = function() return true end,
  create_directories = function() return true end,
  join = function(...) return table.concat({ ... }, "/") end,
  is_file = function(p) local f = io.open(p, "rb"); if f then f:close() return true end return false end,
}
package.loaded["utils"] = {
  read_file = function(p) local f = io.open(p, "rb"); if not f then return nil, "nf" end local c = f:read("*a"); f:close(); return c end,
  write_file = function(p, c) local f, e = io.open(p, "wb"); if not f then return false, e end f:write(c); f:close(); return true end,
  base64_encode = function(s) return s end,
}
package.loaded["http"] = { get = function() error("network in test") end }

-- Full JSON codec (the shared harness decoder only handles flat payloads).
local json = {}
local function esc(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    local m = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
    return m[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end
function json.encode(v)
  local t = type(v)
  if t == "table" then
    if next(v) == nil then return "{}" end
    if #v > 0 then
      local p = {}
      for _, x in ipairs(v) do p[#p + 1] = json.encode(x) end
      return "[" .. table.concat(p, ",") .. "]"
    end
    local p = {}
    for k, x in pairs(v) do p[#p + 1] = esc(tostring(k)) .. ":" .. json.encode(x) end
    return "{" .. table.concat(p, ",") .. "}"
  elseif t == "string" then return esc(v)
  elseif t == "number" then return string.format("%.14g", v)
  elseif t == "boolean" then return tostring(v) end
  return "null"
end
function json.decode(s)
  local i = 1
  local function ws() i = s:find("%S", i) or #s + 1 end
  local value
  local function str()
    local out = {}
    i = i + 1
    while true do
      local c = s:sub(i, i)
      if c == '"' then i = i + 1 break end
      if c == "\\" then
        local n = s:sub(i + 1, i + 1)
        if n == "u" then
          local cp = tonumber(s:sub(i + 2, i + 5), 16)
          out[#out + 1] = utf8.char(cp); i = i + 6
        else
          out[#out + 1] = ({ n = "\n", r = "\r", t = "\t", b = "\b", f = "\f" })[n] or n; i = i + 2
        end
      else out[#out + 1] = c; i = i + 1 end
    end
    return table.concat(out)
  end
  function value()
    ws()
    local c = s:sub(i, i)
    if c == "{" then
      local o = {}; i = i + 1; ws()
      if s:sub(i, i) == "}" then i = i + 1 return o end
      while true do
        ws(); local k = str(); ws(); i = i + 1 -- ':'
        o[k] = value(); ws()
        local d = s:sub(i, i); i = i + 1
        if d == "}" then return o end
      end
    elseif c == "[" then
      local a = {}; i = i + 1; ws()
      if s:sub(i, i) == "]" then i = i + 1 return a end
      while true do
        a[#a + 1] = value(); ws()
        local d = s:sub(i, i); i = i + 1
        if d == "]" then return a end
      end
    elseif c == '"' then return str()
    elseif s:sub(i, i + 3) == "true" then i = i + 4 return true
    elseif s:sub(i, i + 4) == "false" then i = i + 5 return false
    elseif s:sub(i, i + 3) == "null" then i = i + 4 return nil end
    local num = s:match("^-?%d+%.?%d*[eE]?[+-]?%d*", i)
    i = i + #num
    return tonumber(num)
  end
  return value()
end
package.loaded["json"] = json

-- steam_paths / shortcuts stubs for resolve_identity's emulator guard.
local SHORTCUTS = {}
package.loaded["steam_paths"] = { resolve = function() return { shortcuts = "unused" } end }
package.loaded["shortcuts"] = {
  parse = function() return SHORTCUTS end,
  by_appid = function(entries) local ix = {} for _, e in ipairs(entries) do ix[e.appid] = e end return ix end,
}
package.loaded["rpc"] = { method = function(_, f)
  return function(payload)
    local ok, res = pcall(f, json.decode(payload))
    if not ok then return json.encode({ error = tostring(res) }) end
    if res == nil then return "null" end
    return json.encode(res)
  end
end }

-- ---------- helpers ----------
local failures = 0
local function check(label, cond, detail)
  print((cond and "  PASS  " or "  FAIL  ") .. label .. (detail and ("  -> " .. tostring(detail)) or ""))
  if not cond then failures = failures + 1 end
end

package.loaded["cjson"] = { array_mt = { __jsontype = "array" } }

local store = require("achievements_store")
local ach = require("ach_service")
local store_steam = require("steam_store_store")
local record_rpc = require("record_rpc")
local observer = require("achievements_observer")

local STORE_PATH = TMP .. "/sc_ach_store_test_" .. os.time() .. ".json"
local ACH_PATH = TMP .. "/sc_ach_test_" .. os.time() .. ".json"
store._path = ACH_PATH
store_steam._path = STORE_PATH
local function wipe() os.remove(ACH_PATH); os.remove(STORE_PATH); store._reset(); store_steam._reset() end
wipe()

local SC = 4263274102
local SCHEMA = { total = 2, achievements = { { id = "A", name = "a" }, { id = "B", name = "b" } } }
local calls = {}
local function reset_calls() for k in pairs(calls) do calls[k] = nil end end
local function fresh(over)
  reset_calls()
  ach.deps.now = function() return 1000 end
  ach.deps.entry = function() return { exe = "C:/games/x.exe", launch_options = "" } end
  ach.deps.ps3_dir, ach.deps.ps4_dir, ach.deps.rom_path = function() return nil end, function() return nil end, function() return nil end
  ach.deps.steam = function(a, n) calls.steam = (calls.steam or 0) + 1; return { schema = SCHEMA, unlocks = { A = { unlocked_time = 5 } } } end
  ach.deps.ps3 = function() calls.ps3 = (calls.ps3 or 0) + 1; return { schema = SCHEMA, unlocks = {} } end
  ach.deps.ps4 = function() calls.ps4 = (calls.ps4 or 0) + 1; return { schema = SCHEMA, unlocks = {} } end
  ach.deps.ra = function(a, h) calls.ra = (calls.ra or 0) + 1; calls.ra_hardcore = h; return { schema = SCHEMA, unlocks = {} } end
  for k, v in pairs(over or {}) do ach.deps[k] = v end
end

print("supports")
fresh(); WARNS = 0
local r = ach.ensure(SC, { native = 0, hardcore = true, title = "AM2R" })
check("PC game without a ROM path is unsupported and silent", r.status == "unsupported" and calls.ra == nil and calls.ps3 == nil and calls.ps4 == nil and calls.steam == nil and WARNS == 0)

fresh()
r = ach.ensure(SC, { native = 2277560, hardcore = true })
check("native schema wins", r.status == "ok" and r.source == "steam" and r.data.schema.total == 2 and r.data.unlocks.A.unlocked_time == 5 and (calls.ra or 0) == 0)

fresh({ ps3_dir = function() return "C:/rpcs3/trophy/NPWR1" end })
r = ach.ensure(SC, { native = 0 })
check("rpcs3 trophy dir selects rpcs3", r.status == "ok" and r.source == "rpcs3" and calls.ps3 == 1 and (calls.ps4 or 0) == 0)

fresh({ ps4_dir = function() return "C:/shadps4/trophy/x" end })
r = ach.ensure(SC, { native = 0 })
check("shadps4 trophy dir selects shadps4", r.status == "ok" and r.source == "shadps4" and calls.ps4 == 1)

fresh({ rom_path = function() return "D:/roms/sonic.md" end })
r = ach.ensure(SC, { native = 0, hardcore = false })
check("ROM path selects retroachievements with hardcore flag", r.status == "ok" and r.source == "retroachievements" and calls.ra == 1 and calls.ra_hardcore == false)

print("failures")
fresh({ rom_path = function() return "D:/roms/sonic.md" end, ps3_dir = function() return "dir" end,
        ps3 = function() calls.ps3 = 1; return nil, "no trophies" end })
r = ach.ensure(SC, { native = 0 })
check("failing source falls through to the next", r.status == "ok" and r.source == "retroachievements" and calls.ps3 == 1)

fresh({ rom_path = function() return "D:/roms/sonic.md" end,
        steam = function() return { schema = nil, unlocks = {}, error = "steam down" } end,
        ra = function() return nil, "ra unreachable" end })
r = ach.ensure(SC, { native = 5 })
check("all supporting sources failing is error", r.status == "error" and r.message == "ra unreachable", r.message)

print("local part")
fresh(); wipe()
check("local_part is nil when nothing is stored", ach.local_part(SC) == nil)
store.save_schema(77, SCHEMA)
store.bind_schema(SC, 77)
local lp = ach.local_part(SC)
check("local_part reads the stored schema without a source call", lp and lp.status == "ok" and lp.data.schema.total == 2 and calls.steam == nil and calls.ra == nil)
local raw_before = io.open(ACH_PATH, "rb"):read("*a")
ach.local_part(SC); ach.local_part(4000000009)
local raw_after = io.open(ACH_PATH, "rb"):read("*a")
check("local_part is disk only (never writes, even for an unknown shortcut)", raw_before == raw_after)

print("CheckUnlocks")
wipe(); fresh()
local out = observer.check_unlocks(SC, 0, "AM2R")
check("CheckUnlocks returns a list when nothing is new (K1: array metatable)", type(out.new_unlocks) == "table" and #out.new_unlocks == 0 and getmetatable(out.new_unlocks) == package.loaded["cjson"].array_mt)
local viaRpc = json.decode(record_rpc.CheckUnlocks(json.encode({ appid = SC, native = 0, title = "AM2R" })))
check("CheckUnlocks RPC answers { new_unlocks }", viaRpc.new_unlocks ~= nil and viaRpc.error == nil)
check("CheckUnlocks rejects a native appid", json.decode(record_rpc.CheckUnlocks(json.encode({ appid = 435150 }))).error == "not a shortcut")

print("EnsureFresh")
wipe(); fresh()
store_steam.set_mapping(SC, 2820820, "Jotunnslayer", "manual")
local res = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "achievements" }, context = { route = { bucket = "steam-store", via = "default" }, title = "x", hardcore = true } })))
check("EnsureFresh achievements uses the saved identity", res.parts.achievements and res.parts.achievements.source == "steam" and calls.steam == 1)
wipe(); fresh()
res = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "achievements" }, context = { title = "x" } })))
check("EnsureFresh achievements for a PC game with no source is unsupported", res.parts.achievements.status == "unsupported" and WARNS == 0)

wipe(); fresh()
store_steam.set_mapping(SC, 2820820, "Jotunnslayer", "manual")
res = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "achievements" }, context = { route = { bucket = "web-scraping", via = "default" }, title = "x" } })))
check("EnsureFresh ignores a saved mapping on a web-scraping route", res.parts.achievements.status == "unsupported" and calls.steam == nil)

print("GetAllRecords")
wipe(); fresh()
store.save_schema(77, SCHEMA); store.bind_schema(SC, 77)
store_steam.set_mapping(SC, 2820820, "J", "manual")
local all = json.decode(record_rpc.GetAllRecords(json.encode({})))
check("GetAllRecords adds stored achievements (disk only)", all.records[tostring(SC)] and all.records[tostring(SC)].achievements and all.records[tostring(SC)].achievements.data.schema.total == 2)

print("K7")
local names = observer.get_possible_folder_names("WUCHANG: Fallen Feathers", "")
local has = false
for _, n in ipairs(names) do if n == "WUCHANG - Fallen Feathers" then has = true end end
check("colon becomes ' - ' with the spaces collapsed", has)
local em = observer.get_possible_folder_names("Game \xe2\x80\x94 Sequel", "")
local ok_em = false
for _, n in ipairs(em) do if n == "Game - Sequel" then ok_em = true end end
check("an em dash is replaced as a whole sequence, not byte by byte", ok_em, table.concat(em, " | "))

os.remove(ACH_PATH); os.remove(STORE_PATH)
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
