--- Groups activity entries into dated buckets, newest first.
---
--- The core contributes screenshots and recordings. Providers will later
--- contribute achievements and other dated events into the same structure;
--- entries are interleaved by timestamp, never appended per-source.

local timeline = {}

---@class timeline.Entry
---@field type string      "screenshot" | "recording" | provider-defined
---@field at integer       Unix seconds
---@field [string] any     Type-specific payload

---@class timeline.Day
---@field date string           "YYYY-MM-DD" in local time
---@field entries timeline.Entry[]

--- Local-time date key for a unix timestamp.
---@param at integer
---@return string
local function date_key(at)
  return os.date("%Y-%m-%d", at)
end

--- Build dated buckets from a flat entry list.
---@param entries timeline.Entry[]
---@return timeline.Day[]
function timeline.group(entries)
  local by_date = {}
  local order = {}

  for _, entry in ipairs(entries) do
    if entry.at and entry.at > 0 then
      local key = date_key(entry.at)
      if not by_date[key] then
        by_date[key] = {}
        order[#order + 1] = key
      end
      local bucket = by_date[key]
      bucket[#bucket + 1] = entry
    end
  end

  table.sort(order, function(a, b) return a > b end)

  local days = {}
  for _, key in ipairs(order) do
    local bucket = by_date[key]
    table.sort(bucket, function(a, b) return a.at > b.at end)
    days[#days + 1] = { date = key, entries = bucket }
  end

  return days
end

--- Select the entries belonging to the most recent play session.
---
--- Steam's own POST-GAME SUMMARY is scoped to a session, not a calendar day:
--- it shows the screenshots and clips captured during the last time you played.
--- We use the session window from gamerecording.pb when one is available, and
--- fall back to the newest day when it is not (a game played before Steam Game
--- Recording existed has media but no session index).
---@param entries timeline.Entry[]
---@param sessions captures.Session[]
---@return table|nil summary  { started_at, ended_at, entries } or nil if empty
function timeline.post_game_summary(entries, sessions)
  if #entries == 0 then return nil end

  local session = sessions and sessions[1]
  if session then
    -- Media is written slightly after the session ends (Steam finalises the
    -- clip on exit), so allow a grace window on the trailing edge.
    local GRACE = 120
    local picked = {}
    for _, entry in ipairs(entries) do
      if entry.at >= session.started_at - GRACE
        and entry.at <= session.ended_at + GRACE then
        picked[#picked + 1] = entry
      end
    end

    if #picked > 0 then
      table.sort(picked, function(a, b) return a.at > b.at end)
      return {
        started_at = session.started_at,
        ended_at   = session.ended_at,
        source     = "session",
        entries    = picked,
      }
    end
  end

  -- Fallback: the newest day that has any media.
  local days = timeline.group(entries)
  if #days == 0 then return nil end
  return {
    started_at = days[1].entries[#days[1].entries].at,
    ended_at   = days[1].entries[1].at,
    source     = "day",
    date       = days[1].date,
    entries    = days[1].entries,
  }
end

--- Flatten core media into timeline entries.
---@param screenshots captures.Screenshot[]
---@param recordings captures.Recording[]
---@return timeline.Entry[]
function timeline.from_media(screenshots, recordings)
  local entries = {}

  for _, shot in ipairs(screenshots) do
    entries[#entries + 1] = {
      type  = "screenshot",
      at    = shot.taken_at,
      path  = shot.path,
      thumb = shot.thumb,
      width = shot.width,
      height = shot.height,
    }
  end

  for _, rec in ipairs(recordings) do
    entries[#entries + 1] = {
      type        = "recording",
      at          = rec.started_at,
      path        = rec.path,
      kind        = rec.kind,
      -- The UI renders a timeline entry without consulting media[], so carry
      -- everything needed to draw a video card.
      thumb       = rec.thumbnail,
      manifest    = rec.manifest,
      duration_ms = rec.duration_ms,
      width       = rec.width,
      height      = rec.height,
    }
  end

  return entries
end

return timeline
