--- Emulator executables: shortcuts that launch these never get an automatic
--- store match (the shortcut title is a ROM, not a Steam game). A guard against
--- wrong matches, not bucket guessing. A manual mapping still works.

local M = {}

local EMULATORS = {}
for name in ([[retroarch dolphin primehack cemu pcsx2 rpcs3 duckstation ppsspp
  yuzu ryujinx xemu xenia mame mednafen flycast melonds citra vita3k]]):gmatch("%S+") do
  EMULATORS[name] = true
end

--- Basename without extension, lowercased. Handles quotes and both slashes.
function M.basename(exe)
  local s = tostring(exe or ""):gsub('"', ""):gsub("\\", "/")
  local base = s:match("([^/]*)$") or s
  return (base:gsub("%.%w+$", ""):lower())
end

function M.is_emulator(exe)
  local b = M.basename(exe)
  if EMULATORS[b] then return true end
  -- Suffixed builds: "dolphin-x64", "rpcs3-qt", "pcsx2-qt".
  local head = b:match("^(%w+)[%-_ ]")
  return head ~= nil and EMULATORS[head] == true
end

return M
