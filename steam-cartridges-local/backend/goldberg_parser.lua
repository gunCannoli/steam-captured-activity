local json = require("json")
local M = {}

--- Parses Goldberg / GSE achievements.json text. An unknown unlock time is 0, never "now".
--- Returns map: { [ach_id] = { unlocked_time = unix_timestamp } }
function M.parse_goldberg(text)
  local ok, data = pcall(json.decode, text or "")
  if not ok or type(data) ~= "table" then return {} end
  local unlocked = {}
  if #data > 0 then
    -- Array format: [ "ACH_1", "ACH_2" ]
    for _, id in ipairs(data) do
      if type(id) == "string" and #id > 0 then
        unlocked[id] = { unlocked_time = 0 }
      end
    end
  else
    -- Object format: { "ACH_1": { "earned": true, "earned_time": 172... } }
    for k, v in pairs(data) do
      if type(v) == "table" then
        if v.earned == true or v.achieved == true or v.earned == 1 or v.achieved == 1 then
          local t = tonumber(v.earned_time or v.unlock_time) or 0
          if t > 1e10 then t = math.floor(t / 1000) end
          unlocked[k] = { unlocked_time = t > 0 and math.floor(t) or 0 }
        end
      elseif v == 1 or v == true or v == "1" then
        unlocked[k] = { unlocked_time = 0 }
      end
    end
  end
  return unlocked
end

--- Clears all unlocks in Goldberg achievements.json text. Returns (new_text, cleared_count).
function M.lock_all(text)
  local ok, data = pcall(json.decode, text or "")
  if not ok or type(data) ~= "table" then return nil, 0, "not valid JSON" end
  local cleared = 0
  if #data > 0 then
    return "[]", #data
  end
  for _, v in pairs(data) do
    if type(v) == "table" then
      if v.earned == true or v.earned == 1 or v.achieved == true or v.achieved == 1 then
        cleared = cleared + 1
      end
      if v.earned ~= nil then v.earned = false end
      if v.achieved ~= nil then v.achieved = false end
      if v.earned_time ~= nil then v.earned_time = 0 end
      if v.unlock_time ~= nil then v.unlock_time = 0 end
    end
  end
  for k, v in pairs(data) do
    if v == 1 or v == true or v == "1" then data[k] = 0; cleared = cleared + 1 end
  end
  return json.encode(data), cleared
end

return M
