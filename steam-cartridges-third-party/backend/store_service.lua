--- Store copies (ADR-0056): is this shortcut an Epic Games Store or Xbox copy of a game, and which one?
---
--- Found from files already on the PC, never typed by the user (decision 1): the Epic launcher's install manifests,
--- the Xbox packages and their game config (store_epic_local.lua, store_xbox_local.lua). The store's API then names the
--- game's offer and achievement product (Epic) or Store product and title id (Xbox), once per game (the lookup is kept
--- in store_copies.json). A copy is a fact about the shortcut, like its Steam match (resolve_identity.lua), and a copy
--- can have both: Steam stays first for Game Info, art and community content (decision 2); the store's own data fills
--- a copy with no Steam match, and its achievements are the player's from that store (decision 4).
---
--- The `store` part of a record: Part<StoreCopy> (frontend kernel/record.ts). `unsupported` = not a store copy.

local logger = require("logger")
local store  = require("store_copies_store")
local sensor = require("sensor_log")

local M = {}

--- Injectable for tests. nil = the real dependency.
M.deps = {
  entry = nil,        -- fun(appid) -> shortcuts.vdf entry | nil ; nil = registry.shortcut
  entries = nil,      -- fun() -> every shortcuts.vdf entry       ; nil = registry entries
  epic_local = nil,   -- nil = store_epic_local
  xbox_local = nil,   -- nil = store_xbox_local
  epic = nil,         -- nil = epic_graphql
  xbox_catalog = nil, -- nil = xbox_catalog
  now = function() return os.time() end,
  run = nil,          -- fun(cmd) -> output | nil ; nil = silent_exec.run
}

local function now_ms() return math.floor((M.deps.now or os.time)() * 1000) end
local function epic_local() return M.deps.epic_local or require("store_epic_local") end
local function xbox_local() return M.deps.xbox_local or require("store_xbox_local") end
local function epic() return M.deps.epic or require("epic_graphql") end
local function xbox_catalog() return M.deps.xbox_catalog or require("xbox_catalog") end

local function entry_of(appid)
  if M.deps.entry then return M.deps.entry(appid) end
  return require("registry").shortcut(appid)
end

--- The installed games of both stores. The list is remembered for INSTALLED_TTL seconds (a page view asks for it once per
--- shortcut, and reading it costs a registry query and the manifests), and `installed_games` always reads it afresh: a game
--- installed while Steam runs must be found by the auto-add check and the settings panel (a once-per-session cache hid every
--- game installed after Steam started, found 2026-10-03).
local INSTALLED_TTL = 60
local installed_cache = nil
local installed_at = 0
function M._reset() installed_cache = nil end

local function installed(fresh)
  local t = (M.deps.now or os.time)()
  if installed_cache and not fresh and t - installed_at < INSTALLED_TTL then return installed_cache end
  local okE, epic_games = pcall(function() return epic_local().installed() end)
  local okX, xbox_games = pcall(function() return xbox_local().installed() end)
  installed_cache = {
    epic = okE and type(epic_games) == "table" and epic_games or {},
    xbox = okX and type(xbox_games) == "table" and xbox_games or {},
  }
  installed_at = t
  return installed_cache
end

--- The copy a shortcuts.vdf entry is, from local data only: a StoreCopy table without its API fields, or nil.
function M.detect(entry)
  if type(entry) ~= "table" then return nil end
  local games = installed()
  local g, via = epic_local().match(entry, games.epic)
  if g then
    local c = { kind = "epic", title = g.title, namespace = g.namespace, itemId = g.item_id, appName = g.app_name, via = via }
    pcall(sensor.write, "STORE:DETECT", string.format("Detected epic: '%s' (appid %s, via %s)", tostring(c.title), tostring(entry.appid), tostring(c.via)))
    return c
  end
  local x, xvia = xbox_local().match(entry, games.xbox)
  if x then
    local c = { kind = "xbox", title = x.title, pfn = x.pfn, titleId = x.title_id, storeId = x.store_id, via = xvia }
    pcall(sensor.write, "STORE:DETECT", string.format("Detected xbox: '%s' (appid %s, via %s, pfn %s)", tostring(c.title), tostring(entry.appid), tostring(c.via), tostring(c.pfn)))
    return c
  end
  return nil
end

--- Disk only: the saved copy as a part, or nil.
function M.saved(appid)
  local copy = store.get(appid)
  if not copy then return nil end
  return { status = "ok", data = copy, source = copy.kind, checkedAt = now_ms() }
end

--- The store API fields of an Epic game: offer and achievement product, remembered per namespace.
local function fill_epic(copy, ctx)
  local k = "epic:" .. copy.namespace
  local known = store.lookup(k) or {}
  if (not known.offerId or not known.productId) and ctx.allowEpic ~= false and not ctx.noNetwork then
    if not known.offerId then
      local offer = epic().base_offer(copy.namespace)
      if offer then known.offerId, known.title = offer.id, offer.title end
    end
    if not known.productId then
      local schema = epic().achievement_schema(copy.namespace)
      if schema then known.productId = schema.product_id end
    end
    store.remember(k, known)
  end
  copy.offerId, copy.productId = known.offerId, known.productId
  copy.title = (known.title and known.title ~= "") and known.title or copy.title
end

--- The store API fields of an Xbox game: Store product and title, remembered per package family name.
local function fill_xbox(copy, ctx)
  local k = "xbox:" .. copy.pfn
  local known = store.lookup(k) or {}
  if not known.storeId and ctx.allowXbox ~= false and not ctx.noNetwork then
    local product = (copy.storeId and xbox_catalog().by_store_id(copy.storeId)) or xbox_catalog().by_pfn(copy.pfn)
    if product then
      local ids = xbox_catalog().ids(product)
      known.storeId, known.title, known.isGame = ids.store_id, ids.title, ids.is_game
      known.titleId = ids.title_id
      store.remember(k, known)
    end
  end
  copy.storeId = copy.storeId or known.storeId
  copy.titleId = copy.titleId or known.titleId
  copy.title = (known.title and known.title ~= "") and known.title or copy.title
end

--- The `store` part. ctx = { allowEpic?, allowXbox?, noNetwork? }. Local detection always runs (it is the user's own
--- disk); the store APIs are asked only when that store is enabled and not already known.
function M.ensure(appid, ctx)
  ctx = ctx or {}
  local copy = M.detect(entry_of(appid))
  if not copy then
    store.set(appid, nil)
    return { status = "unsupported", checkedAt = now_ms() }
  end
  local ok, err = pcall(copy.kind == "epic" and fill_epic or fill_xbox, copy, ctx)
  if not ok then logger:warn("Store copy " .. tostring(appid) .. ": " .. tostring(err)) end -- ADR-0014: the local copy still counts
  store.set(appid, copy)
  return { status = "ok", data = copy, source = copy.kind, checkedAt = now_ms() }
end

local function all_entries()
  if M.deps.entries then return M.deps.entries() end
  local ok, list = pcall(function()
    local paths = require("steam_paths").resolve()
    if not paths or not paths.shortcuts then return {} end
    return require("shortcuts").parse(paths.shortcuts) or {}
  end)
  return ok and list or {}
end

local function unsigned(id)
  local n = tonumber(id) or 0
  if n < 0 then n = n + 4294967296 end
  return n
end

--- U0 shortcuts out of date after an app update (ADR-0058): a shortcut whose exe is inside a WindowsApps package folder
--- of an installed UWP game, but not the current version's exe. { { appid, title, exe, start_dir, launch_options? } } to
--- repoint; the library-shortcuts surface writes them (the appid stays, so playtime and activity stay). Also a shortcut
--- that still runs the retired uwp_presenter.exe wrapper (`--aumid <PFN>!<App>`, ADR-0065): it goes back to the game's
--- normal launch, launch options included. A shortcut that runs anything else (Explorer, another exe) is never listed.
--- Local data only.
function M.xbox_repairs()
  local xbox = xbox_local()
  local games = installed(true).xbox
  local function norm(p) return (tostring(p or ""):gsub('"', ""):gsub("/", "\\"):lower()) end
  local out = {}
  for _, e in ipairs(all_entries()) do
    local pfn = xbox.pfn_from_path(e.exe)
    if norm(e.exe):find("uwp_presenter.exe", 1, true) then
      local wrapped = xbox.pfn_from_target(e.launch_options)
      for _, g in ipairs(wrapped and games or {}) do
        if g.pfn and g.pfn:lower() == wrapped:lower() then
          local want = xbox.launch_spec(g)
          if want then
            out[#out + 1] = { appid = unsigned(e.appid), title = g.title or g.pfn, exe = want.exe, start_dir = want.start_dir, launch_options = want.launch_options }
          end
          break
        end
      end
    elseif pfn then
      for _, g in ipairs(games) do
        if g.pfn and g.pfn:lower() == pfn:lower() then
          local want = xbox.u0_spec(g)
          if want and norm(want.exe) ~= norm(e.exe) then
            out[#out + 1] = { appid = unsigned(e.appid), title = g.title or g.pfn, exe = want.exe, start_dir = want.start_dir }
          end
          break
        end
      end
    end
  end
  return out
end

--- The shortcuts (unsigned appids) that are an Epic copy started through the launcher link: the ones the Epic Steam
--- Overlay Workaround holds at Play (ADR-0057). Local data only.
function M.epic_launcher_shortcuts()
  local out = {}
  for _, e in ipairs(all_entries()) do
    local c = M.detect(e)
    if c and c.kind == "epic" and c.via == "launch-link" then out[#out + 1] = unsigned(e.appid) end
  end
  return out
end

--- Is an Xbox package's display name an identifier, not the game's name? Some publishers put one there
--- ("worldoftanks_blitz" for World of Tanks Blitz, found 2026-10-04); Steam's store search cannot match it.
local function identifier_title(title, pfn)
  if type(title) ~= "string" or title == "" then return true end
  if title:find("%s") then return false end
  local name = tostring(pfn or ""):match("^([^_]+)_") or ""
  return title:find("_", 1, true) ~= nil or title:lower() == name:lower()
end

--- Every installed game and whether the library already has a shortcut for it (Third-party settings, auto-add).
--- { epic = { { key, title, inLibrary, launch } }, xbox = { ... }, epicLauncher = bool }: `launch` = { exe, start_dir,
--- launch_options } for SteamClient.Apps.AddShortcut. Local data, except an Xbox game whose package names a resource or
--- an identifier instead of a title: the catalog is asked once (ctx.allowXbox, remembered like any lookup), so the new
--- shortcut carries the name Steam's store search can match.
function M.installed_games(ctx)
  ctx = ctx or {}
  local games = installed(true)
  local installed_epic = {}
  for _, g in ipairs(games.epic) do installed_epic[g.app_name] = true end
  local installed_xbox = {}
  for _, g in ipairs(games.xbox) do installed_xbox[g.pfn] = true end

  local owned = {}
  local uninstalled = { epic = {}, xbox = {} }

  for _, e in ipairs(all_entries()) do
    local c = M.detect(e)
    if c then
      local key = (c.kind == "epic" and c.appName or c.pfn) or ""
      owned[key] = unsigned(e.appid)
      pcall(sensor.write, "STORE:OWNED", string.format("Owned: key='%s' -> appid=%s (title='%s')", key, tostring(e.appid), tostring(c.title or "")))
    else
      local epic_app = epic_local().app_name_from_link(e.launch_options) or epic_local().app_name_from_link(e.exe)
      if epic_app and not installed_epic[epic_app] then
        uninstalled.epic[#uninstalled.epic + 1] = {
          key = epic_app,
          appid = unsigned(e.appid),
          title = e.appname or e.name or e.AppName or "",
        }
      end
      local xbox_pfn = xbox_local().pfn_from_target(e.launch_options)
        or xbox_local().pfn_from_target(e.exe)
        or xbox_local().pfn_from_path(e.exe)
      if xbox_pfn and not installed_xbox[xbox_pfn] then
        uninstalled.xbox[#uninstalled.xbox + 1] = {
          key = xbox_pfn,
          appid = unsigned(e.appid),
          title = e.appname or e.name or e.AppName or "",
        }
      end
    end
  end
  local launcher = epic_local().launcher_exe()
  local out = { epic = {}, xbox = {}, uninstalled = uninstalled, epicLauncher = launcher ~= nil }
  for _, g in ipairs(games.epic) do
    local inLib = owned[g.app_name]
    pcall(sensor.write, "STORE:SYNC_EPIC", string.format("Installed game '%s' (AppName %s): inLibrary = %s", tostring(g.title), tostring(g.app_name), tostring(inLib)))
    out.epic[#out.epic + 1] = {
      key = g.app_name, title = g.title, inLibrary = inLib,
      launch = epic_local().launch_spec(g, launcher),
    }
  end
  for _, g in ipairs(games.xbox) do
    local copy = { kind = "xbox", title = g.title, pfn = g.pfn, titleId = g.title_id, storeId = g.store_id }
    if identifier_title(g.title, g.pfn) then pcall(fill_xbox, copy, ctx) end
    local known = store.lookup("xbox:" .. tostring(g.pfn)) or {}
    local inLib = owned[g.pfn]
    pcall(sensor.write, "STORE:SYNC_XBOX", string.format("Installed game '%s' (PFN %s): inLibrary = %s", tostring(g.title or g.pfn), tostring(g.pfn), tostring(inLib)))
    out.xbox[#out.xbox + 1] = {
      key = g.pfn, title = known.title or g.title or g.pfn, inLibrary = inLib,
      launch = xbox_local().launch_spec(g),
    }
  end
  return out
end

--- "<pid>" lines of the running-check's output -> true when one process was listed (pure).
function M.parse_running(output)
  return tostring(output or ""):match("%d+") ~= nil
end

--- Is a process running from inside this package folder? One PowerShell call (about 0.5 s), so it is asked only while
--- an Xbox game is played with the notification mute on (ADR-0065). A GDK game relaunches itself outside Steam's tree
--- (plan F18), so Steam's own running state cannot tell when it ends; its exe still lives in its package folder.
local function root_running(root)
  local dir = tostring(root or ""):gsub('"', ""):gsub("\\+$", "")
  if dir == "" then return false end
  local cmd = "powershell -NoProfile -NonInteractive -Command \"Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('"
    .. dir:gsub("'", "''") .. "\\', 'OrdinalIgnoreCase') } | Select-Object -First 1 -ExpandProperty Id\""
  local run = M.deps.run or function(c) return require("silent_exec").run(c) end
  local ok, out = pcall(run, cmd)
  return ok and M.parse_running(out) or false
end

--- Every shortcut that is an Epic or Xbox copy: { { appid, kind } }. Local data only (start-up: the frontend pushes each
--- one to steam-cartridges, ADR-0067).
function M.library_copies(ctx)
  ctx = ctx or {}
  local out = {}
  for _, e in ipairs(all_entries()) do
    local c = M.detect(e)
    if c and ((c.kind == "epic" and ctx.allowEpic ~= false) or (c.kind == "xbox" and ctx.allowXbox ~= false)) then
      out[#out + 1] = { appid = unsigned(e.appid), kind = c.kind }
    end
  end
  return out
end

--- Everything steam-cartridges needs about a copy, to push (ADR-0067): { copy = { kind, title }, metadata?, media?,
--- achievements? = { source, key, title, achievements, unlocks } }, or { copy = nil } for a shortcut that is not one.
--- ctx = { allowEpic?, allowXbox?, achievements? (default true) }. A store that fails is silent (ADR-0014): its part is
--- left out and the rest still answers.
function M.game_data(appid, ctx)
  ctx = ctx or {}
  local entry = entry_of(appid)
  local part = M.ensure(appid, ctx)
  local copy = part.status == "ok" and part.data or nil
  if not copy then return { copy = nil } end
  if (copy.kind == "epic" and ctx.allowEpic == false) or (copy.kind == "xbox" and ctx.allowXbox == false) then
    return { copy = nil, disabled = copy.kind }
  end
  local title = copy.title or (entry and (entry.appname or entry.name or entry.AppName)) or ""
  local out = { copy = { kind = copy.kind, title = copy.title } }
  local ok, err = pcall(function()
    if copy.kind == "epic" then
      if not (copy.namespace and copy.offerId) then return end
      local g = epic()
      local offer = g.offer(copy.namespace, copy.offerId)
      if offer then
        out.metadata = g.to_metadata(offer, unsigned(appid), title)
        out.media = g.screenshots(offer)
      end
    else
      local catalog = xbox_catalog()
      local product = (copy.storeId and catalog.by_store_id(copy.storeId)) or (copy.pfn and catalog.by_pfn(copy.pfn))
      if product then
        out.metadata = catalog.to_metadata(product, unsigned(appid), title)
        out.media = catalog.screenshots(product)
      end
    end
  end)
  if not ok then logger:warn("Store Game Info " .. tostring(appid) .. ": " .. tostring(err)) end
  if ctx.achievements ~= false then
    local okA, set, aerr = pcall(function() return require("store_achievements").fetch(copy) end)
    if okA and set then
      out.achievements = set
    elseif okA then
      out.achievementsError = tostring(aerr)
    else
      logger:warn("Store achievements " .. tostring(appid) .. ": " .. tostring(set))
    end
  end
  return out
end

--- The notification mute (ADR-0065): is this shortcut an Xbox copy, and is its game running? { xbox, running? }.
--- Local data only.
function M.xbox_running(appid)
  local entry = entry_of(appid)
  local copy = entry and M.detect(entry)
  if not copy or copy.kind ~= "xbox" then return { xbox = false } end
  for _, g in ipairs(installed().xbox) do
    if g.pfn and copy.pfn and g.pfn:lower() == copy.pfn:lower() then
      return { xbox = true, running = root_running(g.root) }
    end
  end
  return { xbox = true, running = false }
end

return M
