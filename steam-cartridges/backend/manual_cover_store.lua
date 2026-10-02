--- Manual covers on disk (features plan F2c): the first page of a ScreenScraper manual as the card's cover image, in
--- <data dir>/manual_covers/<appid>_<key>.jpg. The frontend renders it once from the PDF (the slow step: a download of up to
--- 48 MiB); every later start reads this small file instead. A store stores; it never fetches (ADR-0044).

local data_dir = require("data_dir")

local M = {}

M.deps = {} -- test override: { dir = "<folder>" }

local function dir()
  if M.deps.dir then return M.deps.dir end
  local d = data_dir.path() .. "/manual_covers"
  pcall(function()
    if not fs.is_directory(d) then fs.create_directories(d) end
  end)
  return d
end

local function file(appid, key)
  local n = math.floor(tonumber(appid) or 0)
  local safe = tostring(key):gsub("[^%w]", "_")
  return dir() .. "/" .. n .. "_" .. safe .. ".jpg"
end

--- The stored cover's bytes, or nil.
function M.get(appid, key)
  local f = io.open(file(appid, key), "rb")
  if not f then return nil end
  local body = f:read("*a")
  f:close()
  return body and #body > 0 and body or nil
end

--- Store a cover (replacing one). Returns true, or nil and an error: a disk error costs a re-render later, nothing else.
function M.set(appid, key, body)
  if type(body) ~= "string" or #body == 0 then return nil, "empty cover" end
  local f = io.open(file(appid, key), "wb")
  if not f then return nil, "could not write cover" end
  f:write(body)
  f:close()
  return true
end

return M
