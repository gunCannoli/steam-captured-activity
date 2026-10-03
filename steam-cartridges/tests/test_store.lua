-- Third-party store copies (ADR-0056) backend tests: the local readers, the Epic and Xbox sources, the service.
-- Hermetic: no network, no Steam install (each source's http is injected); one census reads this PC's Epic manifests.
--
--   lua tests/test_store.lua
--
-- Same stubs as test_ach_service.lua: hand-shaped fixtures copied from live answers (2026-10-02), injected deps,
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

-- ======================================================================
-- iso_date
-- ======================================================================
print("iso_date")
local iso = require("iso_date")
check("a day from an ISO date-time (UTC midnight)", iso.day("2023-10-27T04:00:00.000Z") == 1698364800)
check("an instant keeps the time of day", iso.instant("2026-10-02T17:44:53.533Z") == 1790963093, iso.instant("2026-10-02T17:44:53.533Z"))
check("Xbox's seven-digit fraction parses too", iso.instant("2026-10-02T17:54:21.7670000Z") == 1790963661)
check("no date, a year alone or year 0001 is nil", iso.day("") == nil and iso.day("2023") == nil and iso.day("0001-01-01T00:00:00Z") == nil)

-- ======================================================================
-- store_epic_local (pure parts; fixtures copied from this PC's manifest, ids only)
-- ======================================================================
print("store_epic_local")
local epic_local = require("store_epic_local")
local MANIFEST = [[{"FormatVersion":0,"LaunchExecutable":"Jotunnslayer.exe","DisplayName":"Jotunnslayer: Hordes of Hel",
"InstallLocation":"C:\\Program Files\\Epic Games\\JotunnslayerHordesofrI2Zp","CatalogNamespace":"d8a39ea2f35e49b58f18c2b96aec276a",
"CatalogItemId":"193ae706e4ef468aa030326aa0781efe","AppName":"05cc03868360490aa4d7138723f4d99e","MainGameCatalogNamespace":"",
"MainGameCatalogItemId":"","MainGameAppName":""}]]
local ADDON = [[{"DisplayName":"Some DLC","InstallLocation":"C:\\Program Files\\Epic Games\\JotunnslayerHordesofrI2Zp",
"CatalogNamespace":"d8a39ea2f35e49b58f18c2b96aec276a","CatalogItemId":"x","AppName":"dlc1",
"MainGameCatalogNamespace":"d8a39ea2f35e49b58f18c2b96aec276a","MainGameAppName":"05cc03868360490aa4d7138723f4d99e"}]]
local g = epic_local.parse_manifest(MANIFEST)
check("a game manifest parses", g and g.namespace == "d8a39ea2f35e49b58f18c2b96aec276a" and g.app_name == "05cc03868360490aa4d7138723f4d99e" and g.addon == false)
check("an add-on manifest is marked as one", epic_local.parse_manifest(ADDON).addon == true)
check("garbage is no manifest", epic_local.parse_manifest("not json") == nil)
local INCOMPLETE = MANIFEST:gsub('"FormatVersion":0,', '"FormatVersion":0,"bIsIncompleteInstall":true,')
check("a download in progress is marked incomplete (not installed yet)", epic_local.parse_manifest(INCOMPLETE).incomplete == true)
check("a finished install is not", epic_local.parse_manifest(MANIFEST).incomplete == false)
check("the plain launch link names its AppName", epic_local.app_name_from_link("com.epicgames.launcher://apps/05cc03868360490aa4d7138723f4d99e?action=launch&silent=true") == "05cc03868360490aa4d7138723f4d99e")
check("the namespace:item:app link names its AppName", epic_local.app_name_from_link("com.epicgames.launcher://apps/ns%3Aitem%3Aapp9?action=launch") == "app9")
check("no link, no AppName", epic_local.app_name_from_link('"C:\\x.exe"') == nil)
local games = { g }
local m1, via1 = epic_local.match({ exe = '"C:\\Program Files\\Epic Games\\JotunnslayerHordesofrI2Zp\\Jotunnslayer.exe"', launch_options = "" }, games)
check("a shortcut running the game's exe matches by install folder", m1 == g and via1 == "manifest")
local m2, via2 = epic_local.match({ exe = '"C:\\Launcher\\EpicGamesLauncher.exe"', launch_options = "com.epicgames.launcher://apps/05cc03868360490aa4d7138723f4d99e?action=launch&silent=true" }, games)
check("a shortcut running the launcher link matches by AppName", m2 == g and via2 == "launch-link")
check("a sibling folder with the same prefix is not a match", epic_local.match({ exe = '"C:\\Program Files\\Epic Games\\JotunnslayerHordesofrI2Zp2\\x.exe"' }, games) == nil)
epic_local.deps.getenv = function(n) if n == "LOCALAPPDATA" then return "L:" end end
epic_local.deps.list = function() return { { name = "8b91fd9e3d434c52a322ce7be76c06e7.dat", path = "a" }, { name = "OC_8b91fd9e3d434c52a322ce7be76c06e7.dat", path = "b" }, { name = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.dat", path = "c" } } end
epic_local.deps.mtime = function(p) return p == "a" and 20 or 10 end
check("the account id is the newest 32-hex .dat (OC_ files ignored)", epic_local.account_id() == "8b91fd9e3d434c52a322ce7be76c06e7")
epic_local.deps.getenv, epic_local.deps.list, epic_local.deps.mtime = nil, nil, nil
check("the URL handler names the launcher exe", epic_local.parse_handler('HKEY_CLASSES_ROOT\\com.epicgames.launcher\\shell\\open\\command\n    (Default)    REG_SZ    "C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe" %1\n') == "C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe")
local spec = epic_local.launch_spec(g, "C:\\L\\EpicGamesLauncher.exe")
check("a launch spec runs the launcher with the game's link", spec.exe == '"C:\\L\\EpicGamesLauncher.exe"' and spec.launch_options:find("apps/d8a39ea2f35e49b58f18c2b96aec276a%3A193ae706e4ef468aa030326aa0781efe%3A05cc0386", 1, true) ~= nil)

-- ======================================================================
-- store_xbox_local (pure parts; fixtures from this PC's Microsoft Jigsaw)
-- ======================================================================
print("store_xbox_local")
local xbox_local = require("store_xbox_local")
local REG = "\r\nHKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages\\Microsoft.MicrosoftJigsaw_2.9.6011.0_x86__8wekyb3d8bbwe\r\n    PackageRootFolder    REG_SZ    C:\\Program Files\\WindowsApps\\Microsoft.MicrosoftJigsaw_2.9.6011.0_x86__8wekyb3d8bbwe\r\n\r\nHKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages\\Some.App_1.0.0.0_x64__abc\r\n    PackageRootFolder    REG_SZ    C:\\Program Files\\WindowsApps\\Some.App_1.0.0.0_x64__abc\r\n\r\nEnd of search: 2 match(es) found.\r\n"
local pk = xbox_local.parse_packages(REG)
check("reg query output lists packages and folders", #pk == 2 and pk[1].full_name == "Microsoft.MicrosoftJigsaw_2.9.6011.0_x86__8wekyb3d8bbwe" and pk[1].root:match("Jigsaw_2%.9") ~= nil)
check("the family name is Name_PublisherId", xbox_local.family_name(pk[1].full_name) == "Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe")
check("xboxservices.config (with a byte order mark) gives the decimal title id", xbox_local.parse_services_config('\239\187\191{"TitleId": 2003863742, "FirstParty": true}') == "2003863742")
local gc = xbox_local.parse_game_config('<Game><Identity Name="Studio.Game" Publisher="CN=x"/><StoreId>9NBLGGH4R315</StoreId><TitleId>7770BBE5</TitleId></Game>')
check("MicrosoftGame.config gives the hex title id as decimal, and the Store id", gc.title_id == "2003876837" and gc.store_id == "9NBLGGH4R315" and gc.name == "Studio.Game")
local am = xbox_local.parse_appx_manifest('<Properties><DisplayName>ms-resource:AppName</DisplayName></Properties><Applications><Application Id="App" Executable="Jigsaw.exe" EntryPoint="x">')
check("AppxManifest gives the app id and exe; a resource name is no title", am.app_id == "App" and am.executable == "Jigsaw.exe" and am.title == nil)
xbox_local.deps.run = function() return REG end
xbox_local.deps.read = function(p) if p:find("Jigsaw", 1, true) and p:find("xboxservices") then return '{"TitleId": 2003863742}' end if p:find("Jigsaw", 1, true) and p:find("AppxManifest") then return '<Application Id="App" Executable="Jigsaw.exe">' end end
local xg = xbox_local.installed()
check("installed() keeps only packages with an Xbox game config", #xg == 1 and xg[1].pfn == "Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe" and xg[1].title_id == "2003863742" and xg[1].app_id == "App")
local x1, xv1 = xbox_local.match({ exe = '"C:\\Windows\\explorer.exe"', launch_options = "shell:AppsFolder\\Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe!App" }, xg)
check("a shell:AppsFolder shortcut matches by family name", x1 == xg[1] and xv1 == "launch-link")
local x2, xv2 = xbox_local.match({ exe = '"C:\\Program Files\\WindowsApps\\Microsoft.MicrosoftJigsaw_2.9.6011.0_x86__8wekyb3d8bbwe\\Jigsaw.exe"' }, xg)
check("a shortcut running the package's exe matches by folder", x2 == xg[1] and xv2 == "package")
xbox_local.deps.getenv = function(n) if n == "SystemRoot" then return "C:\\Windows" end end
local xs = xbox_local.launch_spec(xg[1])
check("a launch spec opens the app through Explorer", xs.exe == '"C:\\Windows\\explorer.exe"' and xs.launch_options == "shell:AppsFolder\\Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe!App")
-- An Xbox Live game with no game config, marked only by its xboxliveapp- protocol (Microsoft Sudoku)
check("the manifest's xboxliveapp- protocol marks an Xbox Live game", xbox_local.parse_appx_manifest('<uap:Protocol Name="xboxliveapp-1297292189" />').xbox_live == true and xbox_local.parse_appx_manifest('<uap:Protocol Name="myapp" />').xbox_live == false)
xbox_local.deps.read = function(p)
  if p:find("Jigsaw", 1, true) and p:find("xboxservices") then return '{"TitleId": 2003863742}' end
  if p:find("Some.App", 1, true) and p:find("AppxManifest") then return '<Application Id="App" Executable="S.exe"><uap:Protocol Name="xboxliveapp-1297292189" />' end
end
local xp2 = xbox_local.installed()
check("a package with the protocol and no config is installed too, with no title id yet", #xp2 == 2 and xp2[2].pfn == "Some.App_abc" and xp2[2].title_id == nil and xp2[2].via == "protocol")
check("... and the config game keeps its title id", xp2[1].title_id == "2003863742" and xp2[1].via == "config")
xbox_local.deps.run, xbox_local.deps.read, xbox_local.deps.getenv = nil, nil, nil

-- ======================================================================
-- epic_graphql (GraphQL answers as seen live, 2026-10-02)
-- ======================================================================
print("epic_graphql")
local epic = require("epic_graphql")
local posted = {}
local ANSWERS = {}
epic.deps.post = function(url, body, opts)
  posted[#posted + 1] = { url = url, body = body, source = opts.source }
  for pattern, answer in pairs(ANSWERS) do
    if body:find(pattern, 1, true) then return { status = 200, body = answer } end
  end
  return { status = 200, body = '{"errors":[{"message":"unexpected query"}]}' }
end
ANSWERS["catalogOffers"] = '{"data":{"Catalog":{"catalogOffers":{"elements":[{"id":"e1","title":"Edition","offerType":"EDITION"},{"id":"b1","title":"Jotunnslayer: Hordes of Hel","offerType":"BASE_GAME"}]}}}}'
local bo = epic.base_offer("d8a39ea2f35e49b58f18c2b96aec276a")
check("the base game offer wins over an edition", bo and bo.id == "b1" and posted[1].source == "epic" and posted[1].url == "https://store.epicgames.com/graphql")
ANSWERS["catalogOffer("] = '{"data":{"Catalog":{"catalogOffer":{"title":"Alan Wake 2","description":"Saga Anderson arrives.","developerDisplayName":"Remedy Entertainment","publisherDisplayName":"Epic Games Publishing","releaseDate":"2023-10-27T04:00:00.000Z","pcReleaseDate":"2023-10-27T04:00:00.000Z","tags":[{"name":"Horror","groupName":"genre"},{"name":"Single Player","groupName":"feature"},{"name":"Controller Support","groupName":"feature"},{"name":"Co-op","groupName":"feature"},{"name":"Cloud Saves","groupName":"epicfeature"}],"keyImages":[{"type":"featuredMedia","url":"https://cdn2.unrealengine.com/a.jpg"},{"type":"OfferImageTall","url":"https://cdn1.epicgames.com/t.jpg"}]}}}}'
local offer = epic.offer("ns", "id")
local meta = epic.to_metadata(offer, 4000000001, "AW2")
check("an offer maps to Game Info", meta.description == "Saga Anderson arrives." and meta.developers[1] == "Remedy Entertainment" and meta.publishers[1] == "Epic Games Publishing" and meta.release_date == 1698364800)
check("... genres from genre tags, player flags only from exact feature tags", meta.genres[1] == "Horror" and #meta.genres == 1 and meta.categories.single_player and meta.categories.coop and meta.categories.partial_controller and not meta.categories.multiplayer and not meta.categories.full_controller)
local shots = epic.screenshots(offer)
check("featuredMedia images are the screenshots, with a resized thumbnail", #shots == 1 and shots[1].source == "epic" and shots[1].thumb == "https://cdn2.unrealengine.com/a.jpg?w=640&resize=1")
ANSWERS["productAchievementsRecordBySandbox"] = '{"data":{"Achievement":{"productAchievementsRecordBySandbox":{"productId":"18f679a82b234692874031d40a3aaea1","totalAchievements":2,"achievements":[{"achievement":{"name":"ACH_A_TROPHY_SPECIAL","hidden":false,"unlockedDisplayName":"A-Trophy Special","unlockedDescription":"Obtain a Trophy.","unlockedIconLink":"https://i/u.png","lockedIconLink":"https://i/l.png","XP":15,"rarity":{"percent":70}}},{"achievement":{"name":"ACH_FRIENDLY_JOTUNN","hidden":true,"unlockedDisplayName":"Friendly","unlockedDescription":"x","unlockedIconLink":"https://i/f.png","lockedIconLink":"","XP":10,"rarity":{"percent":5}}}]}}}}'
local sch = epic.achievement_schema("d8a39ea2f35e49b58f18c2b96aec276a")
check("the sandbox's list: product id, API names, icons, rarity", sch.product_id == "18f679a82b234692874031d40a3aaea1" and #sch.achievements == 2 and sch.achievements[1].id == "ACH_A_TROPHY_SPECIAL" and sch.achievements[1].global_pct == 70 and sch.achievements[2].hidden == true)
ANSWERS["productAchievements("] = '{"data":{"PlayerProfile":{"playerProfile":{"productAchievements":{"__typename":"PlayerProductAchievementsResponseSuccess","data":{"playerAchievements":[{"playerAchievement":{"achievementName":"ACH_FRIENDLY_JOTUNN","unlocked":true,"unlockDate":"2026-10-02T17:44:53.533Z"}},{"playerAchievement":{"achievementName":"ACH_X","unlocked":false,"unlockDate":null}}]}}}}}}'
local un = epic.player_unlocks("acc", "18f679a82b234692874031d40a3aaea1")
check("a public profile's unlocks, with their times; a locked one is left out", un and un.ACH_FRIENDLY_JOTUNN == 1790963093 and un.ACH_X == nil)
ANSWERS["productAchievements("] = '{"data":{"PlayerProfile":{"playerProfile":{"productAchievements":{"__typename":"ServiceError","status":403,"message":"Request failed with status code 403"}}}}}'
local un2, why = epic.player_unlocks("acc", "p")
check("a private profile is 'private', not a crash", un2 == nil and why == "private")
epic.deps.post = function() return nil, "paused" end
check("a paused source is an error, never a throw", select(2, epic.base_offer("ns")) == "paused")
epic.deps.post = nil

-- ======================================================================
-- xbox_catalog (the Jigsaw product as seen live)
-- ======================================================================
print("xbox_catalog")
local catalog = require("xbox_catalog")
local got = {}
local PRODUCT = '{"Products":[{"ProductId":"9WZDNCRFJ9X2","ProductKind":"Game","AlternateIds":[{"IdType":"LegacyWindowsStoreProductId","Value":"cb51"},{"IdType":"XboxTitleId","Value":"2003863742"}],"LocalizedProperties":[{"ProductTitle":"Microsoft Jigsaw","ProductDescription":"Puzzles.","DeveloperName":"","PublisherName":"Xbox Game Studios","Images":[{"ImagePurpose":"Screenshot","Uri":"//store-images.microsoft.com/image/apps.1.a","Width":1366,"Height":768},{"ImagePurpose":"Logo","Uri":"//x/logo"}]}],"MarketProperties":[{"OriginalReleaseDate":"2012-10-26T00:00:00.0000000Z"}],"Properties":{"Category":"Puzzle & trivia","Attributes":[{"Name":"XboxLive"},{"Name":"SinglePlayer"},{"Name":"XblLocalCoop"}]}}]}'
catalog.deps.get = function(url, opts) got[#got + 1] = { url = url, source = opts.source }; return { status = 200, body = PRODUCT } end
local prod = catalog.by_pfn("Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe")
check("lookup by family name asks the display catalog", prod ~= nil and got[1].url:find("alternateId=PackageFamilyName&value=Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe", 1, true) ~= nil and got[1].source == "xbox-catalog")
local ids = catalog.ids(prod)
check("ids: Store id, title id, title, is a game", ids.store_id == "9WZDNCRFJ9X2" and ids.title_id == "2003863742" and ids.title == "Microsoft Jigsaw" and ids.is_game == true)
local xm = catalog.to_metadata(prod, 4000000002, "Jigsaw")
check("a product maps to Game Info; an empty developer is no developer", xm.description == "Puzzles." and #xm.developers == 0 and xm.publishers[1] == "Xbox Game Studios" and xm.release_date == 1351209600 and xm.genres[1] == "Puzzle & trivia")
check("... attributes: single player, co-op, local play = split screen", xm.categories.single_player and xm.categories.coop and xm.categories.split_screen and not xm.categories.multiplayer)
local xsh = catalog.screenshots(prod)
check("Screenshot images get https: and a resized thumbnail", #xsh == 1 and xsh[1].url == "https://store-images.microsoft.com/image/apps.1.a" and xsh[1].thumb == "https://store-images.microsoft.com/image/apps.1.a?w=640" and xsh[1].width == 1366)
catalog.deps.get = function() return { status = 404, body = "" } end
check("a 404 is 'not found' through an error, never a throw", catalog.by_pfn("x") == nil)
catalog.deps.get = nil

-- ======================================================================
-- xbox_live (answers as seen live; tokens are fake)
-- ======================================================================
print("xbox_live")
local live = require("xbox_live")
local ACCOUNT = nil
local saved_maps = {}
live.deps.account = {
  get = function() return ACCOUNT end,
  save = function(map) saved_maps[#saved_maps + 1] = map; if map.xbox_refresh_token ~= "" then ACCOUNT = { refresh_token = map.xbox_refresh_token, xuid = map.xbox_xuid, gamertag = map.xbox_gamertag } else ACCOUNT = nil end end,
}
live.deps.now = function() return 1000 end
local poll_state = "pending"
local refreshes = 0
live.deps.post = function(url, body)
  if url == live.DEVICE_URL then return { status = 200, body = '{"user_code":"TMSUDKC2","device_code":"DC","verification_uri":"https://www.microsoft.com/link","interval":5,"expires_in":900}' } end
  if url == live.TOKEN_URL then
    if body:find("grant_type=refresh_token", 1, true) then refreshes = refreshes + 1; return { status = 200, body = '{"access_token":"AT2","refresh_token":"RT2"}' } end
    if poll_state == "pending" then return { status = 400, body = '{"error":"authorization_pending"}' } end
    if poll_state == "expired" then return { status = 400, body = '{"error":"expired_token"}' } end
    return { status = 200, body = '{"access_token":"AT","refresh_token":"RT"}' }
  end
  if url == live.XBL_URL then return { status = 200, body = '{"Token":"XBL"}' } end
  if url == live.XSTS_URL then return { status = 200, body = '{"Token":"XSTS","DisplayClaims":{"xui":[{"uhs":"UHS","xid":"2535","gtg":"Cannoli Gun"}]}}' } end
  return nil, "unexpected"
end
local start = live.sign_in_start()
check("sign-in start gives the code and the address, never logs them", start.user_code == "TMSUDKC2" and start.device_code == "DC" and start.interval == 5)
check("a poll before approval is pending", live.sign_in_poll("DC").pending == true and ACCOUNT == nil)
poll_state = "expired"
check("an expired code says so", live.sign_in_poll("DC").error ~= nil)
poll_state = "ok"
local done = live.sign_in_poll("DC")
check("an approved code signs in and stores the refresh token, xuid and gamertag", done.ok == true and done.gamertag == "Cannoli Gun" and ACCOUNT.refresh_token == "RT" and ACCOUNT.xuid == "2535")
check("... the gamertag's space is stored as %20 and read back as a space", saved_maps[#saved_maps].xbox_gamertag == "Cannoli%20Gun" and live.status().gamertag == "Cannoli Gun")
local XACH = '{"achievements":[{"id":"2","name":"First Unlock","description":"Solve one.","isSecret":false,"progressState":"Achieved","progression":{"timeUnlocked":"2026-10-02T17:54:21.7670000Z"},"mediaAssets":[{"url":"https://i/1.png"}],"rewards":[{"type":"Gamerscore","value":"20"}],"rarity":{"currentPercentage":40.5}},{"id":"3","name":"Two","lockedDescription":"Hidden.","isSecret":true,"progressState":"NotStarted","progression":{"timeUnlocked":"0001-01-01T00:00:00.0000000Z"},"mediaAssets":[],"rewards":[]}]}'
local asked = {}
live.deps.get = function(url, opts) asked[#asked + 1] = { url = url, auth = opts.headers.Authorization, source = opts.source }; return { status = 200, body = url:find("titlehub", 1, true) and '{"titles":[{"titleId":"2003863742","achievement":{"currentAchievements":1,"currentGamerscore":20},"titleHistory":{"lastTimePlayed":"2026-10-02T17:52:12.5610357Z"}}]}' or XACH } end
local xa = live.achievements("2003863742")
check("achievements: schema items and the unlock time; a locked one has no unlock", xa and #xa.achievements == 2 and xa.unlocks["2"] == 1790963661 and xa.unlocks["3"] == nil and xa.achievements[1].global_pct == 40.5 and xa.achievements[2].hidden == true and xa.achievements[2].description == "Hidden.")
check("... asked with the XBL3.0 header for the signed-in xuid", asked[1].url:find("xuid(2535)", 1, true) ~= nil and asked[1].auth == "XBL3.0 x=UHS;XSTS" and asked[1].source == "xbox-live")
local tp = live.title_progress()
check("title progress: one call, every played title", tp["2003863742"].unlocked == 1 and tp["2003863742"].gamerscore == 20)
live._reset(); live.deps.now = function() return 1000 + 9 * 3600 end
live.achievements("2003863742")
check("an old session is renewed from the refresh token, and the rotated token is kept", refreshes == 1 and ACCOUNT.refresh_token == "RT2")
live.sign_out()
check("sign-out forgets the account", ACCOUNT == nil and live.status().signed_in == false)
check("signed out, achievements is 'not signed in' with no request", select(2, live.achievements("1")) == "not signed in")
live.deps.post, live.deps.get, live.deps.now, live.deps.account = nil, nil, nil, nil
live._reset()

-- ======================================================================
-- store_service
-- ======================================================================
print("store_service")
local copies = require("store_copies_store")
copies._path = TMP .. "/sc_store_copies_test_" .. os.time() .. ".json"
os.remove(copies._path); copies._reset()
local svc = require("store_service")
local api_calls = { offer = 0, schema = 0, pfn = 0 }
local EPIC_GAME = g
local XBOX_GAME = { pfn = "Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe", title_id = "2003863742", app_id = "App", root = "C:\\WA\\Jig", title = nil }
local ENTRIES = {
  [4000000001] = { appid = 4000000001, exe = '"C:\\Program Files\\Epic Games\\JotunnslayerHordesofrI2Zp\\Jotunnslayer.exe"', launch_options = "" },
  [4000000002] = { appid = 4000000002, exe = '"C:\\Windows\\explorer.exe"', launch_options = "shell:AppsFolder\\Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe!App" },
  [4000000003] = { appid = 4000000003, exe = '"C:\\emu\\AM2R.exe"', launch_options = "" },
}
svc.deps.entry = function(appid) return ENTRIES[appid] end
svc.deps.entries = function() local out = {} for _, e in pairs(ENTRIES) do out[#out + 1] = e end return out end
svc.deps.epic_local = setmetatable({ installed = function() return { EPIC_GAME } end, launcher_exe = function() return "C:\\L\\EpicGamesLauncher.exe" end }, { __index = epic_local })
svc.deps.xbox_local = setmetatable({ installed = function() return { XBOX_GAME } end }, { __index = xbox_local })
svc.deps.epic = {
  base_offer = function() api_calls.offer = api_calls.offer + 1; return { id = "b1", title = "Jotunnslayer: Hordes of Hel" } end,
  achievement_schema = function() api_calls.schema = api_calls.schema + 1; return { product_id = "18f6", achievements = {} } end,
}
svc.deps.xbox_catalog = setmetatable({ by_pfn = function() api_calls.pfn = api_calls.pfn + 1; return catalog.deps and require("json").decode(PRODUCT).Products[1] end }, { __index = catalog })
svc._reset()
local ep = svc.ensure(4000000001, {})
check("an Epic copy is found and filled with its offer and achievement product", ep.status == "ok" and ep.source == "epic" and ep.data.namespace == EPIC_GAME.namespace and ep.data.offerId == "b1" and ep.data.productId == "18f6" and ep.data.via == "manifest")
svc.ensure(4000000001, {})
check("... the store's ids are asked once per game (remembered)", api_calls.offer == 1 and api_calls.schema == 1)
check("... and saved: saved() reads it from disk", svc.saved(4000000001).data.offerId == "b1")
local xp = svc.ensure(4000000002, {})
check("an Xbox copy is found by its launch target and named by the catalog", xp.status == "ok" and xp.data.kind == "xbox" and xp.data.titleId == "2003863742" and xp.data.storeId == "9WZDNCRFJ9X2" and xp.data.title == "Microsoft Jigsaw" and xp.data.via == "launch-link")
check("a shortcut that is no store copy is unsupported, with nothing saved", svc.ensure(4000000003, {}).status == "unsupported" and svc.saved(4000000003) == nil)
os.remove(copies._path); copies._reset(); api_calls.offer = 0
local off = svc.ensure(4000000001, { allowEpic = false })
check("with Epic switched off the local copy is still found, and the API is not asked", off.status == "ok" and off.data.offerId == nil and api_calls.offer == 0)
local list = svc.installed_games({})
check("installed games say which ones the library has", list.epic[1].inLibrary == 4000000001 and list.xbox[1].inLibrary == 4000000002 and list.epicLauncher == true)
check("... with a launch spec for the ones it does not", list.epic[1].launch.exe == '"C:\\L\\EpicGamesLauncher.exe"' and list.xbox[1].title == "Microsoft Jigsaw")
ENTRIES[4000000001] = nil
check("an Epic game without a shortcut is not in the library", svc.installed_games({}).epic[1].inLibrary == nil)
-- A game installed after the first read (found 2026-10-03: a once-per-session cache hid every later install)
local EXTRA_EPIC = { app_name = "newgame1", title = "New Game", install_location = "C:\\Games\\New", launch_exe = "New.exe", namespace = "ns2", item_id = "i2", addon = false, incomplete = false }
local installed_now = { EPIC_GAME }
svc.deps.epic_local = setmetatable({ installed = function() return installed_now end, launcher_exe = function() return "C:\\L\\EpicGamesLauncher.exe" end }, { __index = epic_local })
svc._reset()
check("the list before the install has one Epic game", #svc.installed_games({}).epic == 1)
installed_now = { EPIC_GAME, EXTRA_EPIC }
check("a game installed afterwards is found by the very next call", #svc.installed_games({}).epic == 2)
check("... and installed_games reads afresh every time", (function() installed_now = { EPIC_GAME }; return #svc.installed_games({}).epic == 1 end)())
-- the per-shortcut detection keeps its cache for 60 s, then reads again
local clock = 5000
svc.deps.now = function() return clock end
svc._reset()
installed_now = { EPIC_GAME }
svc.detect(ENTRIES[4000000002])
installed_now = { EPIC_GAME, EXTRA_EPIC }
ENTRIES[4000000009] = { appid = 4000000009, exe = '"C:\\Games\\New\\New.exe"', launch_options = "" }
check("a cached list is kept inside its 60 s (no registry query per page view)", svc.detect(ENTRIES[4000000009]) == nil)
clock = clock + 61
check("... and read again after it: the new game's shortcut is a store copy", svc.detect(ENTRIES[4000000009]) ~= nil)
os.remove(copies._path)

-- ======================================================================
-- census: this PC's Epic manifests (plugins.md § 5: count with a naive scan first, never a hardcoded number)
-- ======================================================================
print("census")
local pd = os.getenv("ProgramData")
if pd then
  local dir = pd .. "\\Epic\\EpicGamesLauncher\\Data\\Manifests"
  local naive = 0
  local p = io.popen('dir /b "' .. dir .. '\\*.item" 2>nul')
  local names = {}
  if p then for line in p:lines() do if line:match("%.item$") then naive = naive + 1; names[#names + 1] = line end end p:close() end
  print("  census: " .. naive .. " manifest file(s) in " .. dir)
  if naive > 0 then
    epic_local.deps.list = function() local out = {} for _, n in ipairs(names) do out[#out + 1] = { name = n, path = dir .. "\\" .. n, is_file = true } end return out end
    local parsed = epic_local.installed()
    local addons = 0
    for _, n in ipairs(names) do local f = io.open(dir .. "\\" .. n, "rb"); local m = f and epic_local.parse_manifest(f:read("*a")); if f then f:close() end if m and m.addon then addons = addons + 1 end end
    check("every manifest that is not an add-on is an installed game", #parsed == naive - addons, #parsed .. " of " .. naive)
    epic_local.deps.list = nil
  else
    print("  SKIP  no Epic games installed on this PC")
  end
end

print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
