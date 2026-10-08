-- Backend test suite. Runs the real modules against a real Steam install.
--
--   lua tests\test_backend.lua
--
-- Steam root comes from NSGA_STEAM_ROOT (see harness.lua).
--
-- The library changes all the time, so counts are never hardcoded. A CENSUS
-- runs first: it counts shortcuts and screenshots straight from the raw files
-- with a deliberately naive scan (no parser under test), prints the numbers,
-- and the parsers are then checked against it. It also prints how the library
-- changed since the last run (information, never a failure). Only a few stable
-- identities (AM2R's appid and name, ...) are hardcoded in FIXTURE; on another
-- install set NSGA_SKIP_FIXTURES=1 to skip those.
--
-- Lua is not bundled with Millennium; get a standalone interpreter from
-- https://luabinaries.sourceforge.net/ to run this.

package.path = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or ".")
  .. "\\?.lua;" .. package.path
require("harness")

-- Stable facts about the development machine's library: identities, never counts.
local FIXTURE = {
  am2r_appid       = 4263274102,
  am2r_name        = "AM2R - Another Metroid 2 Remake",
  vitality_appid   = 4218550559,
  -- A native Steam game (Divinity: Original Sin 2) recorded in the same store,
  -- to prove native vs non-Steam id handling.
  native_appid     = 435150,
}
local skip_fixtures = os.getenv("NSGA_SKIP_FIXTURES") == "1"

local failures = 0
local function check(label, cond, detail)
  print((cond and "  PASS  " or "  FAIL  ") .. label .. (detail and ("  -> " .. detail) or ""))
  if not cond then failures = failures + 1 end
end

--- An assertion that only holds on the dev machine's library.
local function fixture(label, cond, detail)
  if skip_fixtures then
    print("  SKIP  " .. label)
    return
  end
  check(label, cond, detail)
end

-- ============ census helpers ============
-- Naive counts from the raw files, independent of shortcuts.lua / captures.lua.

--- Count the plain-text occurrences of `needle` in `hay`.
local function occurrences(hay, needle)
  local n, i = 0, 1
  while true do
    local at = hay:find(needle, i, true)
    if not at then return n end
    n, i = n + 1, at + 1
  end
end

--- shortcuts.vdf is binary VDF: every entry has the string fields "appname" and
--- "exe" (type byte 0x01, key, NUL, value, NUL). Keys are "AppName" / "appname"
--- and "Exe" / "exe" depending on the Steam version, so scan a lowercased copy.
local function census_shortcuts(file)
  local raw = (require("utils").read_file(file) or ""):lower()
  local retroarch, i = 0, 1
  local key = "\1exe\0"
  while true do
    local at = raw:find(key, i, true)
    if not at then break end
    local value_end = raw:find("\0", at + #key, true) or #raw + 1
    if raw:sub(at + #key, value_end - 1):find("retroarch.exe", 1, true) then retroarch = retroarch + 1 end
    i = at + 1
  end
  return occurrences(raw, "\1appname\0"), retroarch
end

--- screenshots.vdf is text VDF indented with tabs: a game is a bare key at one
--- tab, each of its screenshots has a "filename" line below it. A non-Steam
--- gameid is the composed 64-bit id (more than 10 digits; a native appid fits in
--- 10). The "shortcutnames" block at the end is not numeric, so it is skipped.
local function census_screenshots(file)
  local per_game, current = {}, nil
  for line in (require("utils").read_file(file) or ""):gmatch("[^\r\n]+") do
    local key = line:match('^\t"([^"]+)"%s*$')
    if key then
      current = (key:match("^%d+$") and #key > 10) and key or nil
    elseif current and line:find('"filename"', 1, true) then
      per_game[current] = (per_game[current] or 0) + 1
    end
  end
  local games, shots = 0, 0
  for _, n in pairs(per_game) do games, shots = games + 1, shots + n end
  return { games = games, shots = shots, per_game = per_game }
end

--- The last run's census, kept outside the repo, so a run says what changed.
local CENSUS_KEYS = { "shortcuts", "retroarch", "games_with_media", "screenshots" }
local CENSUS_FILE = (os.getenv("TEMP") or os.getenv("TMPDIR") or ".") .. "/steam-cartridges-census.txt"
local function census_drift(now)
  local before, changed = {}, {}
  local f = io.open(CENSUS_FILE, "r")
  if f then
    for k, v in f:read("*a"):gmatch("([%w_]+)=(%d+)") do before[k] = tonumber(v) end
    f:close()
  end
  for _, k in ipairs(CENSUS_KEYS) do
    if before[k] and before[k] ~= now[k] then changed[#changed + 1] = k .. " " .. before[k] .. " -> " .. now[k] end
  end
  print("  INFO  library since the last run: "
    .. (next(before) == nil and "first run" or #changed == 0 and "unchanged" or table.concat(changed, ", ")))
  f = io.open(CENSUS_FILE, "w")
  if f then
    for _, k in ipairs(CENSUS_KEYS) do f:write(k, "=", now[k], "\n") end
    f:close()
  end
end

-- ============ gameid ============
print("\n=== gameid ===")
local gameid = require("gameid")

local KNOWN = {
  { appid = 4263274102, gid = "18310622842007322624" },
  { appid = 4218550559, gid = "18118536687461072896" },
  { appid = 3224687354, gid = "13849926725288329216" },
  { appid = 3238783531, gid = "13910469344501956608" },
  { appid = 3177320499, gid = "13646487632148955136" },
  { appid = 2652500738, gid = "11392403922359418880" },
}
for _, case in ipairs(KNOWN) do
  local got = gameid.from_appid(case.appid)
  check("from_appid(" .. case.appid .. ")", got == case.gid, got)
  local back = gameid.to_appid(case.gid)
  check("to_appid(" .. case.gid .. ")", back == case.appid, tostring(back))
end
check("is_non_steam(big)", gameid.is_non_steam("18310622842007322624") == true)
check("is_non_steam(steam appid)", gameid.is_non_steam("1084600") == false)
check("is_non_steam(boundary 2^32-1)", gameid.is_non_steam("4294967295") == false)

-- ============ steam_paths ============
print("\n=== steam_paths ===")
local steam_paths = require("steam_paths")
local paths, err = steam_paths.resolve()
check("resolve()", paths ~= nil, err)
if paths then
  check("user_id looks numeric", paths.user_id:match("^%d+$") ~= nil, paths.user_id)
  check("shortcuts.vdf exists", require("fs").is_file(paths.shortcuts), paths.shortcuts)
  check("screenshots.vdf exists", require("fs").is_file(paths.screenshots_vdf))
end

-- ============ census ============
print("\n=== census (expected values, counted from the raw files) ===")
local CENSUS = {}
CENSUS.shortcuts, CENSUS.retroarch = census_shortcuts(paths.shortcuts)
local shots_census = census_screenshots(paths.screenshots_vdf)
CENSUS.games_with_media, CENSUS.screenshots = shots_census.games, shots_census.shots
print(string.format("  INFO  shortcuts=%d retroarch=%d games_with_media=%d screenshots=%d",
  CENSUS.shortcuts, CENSUS.retroarch, CENSUS.games_with_media, CENSUS.screenshots))
-- A census of zero would let a parser that finds nothing pass.
check("census found shortcuts", CENSUS.shortcuts > 0, tostring(CENSUS.shortcuts))
check("census found screenshots", CENSUS.screenshots > 0, tostring(CENSUS.screenshots))
census_drift(CENSUS)
--- Screenshots the census saw for one appid (nil when it has none).
local function census_shots(appid) return shots_census.per_game[gameid.from_appid(appid)] end

-- ============ shortcuts ============
print("\n=== shortcuts ===")
local shortcuts = require("shortcuts")
local entries = shortcuts.parse(paths.shortcuts)
check("parsed entries", entries ~= nil and #entries > 0, "#" .. tostring(entries and #entries))
check("shortcut count matches census", #entries == CENSUS.shortcuts, #entries .. " vs " .. CENSUS.shortcuts)

local retroarch, named, with_exe = 0, 0, 0
for _, e in ipairs(entries) do
  if e.exe:lower():find("retroarch.exe", 1, true) then retroarch = retroarch + 1 end
  if e.name ~= "" then named = named + 1 end
  if e.exe ~= "" then with_exe = with_exe + 1 end
end
check("all entries named", named == #entries, named .. "/" .. #entries)
check("all entries have exe", with_exe == #entries, with_exe .. "/" .. #entries)
check("retroarch shortcut count matches census", retroarch == CENSUS.retroarch, retroarch .. " vs " .. CENSUS.retroarch)

local by_appid = shortcuts.by_appid(entries)
local am2r = by_appid[FIXTURE.am2r_appid]
fixture("AM2R found by appid", am2r ~= nil, am2r and am2r.name)
if am2r then
  fixture("AM2R name correct", am2r.name == FIXTURE.am2r_name, am2r.name)
end

-- ============ captures ============
-- Scope: the screenshot index only. The recording parsers (clip.pb protobuf,
-- DASH manifests, session windows) and their tests were removed with ADR-0022 -
-- the frontend reads clips from Steam's own APIs now. Git history has them.
print("\n=== captures ===")
local captures = require("captures")

local counts = captures.non_steam_counts(paths)
local games, total = 0, 0
for _, n in pairs(counts) do games = games + 1; total = total + n end
check("non-steam games with media matches census", games == CENSUS.games_with_media,
      games .. " vs " .. CENSUS.games_with_media)
check("screenshots indexed matches census", total == CENSUS.screenshots, total .. " vs " .. CENSUS.screenshots)

fixture("AM2R screenshot count matches census", counts[FIXTURE.am2r_appid] == census_shots(FIXTURE.am2r_appid),
        tostring(counts[FIXTURE.am2r_appid]) .. " vs " .. tostring(census_shots(FIXTURE.am2r_appid)))
fixture("Super Metroid Vitality screenshot count matches census",
        counts[FIXTURE.vitality_appid] == census_shots(FIXTURE.vitality_appid),
        tostring(counts[FIXTURE.vitality_appid]) .. " vs " .. tostring(census_shots(FIXTURE.vitality_appid)))

check("unknown appid is not counted", counts[12345] == nil)
check("native Steam appid is not counted", counts[FIXTURE.native_appid] == nil)

-- library_stats: feeds the grid with a last-played lower bound
local lib = captures.library_stats(paths)
local lib_games = 0
for _ in pairs(lib) do lib_games = lib_games + 1 end
check("library_stats covers every media game", lib_games == CENSUS.games_with_media,
      lib_games .. " vs " .. CENSUS.games_with_media)

local stat = lib[FIXTURE.am2r_appid]
check("library_stats has AM2R", stat ~= nil)
if stat then
  check("library_stats screenshot count", stat.screenshots == counts[FIXTURE.am2r_appid],
        tostring(stat.screenshots))
  check("library_stats newest is a real timestamp", stat.newest > 1600000000,
        tostring(stat.newest))
end

check("library_stats excludes native Steam appids",
      lib[FIXTURE.native_appid] == nil)

-- every counted game must resolve back to a non-Steam appid
for appid, n in pairs(counts) do
  check("counted appid is non-Steam (" .. appid .. ")", appid >= 0x80000000)
  check("counted appid has screenshots (" .. appid .. ")", n > 0)
end


-- ============ rpc ============
print("\n=== rpc (shape) ===")
local RPC = require("rpc")
local diag = RPC.GetDiagnostics("{}")
check("GetDiagnostics returns json", type(diag) == "string" and diag:find("\"ok\""), diag)
print("    " .. diag)

local stats_json = RPC.GetLibraryStats("{}")
check("GetLibraryStats returns json",
      type(stats_json) == "string" and stats_json:find("screenshots", 1, true) ~= nil)

-- ============ merged plugin: web modules, data dir, migration ============
print("\n=== steam-cartridges (merge invariants) ===")

for _, e in ipairs(entries) do
  local ok = e.tags == nil
  if type(e.tags) == "table" then
    ok = true
    for _, tag in ipairs(e.tags) do
      if type(tag) ~= "string" then ok = false end
    end
  end
  if not ok then check("shortcut tags is nil or string[] (" .. tostring(e.appid) .. ")", false) end
end
check("shortcut tags are nil or string arrays", true)

for _, mod in ipairs({ "web_metadata_db", "web_config", "web_igdb", "web_sgdb", "web_rpc", "data_dir", "migrate" }) do
  local ok, res = pcall(require, mod)
  check("require(" .. mod .. ") loads", ok, not ok and tostring(res) or nil)
end

local data_dir = require("data_dir")
local real_path = data_dir.path():gsub("\\", "/")
check("data_dir.path() ends in millennium/config/steam-cartridges",
      real_path:sub(-#"millennium/config/steam-cartridges") == "millennium/config/steam-cartridges", real_path)
check("data_dir.path() has no backslash", not data_dir.path():find("\\", 1, true))

-- Migration against a throwaway Steam root: never touches the real one.
do
  local millennium = require("millennium")
  local config = require("web_config")
  local migrate = require("migrate")
  local fs = require("fs")
  local utils = require("utils")

  local base = (os.getenv("TEMP") or "."):gsub("\\", "/") .. "/sc_migrate_" .. tostring(os.time())
  local SENTINEL = "SENTINEL_SECRET_VALUE_12345"
  fs.create_directories(base .. "/millennium/config")
  utils.write_file(base .. "/legacy.env",
    "twitch_client_id=idvalue\ntwitch_client_secret=" .. SENTINEL .. "\nsteamgriddb_api=k" .. SENTINEL .. "\nother=x\n")
  utils.write_file(base .. "/library_metadata.json", "{}")

  local saved_steam, saved_cands = millennium.steam_path, config.legacy_env_candidates
  millennium.steam_path = function() return base end
  config.legacy_env_candidates = { base .. "/legacy.env" }
  data_dir._reset(); config._reset()

  local printed = {}
  local real_print = print
  print = function(...) local p = {} for i = 1, select("#", ...) do p[#p + 1] = tostring((select(i, ...))) end printed[#printed + 1] = table.concat(p, " ") end
  local ran1 = migrate.run()
  local ran2 = migrate.run()
  print = real_print

  check("migrate.run() first call does work", ran1 == true)
  check("migrate.run() second call is a no-op", ran2 == false)
  check("migrate wrote .env", fs.is_file(data_dir.file(".env")))
  check("migrate wrote marker", fs.is_file(data_dir.file(".migrated-v1")))
  check("migrate copied library_metadata.json", fs.is_file(data_dir.file("library_metadata.json")))
  check("migrate kept the original library_metadata.json", fs.is_file(base .. "/library_metadata.json"))
  local env_text = utils.read_file(data_dir.file(".env")) or ""
  check("migrated .env has only the three keys", not env_text:find("other=", 1, true))
  check("migrate output never prints a secret", not table.concat(printed, "\n"):find(SENTINEL, 1, true))

  config._reset()
  local creds = config.get_twitch_credentials()
  check("config reads migrated credentials from the data dir", creds ~= nil and creds.client_id == "idvalue")

  millennium.steam_path, config.legacy_env_candidates = saved_steam, saved_cands
  data_dir._reset(); config._reset()
  os.execute('rmdir /s /q "' .. base:gsub("/", "\\") .. '" >nul 2>nul')
end

-- the network stub must trip, proving tests cannot go online
check("http stub refuses network", not pcall(require("http").get, "http://example.invalid"))

print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
