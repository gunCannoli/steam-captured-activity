-- Backend test suite. Runs the real modules against a real Steam install.
--
--   lua tests\test_backend.lua
--
-- Steam root comes from NSGA_STEAM_ROOT (see harness.lua). The FIXTURE block
-- below records the dev machine's library; on any other install those counts
-- will differ, so set NSGA_SKIP_FIXTURES=1 to run only the invariant checks.
--
-- Lua is not bundled with Millennium; get a standalone interpreter from
-- https://luabinaries.sourceforge.net/ to run this.

package.path = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or ".")
  .. "\\?.lua;" .. package.path
require("harness")

-- Expected values for the development machine's library.
local FIXTURE = {
  shortcuts        = 220,
  retroarch        = 216,
  games_with_media = 6,
  screenshots      = 213,
  am2r_appid       = 4263274102,
  am2r_name        = "AM2R - Another Metroid 2 Remake",
  am2r_shots       = 4,
  vitality_appid   = 4218550559,
  vitality_shots   = 3,
  -- A 14.144s clip recorded on AM2R; see docs/knowledgebase.md "Recordings".
  am2r_clips       = 1,
  am2r_clip_ms     = 14144,
  am2r_clip_at     = 1789835832,
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

-- ============ shortcuts ============
print("\n=== shortcuts ===")
local shortcuts = require("shortcuts")
local entries = shortcuts.parse(paths.shortcuts)
check("parsed entries", entries ~= nil and #entries > 0, "#" .. tostring(entries and #entries))
fixture("shortcut count", #entries == FIXTURE.shortcuts, "#" .. #entries)

local retroarch, named, with_exe = 0, 0, 0
for _, e in ipairs(entries) do
  if e.exe:lower():find("retroarch.exe", 1, true) then retroarch = retroarch + 1 end
  if e.name ~= "" then named = named + 1 end
  if e.exe ~= "" then with_exe = with_exe + 1 end
end
check("all entries named", named == #entries, named .. "/" .. #entries)
check("all entries have exe", with_exe == #entries, with_exe .. "/" .. #entries)
fixture("retroarch shortcut count", retroarch == FIXTURE.retroarch, tostring(retroarch))

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
fixture("non-steam games with media", games == FIXTURE.games_with_media, tostring(games))
fixture("screenshots indexed", total == FIXTURE.screenshots, tostring(total))

fixture("AM2R screenshot count", counts[FIXTURE.am2r_appid] == FIXTURE.am2r_shots,
        tostring(counts[FIXTURE.am2r_appid]))
fixture("Super Metroid Vitality screenshot count",
        counts[FIXTURE.vitality_appid] == FIXTURE.vitality_shots,
        tostring(counts[FIXTURE.vitality_appid]))

check("unknown appid is not counted", counts[12345] == nil)
check("native Steam appid is not counted", counts[FIXTURE.native_appid] == nil)

-- library_stats: feeds the grid with a last-played lower bound
local lib = captures.library_stats(paths)
local lib_games = 0
for _ in pairs(lib) do lib_games = lib_games + 1 end
fixture("library_stats covers every media game", lib_games == FIXTURE.games_with_media,
        tostring(lib_games))

local stat = lib[FIXTURE.am2r_appid]
check("library_stats has AM2R", stat ~= nil)
if stat then
  fixture("library_stats screenshot count", stat.screenshots == FIXTURE.am2r_shots,
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

-- ============ achievements_observer: UE project codename discovery ============
print("\n=== achievements_observer.get_possible_folder_names ===")
do
  local observer = require("achievements_observer")

  local function contains(list, value)
    for _, v in ipairs(list) do
      if v == value then return true end
    end
    return false
  end

  -- Real-world case: "WUCHANG: Fallen Feathers" ships as Project_Plague.exe.
  local candidates = observer.get_possible_folder_names(
    "WUCHANG: Fallen Feathers",
    [[D:\Games\Local\Wuchang - Fallen Feathers\Project_Plague-Win64-Shipping.exe]]
  )
  check("derives Unreal project codename from shipping exe", contains(candidates, "Project_Plague"), table.concat(candidates, ", "))
  check("keeps exact title as a candidate", contains(candidates, "WUCHANG: Fallen Feathers"))
  check("keeps colon-to-dash normalized title", contains(candidates, "WUCHANG - Fallen Feathers"))
  check("exe codename is checked first", candidates[1] == "Project_Plague", candidates[1])

  -- No exe path: falls back to title-only variations, still works.
  local title_only = observer.get_possible_folder_names("Hollow Knight", nil)
  check("falls back to title when exe path is missing", contains(title_only, "Hollow Knight"), table.concat(title_only, ", "))
  check("no exe path yields no nil/empty candidate", #title_only > 0)

  -- Non-shipping exe basename is used as-is (no suffix to strip).
  local plain_exe = observer.get_possible_folder_names("Some Game", [[C:\Games\SomeGame\SomeGame.exe]])
  check("plain exe basename has extension stripped", contains(plain_exe, "SomeGame"), table.concat(plain_exe, ", "))
end

print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
