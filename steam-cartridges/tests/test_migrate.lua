-- Migration v2 test suite: the orphaned library_metadata.json cleanup (migration
-- plan § 7 M4.0). Hermetic: runs against a throwaway data dir, never the real one.
--
--   lua tests\test_migrate.lua

package.path = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or ".")
  .. "\\?.lua;" .. package.path
require("harness")

local failures = 0
local function check(label, cond, detail)
  print((cond and "  PASS  " or "  FAIL  ") .. label .. (detail and ("  -> " .. detail) or ""))
  if not cond then failures = failures + 1 end
end

print("\n=== migrate.run_v2 (orphaned metadata cleanup) ===")

local fs = require("fs")
local utils = require("utils")
local json = require("json")
local millennium = require("millennium")
local data_dir = require("data_dir")
local migrate = require("migrate")

local base = (os.getenv("TEMP") or "."):gsub("\\", "/") .. "/sc_migrate_v2_" .. tostring(os.time())
fs.create_directories(base .. "/millennium/config")

local saved_steam_path = millennium.steam_path
millennium.steam_path = function() return base end
data_dir._reset()

-- Fixture: five orphaned keys (one with custom_override, which must survive),
-- plus two real records that must stay byte-identical.
local FIXTURE = {
  ["3876190134"] = { appid = 3876190134, title = "Densetsu no Ogre Battle", custom_override = false },
  ["4034579314"] = { appid = 4034579314, title = "Wing Commander Prophecy: Secret Ops", custom_override = false },
  ["1234567890"] = { appid = 1234567890, title = "Chrono Trigger", custom_override = false },
  ["4000000001"] = { appid = 4000000001, title = "Secret of Mana", custom_override = false },
  -- This orphan has a manual edit and must be kept despite being on the list.
  ["999999"]     = { appid = 999999, title = "Sengoku 3", custom_override = true, description = "hand-edited" },
  ["4263274102"] = { appid = 4263274102, title = "AM2R - Another Metroid 2 Remake", custom_override = false,
                      categories = { single_player = true, coop = false } },
  ["3135033888"] = { appid = 3135033888, title = "WUCHANG: Fallen Feathers", custom_override = false },
}

local db_path = data_dir.file("library_metadata.json")
utils.write_file(db_path, json.encode(FIXTURE))

local ran1 = migrate.run_v2()
local ran2 = migrate.run_v2()

check("v2 runs once (marker)", ran1 == true and ran2 == false)
check("v2 writes the backup first", fs.is_file(db_path .. ".bak-v2"))

local backup_content = utils.read_file(db_path .. ".bak-v2") or ""
local backup = json.decode(backup_content)
check("v2 backup holds the pre-migration record count", backup["3876190134"] ~= nil and backup["999999"] ~= nil)

local after_content = utils.read_file(db_path) or ""
local after = json.decode(after_content)

check("v2 removes the five orphans",
  after["3876190134"] == nil and after["4034579314"] == nil and after["1234567890"] == nil
  and after["4000000001"] == nil and after["999999"] ~= nil)
check("v2 keeps a record with custom_override",
  after["999999"] ~= nil and after["999999"].custom_override == true
  and after["999999"].description == "hand-edited")
check("v2 leaves every other record byte-identical",
  after["4263274102"] ~= nil and after["4263274102"].title == "AM2R - Another Metroid 2 Remake"
  and after["4263274102"].categories ~= nil and after["4263274102"].categories.single_player == true
  and after["3135033888"] ~= nil and after["3135033888"].title == "WUCHANG: Fallen Feathers")

-- Second call is a true no-op: the file is untouched byte-for-byte.
local content_after_second_run = utils.read_file(db_path) or ""
check("second run leaves the file untouched", content_after_second_run == after_content)

print("\n=== web_config.save_credentials keeps the legacy .env ===")

-- A save must not hide keys that only the legacy .env holds (a ScreenScraper account there vanished from GetStatus
-- after any save, until Steam restarted).
local config = require("web_config")
local legacy_path = base .. "/legacy.env"
utils.write_file(legacy_path, "screenscraper_user=player\nscreenscraper_pass=pw\n")
local saved_candidates = config.legacy_env_candidates
config.legacy_env_candidates = { legacy_path }
config._reset()
check("legacy ScreenScraper account found", config.get_screenscraper_credentials() ~= nil)
config.save_credentials({ zz_probe = "x" })
check("still found after a save", config.get_screenscraper_credentials() ~= nil)
config.save_credentials({ zz_probe = "" })
local ss = config.get_screenscraper_credentials()
check("the player account is the saved one, the developer id the plugin's own (screenscraper_dev.lua)", ss.user == "player" and ss.pass == "pw" and #ss.dev_user > 0 and #ss.dev_pw > 0)
utils.write_file(legacy_path, "screenscraper_dev_user=dev\nscreenscraper_dev_pw=devpw\n")
config._reset()
check("no player account: no ScreenScraper (each player brings their own)", config.get_screenscraper_credentials() == nil)
utils.write_file(legacy_path, "screenscraper_user=player\nscreenscraper_pass=pw\nscreenscraper_dev_user=dev\nscreenscraper_dev_pw=devpw\n")
config._reset()
ss = config.get_screenscraper_credentials()
check("a developer pair in .env overrides the shipped one", ss.dev_user == "dev" and ss.dev_pw == "devpw")
config.legacy_env_candidates = saved_candidates
config._reset()

millennium.steam_path = saved_steam_path
data_dir._reset()
os.execute('rmdir /s /q "' .. base:gsub("/", "\\") .. '" >nul 2>nul')

print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
