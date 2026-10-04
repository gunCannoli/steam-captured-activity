--- Epic Steam Overlay Workaround (ADR-0057). Steam's overlay reaches an Epic game only when Steam itself starts the Epic
--- Games Launcher with the game's dashed launch link: the launcher, then the game, are created by a process Steam tracks.
--- A launcher already running only forwards the link, and the game starts outside Steam's tree (launch-tracking plan § 7,
--- F12, E1, E8). Two steps, both behind the user's setting (off by default):
---   prelaunch(appid)   just before Steam launches the shortcut (the launch-hold surface holds Steam's Play): close a
---                      running launcher, unless a download or install is pending.
---   reap(appid, act)   while the game runs (a 3 s tick from app/epic-launcher): when the game's processes have been gone
---                      for 5 s, wait for Epic's cloud sync line (cap 30 s), then end the launchers started for this launch,
---                      so Steam stops showing the game as running.
--- Only shortcuts that are an Epic copy started through the launcher link take part (store_service.detect, via
--- "launch-link"). A command line is never logged: the game's carries a single-use exchange code.

local logger = require("logger")

local M = {}

M.deps = {
  run = nil,       -- fun(cmd) -> output ; nil = silent_exec.run
  now = nil,       -- fun() -> unix seconds (UTC) ; nil = os.time
  sleep = nil,     -- fun(ms) ; nil = utils.sleep
  entry = nil,     -- fun(appid) -> shortcuts.vdf entry ; nil = registry.shortcut
  detect = nil,    -- fun(entry) -> store copy ; nil = store_service.detect
  installed = nil, -- fun() -> Epic manifests ; nil = store_epic_local.installed
  manifests = nil, -- fun() -> { pending = bool } ; nil = reads the launcher's Manifests folder
  log_path = nil,  -- fun() -> the launcher's log path ; nil = %LOCALAPPDATA%\EpicGamesLauncher\Saved\Logs\EpicGamesLauncher.log
}

M.LAUNCHER = "EpicGamesLauncher.exe"
M.GONE_AFTER = 5       -- seconds without the game's process before it counts as exited (a crash handler may restart it)
M.SYNC_CAP = 30        -- seconds to wait for Epic's cloud sync line after the game exited
M.START_CAP = 180      -- seconds to wait for the game to appear (login, update or an Epic error)
M.SLACK = 15           -- a launcher started up to this long before the launch counts as started by it (no hold seen)
M.LATE = 3             -- seconds after Play past which prelaunch closes nothing: the launch-hold surface lets Steam go on
                       -- after 10 s, and closing the launcher Steam has just started would end the game with it

local function run(cmd) return (M.deps.run or require("silent_exec").run)(cmd) or "" end
local function now() return (M.deps.now or os.time)() end
local function sleep(ms) return (M.deps.sleep or require("utils").sleep)(ms) end
local function entry_of(appid) return (M.deps.entry or require("registry").shortcut)(appid) end
local function detect(entry) return (M.deps.detect or require("store_service").detect)(entry) end
local function installed() return (M.deps.installed or require("store_epic_local").installed)() end

local function log_path()
  if M.deps.log_path then return M.deps.log_path() end
  local base = os.getenv("LOCALAPPDATA")
  return base and (base .. "\\EpicGamesLauncher\\Saved\\Logs\\EpicGamesLauncher.log") or nil
end

--- The image name a manifest's LaunchExecutable runs (pure): "Binaries/Win64/Game.exe" -> "Game.exe".
function M.image_of(launch_exe)
  local s = tostring(launch_exe or ""):gsub("/", "\\")
  return s:match("([^\\]+)$")
end

--- Is a process with this image name running? (pure parse of `tasklist /FO CSV /NH` output)
function M.parse_running(output, image)
  local want = '"' .. tostring(image):lower() .. '"'
  for line in tostring(output or ""):gmatch("[^\r\n]+") do
    if line:lower():sub(1, #want) == want then return true end
  end
  return false
end

local function running(image)
  return M.parse_running(run('tasklist /FI "IMAGENAME eq ' .. image .. '" /FO CSV /NH'), image)
end

--- "<pid> <yyyymmddHHMMSS UTC>" lines -> { { pid, started } } (pure).
function M.parse_launchers(output)
  local out = {}
  for pid, stamp in tostring(output or ""):gmatch("(%d+) (%d%d%d%d%d%d%d%d%d%d%d%d%d%d)") do
    out[#out + 1] = { pid = tonumber(pid), started = stamp }
  end
  return out
end

local function launchers()
  return M.parse_launchers(run(
    "powershell -NoProfile -NonInteractive -Command \"Get-Process EpicGamesLauncher -ErrorAction SilentlyContinue | "
    .. "ForEach-Object { '{0} {1:yyyyMMddHHmmss}' -f $_.Id, $_.StartTime.ToUniversalTime() }\""))
end

--- A download or install the launcher is busy with (never end it then): Manifests\Pending not empty, or a manifest with
--- bIsIncompleteInstall true. Returns the reason, or nil.
local function pending()
  if M.deps.manifests then
    local m = M.deps.manifests() or {}
    return m.pending and (m.reason or "a download is pending") or nil
  end
  local ok, reason = pcall(function()
    local epic_local = require("store_epic_local")
    local dir = epic_local.manifests_dir()
    if not dir then return nil end
    local fs = require("fs")
    local pend = dir .. "\\Pending"
    if fs.exists(pend) then
      for _ in pairs(fs.list(pend) or {}) do return "a download is pending" end
    end
    for _, e in ipairs(fs.list(dir) or {}) do
      local name = tostring(e.name or "")
      if name:lower():match("%.item$") then
        local f = io.open(e.path or (dir .. "\\" .. name), "rb")
        local text = f and f:read("*a") or ""
        if f then f:close() end
        if text:match('"bIsIncompleteInstall"%s*:%s*true') then return "an install is incomplete" end
      end
    end
    return nil
  end)
  if not ok then return "the manifests could not be read" end
  return reason
end

--- Epic's "cloud sync done" line for this game in the launcher log's text (pure).
function M.has_sync_line(text, app_name)
  for line in tostring(text or ""):gmatch("[^\r\n]+") do
    if line:find("Cloud Sync: Upload Complete", 1, true) and line:find(":" .. tostring(app_name), 1, true) then return true end
  end
  return false
end

local function log_size()
  local p = log_path()
  local f = p and io.open(p, "rb")
  if not f then return 0 end
  local size = f:seek("end")
  f:close()
  return size or 0
end

local function log_since(offset)
  local p = log_path()
  local f = p and io.open(p, "rb")
  if not f then return "" end
  local size = f:seek("end") or 0
  if offset > size then offset = 0 end -- the launcher started a new log
  f:seek("set", offset)
  local text = f:read("*a") or ""
  f:close()
  return text
end

--- The Epic game a shortcut starts through the launcher link, or nil (any other shortcut takes no part).
local function epic_game(appid)
  local entry = entry_of(appid)
  if not entry then return nil end
  local copy = detect(entry)
  if not copy or copy.kind ~= "epic" or copy.via ~= "launch-link" then return nil end
  for _, g in ipairs(installed() or {}) do
    if g.app_name == copy.appName then return g end
  end
  return nil
end

--- appid -> { title, app_name, image, t0, phase, last_seen, log_offset, gone_at }
local active = {}

local function begin(appid, game, t0)
  active[appid] = {
    title = game.title, app_name = game.app_name, image = M.image_of(game.launch_exe),
    t0 = t0, phase = "waiting", last_seen = nil, log_offset = log_size(), gone_at = nil,
  }
  return active[appid]
end

--- Before Steam launches `appid`: close a running launcher when the shortcut is an Epic launcher-link copy.
--- `held_at` (unix ms, optional) is when Steam's Play was held; past LATE seconds nothing is closed.
--- { epic = false } for any other shortcut; { epic = true, closed = bool, reason? } otherwise.
function M.prelaunch(appid, held_at)
  local game = epic_game(appid)
  if not game then return { epic = false } end
  begin(appid, game, now())
  if held_at and now() - math.floor(held_at / 1000) > M.LATE then
    logger:warn("Epic overlay workaround: the request to close the launcher came too late; it is left open.")
    return { epic = true, closed = false, reason = "late" }
  end
  if not running(M.LAUNCHER) then return { epic = true, closed = false, reason = "not-running" } end
  local why = pending()
  if why then
    logger:warn("Epic overlay workaround: the Epic Games Launcher is left open (" .. why .. "); Steam's overlay will not reach " .. tostring(game.title) .. ".")
    return { epic = true, closed = false, reason = "pending" }
  end
  run("taskkill /T /F /IM " .. M.LAUNCHER)
  for _ = 1, 20 do
    if not running(M.LAUNCHER) then
      logger:info("Epic overlay workaround: closed the Epic Games Launcher before " .. tostring(game.title) .. " starts.")
      return { epic = true, closed = true }
    end
    sleep(200)
  end
  logger:warn("Epic overlay workaround: the Epic Games Launcher did not close in 4 s.")
  return { epic = true, closed = false, reason = "still-running" }
end

--- End the launchers started for this launch (at or after t0, less SLACK when the launch was not held).
local function end_launchers(st)
  local since = os.date("!%Y%m%d%H%M%S", st.t0)
  local ended = 0
  for _, l in ipairs(launchers()) do
    if l.started >= since then
      run("taskkill /T /F /PID " .. l.pid)
      ended = ended + 1
    end
  end
  return ended
end

--- The reaper (app/epic-launcher ticks it every 3 s while an Epic launcher-link copy runs).
---   act = "start": begin watching (a no-op when prelaunch already began; { active = false } for other shortcuts)
---   act = "tick":  advance; returns { active, phase, reason? }; phase "done" ends the watch
---   act = "stop":  forget the watch (the shortcut quit by itself)
function M.reap(appid, act)
  if act == "stop" then
    active[appid] = nil
    return { active = false, phase = "stopped" }
  end
  local st = active[appid]
  if act == "start" then
    if not st then
      local game = epic_game(appid)
      if not game then return { active = false } end
      st = begin(appid, game, now() - M.SLACK)
    end
    return { active = true, phase = st.phase }
  end
  if not st then return { active = false, phase = "idle" } end
  local t = now()
  local up = running(st.image)
  if st.phase == "waiting" then
    if up then
      st.phase, st.last_seen, st.log_offset = "running", t, log_size()
    elseif t - st.t0 > M.START_CAP then
      active[appid] = nil
      logger:info("Epic overlay workaround: " .. tostring(st.title) .. " never started; the launcher is left alone.")
      return { active = false, phase = "done", reason = "no-game" }
    end
  elseif st.phase == "running" then
    if up then
      st.last_seen, st.log_offset = t, log_size()
    elseif t - st.last_seen >= M.GONE_AFTER then
      st.phase, st.gone_at = "gone", t
    end
  elseif st.phase == "gone" then
    if up then
      st.phase, st.last_seen = "running", t
    else
      local synced = M.has_sync_line(log_since(st.log_offset), st.app_name)
      if synced or t - st.gone_at >= M.SYNC_CAP then
        active[appid] = nil
        local why = pending()
        if why then
          logger:warn("Epic overlay workaround: " .. tostring(st.title) .. " exited; the launcher is left open (" .. why .. ").")
          return { active = false, phase = "done", reason = "pending" }
        end
        local n = end_launchers(st)
        logger:info("Epic overlay workaround: " .. tostring(st.title) .. " exited" .. (synced and " and Epic's cloud sync finished" or " (no cloud sync line in 30 s)")
          .. "; ended " .. n .. " launcher process tree(s).")
        return { active = false, phase = "done", reason = synced and "synced" or "sync-timeout" }
      end
    end
  end
  return { active = true, phase = st.phase }
end

function M._reset() active = {} end

return M
