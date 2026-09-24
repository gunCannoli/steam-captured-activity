--- enhanced-achievements - backend entry point.
---
--- Owns only what the frontend cannot do itself: reading theme files and their
--- assets from disk. Settings are NOT stored here; they live in Millennium's
--- Configuration API and are read by the frontend (docs/knowledgebase.md,
--- "Plugin settings").
---
--- Two theme folders, user first:
---   <steam>/millennium/config/enhanced-achievements/themes   (user themes, survive updates)
---   <plugin>/themes                                          (bundled, replaced on update)
--- A user theme with the same name as a bundled one wins.

local json       = require("json")
local logger     = require("logger")
local millennium = require("millennium")
local fs         = require("fs")
local utils      = require("utils")

-- Only these can be loaded as assets, so a shared theme cannot pull arbitrary
-- files off disk into the frontend.
local MIME = {
  png = "image/png", jpg = "image/jpeg", jpeg = "image/jpeg", gif = "image/gif",
  webp = "image/webp", svg = "image/svg+xml",
  mp3 = "audio/mpeg", wav = "audio/wav", ogg = "audio/ogg",
}

local MAX_ASSET_BYTES = 8 * 1024 * 1024

--- Wrap a handler so it decodes/encodes JSON and never throws across the
--- boundary. Returning a bare nil crashes Millennium, so nil becomes 'null'.
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

local function user_themes_dir()
  return fs.join(millennium.steam_path(), "millennium", "config", "enhanced-achievements", "themes")
end

local function bundled_themes_dir()
  return fs.join(fs.parent_path(utils.get_backend_path()), "themes")
end

--- Theme folders in priority order (user first).
local function theme_dirs()
  return { { dir = user_themes_dir(), source = "user" }, { dir = bundled_themes_dir(), source = "bundled" } }
end

local function is_absolute(path)
  return path:match("^%a:[/\\]") ~= nil or path:sub(1, 1) == "/" or path:sub(1, 2) == "\\\\"
end

--- Names (without .json) of every theme, user themes shadowing bundled ones.
local function list_themes()
  local seen, out = {}, {}
  for _, entry in ipairs(theme_dirs()) do
    if fs.is_directory(entry.dir) then
      for _, item in ipairs(fs.list(entry.dir) or {}) do
        local path = type(item) == "table" and item.path or item
        if type(path) == "string" and fs.extension(path):lower() == ".json" then
          local name = fs.stem(path)
          if not seen[name] then
            seen[name] = true
            out[#out + 1] = { name = name, source = entry.source }
          end
        end
      end
    end
  end
  table.sort(out, function(a, b) return a.name < b.name end)
  return out
end

--- Find a theme by name. Returns its path and folder, or nil.
local function find_theme(name)
  if type(name) ~= "string" or name == "" or name:find("[/\\]") or name:find("%.%.") then return nil end
  for _, entry in ipairs(theme_dirs()) do
    local path = fs.join(entry.dir, name .. ".json")
    if fs.is_file(path) then return path, entry.dir, entry.source end
  end
  return nil
end

ListThemes = method("ListThemes", function(_)
  return { themes = list_themes(), userDir = user_themes_dir() }
end)

--- The theme file's raw text; the frontend parses and validates it.
LoadTheme = method("LoadTheme", function(data)
  local path, dir, source = find_theme(data.name)
  if not path then return { error = "theme not found: " .. tostring(data.name) } end
  return { name = data.name, source = source, dir = dir, text = utils.read_file(path) }
end)

--- Asset paths -> data URLs. Relative paths resolve against the theme's own
--- folder. A missing, oversized or disallowed asset maps to false (not an
--- error), so one bad path degrades one icon or sound, not the whole theme.
LoadAssets = method("LoadAssets", function(data)
  local out = {}
  local dir = type(data.dir) == "string" and data.dir or ""
  for _, rel in ipairs(type(data.paths) == "table" and data.paths or {}) do
    if type(rel) == "string" then
      local path = is_absolute(rel) and rel or fs.join(dir, rel)
      local mime = MIME[(fs.extension(path):sub(2)):lower()]
      if not mime then
        logger:warn("asset type not allowed: " .. rel)
        out[rel] = false
      elseif not fs.is_file(path) then
        logger:warn("asset not found: " .. path)
        out[rel] = false
      elseif (fs.file_size(path) or 0) > MAX_ASSET_BYTES then
        logger:warn("asset too large (> 8 MB): " .. path)
        out[rel] = false
      else
        out[rel] = "data:" .. mime .. ";base64," .. utils.base64_encode(utils.read_file(path))
      end
    end
  end
  return out
end)

OpenThemesFolder = method("OpenThemesFolder", function(_)
  local dir = user_themes_dir()
  fs.create_directories(dir)
  utils.exec('explorer "' .. dir:gsub("/", "\\") .. '"')
  return { dir = dir }
end)

local function on_load()
  -- Create the user themes folder up front so it is discoverable.
  local ok, err = pcall(fs.create_directories, user_themes_dir())
  if not ok then logger:error("could not create user themes folder: " .. tostring(err)) end

  millennium.ready()
  logger:info("Backend loaded. User themes: " .. user_themes_dir())
end

return {
  on_load = on_load,
  on_frontend_loaded = function() end,
  on_unload = function() end,
}
