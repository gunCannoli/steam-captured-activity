--- The player's achievements for an Epic or Xbox copy (ADR-0056 decision 4, ADR-0067): read from the store's API and
--- handed to the frontend, which pushes them to steam-cartridges (`reportAchievementSet`). steam-cartridges stores them,
--- keeps Steam's own list when the shortcut's Steam match covers every id, and announces the new unlocks.
---
---   epic  the list from Epic's achievement sandbox (= the manifest's namespace); the unlocks from the player's public
---         profile, by the account id the launcher keeps on disk (no sign-in). A private profile answers the list with
---         no unlocks and is remembered (lookup "epic:account") so the settings panel can say why.
---   xbox  the list and the unlocks from Xbox Live, for the signed-in account; signed out = no answer.
---
--- Epic's list is kept per namespace (lookup "epic-schema:<namespace>"): it does not change between plays.

local M = {}

--- Injectable for tests. nil = the real dependency.
M.deps = {
  epic = nil,         -- nil = epic_graphql
  live = nil,         -- nil = xbox_live
  epic_local = nil,   -- nil = store_epic_local (account_id)
  copies = nil,       -- nil = store_copies_store (the "epic:account" and "epic-schema:" lookups)
}

local function epic() return M.deps.epic or require("epic_graphql") end
local function live() return M.deps.live or require("xbox_live") end
local function epic_local() return M.deps.epic_local or require("store_epic_local") end
local function copies() return M.deps.copies or require("store_copies_store") end

local function fetch_epic(copy)
  if not copy.namespace then return nil, "no namespace" end
  local k = "epic-schema:" .. copy.namespace
  local list = copies().lookup(k)
  if not list or type(list.achievements) ~= "table" or #list.achievements == 0 then
    local res, err = epic().achievement_schema(copy.namespace)
    if not res then return nil, err end
    if #res.achievements == 0 then return nil, "no achievements" end
    list = { product_id = res.product_id, achievements = res.achievements }
    copies().remember(k, list)
  end
  local account = epic_local().account_id()
  local product = copy.productId or list.product_id
  local unlocks = {}
  if account and product then
    local times, err = epic().player_unlocks(account, product)
    if times then
      for id, at in pairs(times) do unlocks[tostring(id)] = tonumber(at) or 0 end
      copies().remember("epic:account", { private = false })
    elseif err == "private" then
      copies().remember("epic:account", { private = true })
      return nil, "private"
    else
      return nil, err -- a failed request: try again later; steam-cartridges keeps what it has
    end
  end
  return { source = "epic", key = copy.namespace, title = copy.title, achievements = list.achievements, unlocks = unlocks }
end

local function fetch_xbox(copy)
  if not copy.titleId then return nil, "no title id" end
  local res, err = live().achievements(copy.titleId)
  if not res then return nil, err end
  if #res.achievements == 0 then return nil, "no achievements" end
  local unlocks = {}
  for id, at in pairs(res.unlocks or {}) do unlocks[tostring(id)] = tonumber(at) or 0 end
  return { source = "xbox", key = tostring(copy.titleId), title = copy.title, achievements = res.achievements, unlocks = unlocks }
end

--- { source, key, title, achievements, unlocks = { [id] = unix } } for a store copy, or nil and an error.
function M.fetch(copy)
  if type(copy) ~= "table" then return nil, "not a store copy" end
  if copy.kind == "epic" then return fetch_epic(copy) end
  if copy.kind == "xbox" then return fetch_xbox(copy) end
  return nil, "unknown store"
end

return M
