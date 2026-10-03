--- Source `xbox` for game data (ADR-0056): Microsoft's public display catalog,
--- https://displaycatalog.mp.microsoft.com/v7.0/. No sign-in and no key. Every request goes through net.lua
--- (source "xbox-catalog").
---
--- Verified on 2026-10-02 (plan § 4.5 and § 4.7):
---   products/lookup?alternateId=PackageFamilyName&value=<pfn>   Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe -> 9WZDNCRFJ9X2
---   products/lookup?alternateId=XboxTitleId&value=<decimal id>  200
---   A product: ProductKind ("Game" tells a game from an app), AlternateIds (XboxTitleId), LocalizedProperties[1]
---   { ProductTitle, ProductDescription, DeveloperName, PublisherName, Images { ImagePurpose, Uri (//...), Width,
---   Height } }, MarketProperties[1].OriginalReleaseDate, Properties { Category, Attributes { Name } }.

local json     = require("json")
local iso_date = require("iso_date")

local M = {}

M.BASE = "https://displaycatalog.mp.microsoft.com/v7.0/"
M.QUERY = "&market=US&languages=en-US,neutral&fieldsTemplate=details"

--- Injectable for tests. nil = the real dependency.
M.deps = {
  get = nil, -- fun(url, opts) -> res | nil, err ; nil = net.get
}

local function url_encode(s)
  return (tostring(s):gsub("[^%w%-_%.~]", function(c) return string.format("%%%02X", c:byte()) end))
end

--- Products already read this session, by URL (Game Info and the community media read one on the same page view).
local products = {}
function M._reset() products = {} end

--- GET -> the first product, or nil and an error. Kept in memory for the session.
local function first_product(url)
  if products[url] then return products[url] end
  local get = M.deps.get or require("net").get
  local res, err = get(url, { source = "xbox-catalog", headers = { ["Accept"] = "application/json" }, timeout = 20 })
  if not res then return nil, err or "no response" end
  if tonumber(res.status) ~= 200 then return nil, "HTTP " .. tostring(res.status) end
  local ok, body = pcall(json.decode, res.body or "")
  if not ok or type(body) ~= "table" then return nil, "bad JSON" end
  local p = type(body.Products) == "table" and body.Products[1] or (type(body.Product) == "table" and body.Product or nil)
  if type(p) ~= "table" then return nil, "not found" end
  products[url] = p
  return p
end

--- The product of an installed package (its family name), or nil and an error.
function M.by_pfn(pfn)
  return first_product(M.BASE .. "products/lookup?alternateId=PackageFamilyName&value=" .. url_encode(pfn) .. M.QUERY)
end

--- The product of an Xbox title id (decimal), or nil and an error.
function M.by_title_id(title_id)
  return first_product(M.BASE .. "products/lookup?alternateId=XboxTitleId&value=" .. url_encode(title_id) .. M.QUERY)
end

--- A product by its Store id (9WZDNCRFJ9X2), or nil and an error.
function M.by_store_id(store_id)
  return first_product(M.BASE .. "products?bigIds=" .. url_encode(store_id) .. M.QUERY)
end

local function localized(product)
  return type(product.LocalizedProperties) == "table" and product.LocalizedProperties[1] or {}
end

--- { store_id, title_id, title, is_game } of a product (pure).
function M.ids(product)
  if type(product) ~= "table" then return {} end
  local title_id
  for _, a in ipairs(type(product.AlternateIds) == "table" and product.AlternateIds or {}) do
    if type(a) == "table" and a.IdType == "XboxTitleId" then title_id = tostring(a.Value) end
  end
  return {
    store_id = product.ProductId and tostring(product.ProductId) or nil,
    title_id = title_id,
    title = localized(product).ProductTitle,
    is_game = product.ProductKind == "Game",
  }
end

--- Catalog attributes -> our player flags (pure). Only attributes that say it exactly; the catalog has no controller
--- attribute for PC, so controller support keeps coming from the plugin's own rules (ADR-0038).
local ATTRIBUTE_FLAGS = {
  SinglePlayer = "single_player",
  XblOnlineMultiPlayer = "multiplayer",
  XblLocalMultiPlayer = "multiplayer",
  XblCrossPlatformMultiPlayer = "multiplayer",
  XblOnlineCoop = "coop",
  XblLocalCoop = "coop",
  XblCrossPlatformCoop = "coop",
}
local LOCAL_PLAY = { XblLocalMultiPlayer = true, XblLocalCoop = true }

--- A product -> our metadata record (pure; the shape library_metadata.json stores).
function M.to_metadata(product, appid, title)
  if type(product) ~= "table" then return nil end
  local lp = localized(product)
  local market = type(product.MarketProperties) == "table" and product.MarketProperties[1] or {}
  local props = type(product.Properties) == "table" and product.Properties or {}
  local categories = {}
  for _, a in ipairs(type(props.Attributes) == "table" and props.Attributes or {}) do
    local name = type(a) == "table" and a.Name or nil
    if name and ATTRIBUTE_FLAGS[name] then categories[ATTRIBUTE_FLAGS[name]] = true end
    if name and LOCAL_PLAY[name] then categories.split_screen = true end
  end
  local function names(s)
    s = tostring(s or "")
    return s ~= "" and { s } or {}
  end
  return {
    appid = appid,
    title = title,
    matched_title = tostring(lp.ProductTitle or title),
    description = tostring(lp.ProductDescription or lp.ShortDescription or ""),
    developers = names(lp.DeveloperName),
    publishers = names(lp.PublisherName),
    franchises = {},
    release_date = iso_date.day(market.OriginalReleaseDate) or 0,
    genres = props.Category and { tostring(props.Category) } or {},
    categories = categories,
    custom_override = false,
  }
end

--- A product's screenshots as community media items (pure). The catalog's URIs start with "//".
function M.screenshots(product)
  local items = {}
  for _, img in ipairs(type(localized(product).Images) == "table" and localized(product).Images or {}) do
    if type(img) == "table" and img.ImagePurpose == "Screenshot" and type(img.Uri) == "string" then
      local url = img.Uri:sub(1, 2) == "//" and ("https:" .. img.Uri) or img.Uri
      if url:match("^https://") then
        items[#items + 1] = {
          kind = "screenshot", source = "xbox", url = url,
          thumb = url .. (url:find("?", 1, true) and "&" or "?") .. "w=640",
          width = tonumber(img.Width) or 1920, height = tonumber(img.Height) or 1080,
        }
      end
    end
  end
  return items
end

return M
