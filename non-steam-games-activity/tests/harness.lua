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
package.loaded["utils"] = utils

-- ---------- stub: json (encode only, for shape checks) ----------
local json = {}

--- Minimal decoder: enough for the flat { "key": value } payloads the RPC
--- methods receive in tests. Not a general JSON parser.
---
--- It does unescape backslashes, because Windows paths cross this boundary and
--- a decoder that left "C:\\game" as-is would make tests pass or fail for
--- reasons the real json module would not reproduce.
local function unescape(str)
  return (str:gsub('\\(.)', function(c)
    if c == "n" then return "\n" end
    if c == "t" then return "\t" end
    if c == "r" then return "\r" end
    return c  -- covers \\ and \"
  end))
end

function json.decode(s)
  local out = {}
  if type(s) ~= "string" then return out end
  -- Lua patterns have no alternation, so scan for string values manually to
  -- keep escaped quotes and backslashes intact.
  local pos = 1
  while true do
    local ks, ke, key = s:find('"([^"]+)"%s*:%s*"', pos)
    if not ks then break end

    local i, buf = ke + 1, {}
    while i <= #s do
      local c = s:sub(i, i)
      if c == "\\" then
        buf[#buf + 1] = s:sub(i, i + 1)
        i = i + 2
      elseif c == '"' then
        break
      else
        buf[#buf + 1] = c
        i = i + 1
      end
    end

    out[key] = unescape(table.concat(buf))
    pos = i + 1
  end
  for key, value in s:gmatch('"([^"]+)"%s*:%s*(-?%d+%.?%d*)') do
    out[key] = tonumber(value)
  end
  return out
end
function json.encode(v)
  local t = type(v)
  if t == "number" then return tostring(v) end
  if t == "boolean" then return tostring(v) end
  if t == "nil" then return "null" end
  if t == "string" then return '"' .. v:gsub('\\', '\\\\'):gsub('"', '\\"') .. '"' end
  if t == "table" then
    if #v > 0 then
      local parts = {}
      for _, item in ipairs(v) do parts[#parts + 1] = json.encode(item) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, val in pairs(v) do
      parts[#parts + 1] = '"' .. tostring(k) .. '":' .. json.encode(val)
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
package.loaded["json"] = json

return { STEAM_ROOT = STEAM_ROOT }
