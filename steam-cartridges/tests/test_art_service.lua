-- Artwork resolution (art_service.lua) backend tests (migration plan M5c).
-- Hermetic: no network, no Steam install.
--
--   lua tests/test_art_service.lua        (any Lua 5.1-5.5; lupa works too)
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
  exists = function() return false end,
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

local store = require("steam_store_store")
local art = require("art_service")
local record_rpc = require("record_rpc")

local STORE_PATH = TMP .. "/sc_art_store_test_" .. os.time() .. ".json"
store._path = STORE_PATH
local function wipe() os.remove(STORE_PATH); store._reset() end
wipe()

local SC = 4263274102
local ROUTE_WEB = { bucket = "web-scraping", via = "default" }
local ROUTE_STORE = { bucket = "steam-store", via = "default" }
local ROUTE_NONE = { bucket = "none", via = "default" }

art.deps.now = function() return 1000 end
art.deps.api_key = function() return "SECRET-KEY-123" end
art.deps.grid_exists = function() return false end -- every slot empty

local requests = 0
local URLS = { portrait = "https://cdn2.steamgriddb.com/p.png", hero = "https://cdn2.steamgriddb.com/h.png", logo = "https://cdn2.steamgriddb.com/l.png", wide = "https://cdn2.steamgriddb.com/w.png" }
art.deps.search = function(title, key)
  requests = requests + 1
  if title == "Unknown Game" then return nil end
  return { id = 77, name = title }
end
art.deps.fetch = function(id, key) requests = requests + 1; return URLS end

-- ---------- routes that make no request ----------
print("no request")
local r = art.ensure(SC, { title = "AM2R", route = ROUTE_NONE, allowSgdb = true })
check("route none is unsupported, no request", r.status == "unsupported" and requests == 0)
r = art.ensure(SC, { title = "AM2R", route = { bucket = "web-scraping", via = "pending" } })
check("pending route is pending, no request", r.status == "pending" and requests == 0)

-- ---------- needs-setup ----------
print("needs-setup")
art.deps.api_key = function() return nil end
r = art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = true })
check("no key is needs-setup without a request", r.status == "needs-setup" and requests == 0)
art.deps.api_key = function() return "SECRET-KEY-123" end

-- ---------- service disabled / offline ----------
print("disabled")
r = art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = false })
check("allowSgdb false: ok, no urls, no request", r.status == "ok" and next(r.data.urls) == nil and requests == 0)
r = art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = true, noNetwork = true })
check("noNetwork: ok, no urls, no request", r.status == "ok" and next(r.data.urls) == nil and requests == 0)

-- ---------- steamgriddb ok ----------
print("steamgriddb")
r = art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = true })
check("unmatched game gets steamgriddb urls", r.status == "ok" and r.data.source == "steamgriddb" and r.data.urls.portrait == URLS.portrait and requests == 2)
check("all four slots empty", #r.data.emptySlots == 4)
check("steam-store with no saved identity is pending (identity not known)", (function()
  -- saved identity is nil here (no mapping), so steam-store is pending, not sgdb
  local p = art.ensure(SC, { title = "Some Game", route = ROUTE_STORE, allowSgdb = true })
  return p.status == "pending"
end)())

print("identity from context")
requests = 0
r = art.ensure(SC, { title = "Some Game", route = ROUTE_STORE, allowSgdb = true, identity = { status = "ok", data = {} } })
check("steam-store with identity ok and no native uses steamgriddb", r.status == "ok" and r.data.source == "steamgriddb" and requests == 2)
r = art.ensure(SC, { title = "Some Game", route = ROUTE_STORE, allowSgdb = true, identity = { status = "pending" } })
check("steam-store with identity pending waits", r.status == "pending")

-- ---------- only empty slots ----------
print("empty slots only")
art.deps.grid_exists = function(name) return name == SC .. "p.png" end -- the user set the portrait
requests = 0
r = art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = true })
check("a slot with a grid file is not offered", (function()
  for _, s in ipairs(r.data.emptySlots) do if s == 0 then return false end end
  return #r.data.emptySlots == 3
end)())
art.deps.grid_exists = function(name) return true end
requests = 0
r = art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = true })
check("no empty slot: no request", r.status == "ok" and #r.data.emptySlots == 0 and requests == 0)
art.deps.grid_exists = function() return false end

-- ---------- record + tried ----------
print("record")
check("record_sgdb_artwork stores slots and tried", store.record_sgdb_artwork(SC, { 0, 1 }, { 0, 1, 2, 3 }))
art.deps.grid_exists = function(name) return name == SC .. "p.png" or name == SC .. "_hero.jpg" end -- the two files we wrote
r = art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = true })
check("attempted slots are not offered again (user clearing wins)", #r.data.emptySlots == 0)
local out = store.clear(SC, false)
check("Clear returns only the slots we wrote", #out.slots == 2 and out.slots[1] == 0 and out.slots[2] == 1)
art.deps.grid_exists = function() return false end
check("Clear resets tried", #art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = true }).data.emptySlots == 4)
wipe()

-- ---------- negative cache ----------
print("negative cache")
requests = 0
r = art.ensure(SC, { title = "Unknown Game", route = ROUTE_WEB, allowSgdb = true })
check("search miss: ok, no urls", r.status == "ok" and next(r.data.urls) == nil and requests == 1)
r = art.ensure(SC, { title = "Unknown Game", route = ROUTE_WEB, allowSgdb = true })
check("search miss is negative-cached (no second request)", requests == 1)
wipe()

-- ---------- mapped game ----------
print("mapped")
store.set_mapping(SC, 2820820, "Jotunnslayer", "manual")
requests = 0
r = art.ensure(SC, { title = "Jotunnslayer", route = ROUTE_STORE, allowSgdb = true, artUrls = { portrait = "https://shared.akamai.steamstatic.com/hashed.jpg" } })
check("mapped game uses steam-cdn, no steamgriddb request", r.status == "ok" and r.data.source == "steam-cdn" and r.data.steamAppid == 2820820 and requests == 0)
check("hashed urls from the frontend win over the CDN path", r.data.urls.portrait == "https://shared.akamai.steamstatic.com/hashed.jpg" and r.data.urls.hero:find("library_hero.jpg", 1, true))
r = art.ensure(SC, { title = "Jotunnslayer", route = ROUTE_WEB, allowSgdb = true })
check("a saved match is ignored on a web-scraping route (art stays, sgdb applies)", r.data.source == "steamgriddb")
check("record_sgdb_artwork refuses a mapped shortcut", store.record_sgdb_artwork(SC, { 0 }, { 0 }) == false)
wipe()

-- ---------- errors ----------
print("errors")
art.deps.search = function() error("boom") end
r = art.ensure(SC, { title = "Some Game", route = ROUTE_WEB, allowSgdb = true })
check("a thrown search is status error, not a crash", r.status == "error")
art.deps.search = nil

-- ---------- record_rpc ----------
print("record_rpc")
art.deps.search = function() return { id = 1 } end
local res = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "artwork" }, context = { title = "Some Game", route = ROUTE_WEB, allowSgdb = true } })))
check("EnsureFresh resolves artwork", res.parts.artwork and res.parts.artwork.data.source == "steamgriddb")
wipe()

-- ---------- the credential never reaches a logger call ----------
print("credentials")
local function read_all(p) local f = io.open(p, "rb"); local c = f:read("*a"); f:close(); return c end
local leak = false
for _, file in ipairs({ "art_service.lua", "web_sgdb.lua" }) do
  for line in read_all(here .. "/../backend/" .. file):gmatch("[^\n]+") do
    if line:find("logger[:.]") and (line:find("%f[%w_]key%f[^%w_]") or line:find("Bearer")) then leak = true; print("    leak in " .. file .. ": " .. line) end
  end
end
check("the credential never appears in a logger: call", not leak)

os.remove(STORE_PATH)
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
