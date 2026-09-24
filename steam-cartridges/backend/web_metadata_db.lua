local fs = require("fs")
local json = require("json")
local utils = require("utils")
local logger = require("logger")

local data_dir = require("data_dir")

local metadata_db = {}
local DB_FILE = nil

local function get_db_path()
  if DB_FILE then return DB_FILE end
  DB_FILE = data_dir.file("library_metadata.json")
  return DB_FILE
end

local db = nil

local function extract_snippet(text)
  if not text or text == "" then return "" end
  local s = text:match("^%s*(.-)%s*$")
  local sentence = s:match("^(.-[.!?])%s") or s:match("^(.-[.!?])$")
  if sentence and #sentence >= 20 and #sentence <= 250 then
    return sentence
  end
  if #s > 220 then
    local cut = s:sub(1, 220)
    local last_space = cut:match("^(.*)%s")
    return (last_space or cut) .. "..."
  end
  return s
end

--- Load database from JSON file
local function load_db()
  if db then return db end

  local path = get_db_path()
  if fs.is_file(path) then
    local content = utils.read_file(path)
    if content and #content > 0 then
      local ok, data = pcall(json.decode, content)
      if ok and type(data) == "table" then
        db = data
        local migrated = false
        for _, rec in pairs(db) do
          if type(rec) == "table" then
            if (not rec.description or rec.description == "") and rec.summary and rec.summary ~= "" then
              rec.description = rec.summary
              migrated = true
            end
            if rec.short_description ~= nil then
              rec.short_description = nil
              migrated = true
            end
            if rec.summary ~= nil then
              rec.summary = nil
              migrated = true
            end
          end
        end
        if migrated then
          metadata_db.save()
        end
        logger:info("Loaded " .. tostring(metadata_db.count()) .. " game metadata record(s) from " .. path)
        return db
      end
    end
  end

  db = {}
  return db
end

--- Count entries in database
function metadata_db.count()
  local d = load_db()
  local c = 0
  for _ in pairs(d) do c = c + 1 end
  return c
end

--- Get metadata for an appid
---@param appid number|string
---@return table|nil
function metadata_db.get(appid)
  local d = load_db()
  return d[tostring(appid)]
end

--- Get all metadata records
---@return table
function metadata_db.get_all()
  return load_db()
end

--- Pretty-format a Lua value as indented JSON for easy human inspection and editing
local function format_json(obj, indent)
  indent = indent or ""
  local next_indent = indent .. "  "
  local t = type(obj)
  if t == "number" or t == "boolean" then
    return tostring(obj)
  elseif t == "string" then
    return json.encode(obj)
  elseif t == "table" then
    local is_array = (#obj > 0)
    local parts = {}
    if is_array then
      for _, v in ipairs(obj) do
        parts[#parts + 1] = next_indent .. format_json(v, next_indent)
      end
      if #parts == 0 then return "[]" end
      return "[\n" .. table.concat(parts, ",\n") .. "\n" .. indent .. "]"
    else
      local keys = {}
      for k in pairs(obj) do keys[#keys + 1] = k end
      table.sort(keys)
      for _, k in ipairs(keys) do
        local v = obj[k]
        parts[#parts + 1] = next_indent .. json.encode(tostring(k)) .. ": " .. format_json(v, next_indent)
      end
      if #parts == 0 then return "{}" end
      return "{\n" .. table.concat(parts, ",\n") .. "\n" .. indent .. "}"
    end
  else
    return "null"
  end
end

--- Save current in-memory database to disk formatted cleanly
function metadata_db.save()
  if not db then return true end

  local encoded = format_json(db)
  local path = get_db_path()
  local written, err = utils.write_file(path, encoded)
  if not written then
    logger:error("Failed to write " .. path .. ": " .. tostring(err))
    return false
  end
  return true
end

--- Set or update metadata for a game
--- Respects custom_override so manual user edits are preserved.
---@param appid number|string
---@param new_data table
---@param force boolean|nil
---@return table saved_data
function metadata_db.set(appid, new_data, force)
  local d = load_db()
  local key = tostring(appid)
  local existing = d[key]

  if existing and existing.custom_override and not force then
    logger:info("Preserving user custom overrides for appid " .. key .. " (" .. tostring(existing.title) .. ")")
    return existing
  end

  -- If existing had custom edits but no explicit override flag, preserve manual description
  if existing and not force then
    if existing.description and existing.description ~= "" and (not new_data.description or new_data.description == "") then
      new_data.description = existing.description
    end
  end

  new_data.short_description = nil
  new_data.summary = nil

  d[key] = new_data
  metadata_db.save()
  return new_data
end

return metadata_db
