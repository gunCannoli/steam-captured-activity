--- steam-captured-activity backend entry point.
--- The plugin reads everything it shows from Steam's own client (SteamClient.Apps screenshots, the game-recording
--- service's clips) and keeps its settings in Millennium's plugin config, so the backend exposes no RPC. It exists
--- because Millennium's frontend waits for millennium.ready() (docs/plugins.md § 2).

local millennium = require("millennium")
local logger     = require("logger")

-- Millennium's lifecycle (docs/plugins.md § 2): the table is required; ready() belongs in on_load.
local function on_load()
  millennium.ready()
  logger:info("steam-captured-activity backend ready.")
end

return {
  on_load = on_load,
  on_frontend_loaded = function() end,
  on_unload = function() logger:info("steam-captured-activity backend unloading.") end,
}
