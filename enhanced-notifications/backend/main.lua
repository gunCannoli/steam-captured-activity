--- enhanced-notifications - backend entry point.
---
--- Owns only what the frontend cannot do itself: reading theme files and their
--- assets from disk, and writing the Theme Creator's themes into the user folder
--- (SaveTheme / DeleteTheme: never anywhere else, never the bundled folder). Settings are NOT stored here; they live in Millennium's
--- Configuration API and are read by the frontend (docs/knowledgebase.md,
--- "Plugin settings").
---
--- Two theme folders, user first:
---   <steam>/millennium/config/enhanced-notifications/themes   (user themes, survive updates)
---   <plugin>/themes                                          (bundled, replaced on update)
--- A user theme file with the same file name as a bundled one wins.

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

--- One separator style per platform: steam_path() uses "/" but fs.join adds
--- the native one, which showed up as "c:/game/steam\millennium\..." in the panel.
local SEP = package.config:sub(1, 1)
local function native(path)
  return (path:gsub("[/\\]", SEP))
end

local function user_themes_dir()
  return native(fs.join(millennium.steam_path(), "millennium", "config", "enhanced-notifications", "themes"))
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

--- Theme file extensions, in lookup order: a .jsonc and a .json with the same
--- name in one folder resolve to the .jsonc. Both parse as JSONC in the frontend.
local THEME_EXTENSIONS = { ".jsonc", ".json" }
local IS_THEME_EXTENSION = { [".jsonc"] = true, [".json"] = true }

--- Find a theme. `name` is a file stem ("ps5": user folder first, .jsonc before
--- .json) or a whole file name ("ps5.json": that file, user folder first), which
--- picks the other of a .json / .jsonc pair. Returns its path, folder and source, or nil.
local function find_theme(name)
  if type(name) ~= "string" or name == "" or name:find("[/\\]") or name:find("%.%.") then return nil end
  local ext = fs.extension(name):lower()
  if IS_THEME_EXTENSION[ext] then
    for _, entry in ipairs(theme_dirs()) do
      local path = fs.join(entry.dir, name)
      if fs.is_file(path) then return path, entry.dir, entry.source end
    end
  end
  for _, entry in ipairs(theme_dirs()) do
    for _, e in ipairs(THEME_EXTENSIONS) do
      local path = fs.join(entry.dir, name .. e)
      if fs.is_file(path) then return path, entry.dir, entry.source end
    end
  end
  return nil
end

--- Every theme file, a user file shadowing a bundled one of the same file name.
--- `id` is what the `theme` setting stores: the stem for the file a bare stem
--- finds (find_theme), the whole file name for the other of a .json / .jsonc
--- pair, so both can be picked. Sorted by name, then extension.
local function list_themes()
  local seen, out = {}, {}
  for _, entry in ipairs(theme_dirs()) do
    if fs.is_directory(entry.dir) then
      for _, item in ipairs(fs.list(entry.dir) or {}) do
        local path = type(item) == "table" and item.path or item
        local ext = type(path) == "string" and fs.extension(path):lower() or ""
        if IS_THEME_EXTENSION[ext] then
          local name = fs.stem(path)
          local key = name .. ext
          if not seen[key] then
            seen[key] = true
            out[#out + 1] = { name = name, ext = ext, source = entry.source }
          end
        end
      end
    end
  end
  for _, t in ipairs(out) do
    local found, _, source = find_theme(t.name)
    local same = found ~= nil and source == t.source and fs.extension(found):lower() == t.ext
    t.id = same and t.name or (t.name .. t.ext)
  end
  table.sort(out, function(a, b)
    if a.name ~= b.name then return a.name < b.name end
    return a.ext < b.ext
  end)
  return out
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
--- folder; absolute paths are allowed (users keep shared asset libraries
--- elsewhere). Assets are only ever shown or played locally, and only the
--- MIME types above load. A missing, oversized or disallowed asset maps to
--- false (not an error), so one bad path degrades one icon or sound, not the whole theme.
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

--- The Theme Creator's sound library (themes/sounds, tools/import-sfx.mjs): its folder and parsed manifest. The
--- creator loads cues with LoadAssets(dir, { "<pack>/<cue>.wav" }). No manifest: an empty library, not an error.
local function sounds_dir()
  return fs.join(bundled_themes_dir(), "sounds")
end

SoundLibrary = method("SoundLibrary", function(_)
  local dir = sounds_dir()
  local path = fs.join(dir, "library.json")
  if not fs.is_file(path) then return { dir = dir, manifest = { version = 1, cues = {}, packs = {} } } end
  local ok, manifest = pcall(json.decode, utils.read_file(path))
  if not ok or type(manifest) ~= "table" then return { error = "sound library manifest unreadable" } end
  return { dir = dir, manifest = manifest }
end)

OpenThemesFolder = method("OpenThemesFolder", function(_)
  local dir = user_themes_dir()
  fs.create_directories(dir)
  utils.exec('explorer "' .. dir .. '"')
  return { dir = dir }
end)

-- ---------- Theme Creator: writes, user folder only (theme creator plan § 6.6) ----------

--- A theme file stem the creator may write: letters, digits, "_" and "-", 1 to 40.
local function valid_name(name)
  return type(name) == "string" and #name >= 1 and #name <= 40 and name:match("^[%w_%-]+$") ~= nil
end

--- A relative path with no way out of its root: no "..", not absolute, not empty.
local function safe_relative(path)
  if type(path) ~= "string" or path == "" or is_absolute(path) then return false end
  for part in path:gmatch("[^/\\]+") do
    if part == ".." then return false end
  end
  return true
end

--- The roots a copy may read from.
local function copy_root(from)
  if from == "bundled" then return bundled_themes_dir() end
  if from == "user" then return user_themes_dir() end
  if from == "library" then return sounds_dir() end
  return nil
end

--- Copy one file by content (fs.copy refuses an existing target). Errors carry the file's name.
local function copy_file(src, dst)
  local content = utils.read_file(src)
  if content == nil then error("could not read " .. src) end
  local ok, err = utils.write_file(dst, content)
  if not ok then error("could not write " .. dst .. ": " .. tostring(err)) end
end

--- Write through a temp file and a rename, so a theme file is never half-written.
local function write_atomic(path, text)
  local tmp = path .. ".tmp"
  local ok, err = utils.write_file(tmp, text)
  if not ok then error("could not write " .. tmp .. ": " .. tostring(err)) end
  if not fs.rename(tmp, path) then
    -- A rename that cannot replace an existing file: remove it first.
    fs.remove(path)
    if not fs.rename(tmp, path) then
      fs.remove(tmp)
      error("could not replace " .. path)
    end
  end
end

--- The `theme` setting's id for a user theme file (list_themes' rule).
local function id_of(name, ext)
  for _, t in ipairs(list_themes()) do
    if t.name == name and t.ext == ext and t.source == "user" then return t.id end
  end
  return name
end

--- Save a theme: { name, text, overwrite, backup, copies = { { from = "bundled"|"user"|"library"|"file", path, to } } }.
--- Every copy is checked before anything is written (its root, type, size, and a target inside <name>/); one bad
--- copy refuses the whole save. Copies first, then the theme file through a temp file. Returns { id, path }.
SaveTheme = method("SaveTheme", function(data)
  local name = data.name
  if not valid_name(name) then return { error = "invalid theme name (letters, digits, _ and -, at most 40)" } end
  if type(data.text) ~= "string" or data.text == "" then return { error = "no theme text" } end
  local dir = user_themes_dir()
  local path = fs.join(dir, name .. ".jsonc")
  if fs.is_file(path) and data.overwrite ~= true then return { error = "exists" } end

  local plan = {}
  for _, c in ipairs(type(data.copies) == "table" and data.copies or {}) do
    -- "file": a file the user picked with Steam's file dialog (an absolute path); the rest are relative to their root.
    local root = c.from ~= "file" and copy_root(c.from) or nil
    if c.from ~= "file" and not root then return { error = "copy refused: unknown source " .. tostring(c.from) } end
    if c.from == "file" then
      if type(c.path) ~= "string" or not is_absolute(c.path) or c.path:find("%.%.") then return { error = "copy refused: " .. tostring(c.path) } end
    elseif not safe_relative(c.path) then return { error = "copy refused: " .. tostring(c.path) } end
    local file = type(c.to) == "string" and c.to:match("^" .. name:gsub("%-", "%%-") .. "[/\\]([^/\\]+)$")
    if not file or file == ".." or file == "." then return { error = "copy refused: target " .. tostring(c.to) } end
    local src = root and fs.join(root, c.path) or native(c.path)
    if not MIME[(fs.extension(src):sub(2)):lower()] then return { error = "copy refused: type not allowed: " .. c.path } end
    if not fs.is_file(src) then return { error = "copy refused: not found: " .. c.path } end
    if (fs.file_size(src) or 0) > MAX_ASSET_BYTES then return { error = "copy refused: larger than 8 MB: " .. c.path } end
    if not MIME[(fs.extension(file):sub(2)):lower()] then return { error = "copy refused: target type: " .. c.to } end
    plan[#plan + 1] = { src = src, dst = fs.join(dir, name, file) }
  end

  fs.create_directories(dir)
  if #plan > 0 then fs.create_directories(fs.join(dir, name)) end
  for _, step in ipairs(plan) do
    if step.src ~= step.dst then copy_file(step.src, step.dst) end
  end
  if data.backup == true and fs.is_file(path) then copy_file(path, path .. ".bak") end
  write_atomic(path, data.text)
  logger:info("Theme Creator saved " .. path .. " (" .. #plan .. " files copied)")
  return { id = id_of(name, ".jsonc"), path = path }
end)

--- Delete a user theme: { id, assets }. `id` is the theme setting's value (a stem, or a whole file name for the
--- other of a .json / .jsonc pair); only the user folder is looked in. `assets`: also its <stem>/ folder.
DeleteTheme = method("DeleteTheme", function(data)
  local id = data.id
  if type(id) ~= "string" or id:find("[/\\]") or id:find("%.%.") then return { error = "invalid theme id" } end
  local dir = user_themes_dir()
  local ext = fs.extension(id):lower()
  local stem = IS_THEME_EXTENSION[ext] and id:sub(1, #id - #ext) or id
  if not valid_name(stem) then return { error = "not a theme the creator manages: " .. id } end
  local candidates = IS_THEME_EXTENSION[ext] and { id } or { stem .. ".jsonc", stem .. ".json" }
  local path
  for _, file in ipairs(candidates) do
    if fs.is_file(fs.join(dir, file)) then path = fs.join(dir, file) break end
  end
  if not path then return { error = "not a user theme: " .. id } end
  fs.remove(path)
  local removed_assets = false
  local assets = fs.join(dir, stem)
  if data.assets == true and fs.is_directory(assets) then
    fs.remove_all(assets)
    removed_assets = true
  end
  logger:info("Theme Creator deleted " .. path .. (removed_assets and " and its folder" or ""))
  return { deleted = path, assets = removed_assets }
end)

local IMAGE = { png = true, jpg = true, jpeg = true, gif = true, webp = true, svg = true }

--- Images and sounds in a theme folder and its subfolders one level down: { dir } -> { files = { { path, size, kind } } }.
--- `dir` must be the bundled or user themes folder, or a folder inside one of them.
ListThemeAssets = method("ListThemeAssets", function(data)
  local dir = type(data.dir) == "string" and native(data.dir) or ""
  local allowed = false
  for _, entry in ipairs(theme_dirs()) do
    local root = native(entry.dir)
    if dir:lower() == root:lower() or dir:lower():sub(1, #root + 1) == (root .. SEP):lower() then allowed = true end
  end
  if not allowed or dir:find("%.%.") then return { error = "not a themes folder: " .. tostring(data.dir) } end
  local files = {}
  local function scan(folder, prefix, depth)
    if not fs.is_directory(folder) then return end
    for _, item in ipairs(fs.list(folder) or {}) do
      local path = type(item) == "table" and item.path or item
      local name = type(item) == "table" and item.name or fs.filename(path)
      if type(path) == "string" then
        if fs.is_directory(path) then
          if depth < 1 and name ~= "sounds" then scan(path, prefix .. name .. "/", depth + 1) end
        else
          local ext = (fs.extension(path):sub(2)):lower()
          if MIME[ext] then
            files[#files + 1] = { path = prefix .. name, size = fs.file_size(path) or 0, kind = IMAGE[ext] and "image" or "sound" }
          end
        end
      end
    end
  end
  scan(dir, "", 0)
  table.sort(files, function(a, b) return a.path < b.path end)
  return { files = files }
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
