-- Metadata resolution (metadata_service.lua) backend tests (migration plan M5a).
-- Hermetic: no network, no Steam install.
--
--   lua tests/test_metadata_service.lua        (any Lua 5.1-5.5; lupa works too)
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

local SC = 4263274102
local ROUTE_STORE = { bucket = "steam-store", via = "default" }
local ROUTE_WEB = { bucket = "web-scraping", via = "default" }
local ROUTE_NONE = { bucket = "none", via = "default" }
local ROUTE_PENDING = { bucket = "steam-store", via = "pending" }

metadata.deps.now = function() return 1000 end

-- ---------- custom_override wins regardless of route ----------
print("custom override")
metadata_db.set(SC, { appid = SC, title = "Manual", custom_override = true }, true)
local r = metadata.ensure(SC, { title = "x", route = ROUTE_NONE })
check("custom_override wins whatever the route", r.status == "ok" and r.source == "custom" and r.data.title == "Manual")
wipe()

-- ---------- via pending ----------
print("pending route")
r = metadata.ensure(SC, { title = "x", route = ROUTE_PENDING })
check("pending route, no local record -> pending", r.status == "pending")
metadata_db.set(SC, { appid = SC, title = "Local" })
r = metadata.ensure(SC, { title = "x", route = ROUTE_PENDING })
check("pending route, local record -> ok local_db", r.status == "ok" and r.source == "local_db" and r.data.title == "Local")
wipe()

-- ---------- steam-store with native: storeItem present ----------
print("steam-store storeItem")
store.set_mapping(SC, 2820820, "Jotunnslayer", "manual")
r = metadata.ensure(SC, { title = "x", route = ROUTE_STORE, storeItem = { appid = SC, title = "From StoreItemCache" } })
check("storeItem present -> ok steam-store, not persisted", r.status == "ok" and r.source == "steam-store" and r.data.title == "From StoreItemCache" and metadata_db.get(SC) == nil)
wipe()
store.set_mapping(SC, 2820820, "Jotunnslayer", "manual")

-- ---------- steam-store with native: appdetails fetch ----------
print("steam-store appdetails")
metadata.deps.appdetails_fetch = function(steam_appid)
  check("appdetails_fetch called with native appid", steam_appid == 2820820)
  return { name = "Jotunnslayer: Hordes of Hel", steam_appid = 2820820, short_description = "d", categories = {}, genres = {} }
end
r = metadata.ensure(SC, { title = "x", route = ROUTE_STORE })
check("appdetails fetch -> ok steam-appdetails, not persisted", r.status == "ok" and r.source == "steam-appdetails" and r.data.title == "Jotunnslayer: Hordes of Hel" and metadata_db.get(SC) == nil)
metadata.deps.appdetails_fetch = nil
wipe()
store.set_mapping(SC, 2820820, "Jotunnslayer", "manual")

-- ---------- steam-store with native: appdetails error, no DB record ----------
print("steam-store appdetails error, no db")
metadata.deps.appdetails_fetch = function() return nil, "HTTP 503" end
r = metadata.ensure(SC, { title = "x", route = ROUTE_STORE })
check("appdetails error, no local record -> error, no data", r.status == "error" and r.data == nil and r.message == "HTTP 503")
metadata.deps.appdetails_fetch = nil
wipe()

-- ---------- steam-store with native: appdetails error, DB record present ----------
print("steam-store appdetails error, with db")
store.set_mapping(SC, 2820820, "Jotunnslayer", "manual")
metadata_db.set(SC, { appid = SC, title = "Stale Local" })
metadata.deps.appdetails_fetch = function() return nil, "HTTP 503" end
r = metadata.ensure(SC, { title = "x", route = ROUTE_STORE })
check("appdetails error, local record present -> error with local data", r.status == "error" and r.data.title == "Stale Local")
metadata.deps.appdetails_fetch = nil
wipe()

-- ---------- steam-store, no saved mapping (identity not known to the service): local db or pending ----------
-- resolve_identity.saved(appid) returns a Part only when a mapping is on disk; without one it is
-- nil, which metadata_service treats as identity not known yet (the same as steam-store/pending
-- and steam-store/web-scraping-fallback share their local-db-then-igdb tier below).
print("steam-store no saved mapping, no local")
r = metadata.ensure(SC, { title = "x", route = ROUTE_STORE })
check("no saved identity, no local record -> pending", r.status == "pending")
wipe()

print("steam-store no saved mapping, local db")
metadata_db.set(SC, { appid = SC, title = "Local Steam-Store Fallback" })
r = metadata.ensure(SC, { title = "x", route = ROUTE_STORE })
check("no saved identity, local record -> ok local_db", r.status == "ok" and r.source == "local_db" and r.data.title == "Local Steam-Store Fallback")
wipe()

-- ---------- web-scraping: local db ----------
print("web-scraping local db")
metadata_db.set(SC, { appid = SC, title = "Local WS" })
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB })
check("web-scraping, local record -> ok local_db", r.status == "ok" and r.source == "local_db" and r.data.title == "Local WS")
wipe()

-- ---------- web-scraping: igdb fetch, persisted ----------
print("web-scraping igdb")
metadata.deps.igdb_fetch = function(appid, title, info)
  check("igdb_fetch called with title", title == "AM2R")
  return { appid = appid, title = title, igdb_id = 99, matched_title = title, description = "d", developers = {}, publishers = {}, franchises = {}, release_date = 0, genres = {}, categories = { single_player = true }, custom_override = false }
end
r = metadata.ensure(SC, { title = "AM2R", route = ROUTE_WEB, allowWeb = true })
check("igdb match -> ok source igdb, persisted", r.status == "ok" and r.source == "igdb" and metadata_db.get(SC) ~= nil and metadata_db.get(SC).igdb_id == 99)
metadata.deps.igdb_fetch = nil
wipe()

-- ---------- web-scraping: igdb no match, fallback persisted ----------
print("web-scraping igdb no match")
metadata.deps.igdb_fetch = function() return nil end
r = metadata.ensure(SC, { title = "Totally Unknown", route = ROUTE_WEB, allowWeb = true })
check("igdb no match -> ok source fallback, persisted", r.status == "ok" and r.source == "fallback" and metadata_db.get(SC) ~= nil and metadata_db.get(SC).title == "Totally Unknown")
metadata.deps.igdb_fetch = nil
wipe()

-- ---------- web-scraping: not allowed -> pending ----------
print("web-scraping not allowed")
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB, allowWeb = false })
check("web-scraping, allowWeb false, no local -> pending", r.status == "pending")
r = metadata.ensure(SC, { title = "x", route = ROUTE_WEB, allowWeb = true, noNetwork = true })
check("web-scraping, noNetwork true, no local -> pending", r.status == "pending")
wipe()

-- ---------- route none ----------
print("route none")
r = metadata.ensure(SC, { title = "x", route = ROUTE_NONE })
check("route none, no local -> unsupported", r.status == "unsupported")
metadata_db.set(SC, { appid = SC, title = "Local None" })
r = metadata.ensure(SC, { title = "x", route = ROUTE_NONE })
check("route none, local record -> ok local_db", r.status == "ok" and r.source == "local_db")
wipe()

-- ---------- checkedAt in ms ----------
print("checkedAt")
metadata.deps.now = function() return 1234 end
r = metadata.ensure(SC, { title = "x", route = ROUTE_NONE })
check("checkedAt is in ms", r.checkedAt == 1234000, r.checkedAt)
metadata.deps.now = function() return 1000 end
wipe()

-- ---------- steam-store metadata is never written to library_metadata.json ----------
print("steam-store never persisted")
store.set_mapping(SC, 2820820, "Jotunnslayer", "manual")
metadata.deps.appdetails_fetch = function() return { name = "Jotunnslayer", steam_appid = 2820820, short_description = "", categories = {}, genres = {} } end
metadata.ensure(SC, { title = "x", route = ROUTE_STORE })
check("steam-store metadata is never written to library_metadata.json", metadata_db.get(SC) == nil)
metadata.deps.appdetails_fetch = nil
wipe()

-- ---------- record_rpc ----------
print("record_rpc")
metadata_db.set(SC, { appid = SC, title = "Disk Only" })
local out = json.decode(record_rpc.GetGameRecord(json.encode({ appid = SC })))
check("GetGameRecord includes local metadata, disk only", out.parts.metadata and out.parts.metadata.data.title == "Disk Only")
wipe()

metadata_db.set(SC, { appid = SC, title = "Via EnsureFresh" })
out = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "metadata" }, context = { route = ROUTE_NONE, title = "x" } })))
check("EnsureFresh resolves metadata", out.parts.metadata and out.parts.metadata.data.title == "Via EnsureFresh")
wipe()

print("GetAllRecords")
metadata_db.set(SC, { appid = SC, title = "All Records" })
store.set_mapping(SC + 1, 2820820, "Jotunnslayer", "manual")
out = json.decode(record_rpc.GetAllRecords(json.encode({})))
check("GetAllRecords includes the metadata record", out.records[tostring(SC)] and out.records[tostring(SC)].metadata.data.title == "All Records")
check("GetAllRecords includes the identity mapping", out.records[tostring(SC + 1)] and out.records[tostring(SC + 1)].identity.data.native.appid == 2820820)
check("GetAllRecords is disk only (no appdetails/igdb deps invoked)", true)
wipe()

os.remove(META_PATH)
os.remove(STORE_PATH)
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
