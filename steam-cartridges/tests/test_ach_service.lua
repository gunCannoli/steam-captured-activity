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
local fresh_policy = require("fresh_policy")
fresh_policy._path = TMP .. "/sc_fresh_test_" .. os.time() .. ".json"
-- The freshness policy is state too: without resetting it, a case sees what an earlier case recorded.
local function wipe() os.remove(ACH_PATH); os.remove(STORE_PATH); os.remove(fresh_policy._path); store._reset(); store_steam._reset(); fresh_policy._reset() end
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
local function read_all(path) local f = io.open(path, "rb"); local c = f:read("*a"); f:close(); return c end -- closed: Windows cannot delete an open file
local raw_before = read_all(ACH_PATH)
ach.local_part(SC); ach.local_part(4000000009)
local raw_after = read_all(ACH_PATH)
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

print("EnsureFresh: remembered lookups and the paint (ADR-0060)")
local function ensure_ach(ctx)
  ctx = ctx or {}
  ctx.title = ctx.title or "x"
  ctx.route = ctx.route or { bucket = "web-scraping", via = "default" }
  return json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "achievements" }, context = ctx }))).parts.achievements
end
local entry_calls = 0
local function counting_entry() entry_calls = entry_calls + 1; return { exe = "C:/games/x.exe", launch_options = "" } end

wipe(); fresh({ entry = counting_entry }); entry_calls = 0
local a1 = ensure_ach()
local a2 = ensure_ach()
check("an unsupported lookup is remembered: the second request asks no source", a1.status == "unsupported" and a2.status == "unsupported" and entry_calls == 1, entry_calls)
ensure_ach({ force = true })
check("... force (Sync now, Review Fetch) asks again", entry_calls == 2, entry_calls)
check("... and freshness.json keeps the status", fresh_policy.last_status(SC, "achievements") == "unsupported")

wipe(); fresh({ rom_path = function() return "D:/roms/sonic.md" end, ra = function() calls.ra = (calls.ra or 0) + 1; return nil, "ra unreachable" end })
local e1 = ensure_ach()
local e2 = ensure_ach()
check("a failed lookup is remembered for 30 min: the second request asks no source", e1.status == "error" and e2.status == "error" and calls.ra == 1, calls.ra)
check("... and answers with the failure's message", e2.message == "ra unreachable", e2.message)
check("... remembered errors come due after 30 min",
  fresh_policy.remembered(SC, "achievements", os.time() * 1000 + 29 * 60000) ~= nil
    and fresh_policy.remembered(SC, "achievements", os.time() * 1000 + 31 * 60000) == nil)

wipe(); fresh({ rom_path = function() return "D:/roms/sonic.md" end })
local p0 = ensure_ach({ noNetwork = true })
check("noNetwork with nothing stored: pending and stale, no source asked", p0.status == "pending" and p0.stale == true and calls.ra == nil)
store.save_schema(77, SCHEMA); store.bind_schema(SC, 77)
fresh_policy.touch(SC, "achievements", os.time() * 1000, "ok")
local p1 = ensure_ach({ noNetwork = true })
check("noNetwork with a fresh stored part: that part, not stale", p1.status == "ok" and p1.data.schema.total == 2 and p1.stale == nil and calls.ra == nil)
fresh_policy.touch(SC, "achievements", os.time() * 1000 - 25 * 3600 * 1000, "ok")
local p2 = ensure_ach({ noNetwork = true })
check("noNetwork with a due stored part: that part, flagged stale, no source asked", p2.status == "ok" and p2.stale == true and calls.ra == nil)

fresh({ rom_path = function() return "D:/roms/sonic.md" end, ra = function() calls.ra = (calls.ra or 0) + 1; return nil, "ra unreachable" end })
local p3 = ensure_ach()
check("a failed refresh keeps the stored part", calls.ra == 1 and p3.status == "ok" and p3.data.schema.total == 2)

print("CheckUnlocks: a missing schema is resolved once per session (ADR-0060)")
wipe(); fresh({ rom_path = function() return "D:/roms/sonic.md" end, ra = function() calls.ra = (calls.ra or 0) + 1; return nil, "ra unreachable" end })
observer._reset_resolved()
observer.check_unlocks(SC, 0, "Sonic")
observer.check_unlocks(SC, 0, "Sonic")
observer.check_unlocks(SC, 0, "Sonic")
check("three polls ask the sources once", calls.ra == 1, calls.ra)
observer._reset_resolved()

print("RetroAchievements: a known game's unlocks are asked again on a page open (ADR-0060 amendment)")
local ra = require("retroachievements")
local registry = require("registry")
registry.deps.entries = function() return { { appid = SC, exe = "C:/emu/RetroArch/retroarch.exe", launch_options = "" } } end
local RA_SCHEMA = { ra_game_id = 77, title = "Game", total = 2, hardcore = true,
  achievements = { { id = "1", name = "a", points = 5, global_pct = 10 }, { id = "2", name = "b", points = 10, global_pct = 3 } } }
local saved_fetch, saved_creds, saved_hash = ra.fetch_game_data, ra.get_credentials, ra.compute_rom_md5
local ra_fetches, hashes = 0, 0
ra.get_credentials = function() return { username = "me", token = "t", api_key = "k" } end
ra.compute_rom_md5 = function() hashes = hashes + 1; return "md5" end

wipe(); fresh()
store.save_schema_and_sync(SC, "ra_77", RA_SCHEMA, { ["1"] = { unlocked_time = 100 } }, "retroachievements")
ra.fetch_game_data = function(gid)
  ra_fetches = ra_fetches + 1
  return RA_SCHEMA, { ["1"] = { unlocked_time = 999 }, ["2"] = { unlocked_time = 200 } }
end
local got = ra.get_or_fetch(SC, true)
check("a stored game asks its profile again by GameID, without hashing the ROM", ra_fetches == 1 and hashes == 0)
check("an unlock earned on another device is added", got.unlocks["2"] and got.unlocks["2"].unlocked_time == 200)
check("an unlock already known keeps its time", got.unlocks["1"].unlocked_time == 100)
check("... and is stored", store.get_state(SC).unlocks["2"] ~= nil and store.get_state(SC).source == "retroachievements")

ra.fetch_game_data = function() ra_fetches = ra_fetches + 1; return nil, "offline" end
got = ra.get_or_fetch(SC, true)
check("offline: the stored unlocks are answered", ra_fetches == 2 and got.unlocks["1"] ~= nil and got.unlocks["2"] ~= nil)

ra.fetch_game_data = function() return RA_SCHEMA, {} end
got = ra.get_or_fetch(SC, true)
check("a profile without an unlock never drops one known here (merge, not replace)", got.unlocks["1"] ~= nil and got.unlocks["2"] ~= nil)

wipe(); fresh()
store.save_schema(  "ra_77", RA_SCHEMA); store.bind_schema(SC, "ra_77")
local lp_ra = ach.local_part(SC)
check("an entry stored before its source was recorded counts as RetroAchievements (ra_ list)", lp_ra.source == "retroachievements")
local t_ra = os.time() * 1000
fresh_policy.touch(SC, "achievements", t_ra, "ok")
check("RetroAchievements unlocks come due after 30 min, not 24 h",
  not fresh_policy.is_stale(SC, "achievements", lp_ra, t_ra + 29 * 60000) and fresh_policy.is_stale(SC, "achievements", lp_ra, t_ra + 30 * 60000))

print("RetroAchievements: a hash whose set is a placeholder is remembered as a miss (2026-10-07)")
do
  local rc = require("ra_cache")
  local saved_rc_path, saved_resolve, saved_parse, saved_rom = rc._path, require("steam_paths").resolve, require("shortcuts").parse, ra.extract_rom_path
  rc._path = TMP .. "/sc_ra_cache_placeholder_" .. os.time() .. ".json"; rc._reset()
  require("steam_paths").resolve = function() return { shortcuts = "x" } end
  require("shortcuts").parse = function() return { { appid = SC, name = "Jungle Strike", exe = "C:/emu/RetroArch/retroarch.exe", launch_options = "" } } end
  ra.extract_rom_path = function() return "D:/roms/jungle.sfc" end
  ra.compute_rom_md5 = function() return "ff10" end
  local infos = 0
  rawset(logger, "info", function() infos = infos + 1 end)
  wipe(); fresh()

  rc.put_game("ff10", 969) -- what an earlier start stored: the hash's GameID
  ra_fetches = 0
  ra.fetch_game_data = function() ra_fetches = ra_fetches + 1; return { ra_game_id = 969, title = "Jungle Strike", total = 0, achievements = {} }, {} end
  local r1, e1 = ra.get_or_fetch(SC, true)
  check("placeholder set: unsupported, its set asked once, logged", r1 == nil and e1 == "unsupported rom hash" and ra_fetches == 1 and infos == 2, infos)
  local known, id = rc.game_for("ff10")
  check("... and the hash is stored as a miss", known == true and id == nil)

  infos = 0
  rc._reset() -- a Steam restart: read from disk
  local r2, e2 = ra.get_or_fetch(SC, true)
  check("next start: unsupported again, no request, no log line", r2 == nil and e2 == "unsupported rom hash" and ra_fetches == 1 and infos == 0, infos)

  rc.put_game("ff10", 969)
  ra.fetch_game_data = function() ra_fetches = ra_fetches + 1; return nil, "offline" end
  ra.get_or_fetch(SC, true)
  known, id = rc.game_for("ff10")
  check("a failed request is not stored as a miss", known == true and id == 969)

  rawset(logger, "info", nil)
  rc._path = saved_rc_path; rc._reset()
  require("steam_paths").resolve, require("shortcuts").parse, ra.extract_rom_path = saved_resolve, saved_parse, saved_rom
end

ra.fetch_game_data, ra.get_credentials, ra.compute_rom_md5 = saved_fetch, saved_creds, saved_hash
registry.deps.entries = nil

print("GetAllRecords")
wipe(); fresh()
store.save_schema(77, SCHEMA); store.bind_schema(SC, 77)
store_steam.set_mapping(SC, 2820820, "J", "manual")
local all = json.decode(record_rpc.GetAllRecords(json.encode({})))
check("GetAllRecords adds stored achievements (disk only)", all.records[tostring(SC)] and all.records[tostring(SC)].achievements and all.records[tostring(SC)].achievements.data.schema.total == 2)
local LONE, NOSCHEMA = 4000000077, 4000000078
store.save_schema(78, SCHEMA); store.bind_schema(LONE, 78)
store.bind_schema(NOSCHEMA, 999)
all = json.decode(record_rpc.GetAllRecords(json.encode({})))
local lone = all.records[tostring(LONE)]
check("GetAllRecords adds a shortcut with stored achievements and no metadata or mapping (ADR-0045)", lone and lone.achievements and lone.achievements.data.schema.total == 2 and lone.metadata == nil and lone.identity == nil)
check("GetAllRecords leaves out a stored shortcut with no schema", all.records[tostring(NOSCHEMA)] == nil)

print("K7")
local names = observer.get_possible_folder_names("WUCHANG: Fallen Feathers", "")
local has = false
for _, n in ipairs(names) do if n == "WUCHANG - Fallen Feathers" then has = true end end
check("colon becomes ' - ' with the spaces collapsed", has)
local em = observer.get_possible_folder_names("Game \xe2\x80\x94 Sequel", "")
local ok_em = false
for _, n in ipairs(em) do if n == "Game - Sequel" then ok_em = true end end
check("an em dash is replaced as a whole sequence, not byte by byte", ok_em, table.concat(em, " | "))

-- ---------- steam_schema (M10: the source that fetches; the store only stores) ----------
wipe()
local steam_schema = require("steam_schema")
local fetches = 0
local get_json = function() fetches = fetches + 1; return '{"achievementpercentages":{"achievements":[{"name":"A1","percent":12.5}]}}' end
local get_html = function() return "" end
local r1 = steam_schema.get_or_fetch(4000000001, 440, get_json, get_html)
check("steam_schema fetches a schema and the store keeps it", r1.schema ~= nil and r1.schema.total == 1 and store.get_schema(440) ~= nil and fetches == 1)
local r2 = steam_schema.get_or_fetch(4000000001, 440, get_json, get_html)
check("... the next call is served from the store, no request", r2.schema ~= nil and r2.schema.achievements[1].id == "A1" and fetches == 1)


-- ---------- store copies: sources epic and xbox (ADR-0056) ----------
print("store copies")
local EPIC_COPY = { kind = "epic", namespace = "d8a39ea2f35e49b58f18c2b96aec276a", productId = "18f6", title = "Jotunnslayer", via = "manifest" }
wipe()
fresh({ store_fetch = function(a, copy, native) calls.store = (calls.store or 0) + 1; calls.store_native = native; return { schema = SCHEMA, unlocks = { B = { unlocked_time = 9 } } } end })
r = ach.ensure(SC, { native = 2820820, store = EPIC_COPY })
check("an Epic copy answers from its store first, even with a Steam match", r.status == "ok" and r.source == "epic" and calls.store == 1 and (calls.steam or 0) == 0 and calls.store_native == 2820820)
fresh({ store_fetch = function() calls.store = (calls.store or 0) + 1; return { schema = SCHEMA, unlocks = {} } end })
r = ach.ensure(SC, { native = 2820820, store = EPIC_COPY, allowEpic = false })
check("with Epic switched off the copy falls back to Steam's list", r.source == "steam" and (calls.store or 0) == 0)
fresh({ store_fetch = function() return nil, "not signed in" end })
r = ach.ensure(SC, { native = 2820820, store = { kind = "xbox", titleId = "1" } })
check("a store that does not answer (signed out) falls through to the next source", r.status == "ok" and r.source == "steam")
fresh({ store_fetch = function() calls.store = 1; return { schema = SCHEMA, unlocks = {} } end })
r = ach.ensure(SC, { native = 0, store = { kind = "xbox", titleId = "1" }, allowXbox = false })
check("an Xbox copy with Xbox off and no other source is unsupported, silently", r.status == "unsupported" and calls.store == nil)

-- store_achievements: the real source over fake store APIs.
wipe()
local sa = require("store_achievements")
local remembered = {}
local epic_unlocks = { ACH_FRIENDLY_JOTUNN = 1790963093 }
local epic_err = nil
local steam_fetches = 0
sa.deps.epic = {
  achievement_schema = function() return { product_id = "18f6", achievements = { { id = "ACH_A_TROPHY_SPECIAL", name = "A-Trophy", description = "", icon = "u", global_pct = 70 }, { id = "ACH_FRIENDLY_JOTUNN", name = "Friendly", description = "", icon = "f", global_pct = 5 } } } end,
  player_unlocks = function() if epic_err then return nil, epic_err end return epic_unlocks end,
}
sa.deps.epic_local = { account_id = function() return "acc" end }
sa.deps.copies = { remember = function(k, v) remembered[k] = v end }
sa.deps.steam_fetch = function() steam_fetches = steam_fetches + 1; return { native_appid = 2820820, total = 3, achievements = { { id = "ACH_A_TROPHY_SPECIAL", name = "Steam A" }, { id = "ACH_FRIENDLY_JOTUNN", name = "Steam F" }, { id = "ACH_EXTRA", name = "x" } } } end
local res1 = sa.fetch(SC, EPIC_COPY, 0)
check("an Epic copy with no Steam match gets Epic's list and the profile's unlocks", res1 and res1.schema.source == "epic" and res1.schema.total == 2 and res1.unlocks.ACH_FRIENDLY_JOTUNN.unlocked_time == 1790963093 and remembered["epic:account"].private == false)
local stored = store.get_state(SC)
check("... persisted: the list under epic_<namespace>, the unlocks, the source", stored.schema and stored.schema.source == "epic" and stored.unlocks.ACH_FRIENDLY_JOTUNN ~= nil and stored.source == "epic" and store.get_schema("epic_" .. EPIC_COPY.namespace) ~= nil)
local lp = ach.local_part(SC)
check("... local_part carries the source (a short freshness for a synced store)", lp.source == "epic")
fresh_policy.touch(SC, "achievements", 0, "ok")
local at16 = 16 * 60 * 1000
check("... fresh_policy: a synced part is stale after 15 min, a local one is not (24 h)",
  fresh_policy.is_stale(SC, "achievements", { status = "ok", source = "epic" }, at16)
    and not fresh_policy.is_stale(SC, "achievements", { status = "ok", source = "steam" }, at16))
local res2 = sa.fetch(SC, EPIC_COPY, 2820820)
check("with a Steam match whose list covers every Epic id, Steam's list is kept with Epic's unlocks", res2.schema.native_appid == 2820820 and res2.schema.total == 3 and res2.unlocks.ACH_FRIENDLY_JOTUNN ~= nil and steam_fetches == 1)
sa.deps.steam_fetch = function() return { native_appid = 999, total = 1, achievements = { { id = "OTHER" } } } end
store._reset(); os.remove(ACH_PATH)
local res3 = sa.fetch(SC, EPIC_COPY, 999)
check("a Steam list that misses an Epic id is not used: Epic's own list", res3.schema.source == "epic" and res3.schema.total == 2)
epic_err = "private"
local res4 = sa.fetch(SC, EPIC_COPY, 0)
check("a private profile keeps the last unlocks known and is remembered", res4 and res4.unlocks.ACH_FRIENDLY_JOTUNN ~= nil and remembered["epic:account"].private == true)
epic_err = "HTTP 500"
check("a failed request is an error (the record keeps what it has)", sa.fetch(SC, EPIC_COPY, 0) == nil)
epic_err = nil
sa.deps.live = { achievements = function() return { achievements = { { id = "2", name = "First Unlock", description = "", icon = "", global_pct = 40 } }, unlocks = { ["2"] = 1790963661 } } end }
local rx = sa.fetch(SC, { kind = "xbox", titleId = "2003863742", title = "Jigsaw" }, 0)
check("an Xbox copy gets Xbox Live's list and unlocks, stored under xbox_<title id>", rx and rx.schema.source == "xbox" and rx.unlocks["2"].unlocked_time == 1790963661 and store.get_state(SC).source == "xbox" and store.get_schema("xbox_2003863742") ~= nil)
sa.deps.live = { achievements = function() return nil, "not signed in" end }
check("signed out of Xbox: no answer (ach_service asks the next source)", sa.fetch(SC, { kind = "xbox", titleId = "1" }, 0) == nil)
sa.deps.epic, sa.deps.epic_local, sa.deps.copies, sa.deps.steam_fetch, sa.deps.live = nil, nil, nil, nil, nil
wipe()
os.remove(ACH_PATH); os.remove(STORE_PATH)
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
