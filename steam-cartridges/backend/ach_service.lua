--- Achievement schema and unlocks for a shortcut: which source answers? (migration plan M6a).
---
--- Sources, in this order (the chain CartridgesAchievementsGet used to hard-code), each with a
--- `supports` rule so a source is only asked when the shortcut can be one of its games:
---   steam             the shortcut has a Steam match (ctx.native > 0)
---   rpcs3             a PS3 trophy directory is found from the launch command
---   shadps4           a PS4 trophy directory is found from the launch command
---   retroachievements a ROM path is found from the launch command
---
--- K2: a PC game with no ROM path is never sent to RetroAchievements, and a shortcut no source
--- supports is `unsupported` and silent (no log line, no request).

local steam_paths = require("steam_paths")
local shortcuts   = require("shortcuts")
local store       = require("achievements_store")

local M = {}

--- Injectable for tests. nil = the real dependency.
M.deps = {
  entry = nil, -- fun(appid) -> { exe, launch_options } | nil ; nil = shortcuts.vdf lookup
  steam = nil, -- fun(appid, native) -> res, err   ; nil = achievements_store.get_or_fetch
  ps3 = nil,   -- fun(appid) -> res, err          ; nil = ps3_trophies.get_or_fetch
  ps4 = nil,   -- fun(appid) -> res, err          ; nil = ps4_trophies.get_or_fetch
  ra = nil,    -- fun(appid, hardcore) -> res, err ; nil = retroachievements.get_or_fetch
  ps3_dir = nil,  -- fun(exe, launch_options) -> dir | nil ; nil = ps3_trophies.find_trophy_dir
  ps4_dir = nil,  -- fun(exe, launch_options) -> dir | nil ; nil = ps4_trophies.find_trophy_dir
  rom_path = nil, -- fun(exe, launch_options) -> path | nil ; nil = retroachievements.extract_rom_path
  now = function() return os.time() end,
}

local function now_ms()
  return math.floor((M.deps.now or os.time)() * 1000)
end

local function default_entry(appid)
  local ok, result = pcall(function()
    local paths = steam_paths.resolve()
    if not paths then return nil end
    return shortcuts.by_appid(shortcuts.parse(paths.shortcuts) or {})[tonumber(appid)]
  end)
  return ok and result or nil
end

local function dep(name, module_name, fn_name)
  return M.deps[name] or function(...) return require(module_name)[fn_name](...) end
end

local SOURCES = {
  {
    name = "steam",
    supports = function(ctx) return (tonumber(ctx.native) or 0) > 0 end,
    fetch = function(appid, ctx) return dep("steam", "achievements_store", "get_or_fetch")(appid, tonumber(ctx.native)) end,
  },
  {
    name = "rpcs3",
    supports = function(_, entry)
      return entry ~= nil and dep("ps3_dir", "ps3_trophies", "find_trophy_dir")(entry.exe, entry.launch_options) ~= nil
    end,
    fetch = function(appid) return dep("ps3", "ps3_trophies", "get_or_fetch")(appid) end,
  },
  {
    name = "shadps4",
    supports = function(_, entry)
      return entry ~= nil and dep("ps4_dir", "ps4_trophies", "find_trophy_dir")(entry.exe, entry.launch_options) ~= nil
    end,
    fetch = function(appid) return dep("ps4", "ps4_trophies", "get_or_fetch")(appid) end,
  },
  {
    name = "retroachievements",
    supports = function(_, entry)
      return entry ~= nil and dep("rom_path", "retroachievements", "extract_rom_path")(entry.exe, entry.launch_options) ~= nil
    end,
    fetch = function(appid, ctx) return dep("ra", "retroachievements", "get_or_fetch")(appid, ctx.hardcore) end,
  },
}

--- Resolve, returning the part and the raw source result (the old RPC's response shape).
--- ctx = { native = number|nil, hardcore = boolean|nil, title = string }
function M._resolve(appid, ctx)
  ctx = ctx or {}
  local entry = (M.deps.entry or default_entry)(appid)

  local asked, last_err = false, nil
  for _, source in ipairs(SOURCES) do
    local okS, supported = pcall(source.supports, ctx, entry)
    if okS and supported then
      asked = true
      local okF, res, err = pcall(source.fetch, appid, ctx)
      if okF and type(res) == "table" and res.schema then
        return {
          status = "ok",
          source = source.name,
          data = { schema = res.schema, unlocks = res.unlocks or {} },
          checkedAt = now_ms(),
        }, res
      end
      last_err = (okF and (err or (res and res.error))) or (not okF and tostring(res)) or last_err
    end
  end

  if not asked then return { status = "unsupported", checkedAt = now_ms() }, nil end
  return { status = "error", message = tostring(last_err or "no source returned a schema"), checkedAt = now_ms() }, nil
end

--- Full resolution. Returns a Part<{ schema, unlocks }>.
function M.ensure(appid, ctx)
  return (M._resolve(appid, ctx))
end

--- Disk only: the stored schema and unlocks as a part, or nil. Never writes or fetches.
function M.local_part(appid)
  local st = store.get_state(appid)
  if not st or not st.schema then return nil end
  return { status = "ok", data = { schema = st.schema, unlocks = st.unlocks or {} }, checkedAt = now_ms() }
end

return M
