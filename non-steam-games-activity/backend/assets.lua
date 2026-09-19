--- Serves local capture images to the sandboxed frontend.
---
--- The frontend runs in Chromium and cannot read the filesystem, and
--- `file://` is blocked from Steam's origin. Millennium's `steamloopback.host`
--- interception CANNOT help here: it resolves URLs against `<Steam>/steamui/`
--- only, rejecting `..`, absolute paths and UNC (verified in Millennium's
--- `src/instrumentation/loopback/src/url.rs`). Our captures live under
--- `<Steam>/userdata/`, outside that jail.
---
--- So images cross the RPC boundary as base64 data URIs. See ADR-0015.
---
--- Sizes on the dev machine make the strategy obvious:
---   Steam thumbnails  ~11 KB median  -> cheap, send many
---   Full screenshots  ~1 MB median   -> on demand, one at a time
--- Base64 adds ~33%, so a 20-thumbnail page is ~0.4 MB of JSON.

local fs     = require("fs")
local utils  = require("utils")
local logger = require("logger")

local assets = {}

--- Hard ceiling so a single request cannot blow up the RPC channel. Steam's
--- own screenshots top out under 3 MB; anything larger is not ours to serve.
local MAX_BYTES = 12 * 1024 * 1024

local MIME = {
  [".jpg"]  = "image/jpeg",
  [".jpeg"] = "image/jpeg",
  [".png"]  = "image/png",
  [".gif"]  = "image/gif",
  [".webp"] = "image/webp",
}

--- Only paths inside the Steam user's capture directories may be read. The
--- frontend supplies these paths, and although it only ever echoes back paths
--- we gave it, a bug or a compromised renderer must not turn this into an
--- arbitrary file reader.
---@param paths steam_paths.Paths
---@param path string
---@return boolean
local function is_allowed(path, paths)
  if type(path) ~= "string" or path == "" then return false end

  -- Reject traversal outright rather than trying to normalise it away.
  if path:find("%.%.") then return false end

  local normalised = path:gsub("/", "\\"):lower()
  for _, root in ipairs({ paths.screenshots_root, paths.recordings }) do
    local prefix = root:gsub("/", "\\"):lower()
    if normalised:sub(1, #prefix) == prefix then return true end
  end
  return false
end

---@param path string
---@return string|nil mime
local function mime_for(path)
  return MIME[(fs.extension(path) or ""):lower()]
end

--- Read one image and return it as a data URI.
---@param path string Absolute path, inside a capture directory
---@param paths steam_paths.Paths
---@return table result { ok, uri?, bytes?, error? }
function assets.read(path, paths)
  if not is_allowed(path, paths) then
    return { ok = false, error = "path is not inside a capture directory" }
  end

  local mime = mime_for(path)
  if not mime then
    return { ok = false, error = "unsupported file type" }
  end

  if not fs.is_file(path) then
    -- Expected: Steam's index can outlive the file it points at.
    return { ok = false, error = "file not found" }
  end

  local size = fs.file_size(path) or 0
  if size > MAX_BYTES then
    return { ok = false, error = "file too large" }
  end

  local content, err = utils.read_file(path)
  if not content then
    logger:warn("could not read asset " .. path .. ": " .. tostring(err))
    return { ok = false, error = "could not read file" }
  end

  return {
    ok    = true,
    uri   = "data:" .. mime .. ";base64," .. utils.base64_encode(content),
    bytes = #content,
  }
end

--- Read several images in one round trip.
---
--- Intended for thumbnails, which are small. A per-call budget stops a caller
--- from accidentally requesting a page's worth of full-size screenshots; the
--- results say which entries were skipped so the UI can fetch them singly.
---@param list string[]
---@param paths steam_paths.Paths
---@param budget? integer Total decoded bytes allowed (default 8 MB)
---@return table<string, table>
function assets.read_many(list, paths, budget)
  local remaining = budget or (8 * 1024 * 1024)
  local out = {}

  for _, path in ipairs(list or {}) do
    if remaining <= 0 then
      out[path] = { ok = false, error = "budget exhausted" }
    else
      local result = assets.read(path, paths)
      out[path] = result
      if result.ok then remaining = remaining - (result.bytes or 0) end
    end
  end

  return out
end

return assets
