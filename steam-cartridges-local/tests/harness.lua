-- Test harness: stubs the Millennium-provided modules so the real backend
-- modules can run against this machine's actual Steam files.

-- Override for a different install:
--   set NSGA_STEAM_ROOT=D:\Steam && lua tests\test_backend.lua
local STEAM_ROOT = os.getenv("NSGA_STEAM_ROOT") or [[C:\Program Files (x86)\Steam]]

-- Resolve the backend relative to this file so the suite runs from any cwd.
local here = debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."
local BACKEND = here .. "\\..\\backend"

package.path = BACKEND .. "\\?.lua;" .. package.path

-- ---------- stub: logger ----------
local logger = {}
function logger:info(m)  print("  [info]  " .. m) end
function logger:warn(m)  print("  [warn]  " .. m) end
function logger:error(m) print("  [error] " .. m) end
function logger:debug(m) end
package.loaded["logger"] = logger

-- ---------- stub: millennium ----------
package.loaded["millennium"] = {
  steam_path = function() return STEAM_ROOT end,
  ready = function() end,
}

-- ---------- stub: fs ----------
local fs = {}
local function popen_lines(cmd)
  local p = io.popen(cmd, "r")
  if not p then return {} end
  local out = {}
  for line in p:lines() do out[#out + 1] = line end
  p:close()
  return out
end

function fs.join(...)
  local parts = { ... }
  local out = parts[1] or ""
  for i = 2, #parts do
    if out:sub(-1) ~= "\\" and out:sub(-1) ~= "/" then out = out .. "\\" end
    out = out .. parts[i]
  end
  return out
end

function fs.exists(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  -- might be a directory
  local ok = popen_lines('if exist "' .. path .. '\\*" (echo yes)')
  return ok[1] == "yes"
end

function fs.is_file(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

function fs.is_directory(path)
  local ok = popen_lines('if exist "' .. path .. '\\*" (echo yes)')
  return ok[1] == "yes"
end

function fs.last_write_time(path)
  local lines = popen_lines('powershell -NoProfile -Command "try{[int][double]::Parse((Get-Item -LiteralPath \''
    .. path .. '\' -Force).LastWriteTimeUtc.Subtract([datetime]\'1970-01-01\').TotalSeconds)}catch{0}"')
  return tonumber(lines[1]) or 0
end

function fs.create_directories(path)
  -- cmd's mkdir wants backslashes and creates intermediate directories.
  os.execute('mkdir "' .. path:gsub("/", "\\") .. '" >nul 2>nul')
  return true
end

function fs.remove(path)
  return os.remove(path)
end

function fs.remove_all(path)
  os.execute('rmdir /s /q "' .. path:gsub("/", "\\") .. '" >nul 2>nul')
  return 1
end

function fs.extension(path)
  local ext = path:match("(%.[^%.\\/]+)$")
  return ext or ""
end

function fs.file_size(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local size = f:seek("end")
  f:close()
  return size
end

function fs.list(path)
  local entries = {}
  for _, name in ipairs(popen_lines('dir /b "' .. path .. '" 2>nul')) do
    if name ~= "" then
      local full = fs.join(path, name)
      entries[#entries + 1] = {
        name = name,
        path = full,
        is_directory = fs.is_directory(full),
        is_file = fs.is_file(full),
      }
    end
  end
  return entries
end
package.loaded["fs"] = fs

-- ---------- stub: utils ----------
local utils = {}
function utils.base64_encode(input)
  local B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  return ((input:gsub('...', function(x)
    local r, b = '', x:byte(1) * 65536 + x:byte(2) * 256 + x:byte(3)
    for i = 1, 4 do r = r .. B:sub((b >> (24 - i * 6)) % 64 + 1, (b >> (24 - i * 6)) % 64 + 1) end
    return r
  end)) .. ({ '', '==', '=' })[#input % 3 + 1])
end

function utils.read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil, "not found" end
  local content = f:read("*all")
  f:close()
  return content
end
function utils.write_file(path, content)
  local f, err = io.open(path, "wb")
  if not f then return false, err end
  f:write(content)
  f:close()
  return true
end
function utils.url_encode(str)
  if not str then return "" end
  return (string.gsub(tostring(str), "([^%w_%-%.~])", function(c)
    return string.format("%%%02X", string.byte(c))
  end))
end
package.loaded["utils"] = utils



-- ---------- stub: http ----------
-- A test must never reach the network.
local http = {}
function http.get() error("network in test") end
function http.post() error("network in test") end
package.loaded["http"] = http

-- ---------- stub: json ----------
local json = {}

--- General recursive-descent JSON decoder (objects, arrays, strings, numbers,
--- booleans, null nest to any depth). Needed because library_metadata.json and
--- similar files have nested objects/arrays; a flat { "key": "value" } scanner
--- silently mis-parses them.
local function decode_value(s, i)
  i = s:match("^%s*()", i)
  local c = s:sub(i, i)

  if c == '"' then
    local j, buf = i + 1, {}
    while j <= #s do
      local ch = s:sub(j, j)
      if ch == "\\" then
        local esc = s:sub(j + 1, j + 1)
        if esc == "n" then buf[#buf + 1] = "\n"
        elseif esc == "t" then buf[#buf + 1] = "\t"
        elseif esc == "r" then buf[#buf + 1] = "\r"
        elseif esc == "u" then
          local hex = s:sub(j + 2, j + 5)
          buf[#buf + 1] = utf8 and utf8.char(tonumber(hex, 16)) or "?"
          j = j + 4
        else buf[#buf + 1] = esc end
        j = j + 2
      elseif ch == '"' then
        return table.concat(buf), j + 1
      else
        buf[#buf + 1] = ch
        j = j + 1
      end
    end
    error("unterminated string in JSON")
  elseif c == "{" then
    local out, j = {}, s:match("^%s*()", i + 1)
    if s:sub(j, j) == "}" then return out, j + 1 end
    while true do
      local key
      key, j = decode_value(s, j)
      j = s:match("^%s*()", j)
      assert(s:sub(j, j) == ":", "expected ':' in JSON object")
      local val
      val, j = decode_value(s, j + 1)
      out[key] = val
      j = s:match("^%s*()", j)
      local sep = s:sub(j, j)
      if sep == "," then j = s:match("^%s*()", j + 1)
      elseif sep == "}" then return out, j + 1
      else error("expected ',' or '}' in JSON object") end
    end
  elseif c == "[" then
    local out, n, j = {}, 0, s:match("^%s*()", i + 1)
    if s:sub(j, j) == "]" then return out, j + 1 end
    while true do
      local val
      val, j = decode_value(s, j)
      n = n + 1
      out[n] = val
      j = s:match("^%s*()", j)
      local sep = s:sub(j, j)
      if sep == "," then j = s:match("^%s*()", j + 1)
      elseif sep == "]" then return out, j + 1
      else error("expected ',' or ']' in JSON array") end
    end
  elseif s:sub(i, i + 3) == "true" then
    return true, i + 4
  elseif s:sub(i, i + 4) == "false" then
    return false, i + 5
  elseif s:sub(i, i + 3) == "null" then
    return nil, i + 4
  else
    local ns, ne, num = s:find("^(%-?%d+%.?%d*[eE]?[%+%-]?%d*)", i)
    if not ns then error("unexpected token in JSON at position " .. i) end
    return tonumber(num), ne + 1
  end
end

function json.decode(s)
  if type(s) ~= "string" or #s == 0 then return {} end
  local ok, value = pcall(function()
    local v = decode_value(s, 1)
    return v
  end)
  if not ok then return {} end
  return value == nil and {} or value
end
local function encode_string(v)
  return '"' .. v:gsub('[\\"]', function(c) return "\\" .. c end)
    :gsub("\n", "\\n"):gsub("\t", "\\t"):gsub("\r", "\\r") .. '"'
end

function json.encode(v)
  local t = type(v)
  if t == "number" then return tostring(v) end
  if t == "boolean" then return tostring(v) end
  if t == "nil" then return "null" end
  if t == "string" then return encode_string(v) end
  if t == "table" then
    if next(v) == nil then return "{}" end
    if #v > 0 then
      local parts = {}
      for _, item in ipairs(v) do parts[#parts + 1] = json.encode(item) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, val in pairs(v) do
      parts[#parts + 1] = encode_string(tostring(k)) .. ":" .. json.encode(val)
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
package.loaded["json"] = json

return { STEAM_ROOT = STEAM_ROOT }
