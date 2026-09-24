--- One global gate for store.steampowered.com: serial, at most one request per
--- second. The backend is single-threaded and requests are synchronous, so the
--- gate simply waits out the remainder of the interval.

local M = {}

M.INTERVAL = 1.0
M.USER_AGENT = "steam-cartridges (Millennium plugin)"

local last = nil
M.now = os.clock            -- injectable (tests)
M.sleep = function(seconds) -- busy wait; there is no sleep primitive in the sandbox
  local t = os.clock()
  while os.clock() - t < seconds do end
end

--- Block until a request may be made, then stamp it.
function M.acquire()
  local now = M.now()
  if last and now - last < M.INTERVAL then
    M.sleep(M.INTERVAL - (now - last))
  end
  last = M.now()
end

function M._reset() last = nil end

--- Default `http_get(url) -> body | nil, err`: throttled, with our User-Agent.
function M.http_get(url)
  local http = require("http")
  M.acquire()
  local ok, res = pcall(http.get, url, {
    headers = { ["Accept"] = "application/json", ["User-Agent"] = M.USER_AGENT },
    timeout = 15,
  })
  if not ok then return nil, tostring(res) end
  if not res then return nil, "no response" end
  if res.status ~= 200 or not res.body then return nil, "HTTP " .. tostring(res.status) end
  return res.body
end

return M
