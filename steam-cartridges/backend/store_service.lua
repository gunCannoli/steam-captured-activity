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
    return { kind = "epic", title = g.title, namespace = g.namespace, itemId = g.item_id, appName = g.app_name, via = via }
  end
  local x, xvia = xbox_local().match(entry, games.xbox)
  if x then
    return { kind = "xbox", title = x.title, pfn = x.pfn, titleId = x.title_id, storeId = x.store_id, via = xvia }
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
--- of an installed UWP game, but not the current version's exe. { { appid, title, exe, start_dir } } to repoint; the
--- library-shortcuts surface writes them (the appid stays, so playtime and activity stay). A shortcut that runs anything
--- else (Explorer, another exe) is never listed. Local data only.
function M.xbox_repairs()
  local xbox = xbox_local()
  local games = installed(true).xbox
  local function norm(p) return (tostring(p or ""):gsub('"', ""):gsub("/", "\\"):lower()) end
  local out = {}
  for _, e in ipairs(all_entries()) do
    local pfn = xbox.pfn_from_path(e.exe)
    if pfn then
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

--- Every installed game and whether the library already has a shortcut for it (Third-party settings, auto-add).
--- { epic = { { key, title, inLibrary, launch } }, xbox = { ... }, epicLauncher = bool }: `launch` = { exe, start_dir,
--- launch_options } for SteamClient.Apps.AddShortcut. Local data, except an Xbox game whose name is unknown: its
--- package names a resource, not a title, so the catalog is asked once (ctx.allowXbox, remembered like any lookup).
function M.installed_games(ctx)
  ctx = ctx or {}
  local games = installed(true)
  local owned = {}
  for _, e in ipairs(all_entries()) do
    local c = M.detect(e)
    if c then owned[(c.kind == "epic" and c.appName or c.pfn) or ""] = unsigned(e.appid) end
  end
  local launcher = epic_local().launcher_exe()
  local out = { epic = {}, xbox = {}, epicLauncher = launcher ~= nil }
  for _, g in ipairs(games.epic) do
    out.epic[#out.epic + 1] = {
      key = g.app_name, title = g.title, inLibrary = owned[g.app_name],
      launch = epic_local().launch_spec(g, launcher),
    }
  end
  for _, g in ipairs(games.xbox) do
    local copy = { kind = "xbox", title = g.title, pfn = g.pfn, titleId = g.title_id, storeId = g.store_id }
    if not g.title then pcall(fill_xbox, copy, ctx) end
    local known = store.lookup("xbox:" .. tostring(g.pfn)) or {}
    out.xbox[#out.xbox + 1] = {
      key = g.pfn, title = known.title or g.title or g.pfn, inLibrary = owned[g.pfn],
      launch = xbox_local().launch_spec(g),
    }
  end
  return out
end

return M
