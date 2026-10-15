-- backend/main.lua against a throwaway Steam folder and plugin folder (theme creator plan § 10, Lua).
--
--   lua tests\test_backend.lua        (LuaJIT or Lua 5.1+, Windows: uses cmd for folders)
--
-- Millennium's modules are stubbed here (this plugin ships its own harness: a public repo cannot lean on a sibling).
-- Checks: SaveTheme's name and path rules, refused copies (type, size, root, escape), atomic write, overwrite and
-- backup; DeleteTheme only in the user folder; ListThemeAssets' roots; ListThemes never lists sounds/library.json.

local here = debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."
package.path = here .. "/../backend/?.lua;" .. package.path

local TMP = (os.getenv("TEMP") or os.getenv("TMP") or ".") .. "\\en-backend-test-" .. tostring(os.time())
local STEAM = TMP .. "\\steam"
local PLUGIN = TMP .. "\\plugin"

local function sh(cmd) os.execute(cmd .. " >nul 2>nul") end
local function lines(cmd)
  local p = io.popen(cmd, "r")
  local out = {}
  if p then for line in p:lines() do out[#out + 1] = line end p:close() end
  return out
end

-- ---------- stubs ----------
package.loaded["logger"] = { info = function() end, warn = function() end, error = function(_, m) print("  [error] " .. m) end }
package.loaded["millennium"] = { steam_path = function() return STEAM end, ready = function() end }

local fs = {}
function fs.join(...)
  local out = ""
  for i, part in ipairs({ ... }) do
    if i > 1 and out:sub(-1) ~= "\\" and out:sub(-1) ~= "/" then out = out .. "\\" end
    out = out .. part
  end
  return out
end
function fs.is_file(p) local f = io.open(p, "rb") if f then f:close() return true end return false end
function fs.is_directory(p) return lines('if exist "' .. p:gsub("/", "\\") .. '\\*" (echo yes)')[1] == "yes" end
function fs.create_directories(p) sh('mkdir "' .. p:gsub("/", "\\") .. '"') return true end
function fs.remove(p) return os.remove(p) ~= nil end
function fs.remove_all(p) sh('rmdir /s /q "' .. p:gsub("/", "\\") .. '"') return true end
function fs.rename(a, b) return os.rename(a, b) ~= nil end
function fs.extension(p) return p:match("(%.[^%.\\/]+)$") or "" end
function fs.stem(p) local name = p:match("[^\\/]+$") or p return (name:gsub("%.[^%.]+$", "")) end
function fs.filename(p) return p:match("[^\\/]+$") or p end
function fs.parent_path(p) return (p:gsub("[\\/][^\\/]+$", "")) end
function fs.file_size(p) local f = io.open(p, "rb") if not f then return nil end local n = f:seek("end") f:close() return n end
function fs.list(p)
  local out = {}
  for _, name in ipairs(lines('dir /b "' .. p:gsub("/", "\\") .. '" 2>nul')) do
    if name ~= "" then out[#out + 1] = { name = name, path = fs.join(p, name) } end
  end
  return out
end
package.loaded["fs"] = fs

local utils = {}
function utils.read_file(p) local f = io.open(p, "rb") if not f then return nil end local c = f:read("*a") f:close() return c end
function utils.write_file(p, c) local f, e = io.open(p, "wb") if not f then return nil, e end f:write(c) f:close() return true end
function utils.get_backend_path() return PLUGIN .. "\\backend" end
function utils.base64_encode() return "" end
function utils.exec() end
package.loaded["utils"] = utils

-- A tiny JSON: enough for the payloads and results here (objects, arrays, strings, numbers, booleans).
local json = {}
local function enc(v)
  local t = type(v)
  if t == "table" then
    if #v > 0 or next(v) == nil and getmetatable(v) == "array" then
      local parts = {}
      for _, x in ipairs(v) do parts[#parts + 1] = enc(x) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, x in pairs(v) do parts[#parts + 1] = string.format("%q", tostring(k)) .. ":" .. enc(x) end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif t == "string" then return (string.format("%q", v):gsub("\\\n", "\\n"))
  elseif t == "nil" then return "null"
  else return tostring(v) end
end
json.encode = enc
-- Payloads come from this file only, as Lua tables: decode hands back the table enc() was given.
local last = {}
local real_encode = enc
json.encode = function(v) local s = real_encode(v) last[s] = v return s end
-- A file read from disk (library.json): plain JSON to a Lua table literal (fixture data only).
local function from_json(s)
  local lua = s:gsub("%[", "{"):gsub("%]", "}"):gsub('"([^"]-)"%s*:', '["%1"]=')
  local f = (loadstring or load)("return " .. lua)
  return f and f() or {}
end
json.decode = function(s) return last[s] or from_json(s) end
package.loaded["json"] = json

-- ---------- fixture folders ----------
sh('mkdir "' .. STEAM .. '\\millennium\\config\\enhanced-notifications\\themes"')
sh('mkdir "' .. PLUGIN .. '\\backend"')
sh('mkdir "' .. PLUGIN .. '\\themes\\SteamStation\\assets"')
sh('mkdir "' .. PLUGIN .. '\\themes\\sounds\\celtic_harp"')
local function put(path, content) assert(utils.write_file(path, content), path) end
local USER = STEAM .. "\\millennium\\config\\enhanced-notifications\\themes"
put(PLUGIN .. "\\themes\\SteamStation.jsonc", "{}")
put(PLUGIN .. "\\themes\\SteamStation\\assets\\trophy.svg", "<svg/>")
put(PLUGIN .. "\\themes\\SteamStation\\assets\\tool.exe", "MZ")
put(PLUGIN .. "\\themes\\sounds\\library.json", '{"version":1}')
put(PLUGIN .. "\\themes\\sounds\\celtic_harp\\grand.wav", "RIFF")
put(PLUGIN .. "\\themes\\big.wav", string.rep("x", 8 * 1024 * 1024 + 1))

local main = dofile(here .. "/../backend/main.lua")
assert(main and main.on_load, "main.lua returns its hooks")

local function call(fn, payload) return json.decode(_G[fn](json.encode(payload))) end

-- ---------- checks ----------
local failures = 0
local function check(name, cond, detail)
  if cond then print("  PASS  " .. name) else failures = failures + 1 print("  FAIL  " .. name .. (detail and (": " .. tostring(detail)) or "")) end
end

-- The RPC result is the table SaveTheme returned (json stub), so read fields directly.
local function save(p) return call("SaveTheme", p) end

for _, bad in ipairs({ "../x", "a/b", "", string.rep("a", 41), "a b", "x.jsonc" }) do
  check("SaveTheme refuses the name '" .. bad .. "'", save({ name = bad, text = "{}" }).error ~= nil)
end

local ok = save({ name = "mine", text = '{"a":1}', copies = {
  { from = "bundled", path = "SteamStation/assets/trophy.svg", to = "mine/trophy.svg" },
  { from = "library", path = "celtic_harp/grand.wav", to = "mine/celtic_harp_grand.wav" },
} })
check("SaveTheme writes the theme", ok.error == nil and utils.read_file(USER .. "\\mine.jsonc") == '{"a":1}', ok.error)
check("... and copies its files into <name>/", utils.read_file(USER .. "\\mine\\trophy.svg") == "<svg/>" and utils.read_file(USER .. "\\mine\\celtic_harp_grand.wav") == "RIFF")
check("... no temp file left", not fs.is_file(USER .. "\\mine.jsonc.tmp"))
check("... returns the setting id", ok.id == "mine", ok.id)

check("SaveTheme refuses to overwrite without overwrite=true", save({ name = "mine", text = "{}" }).error == "exists")
local over = save({ name = "mine", text = '{"b":2}', overwrite = true, backup = true })
check("overwrite + backup", over.error == nil and utils.read_file(USER .. "\\mine.jsonc") == '{"b":2}' and utils.read_file(USER .. "\\mine.jsonc.bak") == '{"a":1}', over.error)

local refusals = {
  { "a disallowed type", { from = "bundled", path = "SteamStation/assets/tool.exe", to = "x/tool.exe" } },
  { "a file over 8 MB", { from = "bundled", path = "big.wav", to = "x/big.wav" } },
  { "an unknown root", { from = "anywhere", path = "a.svg", to = "x/a.svg" } },
  { "a .. in the source", { from = "bundled", path = "../plugin/themes/SteamStation.jsonc", to = "x/a.jsonc" } },
  { "an absolute source", { from = "bundled", path = "C:/Windows/win.ini", to = "x/win.ini" } },
  { "a target outside <name>/", { from = "bundled", path = "SteamStation/assets/trophy.svg", to = "other/trophy.svg" } },
  { "a target with a subfolder", { from = "bundled", path = "SteamStation/assets/trophy.svg", to = "x/sub/trophy.svg" } },
  { "a missing file", { from = "bundled", path = "SteamStation/assets/none.svg", to = "x/none.svg" } },
}
for _, case in ipairs(refusals) do
  local res = save({ name = "x", text = "{}", copies = { case[2] } })
  check("SaveTheme refuses " .. case[1] .. ", writing nothing", res.error ~= nil and not fs.is_file(USER .. "\\x.jsonc") and not fs.is_directory(USER .. "\\x"), res.error)
end

local picked = save({ name = "picked", text = "{}", copies = { { from = "file", path = PLUGIN .. "/themes/SteamStation/assets/trophy.svg", to = "picked/trophy.svg" } } })
check("SaveTheme copies a file the user picked (absolute path)", picked.error == nil and utils.read_file(USER .. "/picked/trophy.svg") == "<svg/>", picked.error)
check("SaveTheme refuses a picked file of a disallowed type", save({ name = "picked2", text = "{}", copies = { { from = "file", path = PLUGIN .. "/themes/SteamStation/assets/tool.exe", to = "picked2/tool.exe" } } }).error ~= nil)
check("SaveTheme refuses a relative path as a picked file", save({ name = "picked3", text = "{}", copies = { { from = "file", path = "SteamStation/assets/trophy.svg", to = "picked3/trophy.svg" } } }).error ~= nil)
call("DeleteTheme", { id = "picked", assets = true })

local listed = call("ListThemes", {})
local names = {}
for _, t in ipairs(listed.themes or {}) do names[#names + 1] = t.name end
local joined = table.concat(names, ",")
check("ListThemes lists the saved theme and never the sound library", joined:find("mine") ~= nil and joined:find("library") == nil, joined)

local assets = call("ListThemeAssets", { dir = USER })
local paths = {}
for _, a in ipairs(assets.files or {}) do paths[#paths + 1] = a.path .. ":" .. a.kind end
check("ListThemeAssets lists images and sounds one level down", table.concat(paths, ",") == "mine/celtic_harp_grand.wav:sound,mine/trophy.svg:image", table.concat(paths, ","))
check("ListThemeAssets refuses a folder outside the theme roots", call("ListThemeAssets", { dir = TMP }).error ~= nil)

check("DeleteTheme refuses a bundled theme", call("DeleteTheme", { id = "SteamStation" }).error ~= nil and fs.is_file(PLUGIN .. "\\themes\\SteamStation.jsonc"))
check("DeleteTheme refuses a path", call("DeleteTheme", { id = "../x" }).error ~= nil)
local del = call("DeleteTheme", { id = "mine", assets = true })
check("DeleteTheme removes the user theme and its folder", del.error == nil and not fs.is_file(USER .. "\\mine.jsonc") and not fs.is_directory(USER .. "\\mine"), del.error)

local lib = call("SoundLibrary", {})
check("SoundLibrary returns the manifest", type(lib.manifest) == "table" and lib.manifest.version == 1)

sh('rmdir /s /q "' .. TMP .. '"')
print(failures == 0 and "\nALL PASS" or ("\n" .. failures .. " FAILED"))
os.exit(failures == 0 and 0 or 1)
