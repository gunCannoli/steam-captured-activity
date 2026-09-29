--- The record facade: GetGameRecord (disk only), EnsureFresh (resolves stale
--- parts) and GetAllRecords (disk only). Migration plan M4b; M5a adds
--- "metadata" and GetAllRecords.

local core             = require("rpc")
local resolve_identity  = require("resolve_identity")
local metadata_service  = require("metadata_service")
local metadata_db       = require("web_metadata_db")
local steam_store_store = require("steam_store_store")

local method = core.method

local RPC = {}

local function need(data, field)
  if data[field] == nil then error("missing " .. field) end
  return data[field]
end

local SHORTCUT_MIN = 0x80000000

local function is_shortcut(appid)
  local n = tonumber(appid)
  return n ~= nil and n >= SHORTCUT_MIN
end

RPC.GetGameRecord = method("GetGameRecord", function(data)
  local appid = need(data, "appid")
  if not is_shortcut(appid) then return { error = "not a shortcut" } end

  local parts = {}
  local identity = resolve_identity.saved(appid)
  if identity then parts.identity = identity end
  local metadata = metadata_service.local_part(appid)
  if metadata then parts.metadata = metadata end

  return { appid = tonumber(appid), parts = parts }
end)

RPC.EnsureFresh = method("EnsureFresh", function(data)
  local appid = need(data, "appid")
  if not is_shortcut(appid) then return { error = "not a shortcut" } end
  local requested = need(data, "parts")
  local ctx = data.context or {}

  local parts = {}
  for _, name in ipairs(requested) do
    if name == "identity" then
      parts.identity = resolve_identity.ensure(appid, ctx)
    elseif name == "metadata" then
      parts.metadata = metadata_service.ensure(appid, ctx)
    end
    -- Unknown part names are ignored (not an error).
  end

  return { appid = tonumber(appid), parts = parts }
end)

--- Every DB record and every saved mapping, disk only. Replaces the frontend's
--- getAllMetadata preload in M5b.
RPC.GetAllRecords = method("GetAllRecords", function(_)
  local records = {}
  local all_meta = metadata_db.get_all()
  for key, rec in pairs(all_meta) do
    records[key] = records[key] or {}
    records[key].metadata = { status = "ok", data = rec, source = rec.custom_override and "custom" or "local_db" }
  end
  for key, mapping in pairs(steam_store_store.get_state().mappings) do
    records[key] = records[key] or {}
    records[key].identity = {
      status = "ok",
      data = { native = { appid = mapping.steam_appid, source = mapping.source } },
      source = "steam-store",
    }
  end
  return { records = records }
end)

return RPC
