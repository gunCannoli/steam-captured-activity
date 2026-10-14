-- Identity resolution (resolve_identity.lua) backend tests (migration plan M4b).
-- Hermetic: no network, no Steam install.
--
--   lua tests/test_identity.lua        (any Lua 5.1-5.5; lupa works too)
--
-- Same stubs as test_steam_store.lua: hand-shaped fixtures, injected deps,
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

-- steam_paths / shortcuts stubs for the emulator guard.
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
local function read(name)
  local f = assert(io.open(here .. "/fixtures/" .. name, "rb"))
  local c = f:read("*a"); f:close(); return c
end

local store = require("steam_store_store")
local identity = require("resolve_identity")
local record_rpc = require("record_rpc")

local path = TMP .. "/sc_identity_test_" .. os.time() .. ".json"
store._path = path
local function wipe()
  os.remove(path)
  store._reset()
end
wipe()

local fresh_policy = require("fresh_policy")
fresh_policy._path = TMP .. "/sc_fresh_test_" .. os.time() .. ".json"
local SC = 4263274102
local ROUTE_STORE = { bucket = "steam-store", via = "default" }
local ROUTE_OTHER = { bucket = "web-scraping", via = "default" }

identity.deps.now = function() return 1000 end
identity.deps.provided = function() return nil end

-- ---------- route not steam-store ----------
print("route")
local r = identity.ensure(SC, { title = "AM2R", route = ROUTE_OTHER })
check("route not steam-store is unsupported", r.status == "unsupported")

-- ---------- saved manual mapping, no network ----------
print("saved mapping")
store.set_mapping(SC, 435150, "n", "manual")
local calls = 0
identity.deps.http_get = function() calls = calls + 1; error("network") end
r = identity.ensure(SC, { title = "Whatever", route = ROUTE_STORE })
check("saved manual mapping, no network", r.status == "ok" and r.data.native.appid == 435150 and r.data.native.source == "manual" and calls == 0)
store.clear(SC, false)
identity.deps.http_get = nil

-- ---------- emulator is unsupported ----------
print("emulator")
local EMU = 4200000001
SHORTCUTS[1] = { appid = EMU, name = "Some ROM", exe = [["C:\emu\RetroArch\retroarch.exe"]] }
r = identity.ensure(EMU, { title = "Some ROM", route = ROUTE_STORE })
check("emulator is unsupported", r.status == "unsupported")
SHORTCUTS[1] = nil

-- ---------- empty title is pending ----------
print("pending")
r = identity.ensure(SC, { title = "", route = ROUTE_STORE })
check("empty title is pending", r.status == "pending")

-- ---------- unique owned match saves source owned ----------
print("owned")
r = identity.ensure(SC, { title = "Jotunnslayer: Hordes of Hel", route = ROUTE_STORE,
  owned = { { appid = 2820820, name = "Jotunnslayer: Hordes of Hel" } } })
check("unique owned match saves source owned", r.status == "ok" and r.data.native.appid == 2820820 and r.source == "owned")
check("owned match persisted", store.get(SC).mapping.steam_appid == 2820820)
store.clear(SC, false)

print("owned duplicate")
identity.deps.http_get = function() return '{"total":0,"items":[]}' end
r = identity.ensure(SC, { title = "Foo", route = ROUTE_STORE,
  owned = { { appid = 1, name = "Foo" }, { appid = 2, name = "FOO" } } })
check("duplicate owned names are no match", r.status == "ok" and r.data.native == nil, r.data.native)
identity.deps.http_get = nil

print("owned rejected")
store.reject(SC, 2820820)
-- a rejected owned candidate falls through to store search; give it an empty result.
identity.deps.http_get = function() return '{"total":0,"items":[]}' end
r = identity.ensure(SC, { title = "Jotunnslayer: Hordes of Hel", route = ROUTE_STORE,
  owned = { { appid = 2820820, name = "Jotunnslayer: Hordes of Hel" } } })
check("rejected owned candidate is skipped", r.data.native == nil and r.status == "ok")
identity.deps.http_get = nil
wipe()

-- ---------- store search: exact ----------
print("store exact")
local function serve(name)
  local body = read(name)
  return function() return body end
end
identity.deps.http_get = serve("storesearch-jotunnslayer.json")
r = identity.ensure(SC, { title = "Jotunnslayer: Hordes of Hel", route = ROUTE_STORE })
check("store exact saves source search", r.status == "ok" and r.data.native.appid == 2820820 and r.source == "search")
check("exact match persisted and suggestion removed", store.get(SC).mapping.steam_appid == 2820820 and #store.get(SC).suggestions == 0)
wipe()

print("store exact rejected")
store.reject(SC, 2820820)
identity.deps.http_get = serve("storesearch-jotunnslayer.json")
r = identity.ensure(SC, { title = "Jotunnslayer: Hordes of Hel", route = ROUTE_STORE })
check("store exact but rejected, no native", r.status == "ok" and r.data.native == nil)
wipe()

print("store suggestions only")
identity.deps.http_get = serve("storesearch-alan-wake-2.json")
r = identity.ensure(SC, { title = "Alan Wake 2", route = ROUTE_STORE })
check("suggestions only are stored, no native", r.status == "ok" and r.data.native == nil and #store.get(SC).suggestions > 0)
wipe()

print("negative cache")
local neg_calls = 0
identity.deps.http_get = function() neg_calls = neg_calls + 1; return '{"total":0,"items":[]}' end
identity.ensure(SC, { title = "Totally Unknown Rom Hack", route = ROUTE_STORE })
store._reset() -- fresh appid memo, same title -> negative cache in `store`, not per-appid (kept on disk)
identity.ensure(SC + 1, { title = "Totally Unknown Rom Hack", route = ROUTE_STORE })
check("negative cache skips the request", neg_calls == 1, neg_calls)
identity.deps.http_get = nil
wipe()

-- ---------- a pushed title (ADR-0067; ADR-0056 "Steam first") ----------
print("pushed title")
-- The Xbox package names itself "worldoftanks_blitz"; its catalog title is "World of Tanks Blitz" (found 2026-10-04).
-- steam-cartridges-third-party pushes the catalog title with the game (reportGame).
local terms = {}
identity.deps.http_get = function(url)
  terms[#terms + 1] = url
  if url:find("term=World%20of%20Tanks%20Blitz", 1, true) then
    return '{"total":2,"items":[{"id":444200,"name":"World of Tanks Blitz"},{"id":2994410,"name":"World of Tanks Blitz - Resupply Pack"}]}'
  end
  return '{"total":0,"items":[]}'
end
identity.deps.provided = function() return { source = "xbox", title = "World of Tanks Blitz" } end
r = identity.ensure(SC, { title = "worldoftanks_blitz", route = ROUTE_STORE })
check("a miss on the shortcut name is retried with the pushed title", r.status == "ok" and r.data.native and r.data.native.appid == 444200, #terms)
check("the shortcut name is searched first", #terms == 2 and terms[1]:find("worldoftanks_blitz", 1, true) ~= nil, terms[1])
wipe()

terms = {}
r = identity.ensure(SC, { title = "worldoftanks_blitz", route = ROUTE_STORE,
  owned = { { appid = 444200, name = "World of Tanks Blitz" } } })
check("an owned game matches the pushed title without a search", r.source == "owned" and r.data.native.appid == 444200 and #terms == 0, #terms)
wipe()

terms = {}
identity.deps.provided = function() return { source = "epic", title = "World of Tanks: Blitz!" } end
r = identity.ensure(SC, { title = "World of Tanks Blitz", route = ROUTE_STORE })
check("a pushed title equal after normalizing is not searched twice", #terms == 1 and r.data.native.appid == 444200, #terms)
wipe()

terms = {}
identity.deps.provided = function() return { source = "xbox", title = "World of Tanks Blitz" } end
r = identity.ensure(SC, { title = "", route = ROUTE_STORE })
check("an empty shortcut name still resolves through the pushed title", r.data and r.data.native and r.data.native.appid == 444200)
identity.deps.provided = function() return nil end
identity.deps.http_get = nil
wipe()

print("network error")
identity.deps.http_get = function() return nil, "HTTP 503" end
r = identity.ensure(SC, { title = "Whatever Title", route = ROUTE_STORE })
check("network error is status error", r.status == "error" and r.message == "HTTP 503")
identity.deps.http_get = nil
wipe()

print("checkedAt")
identity.deps.now = function() return 1234 end
r = identity.ensure(SC, { title = "", route = ROUTE_STORE })
check("checkedAt is in ms", r.checkedAt == 1234000, r.checkedAt)
identity.deps.now = function() return 1000 end
wipe()


local out = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "bogus-part" }, context = { route = ROUTE_STORE, title = "x" } })))
check("EnsureFresh ignores unknown parts", out.parts.identity == nil and out.error == nil)

out = json.decode(record_rpc.EnsureFresh(json.encode({ appid = 435150, parts = { "identity" }, context = { route = ROUTE_STORE, title = "x" } })))
check("EnsureFresh rejects a native appid", out.error == "not a shortcut")

wipe()
os.remove(path)
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
