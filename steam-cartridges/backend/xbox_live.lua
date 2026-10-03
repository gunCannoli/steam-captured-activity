--- Source `xbox` for achievements (ADR-0056): the player's own Xbox Live unlocks, after a one-time sign-in with a
--- device code (the user types a short code at microsoft.com/link; no password passes through the plugin).
--- Every request goes through net.lua (source "xbox-live").
---
--- Verified with the user's account on 2026-10-02 (plan § 4.7):
---   login.live.com/oauth20_connect.srf    device code (client 00000000402b5328, scope MBI_SSL), interval 5 s, 900 s
---   login.live.com/oauth20_token.srf      the device code (authorization_pending until the user approves), then a
---                                         24 h access token and a refresh token
---   user.auth.xboxlive.com/user/authenticate  RpsTicket = the access token with no prefix -> an XBL token
---   xsts.auth.xboxlive.com/xsts/authorize     -> XSTS token (about 16 h) and DisplayClaims.xui[1] { uhs, xid, gtg }
---   achievements.xboxlive.com/users/xuid(<xuid>)/achievements?titleId=<id>   contract 2: progressState,
---                                         progression.timeUnlocked, rewards (Gamerscore), mediaAssets, rarity
---   titlehub.xboxlive.com/users/xuid(<xuid>)/titles/titlehistory/decoration/achievement   every played title's
---                                         currentAchievements / currentGamerscore, in one call
---
--- Credentials (decision 8): only the refresh token, the xuid and the gamertag are stored, in the data folder's .env
--- through web_config, like every other account. The access and XSTS tokens live in memory. Nothing here logs a
--- token, a device code or a request body.

local json     = require("json")
local logger   = require("logger")
local iso_date = require("iso_date")

local M = {}

M.CLIENT_ID = "00000000402b5328"
M.SCOPE = "service::user.auth.xboxlive.com::MBI_SSL"
M.DEVICE_URL = "https://login.live.com/oauth20_connect.srf"
M.TOKEN_URL = "https://login.live.com/oauth20_token.srf"
M.XBL_URL = "https://user.auth.xboxlive.com/user/authenticate"
M.XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize"

--- Injectable for tests. nil = the real dependency.
M.deps = {
  post = nil,    -- fun(url, body, opts) -> res | nil, err ; nil = net.post
  get = nil,     -- fun(url, opts) -> res | nil, err       ; nil = net.get
  now = nil,     -- fun() -> unix seconds                   ; nil = os.time
  account = nil, -- { get = fun() -> account | nil, save = fun(map) } ; nil = web_config
}

local session = nil -- { xsts, uhs, xuid, gamertag, until_ }

function M._reset() session = nil end

local function now() return (M.deps.now or os.time)() end
local function post(url, body, opts) return (M.deps.post or require("net").post)(url, body, opts) end
local function get(url, opts) return (M.deps.get or require("net").get)(url, opts) end

local function account()
  if M.deps.account then return M.deps.account.get() end
  return require("web_config").get_xbox_account()
end

--- The .env reader drops spaces from a value, so a gamertag's spaces are stored as %20.
local function save_account(map)
  if map.xbox_gamertag then map.xbox_gamertag = map.xbox_gamertag:gsub(" ", "%%20") end
  if M.deps.account then return M.deps.account.save(map) end
  return require("web_config").save_credentials(map)
end

local function url_encode(s)
  return (tostring(s):gsub("[^%w%-_%.~]", function(c) return string.format("%%%02X", c:byte()) end))
end

local function form(t)
  local parts = {}
  for _, kv in ipairs(t) do parts[#parts + 1] = kv[1] .. "=" .. url_encode(kv[2]) end
  return table.concat(parts, "&")
end

local FORM = { ["Content-Type"] = "application/x-www-form-urlencoded", ["Accept"] = "application/json" }
local JSON_HEADERS = { ["Content-Type"] = "application/json", ["Accept"] = "application/json", ["x-xbl-contract-version"] = "1" }

local function decode(res)
  if not res or not res.body then return nil end
  local ok, body = pcall(json.decode, res.body)
  return ok and type(body) == "table" and body or nil
end

--- Step 1 of the sign-in: a code for the user to type at the returned address.
--- { user_code, verification_uri, device_code, interval, expires_in } or { error }.
function M.sign_in_start()
  local res = post(M.DEVICE_URL, form({ { "client_id", M.CLIENT_ID }, { "scope", M.SCOPE }, { "response_type", "device_code" } }),
    { source = "xbox-live", headers = FORM, timeout = 20 })
  local body = decode(res)
  if not body or not body.device_code then return { error = "Could not reach Microsoft's sign-in." } end
  return {
    user_code = tostring(body.user_code or ""),
    verification_uri = tostring(body.verification_uri or "https://www.microsoft.com/link"),
    device_code = tostring(body.device_code),
    interval = tonumber(body.interval) or 5,
    expires_in = tonumber(body.expires_in) or 900,
  }
end

--- The XBL and XSTS tokens for a Microsoft access token: a session, or nil and an error.
local function token_chain(access_token)
  local xbl
  for _, prefix in ipairs({ "", "d=", "t=" }) do
    local res = post(M.XBL_URL, json.encode({
      RelyingParty = "http://auth.xboxlive.com",
      TokenType = "JWT",
      Properties = { AuthMethod = "RPS", SiteName = "user.auth.xboxlive.com", RpsTicket = prefix .. access_token },
    }), { source = "xbox-live", headers = JSON_HEADERS, timeout = 20 })
    local body = res and tonumber(res.status) == 200 and decode(res)
    if body and body.Token then
      xbl = body.Token
      break
    end
  end
  if not xbl then return nil, "Xbox Live sign-in failed." end
  local res = post(M.XSTS_URL, json.encode({
    RelyingParty = "http://xboxlive.com",
    TokenType = "JWT",
    Properties = { SandboxId = "RETAIL", UserTokens = { xbl } },
  }), { source = "xbox-live", headers = JSON_HEADERS, timeout = 20 })
  local body = res and tonumber(res.status) == 200 and decode(res)
  if not body or not body.Token then
    -- 401 with XErr: no Xbox profile on this Microsoft account, or a child account without consent.
    return nil, "This Microsoft account has no Xbox profile, or Xbox Live refused it."
  end
  local xui = type(body.DisplayClaims) == "table" and type(body.DisplayClaims.xui) == "table" and body.DisplayClaims.xui[1] or {}
  if not xui.uhs or not xui.xid then return nil, "Xbox Live answered without a player." end
  return {
    xsts = tostring(body.Token),
    uhs = tostring(xui.uhs),
    xuid = tostring(xui.xid),
    gamertag = tostring(xui.gtg or ""),
    -- XSTS lasts about 16 h; renew after 8 h so a call never races its expiry.
    until_ = now() + 8 * 3600,
  }
end

--- Step 2: poll once (every `interval` seconds). { pending = true } until the user approves, then signs in and stores
--- the account: { ok = true, gamertag }. { error } when the code expired or was declined.
function M.sign_in_poll(device_code)
  if type(device_code) ~= "string" or device_code == "" then return { error = "No sign-in in progress." } end
  local res = post(M.TOKEN_URL, form({
    { "client_id", M.CLIENT_ID },
    { "grant_type", "urn:ietf:params:oauth:grant-type:device_code" },
    { "device_code", device_code },
  }), { source = "xbox-live", headers = FORM, timeout = 20 })
  local body = decode(res)
  if not body then return { pending = true } end
  if body.error then
    if body.error == "authorization_pending" or body.error == "slow_down" then return { pending = true } end
    if body.error == "expired_token" then return { error = "The code expired. Start again." } end
    if body.error == "authorization_declined" then return { error = "The sign-in was declined." } end
    return { error = "Sign-in failed (" .. tostring(body.error) .. ")." }
  end
  if not body.access_token then return { pending = true } end
  local s, err = token_chain(body.access_token)
  if not s then return { error = err } end
  session = s
  save_account({ xbox_refresh_token = body.refresh_token or "", xbox_xuid = s.xuid, xbox_gamertag = s.gamertag })
  logger:info("Xbox account signed in.")
  return { ok = true, gamertag = s.gamertag }
end

--- Forget the account (the refresh token leaves the .env). Microsoft keeps the app's consent until the user removes it
--- at account.live.com/consent; the settings panel says so.
function M.sign_out()
  session = nil
  save_account({ xbox_refresh_token = "", xbox_xuid = "", xbox_gamertag = "" })
  return { ok = true }
end

--- { signed_in, gamertag } from the stored account. Disk only.
function M.status()
  local a = account()
  if not a then return { signed_in = false } end
  return { signed_in = true, gamertag = (a.gamertag or ""):gsub("%%20", " ") }
end

--- A current session: the one in memory, else a refresh of the stored token. nil and an error when signed out.
local function ensure_session()
  if session and now() < session.until_ then return session end
  local a = account()
  if not a or not a.refresh_token or a.refresh_token == "" then return nil, "not signed in" end
  local res = post(M.TOKEN_URL, form({
    { "client_id", M.CLIENT_ID },
    { "grant_type", "refresh_token" },
    { "refresh_token", a.refresh_token },
    { "scope", M.SCOPE },
  }), { source = "xbox-live", headers = FORM, timeout = 20 })
  local body = decode(res)
  if not body or not body.access_token then
    logger:warn("Xbox account: the stored sign-in no longer works (status " .. tostring(res and res.status) .. ").")
    return nil, "sign in again"
  end
  local s, err = token_chain(body.access_token)
  if not s then return nil, err end
  session = s
  -- Microsoft rotates the refresh token: keep the new one.
  if body.refresh_token and body.refresh_token ~= a.refresh_token then
    save_account({ xbox_refresh_token = body.refresh_token, xbox_xuid = s.xuid, xbox_gamertag = s.gamertag })
  end
  return s
end

local function xbl_headers(s, contract)
  return {
    ["Authorization"] = "XBL3.0 x=" .. s.uhs .. ";" .. s.xsts,
    ["x-xbl-contract-version"] = tostring(contract),
    ["Accept"] = "application/json",
    ["Accept-Language"] = "en-US",
  }
end

--- One title's achievements for the signed-in player: { achievements = { schema items }, unlocks = { [id] = unix } },
--- or nil and an error ("not signed in" when there is no account).
function M.achievements(title_id)
  local s, err = ensure_session()
  if not s then return nil, err end
  local url = "https://achievements.xboxlive.com/users/xuid(" .. s.xuid .. ")/achievements?titleId="
    .. url_encode(title_id) .. "&maxItems=1000"
  local res, gerr = get(url, { source = "xbox-live", headers = xbl_headers(s, 2), timeout = 20 })
  if not res then return nil, gerr end
  if tonumber(res.status) == 401 then session = nil end -- the next call renews the session
  if tonumber(res.status) ~= 200 then return nil, "HTTP " .. tostring(res.status) end
  local body = decode(res)
  if not body or type(body.achievements) ~= "table" then return nil, "bad answer" end
  local out = { achievements = {}, unlocks = {} }
  for _, a in ipairs(body.achievements) do
    if type(a) == "table" and a.id ~= nil then
      local id = tostring(a.id)
      local icon = type(a.mediaAssets) == "table" and type(a.mediaAssets[1]) == "table" and a.mediaAssets[1].url or ""
      local gamerscore = 0
      for _, r in ipairs(type(a.rewards) == "table" and a.rewards or {}) do
        if type(r) == "table" and r.type == "Gamerscore" then gamerscore = tonumber(r.value) or 0 end
      end
      out.achievements[#out.achievements + 1] = {
        id = id,
        name = tostring(a.name or id),
        description = tostring(a.description or a.lockedDescription or ""),
        icon = tostring(icon or ""),
        global_pct = tonumber(type(a.rarity) == "table" and a.rarity.currentPercentage) or 0,
        hidden = a.isSecret == true,
        gamerscore = gamerscore,
      }
      if a.progressState == "Achieved" then
        local at = type(a.progression) == "table" and iso_date.instant(a.progression.timeUnlocked) or nil
        out.unlocks[id] = at or 0
      end
    end
  end
  return out
end

--- Every title the player has played, with progress: { [title id] = { unlocked, gamerscore, last_played } }, or nil
--- and an error. One call; a sync uses it to ask only for titles whose progress changed.
function M.title_progress()
  local s, err = ensure_session()
  if not s then return nil, err end
  local url = "https://titlehub.xboxlive.com/users/xuid(" .. s.xuid .. ")/titles/titlehistory/decoration/achievement"
  local res, gerr = get(url, { source = "xbox-live", headers = xbl_headers(s, 2), timeout = 20 })
  if not res then return nil, gerr end
  if tonumber(res.status) ~= 200 then return nil, "HTTP " .. tostring(res.status) end
  local body = decode(res)
  if not body or type(body.titles) ~= "table" then return nil, "bad answer" end
  local out = {}
  for _, t in ipairs(body.titles) do
    if type(t) == "table" and t.titleId then
      local ach = type(t.achievement) == "table" and t.achievement or {}
      out[tostring(t.titleId)] = {
        unlocked = tonumber(ach.currentAchievements) or 0,
        gamerscore = tonumber(ach.currentGamerscore) or 0,
        last_played = type(t.titleHistory) == "table" and iso_date.instant(t.titleHistory.lastTimePlayed) or nil,
      }
    end
  end
  return out
end

return M
