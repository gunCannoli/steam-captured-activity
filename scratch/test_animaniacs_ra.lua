package.path = 'steam-cartridges/backend/?.lua;' .. package.path
local ra = require('retroachievements')

local creds = ra.get_credentials('C:/emu/RetroArch/retroarch.exe')
print('Creds emulator:', creds.emulator, 'has user:', creds.username ~= nil, 'has token:', creds.token ~= nil)

local rom_path = ra.extract_rom_path('"C:/emu/RetroArch/retroarch.exe" -L cores/snes9x_libretro.dll "C:/emu/roms/snes/Animaniacs (USA).zip"', '')
print('Rom path:', rom_path)

local res, err = ra.get_or_fetch(3048673328, false)
print('get_or_fetch res:', res ~= nil, 'err:', err)
if res and res.schema then
    print('Title:', res.schema.title, 'Total:', res.schema.total)
end
