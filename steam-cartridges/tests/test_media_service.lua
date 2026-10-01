-- Community media (media_service.lua, screenscraper_media.lua media half, net.get_binary) backend tests
-- (features plan F2). Hermetic: no network, no Steam install.
--
--   lua tests/test_media_service.lua
--
-- Same stubs as test_art_service.lua: injected deps, the real `http` module stubbed to throw.
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


local media_store = require("media_store")
local media = require("media_service")
local ss = require("screenscraper_media")
local net = require("net")
local fresh_policy = require("fresh_policy")
local record_rpc = require("record_rpc")
local utils = require("utils")
-- Printable base64 stand-in: the test JSON codec cannot carry raw bytes.
utils.base64_encode = function(s) return "b64:" .. #s end

media_store._path = TMP .. "/sc_media_test_" .. os.time() .. ".json"
fresh_policy._path = TMP .. "/sc_media_fresh_test_" .. os.time() .. ".json"
local function wipe()
  os.remove(media_store._path); media_store._reset()
  os.remove(fresh_policy._path); fresh_policy._reset()
  net._reset()
end
wipe()

local SC = 4263274102
local ROUTE_WEB = { bucket = "web-scraping", via = "default" }
local ROUTE_STORE = { bucket = "steam-store", via = "default" }
local ROUTE_NONE = { bucket = "none", via = "default" }

local clock = 1000
media.deps.now = function() return clock end
media.deps.shortcut_info = function() return { exe = "retroarch.exe", launch_options = "" } end

local IGDB_GAME = {
  id = 1234,
  videos = { { video_id = "abcDEF12345", name = "Trailer" }, { video_id = "" } },
  screenshots = { { image_id = "sc1", width = 1280, height = 720 } },
  artworks = { { image_id = "ar1" }, { image_id = "" } },
}
local queries = {}
local igdb_answer = { IGDB_GAME }
media.deps.igdb_query = function(q) queries[#queries + 1] = q; return igdb_answer end

local SS_URL = "https://neoclone.screenscraper.fr/api2/mediaJeu.php?devid=DEV&devpassword=SECRET-PW&softname=x&ssid=USER&sspassword=USER-PW&jeuid=3"
local JEU = {
  id = "3",
  medias = {
    { type = "ss", region = "jp", url = SS_URL .. "&media=ss(jp)" },
    { type = "ss", region = "wor", url = SS_URL .. "&media=ss(wor)" },
    { type = "sstitle", region = "us", url = SS_URL .. "&media=sstitle(us)" },
    { type = "fanart", url = SS_URL .. "&media=fanart" },
    { type = "box-2D", region = "wor", url = SS_URL .. "&media=box-2D(wor)" },
    { type = "video-normalized", url = SS_URL .. "&media=video-normalized" },
  },
}
local jeu_calls = 0
local jeu_answer, jeu_err = JEU, nil
media.deps.ss_jeu = function() jeu_calls = jeu_calls + 1; return jeu_answer, jeu_err end

-- ---------- IGDB mapping ----------
print("igdb items")
local items = media.igdb_items(IGDB_GAME)
check("igdb_items: one video, one screenshot, one artwork (empty ids dropped)", #items == 3, #items)
check("a video keeps its YouTube id and name", items[1].kind == "video" and items[1].youtube == "abcDEF12345" and items[1].title == "Trailer")
check("a screenshot gets the 1080p URL, the big thumbnail and its own size",
  items[2].kind == "screenshot" and items[2].url:find("/t_1080p/sc1%.jpg$") ~= nil and items[2].thumb:find("/t_screenshot_big/sc1%.jpg$") ~= nil
  and items[2].width == 1280 and items[2].height == 720)
check("an artwork without a size is laid out as 1920x1080", items[3].kind == "artwork" and items[3].width == 1920 and items[3].height == 1080)
check("igdb_items of nothing is an empty list", #media.igdb_items(nil) == 0)

-- ---------- ensure: routing and identity ----------
print("ensure")
local r = media.ensure(SC, { title = "G", route = ROUTE_NONE, allowWeb = true, igdb_id = 1234 })
check("route none is unsupported and asks nobody", r.status == "unsupported" and #queries == 0 and jeu_calls == 0)
r = media.ensure(SC, { title = "G", route = ROUTE_STORE, allowWeb = true, igdb_id = 1234,
  identity = { status = "ok", data = { native = { appid = 435150 } } } })
check("a Steam match is unsupported (Steam shows the native app's community content)", r.status == "unsupported" and r.message == "steam" and #queries == 0)
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true })
check("IGDB without an igdb_id never searches by title", r.status == "unsupported" and #queries == 0)

r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234 })
check("IGDB with the metadata's igdb_id: one query by id", #queries == 1 and queries[1]:find("where id = 1234;", 1, true) ~= nil, queries[1])
check("the query asks for videos, screenshots and artworks", queries[1]:find("videos.video_id", 1, true) ~= nil
  and queries[1]:find("screenshots.image_id", 1, true) ~= nil and queries[1]:find("artworks.image_id", 1, true) ~= nil)
check("the part is ok with the three items and the igdb source", r.status == "ok" and r.source == "igdb" and #r.data.items == 3 and r.data.igdb_id == 1234)
check("the media is stored", media_store.get(SC) ~= nil and #media_store.get(SC).items == 3)

clock = clock + 3600
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234 })
check("within 7 days the stored media answers, no query", #queries == 1 and r.status == "ok" and r.source == "local")
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234, force = true })
check("force asks again", #queries == 2 and r.source == "igdb")
clock = clock + 8 * 86400
media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234 })
check("after 7 days the media is due again", #queries == 3)

igdb_answer = nil
clock = clock + 8 * 86400
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234 })
check("a failed refresh keeps the stored media", r.status == "ok" and r.source == "local" and #r.data.items == 3)
wipe()
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234 })
check("a failed first lookup is an error part", r.status == "error")
igdb_answer = { IGDB_GAME }

wipe()
local q_count = #queries
r = media.ensure(SC, { title = "G", route = { bucket = "web-scraping", via = "pending" }, allowWeb = true, igdb_id = 1234 })
check("routing still pending: nothing is fetched", r.status == "pending" and #queries == q_count)
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234, noNetwork = true })
check("noNetwork without stored media is pending", r.status == "pending" and #queries == q_count)

-- ---------- ScreenScraper ----------
print("screenscraper")
local ss_items = ss.media_items(JEU)
check("media_items: title screen, screenshot, fanart and the front box (no video)", #ss_items == 4
  and ss_items[1].key == "sstitle(us)" and ss_items[2].key == "ss(wor)" and ss_items[3].key == "fanart()" and ss_items[4].key == "box-2D(wor)", #ss_items)
check("the world screenshot beats the Japanese one", ss_items[2].key == "ss(wor)")
check("a box gets its caption", ss_items[4].title == "Box: front" and ss_items[4].kind == "artwork")
check("screens are laid out 4:3 and fanart 16:9", ss_items[2].width == 640 and ss_items[2].height == 480 and ss_items[3].width == 1920)
local no_url = true
for _, it in ipairs(ss_items) do if it.url or it.thumb then no_url = false end end
check("a ScreenScraper item carries a key, never a URL", no_url)
check("media_url finds the URL of a key and nothing for an unknown one",
  ss.media_url(JEU, "ss(wor)") == SS_URL .. "&media=ss(wor)" and ss.media_url(JEU, "ss(br)") == nil)

wipe()
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234, allowScreenscraper = true })
check("both sources: 3 IGDB + 4 ScreenScraper items, source igdb+screenscraper",
  r.status == "ok" and #r.data.items == 7 and r.source == "igdb+screenscraper" and r.data.ss_id == 3, r.source)
local disk = utils.read_file(media_store._path) or ""
check("the stored file holds no ScreenScraper URL or account",
  #disk > 0 and not disk:find("screenscraper.fr", 1, true) and not disk:find("SECRET", 1, true) and not disk:find("USER", 1, true))

wipe(); jeu_answer, jeu_err = nil, "no-credentials"
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowScreenscraper = true })
check("ScreenScraper without an account (and no IGDB) is needs-setup", r.status == "needs-setup")
wipe(); jeu_answer, jeu_err = nil, "not-found"
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowScreenscraper = true })
check("a game ScreenScraper does not know is ok with no items", r.status == "ok" and #r.data.items == 0)
wipe(); jeu_answer, jeu_err = nil, "request-failed"
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowScreenscraper = true })
check("a failed ScreenScraper request is an error", r.status == "error")
jeu_answer, jeu_err = JEU, nil

-- ---------- images ----------
print("images")
local PNG = "\137PNG\r\n\26\n\0\0\0\13IHDR\0\0\5\0\0\0\2\208" .. string.rep("\0", 20)
local JPG = "\255\216\255\224\0\16JFIF\0\1\1\0\0\1\0\1\0\0" .. "\255\192\0\17\8\1\224\2\128\3" .. string.rep("\0", 20)
check("image_type knows JPEG and PNG and rejects text", ss.image_type(PNG) == "png" and ss.image_type(JPG) == "jpg" and ss.image_type("Erreur de login") == nil)
local pw, ph = ss.image_size(PNG, "png")
check("image_size reads a PNG header", pw == 1280 and ph == 720, tostring(pw) .. "x" .. tostring(ph))
local jw, jh = ss.image_size(JPG, "jpg")
check("image_size reads a JPEG SOF0 segment", jw == 640 and jh == 480, tostring(jw) .. "x" .. tostring(jh))

local downloaded = {}
media.deps.download = function(url) downloaded[#downloaded + 1] = url; return JPG, "jpg", 640, 480 end
local img, err = media.image(SC, "ss(wor)", "G")
check("image() downloads the key's URL and returns base64, ext and size",
  img ~= nil and img.base64 == "b64:" .. #JPG and img.ext == "jpg" and img.width == 640 and downloaded[1] == SS_URL .. "&media=ss(wor)", err)
img, err = media.image(SC, "ss(br)", "G")
check("image() of an unknown key fails without a download", img == nil and err == "unknown key" and #downloaded == 1)
media.deps.download = nil

local bin_calls = {}
net.deps.binary = { get = function(url, opts) bin_calls[#bin_calls + 1] = { url = url, opts = opts }; return { status = 200, body = "Erreur de login" } end }
local body, why = ss.download(SS_URL)
check("download asks for maxwidth=1280 with the plugin's user agent", bin_calls[1] ~= nil and bin_calls[1].url:find("&maxwidth=1280$") ~= nil
  and bin_calls[1].opts.source == nil and bin_calls[1].opts.user_agent == "steam-cartridges/1.0")
check("download counts against the screenscraper source", net.stats().http_calls.screenscraper == 1)
check("a text answer (HTTP 200) is not an image", body == nil and why == "not an image")
net.deps.binary = { get = function() return { status = 200, body = PNG } end }
local b2, ext2, w2, h2 = ss.download(SS_URL)
check("an image answer returns bytes, ext and size", b2 == PNG and ext2 == "png" and w2 == 1280 and h2 == 720)
net.deps.binary = { get = function() return nil, "request failed" end }
for _ = 1, net.FAILURES_BEFORE_PAUSE do ss.download(SS_URL) end
local n_before = net.stats().http_calls.screenscraper
local _, paused_err = ss.download(SS_URL)
check("5 failures pause the screenscraper source; the next download makes no request",
  paused_err == "paused" and net.stats().http_calls.screenscraper == n_before)
net.deps.binary = nil
net._reset()

-- ---------- RPC facade ----------
print("rpc")
wipe()
local res = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "media" },
  context = { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234 } })))
check("EnsureFresh parts=[media] returns the media part",
  res.parts ~= nil and res.parts.media ~= nil and res.parts.media.status == "ok" and #res.parts.media.data.items == 3)
wipe(); igdb_answer = nil
local q_before = #queries
json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "media" }, context = { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234 } })))
res = json.decode(record_rpc.EnsureFresh(json.encode({ appid = SC, parts = { "media" }, context = { title = "G", route = ROUTE_WEB, allowWeb = true, igdb_id = 1234 } })))
check("a media error less than 30 min old is answered from memory", res.parts.media.status == "error" and #queries == q_before + 1)
igdb_answer = { IGDB_GAME }
fresh_policy.forget_error(SC, "media")

media.deps.download = function() return JPG, "jpg", 640, 480 end
res = json.decode(record_rpc.GetMediaImage(json.encode({ appid = SC, key = "ss(wor)", title = "G" })))
check("GetMediaImage returns base64 and ext, and no url field", res.base64 == "b64:" .. #JPG and res.ext == "jpg" and res.url == nil)
res = json.decode(record_rpc.GetMediaImage(json.encode({ appid = 435150, key = "ss(wor)" })))
check("GetMediaImage refuses a native appid", res.error == "not a shortcut")
res = json.decode(record_rpc.GetMediaImage(json.encode({ appid = SC })))
check("GetMediaImage without a key is an error, not a crash", type(res.error) == "string")
media.deps.download = nil

-- ---------- credentials ----------
print("credentials")
local leak = false
for _, name in ipairs({ "media_service.lua", "screenscraper_media.lua", "bin_http.lua", "net.lua" }) do
  local fh = assert(io.open(here .. "/../backend/" .. name, "rb")); local src = fh:read("*a"); fh:close()
  for line in src:gmatch("[^\n]+") do
    if line:find("logger[:.]") and (line:find("%f[%w_]url%f[^%w_]") or line:find("sspw") or line:find("dev_pw") or line:find("ssid") or line:find("creds")) then
      leak = true; print("    leak: " .. name .. ": " .. line)
    end
  end
end
check("no media module logs a URL or an account", not leak)

wipe()
os.remove(media_store._path); os.remove(fresh_policy._path)
-- ---------- name matching (a game with no ROM file) ----------
print("name matching")
check("normalize_name drops case, punctuation, brackets and a leading the",
  ss.normalize_name("The Legend of Zelda: A Link to the Past (USA) [!]") == "legend of zelda a link to the past")
check("AM2R matches ScreenScraper's spelling of it", ss.name_score("AM2R - Another Metroid 2 Remake", "AM2R: Another Metroid 2 Remake") == 1)
check("a different game scores low", ss.name_score("Metroid", "Super Metroid Vitality") < 0.8 and ss.name_score("Doom", "Doom II") < 0.8)
check("a missing name scores zero", ss.name_score("", "Doom") == 0 and ss.name_score("Doom", nil) == 0)
check("is_pc_system", ss.is_pc_system("PC Windows") and ss.is_pc_system("PC (DOS)") and ss.is_pc_system("Windows") and not ss.is_pc_system("Super Nintendo"))
local SEARCH = {
  { id = "1", noms = { { region = "wor", text = "AM2R: Another Metroid 2 Remake" } }, systeme = { id = "138", text = "PC Windows" } },
  { id = "2", noms = { { region = "wor", text = "Metroid II: Return of Samus" } }, systeme = { id = "9", text = "Game Boy" } },
  { id = "3", noms = { { region = "us", text = "AM2R - Another Metroid 2 Remake" } }, systeme = { id = "9", text = "Game Boy" } },
}
local m1, s1 = ss.best_match("AM2R - Another Metroid 2 Remake", SEARCH, nil)
check("best_match takes the same game, a PC copy before another platform's when the console is unknown", m1 and m1.id == "1" and s1 > 1, m1 and m1.id)
local m2 = ss.best_match("AM2R - Another Metroid 2 Remake", SEARCH, 9)
check("a known console prefers its own copy", m2 and m2.id == "3", m2 and m2.id)
check("no result reaches the minimum score: no match", ss.best_match("Something Else Entirely", SEARCH, nil) == nil)
check("an empty or odd result list is no match", ss.best_match("AM2R", {}, nil) == nil and ss.best_match("AM2R", { {}, "x" }, nil) == nil and ss.best_match("AM2R", nil, nil) == nil)
check("a result with a plain nom is matched too", ss.best_match("Cave Story", { { id = "7", nom = "Cave Story" } }, nil) ~= nil)



-- every extra type the user asked for maps to an artwork card with a caption; regions rank wor, us, eu, ss, jp
local MORE = {
  medias = {
    { type = "box-3D", region = "ss", url = "u1" }, { type = "box-3D", region = "jp", url = "u2" },
    { type = "support-2D", region = "jp", url = "u3" }, { type = "flyer", region = "eu", url = "u4" },
    { type = "mixrbv1", region = "wor", url = "u5" }, { type = "mixrbv2", region = "us", url = "u6" },
    { type = "themehs", url = "u7" }, { type = "video-normalized", url = "u8" }, { type = "manuel", region = "wor", url = "u9" },
  },
}
local more = ss.media_items(MORE)
local seen = {}
for _, it in ipairs(more) do seen[it.key] = it end
check("media_items: every requested extra type becomes an artwork card, a video and a manual do not", #more == 6
  and seen["mixrbv2(us)"] and seen["mixrbv1(wor)"] and seen["box-3D(ss)"] and seen["support-2D(jp)"] and seen["flyer(eu)"] and seen["themehs()"], #more)
check("the extra types have their captions", seen["mixrbv2(us)"].title == "Recalbox mix" and seen["mixrbv1(wor)"].title == "Recalbox mix (v1)"
  and seen["support-2D(jp)"].title == "Cartridge / disc" and seen["flyer(eu)"].title == "Flyer" and seen["themehs()"].title == "HyperSpin theme")
check("box-3D takes the ScreenScraper copy over the Japanese one (rank ss before jp)", seen["box-3D(ss)"] ~= nil and seen["box-3D(jp)"] == nil)

-- a fan game is listed under its short name: a part of the title matches only on a PC platform or the shortcut's console
local FAN = {
  { id = "273188", noms = { { region = "wor", text = "AM2R" } }, systeme = { id = "138", text = "PC Windows" } },
  { id = "5", noms = { { region = "wor", text = "AM2R" } }, systeme = { id = "9", text = "Game Boy" } },
}
local mf = ss.best_match("AM2R - Another Metroid 2 Remake", FAN, nil)
local REAL = {
  { id = "501044", noms = { { text = "AM2R" } }, systeme = { id = "63", text = "Android" } },
  { id = "273188", noms = { { text = "AM2R - Return of Samus" }, { text = "ZZZ(notgame):AM2R: Return of Samus" } }, systeme = { id = "138", text = "PC Windows" } },
}
local mr = ss.best_match("AM2R - Another Metroid 2 Remake", REAL, nil)
check("the live case: the PC entry under its other subtitle wins over the Android port", mr and mr.id == "273188", mr and mr.id)
check("a PC game is found by its short name (the part before the dash)", mf and mf.id == "273188", mf and mf.id)
check("the same part on another platform is no match", ss.best_match("AM2R - Another Metroid 2 Remake", { FAN[2] }, nil) == nil)
check("a part never matches a different game of the same series",
  ss.best_match("Metroid - Zero Mission", { { id = "9", noms = { { text = "Metroid" } }, systeme = { id = "3", text = "NES" } } }, nil) == nil)
check("the part after the dash can match too", ss.best_match("Fan - Another Metroid 2 Remake", { { id = "8", noms = { { text = "Another Metroid 2 Remake" } }, systeme = { text = "PC Windows" } } }, nil) ~= nil)

-- ---------- ScreenScraper system ids (features plan F2c, phase 0) ----------
print("system ids")
local real_fetch, real_search = ss.fetch_jeu, ss.search_jeu
local asked = {}
ss.fetch_jeu = function(_, _, system_id) asked[#asked + 1] = { "fetch", system_id }; return nil, "request-failed" end
ss.search_jeu = function(_, _, system_id) asked[#asked + 1] = { "search", system_id }; return { id = "9" } end
package.loaded["retroachievements"] = {
  extract_rom_path = function() return "C:/roms/snes/Captain Commando (USA).zip" end,
  compute_rom_md5 = function() return "md5" end,
  detect_console_id = function() return 3 end, -- RetroAchievements' SNES
}
local found = ss.jeu_for(SC, "Captain Commando", { exe = "retroarch.exe", launch_options = "" })
check("an SNES ROM asks ScreenScraper for system 4 (its SNES), not 3 (its NES)", asked[1] and asked[1][2] == 4, asked[1] and asked[1][2])
check("a ROM ScreenScraper does not know falls back to the title on that system",
  asked[2] and asked[2][1] == "search" and asked[2][2] == 4 and found and found.id == "9")
check("the console ids map to ScreenScraper's", ss.SS_SYSTEM[1] == 1 and ss.SS_SYSTEM[3] == 4 and ss.SS_SYSTEM[7] == 3 and ss.SS_SYSTEM[12] == 57)
ss.fetch_jeu, ss.search_jeu = real_fetch, real_search
package.loaded["retroachievements"] = nil
-- ---------- manuals (features plan F2c) ----------
print("manuals")
local MAN = { id = "5", medias = {
  { type = "manuel", region = "jp", url = SS_URL .. "&media=manuel(jp)" },
  { type = "manuel", region = "us", url = SS_URL .. "&media=manuel(us)" },
  { type = "ss", region = "wor", url = SS_URL .. "&media=ss(wor)" },
} }
local man = ss.manual_item(MAN)
check("manual_item: the US manual beats the Japanese one", man and man.key == "manuel(us)" and man.kind == "manual" and man.source == "screenscraper")
check("the manual card is laid out 16:9 and carries no URL", man.width == 960 and man.height == 540 and man.url == nil and man.thumb == nil)
check("no manual: nil", ss.manual_item(JEU) == nil and ss.manual_item(nil) == nil)
check("media_items still leaves the manual out", #ss.media_items(MAN) == 1)

wipe()
jeu_answer = MAN
r = media.ensure(SC, { title = "G", route = ROUTE_WEB, allowScreenscraper = true })
check("ensure: the manual is one more ScreenScraper item, after the images", r.status == "ok" and #r.data.items == 2 and r.data.items[2].kind == "manual",
  r.data and #r.data.items)

local PDF = "%PDF-1.4\n" .. string.rep("x", 2 * media.MANUAL_CHUNK_BYTES + 10)
local doc_calls = {}
net.deps.binary = { get = function(url, opts) doc_calls[#doc_calls + 1] = { url = url, opts = opts }; return { status = 200, body = PDF } end }
local pdf_body = ss.download_document(SS_URL)
check("download_document: the PDF body, no maxwidth, the manual size cap", pdf_body == PDF and not doc_calls[1].url:find("maxwidth", 1, true)
  and doc_calls[1].opts.max_bytes == ss.MAX_MANUAL_BYTES)
net.deps.binary = { get = function() return { status = 200, body = "Erreur de login" } end }
local nb, nerr = ss.download_document(SS_URL)
check("an answer that is not a PDF is an error", nb == nil and nerr == "not a pdf")
net.deps.binary = nil
net._reset()

local downloads = 0
media.deps.download_document = function() downloads = downloads + 1; return PDF end
local c0 = media.manual_chunk(SC, "manuel(us)", "G", 0)
check("chunk 0: downloads once, 3 chunks of 1 MiB, the size", downloads == 1 and c0.chunks == 3 and c0.size == #PDF and c0.index == 0)
local c1 = media.manual_chunk(SC, "manuel(us)", "G", 1)
local c2 = media.manual_chunk(SC, "manuel(us)", "G", 2)
check("chunks 1 and 2 read the same copy", downloads == 1 and c1.index == 1 and c2.index == 2)
check("the chunks are the PDF's bytes in order", c0.base64 == utils.base64_encode(PDF:sub(1, media.MANUAL_CHUNK_BYTES))
  and c2.base64 == utils.base64_encode(PDF:sub(2 * media.MANUAL_CHUNK_BYTES + 1)))
media.manual_chunk(SC, "manuel(us)", "G", 1)
check("after the last chunk the copy is freed: a later chunk downloads again", downloads == 2)
local _, bad = media.manual_chunk(SC, "manuel(us)", "G", 9)
check("an index past the end is an error", bad == "bad index")
local _, unk = media.manual_chunk(SC, "manuel(fr)", "G", 0)
check("an unknown key is an error", unk == "unknown key")
res = json.decode(record_rpc.GetManualChunk(json.encode({ appid = SC, key = "manuel(us)", title = "G", index = 0 })))
check("GetManualChunk returns base64 and the chunk count, and no url field", type(res.base64) == "string" and res.chunks == 3 and res.url == nil)
res = json.decode(record_rpc.GetManualChunk(json.encode({ appid = 435150, key = "manuel(us)", index = 0 })))
check("GetManualChunk refuses a native appid", res.error == "not a shortcut")
media.deps.download_document = nil
jeu_answer = JEU
wipe()
os.remove(media_store._path); os.remove(fresh_policy._path)
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
