--- The methods the frontend can call.
---
--- Millennium's RPC channel passes strings, so every method takes a JSON
--- payload and returns JSON.

local json        = require("json")
local logger      = require("logger")
local steam_paths = require("steam_paths")
local shortcuts   = require("shortcuts")
local captures    = require("captures")
local timeline    = require("timeline")
local gameid      = require("gameid")

local RPC = {}

--- Wrap a handler so it decodes/encodes JSON and never throws across the
--- boundary.
---
--- Returning a bare nil crashes Millennium (it tries to parse the result as an
--- integer), so a nil result must become the string 'null'.
---@param name string
---@param func fun(data: table): any
---@return fun(payload: string): string
local function method(name, func)
  return function(payload)
    local ok, data = pcall(json.decode, payload or "{}")
    if not ok or type(data) ~= "table" then data = {} end

    local success, result = pcall(func, data)
    if not success then
      logger:error("RPC " .. name .. " failed: " .. tostring(result))
      return json.encode({ error = tostring(result) })
    end

    if result == nil then return "null" end
    return json.encode(result)
  end
end

--- Everything needed to render one app's activity page.
RPC.GetActivity = method("GetActivity", function(data)
  local appid = tonumber(data.appid)
  if not appid then error("appid is required") end

  local paths, err = steam_paths.resolve()
  if not paths then error(err or "could not resolve Steam paths") end

  local entries = shortcuts.parse(paths.shortcuts) or {}
  local shortcut = shortcuts.by_appid(entries)[appid]

  local screenshots = captures.screenshots_for(paths, appid)
  local recordings  = captures.recordings_for(paths, appid)
  local sessions    = captures.sessions_for(paths, appid)

  local entries = timeline.from_media(screenshots, recordings)

  return {
    appid  = appid,
    gameid = gameid.from_appid(appid),
    name   = shortcut and shortcut.name or nil,
    media = {
      screenshots = screenshots,
      recordings  = recordings,
    },
    -- Mirrors Steam's own layout: a session-scoped summary on top, then the
    -- full history broken down by day.
    post_game_summary = timeline.post_game_summary(entries, sessions),
    timeline          = timeline.group(entries),
    last_session      = sessions[1],
  }
end)

--- Batched counts for the library grid.
RPC.GetLibraryStats = method("GetLibraryStats", function(_)
  local paths, err = steam_paths.resolve()
  if not paths then error(err or "could not resolve Steam paths") end

  local counts = captures.non_steam_counts(paths)
  local out = {}
  for appid, count in pairs(counts) do
    -- JSON object keys must be strings.
    out[tostring(appid)] = { screenshots = count }
  end
  return out
end)

--- Diagnostic: what the backend can see. Used by the smoke test.
RPC.GetDiagnostics = method("GetDiagnostics", function(_)
  local paths, err = steam_paths.resolve()
  if not paths then
    return { ok = false, error = err }
  end

  local entries = shortcuts.parse(paths.shortcuts) or {}
  local counts = captures.non_steam_counts(paths)

  local games_with_media, total_shots = 0, 0
  for _, count in pairs(counts) do
    games_with_media = games_with_media + 1
    total_shots = total_shots + count
  end

  return {
    ok               = true,
    steam_root       = paths.root,
    user_id          = paths.user_id,
    shortcuts        = #entries,
    games_with_media = games_with_media,
    screenshots      = total_shots,
  }
end)

return RPC
