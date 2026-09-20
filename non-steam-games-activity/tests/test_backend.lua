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
  shortcuts        = 223,
  retroarch        = 210,
  games_with_media = 6,
  screenshots      = 211,
  am2r_appid       = 4263274102,
  am2r_name        = "AM2R - Another Metroid 2 Remake",
  am2r_shots       = 2,
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
print("
=== captures ===")
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
print("
=== rpc (shape) ===")
local RPC = require("rpc")
local diag = RPC.GetDiagnostics("{}")
check("GetDiagnostics returns json", type(diag) == "string" and diag:find("\"ok\""), diag)
print("    " .. diag)

local stats_json = RPC.GetLibraryStats("{}")
check("GetLibraryStats returns json",
      type(stats_json) == "string" and stats_json:find("screenshots", 1, true) ~= nil)

print("
" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
