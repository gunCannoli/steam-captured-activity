local M = {}

local function file_exists(path)
  if not path or #path == 0 then return false end
  local f = io.open(path, "rb")
  if f then
    f:close()
    return true
  end
  return false
end

--- Returns candidate paths for a given Steam AppID: { path, emulator, exists = boolean }
function M.find_candidates(n_appid)
  n_appid = tonumber(n_appid) or 0
  if n_appid <= 0 then return {} end

  local public_dir = os.getenv("PUBLIC") or "C:\\Users\\Public"
  local appdata = os.getenv("APPDATA") or ""
  local id = tostring(math.floor(n_appid))

  local candidates = {
    { path = public_dir .. "\\Documents\\Steam\\CODEX\\" .. id .. "\\achievements.ini", emulator = "CODEX" },
    { path = appdata .. "\\Steam\\CODEX\\" .. id .. "\\achievements.ini", emulator = "CODEX" },
    { path = public_dir .. "\\Documents\\Steam\\RUNE\\" .. id .. "\\achievements.ini", emulator = "RUNE" },
    { path = appdata .. "\\Steam\\RUNE\\" .. id .. "\\achievements.ini", emulator = "RUNE" },
    { path = public_dir .. "\\Documents\\Steam\\" .. id .. "\\achievements.ini", emulator = "GSE" },
    { path = appdata .. "\\Steam\\" .. id .. "\\achievements.ini", emulator = "GSE" },
    { path = appdata .. "\\Goldberg SteamEmu Saves\\" .. id .. "\\achievements.json", emulator = "Goldberg" },
  }

  local out = {}
  for _, c in ipairs(candidates) do
    if file_exists(c.path) then
      c.exists = true
      out[#out + 1] = c
    end
  end
  return out
end

return M
