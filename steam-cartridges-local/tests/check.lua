-- Shared assertions for the steam-cartridges-local suites: count failures, keep going, exit non-zero at the end.
local M = { failures = 0 }

function M.check(name, cond, detail)
  if cond then
    print("  PASS  " .. name)
  else
    M.failures = M.failures + 1
    print("  FAIL  " .. name .. (detail ~= nil and ("  -> " .. tostring(detail)) or ""))
  end
end

function M.finish(label)
  if M.failures == 0 then
    print("ALL PASS (" .. label .. ")")
    os.exit(0)
  end
  print(M.failures .. " FAILURE(S) (" .. label .. ")")
  os.exit(1)
end

--- A fresh temp folder (forward slashes), removed by M.cleanup.
local made = {}
function M.tempdir(tag)
  local base = (os.getenv("TEMP") or "."):gsub("\\", "/")
  local dir = base .. "/scl_" .. tag .. "_" .. tostring(os.time()) .. "_" .. tostring(math.random(100000, 999999))
  os.execute('mkdir "' .. dir:gsub("/", "\\") .. '" >nul 2>nul')
  made[#made + 1] = dir
  return dir
end

function M.mkdir(dir) os.execute('mkdir "' .. dir:gsub("/", "\\") .. '" >nul 2>nul') end

function M.write(path, data)
  local f = assert(io.open(path, "wb"))
  f:write(data)
  f:close()
end

function M.read(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local d = f:read("*a")
  f:close()
  return d
end

function M.cleanup()
  for _, d in ipairs(made) do os.execute('rmdir /s /q "' .. d:gsub("/", "\\") .. '" >nul 2>nul') end
end

math.randomseed(os.time())
return M
