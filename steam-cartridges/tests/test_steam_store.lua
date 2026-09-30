-- Steam Store bucket (P3) backend tests. Hermetic: no network, no Steam install.
--
--   lua tests/test_steam_store.lua        (any Lua 5.1-5.5; lupa works too)
--
-- Uses hand-shaped fixtures in tests/fixtures/ and an injected http_get. The
-- real `http` module is stubbed to throw, so a test can never go online.

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

-- steam_paths / shortcuts stubs for the emulator guard through the RPC layer.
local SHORTCUTS = {}
package.loaded["steam_paths"] = { resolve = function() return { shortcuts = "unused" } end }
package.loaded["shortcuts"] = {
  parse = function() return SHORTCUTS end,
  by_appid = function(entries) local ix = {} for _, e in ipairs(entries) do ix[e.appid] = e end return ix end,
}

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
local function fixture(name) return json.decode(read(name)) end

local normalize  = require("steam_store_normalize")
local emulators  = require("steam_store_emulators")
local search     = require("steam_store_search")
local appdetails = require("steam_store_appdetails")
local throttle   = require("steam_store_throttle")
local store      = require("steam_store_store")

-- ---------- normalize (shared fixture) ----------
print("normalize")
for _, case in ipairs(fixture("normalize-cases.json").normalize) do
  local got = normalize.normalize(case[1])
  check(("normalize(%q)"):format(case[1]), got == case[2], got)
end

-- ---------- classify ----------
print("classify")
check("exact", normalize.classify("Jotunnslayer: Hordes of Hel", "Jotunnslayer Hordes of Hel") == "exact")
check("edition", normalize.classify("Alan Wake 2", "Alan Wake 2 Deluxe Edition") == "edition")
check("edition year", normalize.classify("Doom", "DOOM 2016") == "edition")
check("none: Doom vs Doom Eternal", normalize.classify("Doom", "Doom Eternal") == "none")
check("none: unrelated", normalize.classify("Doom", "Quake") == "none")
check("near is not exact", normalize.is_near("Doom", "Doom Eternal") and not normalize.is_near("Doom", "Doom"))

-- ---------- emulator guard ----------
print("emulators")
check("retroarch.exe", emulators.is_emulator([["C:\emu\RetroArch\retroarch.exe"]]))
check("dolphin-x64", emulators.is_emulator("D:/games/Dolphin-x64.exe"))
check("rpcs3", emulators.is_emulator("rpcs3.exe"))
check("a native-style exe is not an emulator", not emulators.is_emulator("C:/games/Jotunnslayer.exe"))
check("empty", not emulators.is_emulator(""))

-- ---------- search (injected http_get) ----------
print("search")
local calls, last_url = 0, nil
local function serve(name)
  local body = read(name)
  return function(url) calls = calls + 1; last_url = url; return body end
end
local r = search.search("Jotunnslayer: Hordes of Hel", serve("storesearch-jotunnslayer.json"))
check("exact hit is the app, not the bundle", r.exact and r.exact.appid == 2820820, r.exact and r.exact.appid)
check("soundtrack is a suggestion", #r.suggestions == 1 and r.suggestions[1].steam_appid == 3000001)
check("url is encoded", last_url:find("term=Jotunnslayer%3A%20Hordes%20of%20Hel", 1, true) ~= nil, last_url)

r = search.search("Alan Wake 2", serve("storesearch-alan-wake-2.json"))
check("edition-only: no exact", r.exact == nil)
check("edition suggestion", r.suggestions[1] and r.suggestions[1].reason == "edition" and r.suggestions[1].steam_appid == 1000001)
check("unrelated is dropped", #r.suggestions <= 2)

-- duplicate exact names are never picked silently
r = search.classify_items("Foo", { { type = "app", name = "Foo", id = 1 }, { type = "app", name = "FOO", id = 2 } })
check("two exact names -> no exact", r.exact == nil and #r.suggestions == 2)

r = search.search("Jotunnslayer", function() return nil, "HTTP 503" end)
check("http failure -> error", r.error == "HTTP 503")
check("real http stub trips", not pcall(require("http").get, "http://example.invalid"))

-- ---------- appdetails ----------
print("appdetails")
local data = fixture("appdetails-435150.json")["435150"].data
local meta = appdetails.to_metadata(data, 4263274102)
check("title", meta.title == data.name)
check("developers/publishers", meta.developers[1] == "Larian Studios" and meta.publishers[1] == "Larian Studios")
check("description html stripped", meta.description == 'The critically acclaimed RPG that raised the bar, now better than ever. "Gather your party" & go. Second line.', meta.description)
check("release date 14 Sep 2017", meta.release_date == 1505347200, meta.release_date)
check("categories mapped", meta.categories.single_player and meta.categories.multiplayer and meta.categories.coop
  and meta.categories.split_screen and meta.categories.full_controller and meta.categories.remote_play_together)
check("achievements always false", meta.categories.achievements == false)
check("partial controller off", meta.categories.partial_controller == false)
check("genres", meta.genres[1] == "RPG" and meta.genres[2] == "Strategy")
check("source + ids", meta.source == "steam-store" and meta.steam_appid == 435150 and meta.appid == 4263274102)
check("franchises empty", #meta.franchises == 0)
check("date: Sep 13, 2017", appdetails.parse_date("Sep 13, 2017") == 1505260800)
check("date: unknown -> 0", appdetails.parse_date("Coming soon") == 0 and appdetails.parse_date(nil) == 0)

appdetails._reset()
local fetches = 0
local body = read("appdetails-435150.json")
local http_get = function() fetches = fetches + 1; return body end
local d1, _, c1 = appdetails.fetch(435150, http_get, { now = 1000 })
local d2, _, c2 = appdetails.fetch(435150, http_get, { now = 2000 })
check("second fetch served from cache", d1 and d2 and c1 == false and c2 == true and fetches == 1)
appdetails.fetch(435150, http_get, { now = 1000 + 8 * 24 * 3600 })
check("cache expires after 7 days", fetches == 2)
appdetails.fetch(435150, http_get, { now = 1000 + 8 * 24 * 3600, force = true })
check("force bypasses the cache", fetches == 3)
check("unsuccessful app -> error", appdetails.fetch(1, function() return '{"1":{"success":false}}' end) == nil)

-- ---------- throttle ----------
print("throttle")
do
  local clock, slept = 0, 0
  local saved_now, saved_sleep = throttle.now, throttle.sleep
  throttle.now = function() return clock end
  throttle.sleep = function(s) slept = slept + s; clock = clock + s end
  throttle._reset()
  throttle.acquire()
  clock = 0.25
  throttle.acquire()
  check("second request waits out the interval", math.abs(slept - 0.75) < 1e-9, slept)
  clock = clock + 5
  throttle.acquire()
  check("no wait after the interval", math.abs(slept - 0.75) < 1e-9, slept)
  throttle.now, throttle.sleep = saved_now, saved_sleep
end

-- ---------- offline circuit breaker (P4 H3) ----------
print("offline breaker")
do
  local clock = 1000
  local saved_now, saved_sleep = throttle.now, throttle.sleep
  throttle.now = function() return clock end
  throttle.sleep = function(s) clock = clock + s end
  throttle._reset()
  local http = require("http")
  local saved_get = http.get
  local body, err = throttle.http_get("https://store.steampowered.com/x")
  check("transport failure -> offline", body == nil and err == "offline", err)
  local hits = 0
  http.get = function() hits = hits + 1; return { status = 200, body = "{}" } end
  body, err = throttle.http_get("https://store.steampowered.com/x")
  check("breaker open: fails fast without a request", body == nil and err == "offline" and hits == 0)
  clock = clock + throttle.OFFLINE_SECONDS + 1
  body = throttle.http_get("https://store.steampowered.com/x")
  check("breaker closes after OFFLINE_SECONDS", body == "{}" and hits == 1)
  http.get = function() return { status = 404 } end
  body, err = throttle.http_get("https://store.steampowered.com/x")
  check("HTTP error does not open the breaker", err == "HTTP 404" and not throttle.is_offline(), err)
  http.get = saved_get
  throttle.now, throttle.sleep = saved_now, saved_sleep
  throttle._reset()
end

-- ---------- store round trip ----------
print("store")
local path = TMP .. "/sc_steam_store_test_" .. os.time() .. ".json"
store._path = path
os.remove(path) -- a run in the same second must not see another run's file
store._reset()
local SC = 4263274102
check("set_mapping (search)", store.set_mapping(SC, 2820820, "Jotunnslayer: Hordes of Hel", "search", 100).source == "search")
store.record_artwork(SC, 2820820, { 0, 1, 3 }, 101)
store._reset() -- force a reload from disk
local e = store.get(SC)
check("mapping survives reload", e.mapping and e.mapping.steam_appid == 2820820)
check("applied slots survive reload", e.applied and #e.applied.slots == 3 and e.applied.slots[3] == 3)
check("record refused for another native app (P4 H5)", select(2, store.record_artwork(SC, 1, { 0 }, 102)) == "no mapping")
check("slot file names", table.concat(store.slot_files(SC, 1), ",") == "4263274102_hero.png,4263274102_hero.jpg,4263274102_hero.jpeg")
local pruned = store.prune_missing_slots(SC, function(name) return name ~= "4263274102_hero.png" and name ~= "4263274102_hero.jpg" and name ~= "4263274102_hero.jpeg" end)
check("prune drops a slot whose file is gone", #pruned.slots == 2 and pruned.slots[1] == 0 and pruned.slots[2] == 3)
store._reset()
check("pruning is persisted", #store.get(SC).applied.slots == 2)
store.record_artwork(SC, 2820820, { 0, 1, 3 }, 103, { 2 })
check("failed slots recorded", store.get(SC).applied.failed[1] == 2)
local cleared = store.clear(SC, true)
check("clear returns steam_appid + recorded slots", cleared.steam_appid == 2820820 and #cleared.slots == 3)
e = store.get(SC)
check("mapping and applied gone", e.mapping == nil and e.applied == nil)
check("appid rejected", store.is_rejected(SC, 2820820) and #e.rejected == 1)
local again, err = store.set_mapping(SC, 2820820, "x", "owned")
check("SaveKnownMatch refused for a rejected id", again == nil and err == "rejected")
check("search source refused too", select(2, store.set_mapping(SC, 2820820, "x", "search")) == "rejected")
check("manual overrides the rejection", store.set_mapping(SC, 2820820, "x", "manual").source == "manual" and not store.is_rejected(SC, 2820820))
store.add_suggestions(SC, { { steam_appid = 5, name = "S", reason = "near" } })
check("suggestions stored", #store.get(SC).suggestions == 1)
store.set_mapping(SC, 7, "y", "manual")
check("set_mapping clears suggestions", #store.get(SC).suggestions == 0)
store.clear(SC, true)
check("rejected ids are dropped from suggestions", #store.add_suggestions(SC, { { steam_appid = 7, name = "y", reason = "near" } }) == 0)
check("no tmp file left behind", io.open(path .. ".tmp", "rb") == nil)

store.set_negative("some title", 1000)
check("negative cache hit", store.is_negative("some title", 2000))
check("negative cache expires after 7 days", not store.is_negative("some title", 1000 + 8 * 24 * 3600))

-- non-Steam only
check("native appid is refused (never persisted)", not pcall(store.set_mapping, 435150, 435150, "n", "manual"))
check("native appid refused for artwork", not pcall(store.record_artwork, 435150, 435150, { 0 }))
local raw = read and io.open(path, "rb"):read("*a")
check("file holds no native app key", raw:find('"435150"', 1, true) == nil)

-- search + negative cache
local neg_calls = 0
local empty = function() neg_calls = neg_calls + 1; return '{"total":0,"items":[]}' end
search.search("Totally Unknown Rom Hack", empty, store)
local skipped = search.search("Totally Unknown Rom Hack", empty, store)
check("no store hit is negative-cached (one request)", neg_calls == 1 and skipped.skipped == "negative")

-- ---------- rpc layer ----------
print("rpc")
package.loaded["rpc"] = package.loaded["rpc"] or { method = function(_, f)
  return function(payload)
    local ok, res = pcall(f, json.decode(payload))
    if not ok then return json.encode({ error = tostring(res) }) end
    if res == nil then return "null" end
    return json.encode(res)
  end
end }
local RPC = require("steam_store_rpc")
check("all six RPCs exist", (function()
  for _, n in ipairs({ "SteamStoreGetState", "SteamStoreGetMapping", "SteamStoreSetMapping", "SteamStoreClearMapping", "SteamStoreRejectSuggestion", "SteamStoreRecordArtwork" }) do
    if type(RPC[n]) ~= "function" then return false, n end
  end
  return true
end)())
store._reset(); os.remove(path)
local EMU = 4200000001
SHORTCUTS[1] = { appid = EMU, name = "Some ROM", exe = [["C:\emu\RetroArch\retroarch.exe"]] }
local out
out = json.decode(RPC.SteamStoreSetMapping(json.encode({ appid = EMU, steam_appid = 99, name = "n" })))
check("manual mapping works for an emulator shortcut", out.mapping and out.mapping.source == "manual")
out = json.decode(RPC.SteamStoreClearMapping(json.encode({ appid = EMU, reject = true })))
check("clear via RPC returns steam_appid", out.steam_appid == 99)
out = json.decode(RPC.SteamStoreGetMapping(json.encode({ appid = EMU })))
check("GetMapping reports the rejection", out.mapping == nil and out.rejected[1] == 99)
out = json.decode(RPC.SteamStoreRecordArtwork(json.encode({ appid = EMU, steam_appid = 99, slots = { 0 } })))
check("RecordArtwork without a mapping is refused (P4 H5)", out.error == "no mapping")
store.add_suggestions(EMU, { { steam_appid = 55, name = "S", reason = "near" } })
RPC.SteamStoreRejectSuggestion(json.encode({ appid = EMU, steam_appid = 55 }))
out = json.decode(RPC.SteamStoreGetMapping(json.encode({ appid = EMU })))
check("rejecting a suggestion removes it and remembers it", #store.get(EMU).suggestions == 0 and store.is_rejected(EMU, 55))

os.remove(path)
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
