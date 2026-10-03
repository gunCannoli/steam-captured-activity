--- Sources `epic` and `xbox` of the achievements service (ADR-0056): the player's own unlocks on the store the copy
--- was bought on, synced through the store's API (decision 4: no in-game observer, no toast; the store's overlay
--- already showed the unlock).
---
---   epic  the list from Epic's achievement sandbox (= the manifest's namespace); the unlocks from the player's public
---         profile, by the account id the launcher keeps on disk (no sign-in). A private profile keeps the last
---         unlocks known and is remembered (lookup "epic:account") so the settings panel can say why.
---   xbox  the list and the unlocks from Xbox Live, for the signed-in account; signed out = no answer (the next source
---         of ach_service answers instead).
---
--- A copy with a Steam match keeps Steam's own list (names and icons in the user's language) when every store id is in
--- it, as for Jotunnslayer (Epic's ACH_* names are Steam's API names); any mismatch -> the store's own list. Never a
--- match by display name.
---
--- Persisted in achievements.json like every source: the store's list under "epic_<namespace>" / "xbox_<title id>",
--- the shortcut's unlocks (replaced by each sync: the store is the truth) and its `source`.

local store = require("achievements_store")

local M = {}

--- Injectable for tests. nil = the real dependency.
M.deps = {
  epic = nil,         -- nil = epic_graphql
  live = nil,         -- nil = xbox_live
  epic_local = nil,   -- nil = store_epic_local (account_id)
  steam_fetch = nil,  -- fun(native) -> schema | nil, err ; nil = steam_schema.fetch
  copies = nil,       -- nil = store_copies_store (the "epic:account" lookup)
}

local function epic() return M.deps.epic or require("epic_graphql") end
local function live() return M.deps.live or require("xbox_live") end
local function epic_local() return M.deps.epic_local or require("store_epic_local") end
local function copies() return M.deps.copies or require("store_copies_store") end

--- Steam's list for a native app: stored, else fetched and stored (the shortcut is not re-bound here).
local function steam_list(native)
  local s = store.get_schema(native)
  if s then return s end
  local fetched = (M.deps.steam_fetch or require("steam_schema").fetch)(native)
  if fetched then store.save_schema(native, fetched) end
  return fetched
end

--- Every id of `list` is in `steam` (pure).
local function covered_by(list, steam)
  if type(steam) ~= "table" or type(steam.achievements) ~= "table" or #list == 0 then return false end
  local ids = {}
  for _, a in ipairs(steam.achievements) do ids[tostring(a.id)] = true end
  for _, a in ipairs(list) do
    if not ids[tostring(a.id)] then return false end
  end
  return true
end

local function as_unlocks(times)
  local out = {}
  for id, at in pairs(times or {}) do out[tostring(id)] = { unlocked_time = tonumber(at) or 0 } end
  return out
end

--- The schema record the store keeps for a store list.
local function schema_record(kind, items, extra)
  local s = { native_appid = 0, total = #items, achievements = items, source = kind, fetched_at = os.time() }
  for k, v in pairs(extra or {}) do s[k] = v end
  return s
end

--- Pick the list (Steam's when it covers the store's), persist, and answer like the other sources.
local function finish(appid, kind, key, list_schema, unlocks, native)
  local schema_id, schema = key, list_schema
  if (tonumber(native) or 0) > 0 then
    local ok, steam = pcall(steam_list, native)
    if ok and covered_by(list_schema.achievements, steam) then schema_id, schema = native, steam end
  end
  store.sync(appid, schema_id, unlocks, kind)
  return { schema = schema, unlocks = unlocks }
end

local function fetch_epic(appid, copy, native)
  if not copy.namespace then return nil, "no namespace" end
  local key = "epic_" .. copy.namespace
  local list = store.get_schema(key)
  if not list then
    local res, err = epic().achievement_schema(copy.namespace)
    if not res then return nil, err end
    if #res.achievements == 0 then return nil, "no achievements" end
    list = schema_record("epic", res.achievements, { product_id = res.product_id, title = copy.title })
    store.save_schema(key, list)
  end
  local previous = store.get_state(appid).unlocks or {}
  local account = epic_local().account_id()
  local product = copy.productId or list.product_id
  local unlocks = previous
  if account and product then
    local times, err = epic().player_unlocks(account, product)
    if times then
      unlocks = as_unlocks(times)
      copies().remember("epic:account", { private = false })
    elseif err == "private" then
      copies().remember("epic:account", { private = true })
    else
      return nil, err -- a failed request: try again later, keep what the record has
    end
  end
  return finish(appid, "epic", key, list, unlocks, native)
end

local function fetch_xbox(appid, copy, native)
  if not copy.titleId then return nil, "no title id" end
  local res, err = live().achievements(copy.titleId)
  if not res then return nil, err end
  if #res.achievements == 0 then return nil, "no achievements" end
  local key = "xbox_" .. copy.titleId
  local list = schema_record("xbox", res.achievements, { title = copy.title })
  store.save_schema(key, list)
  return finish(appid, "xbox", key, list, as_unlocks(res.unlocks), native)
end

--- { schema, unlocks } for a store copy, or nil and an error. `copy` is the record's StoreCopy; `native` its Steam match.
function M.fetch(appid, copy, native)
  if type(copy) ~= "table" then return nil, "not a store copy" end
  if copy.kind == "epic" then return fetch_epic(appid, copy, native) end
  if copy.kind == "xbox" then return fetch_xbox(appid, copy, native) end
  return nil, "unknown store"
end

return M
