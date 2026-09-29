--- The record facade: GetGameRecord (disk only) and EnsureFresh (resolves
--- stale parts). Migration plan M4b; M5a adds "metadata" and GetAllRecords.

local core             = require("rpc")
local resolve_identity  = require("resolve_identity")

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
    end
    -- Unknown part names are ignored (not an error).
  end

  return { appid = tonumber(appid), parts = parts }
end)

return RPC
