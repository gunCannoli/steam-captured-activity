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
print("\n=== captures ===")
local captures = require("captures")

local counts = captures.non_steam_counts(paths)
local games, total = 0, 0
for _, n in pairs(counts) do games = games + 1; total = total + n end
fixture("non-steam games with media", games == FIXTURE.games_with_media, tostring(games))
fixture("screenshots indexed", total == FIXTURE.screenshots, tostring(total))

local am2r_shots = captures.screenshots_for(paths, FIXTURE.am2r_appid)
fixture("AM2R screenshot count", #am2r_shots == FIXTURE.am2r_shots, "#" .. #am2r_shots)
if #am2r_shots > 0 then
  local s = am2r_shots[1]
  check("screenshot has real path", require("fs").is_file(s.path), s.path)
  check("screenshot has timestamp", s.taken_at > 1600000000, tostring(s.taken_at))
  check("screenshot has dimensions", s.width > 0 and s.height > 0,
        s.width .. "x" .. s.height)
  check("newest first", am2r_shots[1].taken_at >= am2r_shots[#am2r_shots].taken_at)
end

local vitality = captures.screenshots_for(paths, FIXTURE.vitality_appid)
fixture("Super Metroid Vitality screenshot count", #vitality == FIXTURE.vitality_shots, "#" .. #vitality)

check("unknown appid returns empty", #captures.screenshots_for(paths, 12345) == 0)

-- recordings: Steam stores clips as directories with a protobuf metadata file
local clips = captures.recordings_for(paths, FIXTURE.am2r_appid)
fixture("AM2R clip count", #clips == FIXTURE.am2r_clips, "#" .. #clips)
if #clips > 0 then
  local c = clips[1]
  check("clip kind", c.kind == "clip", c.kind)
  fixture("clip duration from clip.pb", c.duration_ms == FIXTURE.am2r_clip_ms,
          tostring(c.duration_ms))
  fixture("clip start time from clip.pb", c.started_at == FIXTURE.am2r_clip_at,
          tostring(c.started_at))
  check("clip timestamp is an integer", tostring(c.started_at):find("%.") == nil,
        tostring(c.started_at))
  check("clip has thumbnail", c.thumbnail ~= nil and require("fs").is_file(c.thumbnail),
        tostring(c.thumbnail))
  check("clip has DASH manifest", c.manifest ~= nil and require("fs").is_file(c.manifest),
        tostring(c.manifest))
  check("clip has dimensions", c.width > 0 and c.height > 0, c.width .. "x" .. c.height)
end

check("unknown appid has no recordings", #captures.recordings_for(paths, 12345) == 0)

-- sessions: gamerecording.pb indexes play sessions, and is the scope Steam's
-- own POST-GAME SUMMARY uses
local sessions = captures.sessions_for(paths, FIXTURE.am2r_appid)
fixture("AM2R has a session", #sessions > 0, "#" .. #sessions)
if #sessions > 0 then
  local sess = sessions[1]
  check("session has start time", sess.started_at > 1600000000, tostring(sess.started_at))
  check("session has duration", sess.duration_ms > 0, tostring(sess.duration_ms))
  check("session end after start", sess.ended_at >= sess.started_at)
  check("sessions newest first", sessions[1].started_at >= sessions[#sessions].started_at)
end

-- Native Steam games live in the SAME store but key on the raw appid, not the
-- composed gameid. Regression guard: a plain appid must not be transformed.
local native_recs = captures.recordings_for(paths, FIXTURE.native_appid)
local native_sess = captures.sessions_for(paths, FIXTURE.native_appid)
fixture("native game recording found", #native_recs > 0, "#" .. #native_recs)
fixture("native game session found", #native_sess > 0, "#" .. #native_sess)

check("no session for unknown appid", #captures.sessions_for(paths, 12345) == 0)

-- every indexed file must exist on disk
local missing = 0
for appid in pairs(counts) do
  for _, s in ipairs(captures.screenshots_for(paths, appid)) do
    if not require("fs").is_file(s.path) then missing = missing + 1 end
  end
end
check("no missing files", missing == 0, tostring(missing) .. " missing")

-- ============ timeline ============
print("\n=== timeline ===")
local timeline = require("timeline")
local entries_t = timeline.from_media(am2r_shots, clips)
check("media -> entries", #entries_t == #am2r_shots + #clips,
      #entries_t .. " vs " .. (#am2r_shots + #clips))

local has_recording = false
for _, e in ipairs(entries_t) do
  if e.type == "recording" then has_recording = true end
end
fixture("recording reaches the timeline", has_recording)

local days = timeline.group(entries_t)
check("grouped into days", #days > 0, "#" .. #days)
if #days > 0 then
  check("date format YYYY-MM-DD", days[1].date:match("^%d%d%d%d%-%d%d%-%d%d$") ~= nil, days[1].date)
end

-- ordering: days descending, entries within a day descending
local ordered = true
for i = 2, #days do
  if days[i - 1].date < days[i].date then ordered = false end
end
check("days newest first", ordered)

check("drops zero timestamps", #timeline.group({ { type = "x", at = 0 } }) == 0)

-- post-game summary: scoped to the last SESSION, not the last calendar day
local summary = timeline.post_game_summary(entries_t, sessions)
fixture("summary built", summary ~= nil)
if summary then
  fixture("summary is session-scoped", summary.source == "session", summary.source)
  check("summary has entries", #summary.entries > 0, "#" .. #summary.entries)
  local within = true
  for _, e in ipairs(summary.entries) do
    if e.at < summary.started_at - 120 or e.at > summary.ended_at + 120 then
      within = false
    end
  end
  check("summary entries inside session window", within)
end

-- With no session index, fall back to the newest day.
local fallback = timeline.post_game_summary({
  { type = "screenshot", at = 1761276095 },
  { type = "screenshot", at = 1760533309 },
}, {})
check("summary falls back to newest day", fallback ~= nil and fallback.source == "day",
      fallback and fallback.source)
if fallback then
  check("fallback picks one day only", #fallback.entries == 1, "#" .. #fallback.entries)
end
check("no summary without media", timeline.post_game_summary({}, {}) == nil)

-- multi-day grouping with a synthetic set
local synth = timeline.group({
  { type = "a", at = 1761276095 },
  { type = "b", at = 1761276099 },
  { type = "c", at = 1760533309 },
})
check("groups 3 entries into 2 days", #synth == 2, "#" .. #synth)
if #synth == 2 then
  check("first day has 2 entries", #synth[1].entries == 2, "#" .. #synth[1].entries)
  check("entries within day newest first",
        synth[1].entries[1].at >= synth[1].entries[2].at)
end

-- ============ rpc ============
print("\n=== rpc (shape) ===")
local RPC = require("rpc")
local diag = RPC.GetDiagnostics("{}")
check("GetDiagnostics returns json", type(diag) == "string" and diag:find("\"ok\""), diag)
print("    " .. diag)

print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
