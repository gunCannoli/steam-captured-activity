--- Reads Steam's own screenshot and recording stores.
---
--- Screenshots are indexed by userdata/<id>/760/screenshots.vdf, which - unlike
--- shortcuts.vdf - is TEXT VDF:
---
---   "screenshots"
---   {
---     "18310622842007322624"     <- gameid
---     {
---       "0"
---       {
---         "filename"   "18310622842007322624/screenshots/20251024002134_1.jpg"
---         "thumbnail"  "…/thumbnails/20251024002134_1.jpg"
---         "creation"   "1761276095"   <- unix seconds
---         "width"      "3840"
---         "height"     "2160"
---       }
---     }
---   }
---
--- Paths are relative to userdata/<id>/760/remote/.

local fs     = require("fs")
local utils  = require("utils")
local logger = require("logger")
local gameid = require("gameid")

local captures = {}

--- Steam assigns non-Steam shortcuts appids at the top of the 32-bit range.
--- Matches the frontend SDK's NON_STEAM_APP_APPID_MASK.
local NON_STEAM_APPID_MIN = 0x80000000

---@class captures.Screenshot
---@field path string       Absolute path on disk
---@field thumb string|nil  Absolute path to Steam's thumbnail, if present
---@field taken_at integer  Unix seconds
---@field width integer
---@field height integer

--- Parse the text VDF into { [gameid] = { {filename=…, creation=…}, … } }.
---
--- Nesting is what distinguishes a game key from a screenshot index - NOT the
--- length of the number. A Steam appid like "238960" is the same shape as the
--- screenshot index "0"; only depth tells them apart:
---
---   "screenshots"          depth 0
---   {
---     "18310622842007322624"   depth 1  <- game
---     {
---       "0"                    depth 2  <- screenshot
---       {
---         "filename" "…"       depth 3  <- field
---
--- So we track brace depth rather than guessing from the key.
---@param content string
---@return table<string, table[]>
local function parse_screenshots_vdf(content)
  local games = {}
  local depth = 0
  local pending = nil    ---@type string|nil  key awaiting its opening brace
  local current_game = nil
  local current_shot = nil

  for line in content:gmatch("[^\r\n]+") do
    local trimmed = line:match("^%s*(.-)%s*$")

    if trimmed == "{" then
      -- The key we just saw opens a block at this depth.
      if depth == 1 and pending then
        current_game = pending
        games[current_game] = games[current_game] or {}
        current_shot = nil
      elseif depth == 2 and pending and current_game then
        current_shot = {}
        local list = games[current_game]
        list[#list + 1] = current_shot
      end
      pending = nil
      depth = depth + 1
    elseif trimmed == "}" then
      depth = depth - 1
      if depth <= 1 then current_shot = nil end
      if depth <= 0 then current_game = nil end
      pending = nil
    else
      local key, value = trimmed:match('^"([^"]+)"%s+"([^"]*)"$')
      if key then
        -- A key/value pair: only meaningful inside a screenshot block.
        if current_shot and depth == 3 then
          local lowered = key:lower()
          if lowered == "filename" or lowered == "thumbnail" then
            current_shot[lowered] = value
          elseif lowered == "creation" or lowered == "width" or lowered == "height" then
            current_shot[lowered] = tonumber(value)
          end
        end
      else
        -- A bare quoted key: remember it until its brace arrives.
        pending = trimmed:match('^"([^"]+)"$') or pending
      end
    end
  end

  return games
end

local cache = { mtime = -1, games = nil } ---@type table

--- Load and index every screenshot, keyed by gameid string.
---@param paths steam_paths.Paths
---@return table<string, table[]> games
local function load_index(paths)
  if not fs.is_file(paths.screenshots_vdf) then
    return {}
  end

  local mtime = fs.last_write_time(paths.screenshots_vdf) or 0
  if cache.games and cache.mtime == mtime then
    return cache.games
  end

  local content, err = utils.read_file(paths.screenshots_vdf)
  if not content then
    logger:warn("could not read screenshots.vdf: " .. tostring(err))
    return {}
  end

  local games = parse_screenshots_vdf(content)
  cache.mtime = mtime
  cache.games = games
  return games
end

--- Screenshots for one non-Steam app, newest first.
---
--- The index can outlive the files it points at, so every entry is stat-ed
--- before being returned.
---@param paths steam_paths.Paths
---@param appid integer
---@return captures.Screenshot[]
function captures.screenshots_for(paths, appid)
  local games = load_index(paths)
  local id = gameid.from_appid(appid)
  local raw = games[id]
  if not raw then return {} end

  local out = {}
  for _, shot in ipairs(raw) do
    if shot.filename then
      local abs = fs.join(paths.screenshots_root, (shot.filename:gsub("/", "\\")))
      if fs.is_file(abs) then
        local thumb = nil
        if shot.thumbnail then
          local thumb_abs = fs.join(paths.screenshots_root, (shot.thumbnail:gsub("/", "\\")))
          if fs.is_file(thumb_abs) then thumb = thumb_abs end
        end

        out[#out + 1] = {
          path     = abs,
          thumb    = thumb,
          taken_at = shot.creation or fs.last_write_time(abs) or 0,
          width    = shot.width or 0,
          height   = shot.height or 0,
        }
      end
    end
  end

  table.sort(out, function(a, b) return a.taken_at > b.taken_at end)
  return out
end

--- Every gameid in the screenshot index that belongs to a non-Steam game.
--- Includes ids whose shortcut has since been deleted - callers decide whether
--- to show those.
---@param paths steam_paths.Paths
---@return table<integer, integer> counts  appid -> screenshot count
function captures.non_steam_counts(paths)
  local games = load_index(paths)
  local counts = {}
  for id, list in pairs(games) do
    if gameid.is_non_steam(id) then
      local appid = gameid.to_appid(id)
      if appid then counts[appid] = #list end
    end
  end
  return counts
end

--- Per-app capture summary for the library grid.
---
--- `newest` is the most recent capture time and doubles as evidence the game
--- was played: Steam leaves `rt_last_time_played` at 0 for shortcuts it did not
--- launch itself, even when screenshots plainly exist.
---
--- Reads the screenshot index only (cheap, already cached). Recordings would
--- mean walking the clips directory for every app, which is not worth it for a
--- grid - the app page picks them up anyway.
---@param paths steam_paths.Paths
---@return table<integer, table> stats  appid -> { screenshots, newest }
function captures.library_stats(paths)
  local games = load_index(paths)
  local out = {}

  for id, list in pairs(games) do
    if gameid.is_non_steam(id) then
      local appid = gameid.to_appid(id)
      if appid then
        local newest = 0
        for _, shot in ipairs(list) do
          local at = shot.creation or 0
          if at > newest then newest = at end
        end
        out[appid] = { screenshots = #list, newest = newest }
      end
    end
  end

  return out
end

---@class captures.Recording
---@field path string            Recording directory
---@field started_at integer     Unix seconds (from clip.pb, else folder mtime)
---@field duration_ms integer    0 when unknown
---@field thumbnail string|nil   Absolute path to Steam's thumbnail
---@field manifest string|nil    session.mpd - the DASH manifest to play
---@field width integer
---@field height integer
---@field kind string            "clip" | "video"

--- Minimal protobuf reader: enough to pull scalar fields out of clip.pb.
---
--- Steam writes these as protobuf, but the fields we want are plain varints and
--- length-delimited blobs, so a ~30 line reader beats a dependency. Verified
--- against a real clip.pb (see docs/knowledgebase.md "Recordings").
---@param data string
---@param offset integer
---@return integer value
---@return integer next_offset
--- A varint must always be consumed in full, even when its value is too large
--- to represent exactly - stopping early would desynchronise every field after
--- it. Steam stores the 64-bit gameid this way, so this matters here.
--- Values above 2^53 are returned as nil (caller treats them as "not a usable
--- number"); the byte offset is still advanced correctly.
local function read_varint(data, offset)
  local result, multiplier = 0, 1
  local overflow = false

  while offset <= #data do
    local byte = data:byte(offset)
    offset = offset + 1
    if not overflow then
      result = result + (byte % 128) * multiplier
      multiplier = multiplier * 128
      if multiplier > 2 ^ 53 then overflow = true end
    end
    if byte < 128 then break end
  end

  if overflow then return nil, offset end

  -- Normalise to an integer subtype where the runtime has one (Lua 5.3+), so
  -- timestamps do not render as "1789835832.0". LuaJIT (5.1) has no
  -- math.tointeger and no float/int distinction, so this is a no-op there.
  if math.tointeger then
    result = math.tointeger(result) or result
  end
  return result, offset
end

--- Read top-level fields of a protobuf message into { [field_number] = value }.
---
--- Length-delimited fields are returned as raw strings. Protobuf does not
--- distinguish a nested message from a string on the wire, so the caller must
--- know which is which and re-parse only the ones it expects to be messages -
--- recursing blindly would misread a string's bytes as field tags.
---
--- Varints too large for a Lua number come back as nil but are still skipped
--- correctly, so later fields stay aligned.
---@param data string
---@return table<integer, any>
local function parse_protobuf(data)
  local fields = {}
  local offset = 1

  while offset <= #data do
    local key
    key, offset = read_varint(data, offset)
    -- nil key = a tag we cannot represent; 0 = padding. Either way, stop.
    if not key or key == 0 then break end

    local field_number = math.floor(key / 8)
    local wire_type = key % 8

    if wire_type == 0 then
      local value
      value, offset = read_varint(data, offset)
      fields[field_number] = value
    elseif wire_type == 2 then
      local length
      length, offset = read_varint(data, offset)
      if not length or offset + length - 1 > #data then break end
      fields[field_number] = data:sub(offset, offset + length - 1)
      offset = offset + length
    elseif wire_type == 5 then
      offset = offset + 4
    elseif wire_type == 1 then
      offset = offset + 8
    else
      break -- unknown wire type: stop rather than misread
    end
  end

  return fields
end

--- Pull metadata out of a clip's clip.pb.
---
--- Layout confirmed against a real 14s AM2R clip:
---   field 1 = session (nested)
---     field 1 = timeline name
---     field 3 = recorded-at unix seconds
---     field 5 = video (nested): field 3 = duration ms
---   field 3 = clip created-at unix seconds
---   field 12/13 = width/height
---@param dir string
---@return table metadata
local function read_clip_metadata(dir)
  local meta = { started_at = 0, duration_ms = 0, width = 0, height = 0 }

  local content = utils.read_file(fs.join(dir, "clip.pb"))
  if not content then return meta end

  local ok, top = pcall(parse_protobuf, content)
  if not ok or type(top) ~= "table" then return meta end

  if type(top[3]) == "number" then meta.started_at = top[3] end
  if type(top[12]) == "number" then meta.width = top[12] end
  if type(top[13]) == "number" then meta.height = top[13] end

  if type(top[1]) == "string" then
    local ok2, session = pcall(parse_protobuf, top[1])
    if ok2 and type(session) == "table" then
      -- Prefer the session's recorded-at; it is when play happened.
      if type(session[3]) == "number" and session[3] > 0 then
        meta.started_at = session[3]
      end
      if type(session[5]) == "string" then
        local ok3, video = pcall(parse_protobuf, session[5])
        if ok3 and type(video) == "table" and type(video[3]) == "number" then
          meta.duration_ms = video[3]
        end
      end
    end
  end

  return meta
end

--- Find the DASH manifest inside a recording directory.
---@param dir string
---@return string|nil
local function find_manifest(dir)
  local video_dir = fs.join(dir, "video")
  if not fs.is_directory(video_dir) then return nil end

  for _, entry in ipairs(fs.list(video_dir) or {}) do
    if entry.is_directory then
      local manifest = fs.join(entry.path, "session.mpd")
      if fs.is_file(manifest) then return manifest end
    end
  end
  return nil
end

---@class captures.Session
---@field id string          Timeline name, e.g. "timeline_43515020260919_164501"
---@field started_at integer Unix seconds
---@field duration_ms integer
---@field ended_at integer   started_at + duration

--- Play sessions for one app, newest first.
---
--- gamerecording.pb is an index of background-recording sessions. Each entry:
---   field 1 = timeline name (string)
---   field 2 = appid or gameid (varint)
---   field 3 = session start, unix seconds
---   field 4 = session duration, milliseconds
---
--- A "session" is what Steam's POST-GAME SUMMARY is scoped to: the media
--- captured during the most recent play session, rather than an arbitrary
--- calendar day.
---
--- Field 2 holds a 64-bit gameid for non-Steam games, which overflows a Lua
--- number, so we match on the id embedded in the timeline NAME instead - it is
--- a string and therefore exact.
---@param paths steam_paths.Paths
---@param appid integer
---@return captures.Session[]
function captures.sessions_for(paths, appid)
  local index_path = fs.join(paths.recordings, "gamerecording.pb")
  local content = utils.read_file(index_path)
  if not content then return {} end

  local id = appid >= NON_STEAM_APPID_MIN
    and gameid.from_appid(appid)
    or tostring(appid)

  local out = {}
  local offset = 1

  -- Top level is a repeated field 1; parse_protobuf keeps only the last
  -- occurrence of a field, so walk the entries manually.
  while offset <= #content do
    local key
    key, offset = read_varint(content, offset)
    if not key or key == 0 then break end

    local field_number = math.floor(key / 8)
    local wire_type = key % 8

    if wire_type == 2 then
      local length
      length, offset = read_varint(content, offset)
      if not length or offset + length - 1 > #content then break end
      local blob = content:sub(offset, offset + length - 1)
      offset = offset + length

      if field_number == 1 then
        local ok, entry = pcall(parse_protobuf, blob)
        if ok and type(entry) == "table" and type(entry[1]) == "string" then
          local name = entry[1]
          -- "timeline_<id><YYYYMMDD>_<HHMMSS>" - the id is glued to the date
          -- with no separator, so anchor on the prefix.
          if name:find("timeline_" .. id, 1, true) == 1 then
            local started = type(entry[3]) == "number" and entry[3] or 0
            local duration = type(entry[4]) == "number" and entry[4] or 0
            if started > 0 then
              out[#out + 1] = {
                id          = name,
                started_at  = started,
                duration_ms = duration,
                ended_at    = started + math.floor(duration / 1000),
              }
            end
          end
        end
      end
    elseif wire_type == 0 then
      local _
      _, offset = read_varint(content, offset)
    elseif wire_type == 5 then
      offset = offset + 4
    elseif wire_type == 1 then
      offset = offset + 8
    else
      break
    end
  end

  table.sort(out, function(a, b) return a.started_at > b.started_at end)
  return out
end

--- Recordings for one app, newest first.
---
--- Steam stores each clip as a directory whose name embeds the game's id:
---   clips/clip_<id>_<YYYYMMDD>_<HHMMSS>/
---     clip.pb          metadata (protobuf)
---     thumbnail.jpg    ready-made poster frame
---     video/fg_<id>_…/session.mpd + chunk-*.m4s   (MPEG-DASH)
---
--- IMPORTANT: <id> is the 64-bit gameid for non-Steam games, but the plain
--- 32-bit appid for native Steam games (verified: clip_18310622842007322624_…
--- for AM2R vs clip_435150_… for Divinity: Original Sin 2). We therefore match
--- on the id form that fits the app, not on one fixed transform.
---
--- Video is fragmented DASH, not a single mp4, so it must be played through the
--- manifest rather than linked directly.
---@param paths steam_paths.Paths
---@param appid integer
---@return captures.Recording[]
function captures.recordings_for(paths, appid)
  if not fs.is_directory(paths.recordings) then return {} end

  -- Non-Steam shortcuts use the composed gameid; native apps use the appid.
  local id = appid >= NON_STEAM_APPID_MIN
    and gameid.from_appid(appid)
    or tostring(appid)
  local out = {}

  for _, kind in ipairs({ "clips", "video" }) do
    local dir = fs.join(paths.recordings, kind)
    if fs.is_directory(dir) then
      for _, entry in ipairs(fs.list(dir) or {}) do
        -- Anchor the id between underscores so appid 435150 cannot match a
        -- directory for 4351501 or for a gameid that merely contains it.
        if entry.is_directory and entry.name:find("_" .. id .. "_", 1, true) then
          local meta = read_clip_metadata(entry.path)
          local thumb = fs.join(entry.path, "thumbnail.jpg")

          out[#out + 1] = {
            path        = entry.path,
            started_at  = meta.started_at > 0 and meta.started_at
                          or (fs.last_write_time(entry.path) or 0),
            duration_ms = meta.duration_ms,
            thumbnail   = fs.is_file(thumb) and thumb or nil,
            manifest    = find_manifest(entry.path),
            width       = meta.width,
            height      = meta.height,
            kind        = kind == "clips" and "clip" or "video",
          }
        end
      end
    end
  end

  table.sort(out, function(a, b) return a.started_at > b.started_at end)
  return out
end

return captures
