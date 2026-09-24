--- One-time migration from the two legacy plugins to the data folder
--- (ADR-0032). Guarded by <data_dir>/.migrated-v1.
---
--- Copies, never moves, so rolling back to the old plugins loses nothing.
--- Logs counts and booleans only. NEVER log a credential value.

local fs         = require("fs")
local utils      = require("utils")
local logger     = require("logger")
local millennium = require("millennium")
local data_dir   = require("data_dir")
local config     = require("web_config")

local migrate = {}

local MARKER = ".migrated-v1"
local KEYS = { "twitch_client_id", "twitch_client_secret", "steamgriddb_api" }

local function yn(b) return b and "yes" or "no" end

---@return boolean ran false when the marker already existed
function migrate.run()
  local marker = data_dir.file(MARKER)
  if fs.is_file(marker) then return false end

  local env_path = data_dir.file(".env")
  local migrated_twitch, migrated_sgdb, copied_db = false, false, false

  -- 1. Credentials: only when the data folder has no .env yet.
  if not fs.is_file(env_path) then
    local legacy = config.find_legacy_env() or {}
    local legacy_key = config.find_legacy_key()
    if legacy_key and #legacy_key > 0 then legacy.steamgriddb_api = legacy_key end

    local lines = {}
    for _, k in ipairs(KEYS) do
      local v = legacy[k]
      if v and #v > 0 then lines[#lines + 1] = k .. "=" .. v end
    end
    if #lines > 0 then
      local ok = utils.write_file(env_path, table.concat(lines, "\n") .. "\n")
      if ok ~= false then
        migrated_twitch = legacy.twitch_client_id ~= nil and legacy.twitch_client_secret ~= nil
        migrated_sgdb = legacy.steamgriddb_api ~= nil
      end
    end
  end

  -- 2. Metadata cache: copy, keep the original.
  local new_db = data_dir.file("library_metadata.json")
  if not fs.is_file(new_db) then
    local ok_sp, sp = pcall(millennium.steam_path)
    if ok_sp and sp and #sp > 0 then
      local old_db = (sp:gsub("\\", "/")):gsub("/+$", "") .. "/library_metadata.json"
      if fs.is_file(old_db) then
        local content = utils.read_file(old_db)
        if content and utils.write_file(new_db, content) ~= false then copied_db = true end
      end
    end
  end

  utils.write_file(marker, "1\n")
  config._reset()

  logger:info("Migration v1: migrated twitch creds: " .. yn(migrated_twitch)
    .. ", migrated sgdb key: " .. yn(migrated_sgdb)
    .. ", copied metadata db: " .. yn(copied_db))
  return true
end

return migrate
