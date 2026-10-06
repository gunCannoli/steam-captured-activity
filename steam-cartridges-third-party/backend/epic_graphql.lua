--- Source `epic` (ADR-0056): the Epic Games Store's own public GraphQL API, https://store.epicgames.com/graphql.
--- No sign-in and no key: the store's game data, achievement list and, when the player's profile shows its
--- achievements to everyone, the player's unlocks. Every request goes through net.lua (source "epic", breakers).
---
--- Queries and fields verified anonymously on 2026-10-02 (plan § 4.2 and § 4.7). Introspection is off, and a query
--- that names an unknown field fails as a whole, so only these fields are asked for:
---   Catalog.catalogOffers(namespace, locale, params)   the namespace's offers with offerType (BASE_GAME first)
---   Catalog.catalogOffer(namespace, id, locale)        title, description, developer/publisherDisplayName,
---                                                      releaseDate, pcReleaseDate, tags { name groupName },
---                                                      keyImages { type url } (featuredMedia = screenshots)
---   Achievement.productAchievementsRecordBySandbox     productId and each achievement (name = the API name)
---   PlayerProfile.playerProfile(epicAccountId)
---     .productAchievements(productId)                  the player's unlocks with unlockDate; a private profile
---                                                      answers ServiceError { status 403 }

local json     = require("json")
local iso_date = require("iso_date")

local M = {}

M.URL = "https://store.epicgames.com/graphql"
M.USER_AGENT = "steam-cartridges (Millennium plugin)"

--- Injectable for tests. nil = the real dependency.
M.deps = {
  post = nil, -- fun(url, body, opts) -> res | nil, err ; nil = net.post
}

--- GraphQL request -> the `data` table, or nil and an error.
local function query(q)
  local post = M.deps.post or require("net").post
  local res, err = post(M.URL, json.encode({ query = q }), {
    source = "epic",
    headers = { ["Content-Type"] = "application/json", ["Accept"] = "application/json", ["User-Agent"] = M.USER_AGENT },
    timeout = 20,
  })
  if not res then return nil, err or "no response" end
  if tonumber(res.status) ~= 200 then return nil, "HTTP " .. tostring(res.status) end
  local ok, body = pcall(json.decode, res.body or "")
  if not ok or type(body) ~= "table" then return nil, "bad JSON" end
  if type(body.errors) == "table" and body.errors[1] then
    return nil, tostring(body.errors[1].message or "GraphQL error")
  end
  if type(body.data) ~= "table" then return nil, "no data" end
  return body.data
end

--- A GraphQL string literal (ids come from the user's own disk, still quote them safely).
local function lit(s) return json.encode(tostring(s or "")) end

--- The namespace's base game offer: { id, title } or nil and an error.
function M.base_offer(namespace)
  local data, err = query("query { Catalog { catalogOffers(namespace: " .. lit(namespace)
    .. ", locale: \"en-US\", params: { count: 50 }) { elements { id title offerType } } } }")
  if not data then return nil, err end
  local list = (((data.Catalog or {}).catalogOffers or {}).elements) or {}
  local first
  for _, o in ipairs(list) do
    if type(o) == "table" and o.id then
      first = first or o
      if o.offerType == "BASE_GAME" then return { id = tostring(o.id), title = tostring(o.title or "") } end
    end
  end
  if first then return { id = tostring(first.id), title = tostring(first.title or "") } end
  return nil, "no offer"
end

--- Offers already read this session (Game Info and the community media both read one on the same page view).
local offers = {}
function M._reset() offers = {} end

--- The offer's game data (the fields above), or nil and an error. Kept in memory for the session.
function M.offer(namespace, offer_id)
  local memo_key = tostring(namespace) .. "/" .. tostring(offer_id)
  if offers[memo_key] then return offers[memo_key] end
  local data, err = query("query { Catalog { catalogOffer(namespace: " .. lit(namespace) .. ", id: " .. lit(offer_id)
    .. ", locale: \"en-US\") { title description developerDisplayName publisherDisplayName releaseDate pcReleaseDate"
    .. " tags { name groupName } keyImages { type url } } } }")
  if not data then return nil, err end
  local o = (data.Catalog or {}).catalogOffer
  if type(o) ~= "table" or not o.title then return nil, "no offer" end
  offers[memo_key] = o
  return o
end

--- Epic feature tags -> our player flags (pure). Only tags that say it exactly; Epic's "Controller Support" does not
--- tell full from partial, so it is partial.
local FEATURE_FLAGS = {
  ["Single Player"] = "single_player",
  ["Multiplayer"] = "multiplayer",
  ["Co-op"] = "coop",
  ["Controller Support"] = "partial_controller",
}

--- An offer -> our metadata record (pure; the shape library_metadata.json stores).
function M.to_metadata(offer, appid, title)
  if type(offer) ~= "table" then return nil end
  local genres, categories = {}, {}
  for _, t in ipairs(type(offer.tags) == "table" and offer.tags or {}) do
    if type(t) == "table" and t.name then
      if t.groupName == "genre" then genres[#genres + 1] = tostring(t.name) end
      local flag = (t.groupName == "feature" or t.groupName == "epicfeature") and FEATURE_FLAGS[tostring(t.name)]
      if flag then categories[flag] = true end
    end
  end
  local function names(s)
    s = tostring(s or "")
    return s ~= "" and { s } or {}
  end
  return {
    appid = appid,
    title = title,
    matched_title = tostring(offer.title or title),
    description = tostring(offer.description or ""),
    developers = names(offer.developerDisplayName),
    publishers = names(offer.publisherDisplayName),
    franchises = {},
    release_date = iso_date.day(offer.pcReleaseDate) or iso_date.day(offer.releaseDate) or 0,
    genres = genres,
    categories = categories,
    custom_override = false,
  }
end

--- An offer's screenshots as community media items (pure): its `featuredMedia` key images, 16:9 store art.
function M.screenshots(offer)
  local items = {}
  for _, k in ipairs(type(offer) == "table" and type(offer.keyImages) == "table" and offer.keyImages or {}) do
    if type(k) == "table" and k.type == "featuredMedia" and type(k.url) == "string" and k.url:match("^https://") then
      items[#items + 1] = {
        kind = "screenshot", source = "epic", url = k.url,
        -- Epic's image CDN resizes on request: the card loads a small copy, the viewer the full one.
        thumb = k.url .. (k.url:find("?", 1, true) and "&" or "?") .. "w=640&resize=1",
        width = 1920, height = 1080,
      }
    end
  end
  return items
end

--- The sandbox's achievement list: { product_id, achievements = { { id, name, description, icon, icon_locked, xp,
--- global_pct, hidden } } }, or nil and an error.
function M.achievement_schema(sandbox)
  local data, err = query("query { Achievement { productAchievementsRecordBySandbox(sandboxId: " .. lit(sandbox)
    .. ", locale: \"en-US\") { productId totalAchievements achievements { achievement { name hidden"
    .. " unlockedDisplayName unlockedDescription unlockedIconLink lockedIconLink XP rarity { percent } } } } } }")
  if not data then return nil, err end
  local rec = (data.Achievement or {}).productAchievementsRecordBySandbox
  if type(rec) ~= "table" or not rec.productId then return nil, "no achievements" end
  local out = { product_id = tostring(rec.productId), achievements = {} }
  for _, wrap in ipairs(type(rec.achievements) == "table" and rec.achievements or {}) do
    local a = type(wrap) == "table" and wrap.achievement or nil
    if type(a) == "table" and a.name then
      out.achievements[#out.achievements + 1] = {
        id = tostring(a.name),
        name = tostring(a.unlockedDisplayName or a.name),
        description = tostring(a.unlockedDescription or ""),
        icon = tostring(a.unlockedIconLink or ""),
        icon_locked = tostring(a.lockedIconLink or ""),
        xp = tonumber(a.XP) or 0,
        global_pct = tonumber(type(a.rarity) == "table" and a.rarity.percent) or 0,
        hidden = a.hidden == true,
      }
    end
  end
  return out
end

--- The player's unlocks in one product: { [api name] = unix seconds }, or nil and an error. "private" when the
--- profile does not show its achievements to everyone (the user changes that in their Epic account's privacy).
function M.player_unlocks(account_id, product_id)
  local data, err = query("query { PlayerProfile { playerProfile(epicAccountId: " .. lit(account_id)
    .. ") { productAchievements(productId: " .. lit(product_id) .. ") { __typename"
    .. " ... on PlayerProductAchievementsResponseSuccess { data { playerAchievements { playerAchievement"
    .. " { achievementName unlocked unlockDate } } } } ... on ServiceError { status message } } } } }")
  if not data then return nil, err end
  local res = (((data.PlayerProfile or {}).playerProfile or {}).productAchievements)
  if type(res) ~= "table" then return nil, "no profile" end
  if res.__typename == "ServiceError" then
    return nil, tonumber(res.status) == 403 and "private" or ("service error " .. tostring(res.status))
  end
  local unlocks = {}
  local list = type(res.data) == "table" and res.data.playerAchievements or {}
  for _, wrap in ipairs(type(list) == "table" and list or {}) do
    local p = type(wrap) == "table" and wrap.playerAchievement or nil
    if type(p) == "table" and p.unlocked == true and p.achievementName then
      unlocks[tostring(p.achievementName)] = iso_date.instant(p.unlockDate) or 0
    end
  end
  return unlocks
end

return M
