-- Freshness, registry and net (fresh_policy, registry, net, metadata refresh) backend tests (migration plan M7a).
-- Hermetic: no network, no Steam install.
--
--   lua tests/test_freshness.lua        (any Lua 5.1-5.5; lupa works too)
--
-- Same stubs as test_identity.lua: hand-shaped fixtures, injected deps,
-- the real `http` module stubbed to throw so a test can never go online.

local here = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."):gsub("\\", "/")
package.path = here .. "/../backend/?.lua;" .. package.path

-- ---------- stubs ----------
local logger = setmetatable({}, { __index = function() return function() end end })
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

local metadata_db = require("web_metadata_db")
local store = require("steam_store_store")
local identity = require("resolve_identity")
local metadata = require("metadata_service")
local record_rpc = require("record_rpc")

-- millennium.steam_path() is stubbed to always return TMP, so data_dir.path()
-- is deterministic and process-wide: <TMP>/millennium/config/steam-cartridges.
-- web_metadata_db has no _path test hook (unlike steam_store_store); wipe by
-- deleting its file on disk and reloading the module fresh so its in-memory
-- cache (module-local, not exposed) is gone too.
local data_dir = require("data_dir")
local META_PATH = data_dir.file("library_metadata.json")
local STORE_PATH = TMP .. "/sc_metadata_store_test_" .. os.time() .. ".json"
store._path = STORE_PATH

local function wipe()
  os.remove(META_PATH)
  os.remove(STORE_PATH)
  package.loaded["web_metadata_db"] = nil
  metadata_db = require("web_metadata_db")
  package.loaded["metadata_service"] = nil
  metadata = require("metadata_service")
  package.loaded["record_rpc"] = nil
  record_rpc = require("record_rpc")
  store._reset()
end
wipe()

local fp = require("fresh_policy")
local FP_PATH = TMP .. "/sc_fresh_test_" .. os.time() .. ".json"
fp._path = FP_PATH
local function fp_wipe() os.remove(FP_PATH); fp._reset() end
fp_wipe()

local SC = 4263274102
local H, D = 3600 * 1000, 24 * 3600 * 1000
local T0 = 1000000000000 -- an arbitrary "now" in ms

-- ---------- fresh_policy: one check per TTL row ----------
print("ttl table")
check("custom source is never stale, even if never checked", fp.is_stale(SC, "metadata", { status = "ok", source = "custom" }, T0) == false)
fp.touch(SC, "identity", T0 - 999 * D)
check("identity ok with a native match is never stale", fp.is_stale(SC, "identity", { status = "ok", data = { native = { appid = 1 } } }, T0) == false)
fp.touch(SC, "identity", T0 - 6 * D)
check("identity ok without native: fresh at 6 days", fp.is_stale(SC, "identity", { status = "ok", data = {} }, T0) == false)
fp.touch(SC, "identity", T0 - 7 * D)
check("identity ok without native: stale at 7 days", fp.is_stale(SC, "identity", { status = "ok", data = {} }, T0) == true)
fp.touch(SC, "metadata", T0 - 23 * H)
check("metadata ok: fresh at 23 h", fp.is_stale(SC, "metadata", { status = "ok", source = "igdb" }, T0) == false)
fp.touch(SC, "metadata", T0 - 24 * H)
check("metadata ok: stale at 24 h", fp.is_stale(SC, "metadata", { status = "ok", source = "fallback" }, T0) == true)
fp.touch(SC, "achievements", T0 - 23 * H)
check("achievements ok: fresh at 23 h", fp.is_stale(SC, "achievements", { status = "ok" }, T0) == false)
fp.touch(SC, "achievements", T0 - 25 * H)
check("achievements ok: stale at 25 h", fp.is_stale(SC, "achievements", { status = "ok" }, T0) == true)
for _, part in ipairs({ "identity", "metadata", "achievements" }) do
  fp.touch(SC, part, T0)
  check(part .. " error status: fresh at 29 min, stale at 30 min", fp.is_stale(SC, part, "error", T0 + 29 * 60000) == false and fp.is_stale(SC, part, "error", T0 + 30 * 60000) == true)
  -- a failed refresh of a stored ok record is back-dated so it comes due after the short TTL
  local ok_info = part == "identity" and { status = "ok", data = {} } or { status = "ok", source = "igdb" }
  fp.touch(SC, part, T0, "error")
  check(part .. " failed refresh comes due after 30 min, not the long TTL", fp.is_stale(SC, part, ok_info, T0 + 29 * 60000) == false and fp.is_stale(SC, part, ok_info, T0 + 30 * 60000) == true)
end
check("a part never checked is stale", fp.is_stale(4000000123, "metadata", { status = "ok", source = "igdb" }, T0) == true)
check("pending is always stale", fp.is_stale(SC, "metadata", "pending", T0) == true)
fp._reset()
check("checked times survive a reload from disk", fp.checked_at(SC, "achievements") ~= nil)

-- ---------- metadata refresh (K15 and the 24 h rule) ----------
print("metadata refresh")
local igdb_calls = 0
local function igdb_stub(result)
  metadata.deps.igdb_fetch = function(a, t)
    igdb_calls = igdb_calls + 1
    if not result then return nil end
    return { appid = a, title = t, igdb_id = 9, description = "fresh", developers = {}, publishers = {}, franchises = {}, genres = {}, categories = {}, release_date = 0, custom_override = false }
  end
end
local ROUTE_WEB = { bucket = "web-scraping", via = "default" }

wipe(); fp_wipe(); igdb_calls = 0
metadata_db.set(SC, { appid = SC, title = "Manual", description = "mine", custom_override = true }, true)
igdb_stub(true)
local r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB, allowWeb = true, force = true })
check("custom override is never forced (K15)", r.source == "custom" and igdb_calls == 0 and metadata_db.get(SC).description == "mine")

wipe(); fp_wipe(); igdb_calls = 0
metadata_db.set(SC, { appid = SC, title = "Old", description = "old", custom_override = false })
igdb_stub(true)
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB, allowWeb = true })
check("a stale local record is refreshed from igdb and persisted", r.source == "igdb" and igdb_calls == 1 and metadata_db.get(SC).igdb_id == 9)
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB, allowWeb = true })
check("opening it again at once adds no request", r.source == "local_db" and igdb_calls == 1)

wipe(); igdb_calls = 0
metadata_db.set(SC, { appid = SC, title = "Old", description = "old", custom_override = false })
igdb_stub(true)
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB, allowWeb = true, force = true })
check("force refreshes a fresh, non-custom record", r.source == "igdb" and igdb_calls == 1)

wipe(); fp_wipe(); igdb_calls = 0
metadata_db.set(SC, { appid = SC, title = "Keep", description = "keep me", custom_override = false })
igdb_stub(false)
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB, allowWeb = true })
check("a refresh that finds nothing keeps the old record (no fallback over it)", r.source == "local_db" and metadata_db.get(SC).description == "keep me")
local now_ms = math.floor(os.time() * 1000)
local info = { status = "ok", source = "local_db" }
check("... and retries after 30 min, not 24 h", fp.is_stale(SC, "metadata", info, now_ms + 31 * 60000) == true and fp.is_stale(SC, "metadata", info, now_ms + 10 * 60000) == false)

wipe(); fp_wipe(); igdb_calls = 0
metadata_db.set(SC, { appid = SC, title = "Old", description = "old", custom_override = false })
igdb_stub(true)
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB, allowWeb = true, noNetwork = true })
check("noNetwork never refreshes a stale record", r.source == "local_db" and igdb_calls == 0)
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB })
check("no allowed source never refreshes a stale record", r.source == "local_db" and igdb_calls == 0)
metadata.deps.igdb_fetch = nil

-- ---------- registry ----------
print("registry")
local registry = require("registry")
local REG_PATH = TMP .. "/sc_known_test_" .. os.time() .. ".json"
registry._path = REG_PATH
os.remove(REG_PATH)
local LIB = { { appid = 4000000001, name = "A", exe = "a.exe" }, { appid = 4000000002, name = "B", exe = "b.exe" } }
registry.deps.entries = function() return LIB end
check("first run seeds without new shortcuts", #registry.new_shortcuts() == 0)
LIB[#LIB + 1] = { appid = 4000000003, name = "C", exe = "c.exe" }
local fresh_list = registry.new_shortcuts()
check("a new shortcut is reported", #fresh_list == 1 and fresh_list[1].appid == 4000000003 and fresh_list[1].name == "C")
check("... and again until it is marked known", #registry.new_shortcuts() == 1)
registry.mark_known({ 4000000003 })
check("... then it is known", #registry.new_shortcuts() == 0)
LIB[#LIB + 1] = { appid = -100, name = "Signed", exe = "s.exe" }
check("signed appids are compared unsigned", registry.new_shortcuts()[1].appid == 4294967196)
os.remove(REG_PATH)

-- ---------- net ----------
print("net")
local net = require("net")
local clock = 5000
net.deps.now = function() return clock end
local http_hits = 0
local respond = function() return { status = 200, body = "x" } end
net.deps.http = { get = function(url, o) http_hits = http_hits + 1; return respond(url, o) end }

net._reset(); http_hits = 0
respond = function() return { status = 429, body = "" } end
net.get("u", { source = "igdb" })
check("429 pauses the source for 30 min", net.is_paused("igdb") == true and net.stats().paused.igdb == 5000 + 1800)
clock = 5000 + 1799
check("... still paused just before 30 min", net.is_paused("igdb") == true)
clock = 5000 + 1800
check("... free again at 30 min", net.is_paused("igdb") == false)

net._reset(); http_hits = 0; clock = 5000
respond = function() return { status = 503, body = "" } end
for _ = 1, 4 do net.get("u", { source = "sgdb" }) end
check("4 consecutive failures do not pause", net.is_paused("sgdb") == false)
net.get("u", { source = "sgdb" })
check("5 failures pause for 15 min", net.is_paused("sgdb") == true and net.stats().paused.sgdb == 5000 + 900)

http_hits = 0
local res, err = net.get("u", { source = "sgdb" })
check("a paused source makes no request", res == nil and err == "paused" and http_hits == 0)

net._reset(); http_hits = 0; clock = 5000
respond = function() return { status = 503 } end
for _ = 1, 4 do net.get("u", { source = "igdb" }) end
respond = function() return { status = 200, body = "ok" } end
net.get("u", { source = "igdb" })
respond = function() return { status = 503 } end
for _ = 1, 4 do net.get("u", { source = "igdb" }) end
check("a success resets the failure count", net.is_paused("igdb") == false)

net._reset(); http_hits = 0
respond = function() return { status = 200, body = "ok" } end
net.get("a", { source = "igdb" }); net.get("b", { source = "igdb" }); net.get("c", { source = "sgdb" })
local stats = net.stats()
check("http_calls counts per source", stats.http_calls.igdb == 2 and stats.http_calls.sgdb == 1)
net.deps.http.get = function() error("boom") end
local r2, e2 = net.get("u", { source = "screenscraper" })
check("a throwing transport is an error result, not a crash", r2 == nil and e2:find("boom") ~= nil)
net.deps.http, net.deps.now = nil, nil

-- ---------- pause handling (M7b) ----------
print("paused source")
local net2 = require("net")
wipe(); fp_wipe(); net2._reset()
local clock2 = 9000
net2.deps.now = function() return clock2 end
net2.deps.http = { get = function() return { status = 429 } end }
net2.get("u", { source = "igdb" })
igdb_stub(false)
r = metadata.ensure(SC, { title = "New Game", route = ROUTE_WEB, allowWeb = true })
check("a paused igdb does not persist a fallback record", r.status == "pending" and r.message == "paused" and metadata_db.get(SC) == nil)
clock2 = 9000 + 1800
r = metadata.ensure(SC, { title = "New Game", route = ROUTE_WEB, allowWeb = true })
check("once free again the fallback path works as before", r.status == "ok" and r.source == "fallback")

wipe(); fp_wipe(); net2._reset(); clock2 = 9000
net2.get("u", { source = "igdb" })
igdb_stub(false)
local resp = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "metadata" }, context = { title = "x", route = ROUTE_WEB, allowWeb = true } })))
check("EnsureFresh reports paused sources", resp.paused ~= nil and resp.paused.igdb == 9000 + 1800)
net2._reset()
resp = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "metadata" }, context = { title = "x", route = ROUTE_WEB, allowWeb = true } })))
check("... and nothing when none is paused", resp.paused == nil)
net2.deps.http, net2.deps.now = nil, nil
metadata.deps.igdb_fetch = nil

-- ---------- recent errors (M10): EnsureFresh answers a repeat failure from memory for 30 min ----------
wipe(); fp_wipe()
local search_calls = 0
identity.deps.is_emulator = function() return false end
identity.deps.http_get = function() search_calls = search_calls + 1; return nil, "network" end
local ROUTE_STORE = { bucket = "steam-store", via = "default" }
local function ensure_identity()
  return json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "identity" }, context = { title = "Some Game", route = ROUTE_STORE } }))).parts.identity
end
local p1 = ensure_identity()
local p2 = ensure_identity()
check("a failed identity lookup is answered from memory on the next call", p1.status == "error" and p2.status == "error" and search_calls == 1, search_calls)
check("recent_error forgets after 30 min", fp.recent_error(SC, "identity", os.time() * 1000 + 31 * 60000) == nil)
wipe(); fp_wipe(); search_calls = 0
ensure_identity()
store.set_mapping(SC, 435150, "Manual", "manual")
local p3 = ensure_identity()
check("a saved mapping wins over a remembered error", p3.status == "ok" and p3.data.native.appid == 435150 and search_calls == 1)
identity.deps.http_get, identity.deps.is_emulator = nil, nil

fp_wipe()
os.remove(META_PATH); os.remove(STORE_PATH)
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
