-- rom_hash.lua (ADR-0066): ROM hashing in Lua, replacing ra_hasher.js. MD5 against RFC 1321's vectors, raw inflate
-- against zlib (fixtures made with Python's zlib, expected MD5 by hashlib), and every cartridge and disc rule on files
-- written to a temp folder. Hermetic: nothing outside that folder is read.
--
--   lua tests/test_rom_hash.lua

local here = (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$") or "."):gsub("\\", "/")
package.path = here .. "/../backend/?.lua;" .. package.path
if jit and jit.off then jit.off() end -- as the backend runs (main.lua)

local rh = require("rom_hash")

local failures = 0
local function check(label, cond, detail)
  print((cond and "  PASS  " or "  FAIL  ") .. label .. (detail and ("  -> " .. tostring(detail)) or ""))
  if not cond then failures = failures + 1 end
end

local function unhex(h) return (h:gsub("%x%x", function(x) return string.char(tonumber(x, 16)) end)) end

print("=== md5 (RFC 1321) ===")
local VECTORS = {
  { "", "d41d8cd98f00b204e9800998ecf8427e" },
  { "a", "0cc175b9c0f1b6a831c399e269772661" },
  { "abc", "900150983cd24fb0d6963f7d28e17f72" },
  { "message digest", "f96b697d7cb7938d525a2f31aaf161d0" },
  { "abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b" },
  { "12345678901234567890123456789012345678901234567890123456789012345678901234567890", "57edf4a22be3c955ac49da2e2107b67a" },
}
for _, v in ipairs(VECTORS) do check("md5 of " .. #v[1] .. " bytes", rh.md5(v[1]) == v[2], rh.md5(v[1])) end

print("=== inflate (zlib fixtures) ===")
local INFLATE = {
  { "stored blocks (level 0)", "012805d7fa737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d206361727472696467657320737465616d20636172747269646765732073dd8fdbecc7777382da96302fcd8379a19dcb2f18724d241789cfe3b1a20a98fb65f673a7bd9da6289f03d487100f0930e13d9907c776537097d732843ba34b7f01a91575a74768ff8dfeeed715b54150c23a8349071190c41b661bd84a6211f504d8af003635ede90d7860fab5656b1290a132c7ac4556164f5503f668c2ec1e223fb419020f77cc7c2dae8f30728230fcbbc4216ba4621d656bfd360045ddf8f9cd974dffe205352f64feda9aa493190afd2536714202c59c54d44b621213173595a23e03995e5f9f7420f5967bd59322dd622ea0274fe83ad19c3fb93028bda1f08d32aff363e17b9a146b0c1a1b0983f6413dbdb464416bd2e7987d4b852cedb8fa11203a7a8fa7da9d9d124736eaea34bf04114469723f0f0b2d485e8792f921175c23e473fb54a8bb", 1320, "2ed749e6a4454269c25356b0b1443e8f" },
  { "fixed Huffman (Z_FIXED)", "2b2e494dcc55484e2c2a29ca4c494f2d56281e151815181518110277fb6fbf395e5edc746b9a81fed9e6ca85734feb4b14f9aa88779e7fbc7111d78cdfa9df8a97ef9dbb4c633ef39576017e4e8387b633d98f9705174cbf6ed462bdd8bb9e71a568e972f78cffbdffde5d17ddea1870c8aad9935d70c211e934e91b5e49825f596eac6730337dfb92b722e1d7d6d46ca1090b8d8eaf710d13f30f65fe9671e88d9c92fd164926fef23335baebfa0d8a9a0cfeec3ea298bd24493635fbaf1983ebdd1f3fcf4ef7fdff88d5543fe5dfad594b264b72fd55352b74623a3a27e48a779290b0b8e9d44576cc33e3e2e797287c9d567d75b2d2dd24bd05eafe2fac2eceb1df69a0b177e1875ea3f59f931f56cf12c9e69192e66cfee668bb774b8a63f6a5e7336abd5b75deeef825a86055d5bffcd6dcb942ee66af5e99ec671174c92cb2e7e7d6f5886b9ff453513c46f949f1ef9015bb01", 1320, "2ed749e6a4454269c25356b0b1443e8f" },
  { "dynamic Huffman (level 9)", "2b2e494dcc55484e2c2a29ca4c494f2d56281e151815181518110277fb6fbf395e5edc746b9a81fed9e6ca85734feb4b14f9aa88779e7fbc7111d78cdfa9df8a97ef9dbb4c633ef39576017e4e8387b633d98f9705174cbf6ed462bdd8bb9e71a568e972f78cffbdffde5d17ddea1870c8aad9935d70c211e934e91b5e49825f596eac6730337dfb92b722e1d7d6d46ca1090b8d8eaf710d13f30f65fe9671e88d9c92fd164926fef23335baebfa0d8a9a0cfeec3ea298bd24493635fbaf1983ebdd1f3fcf4ef7fdff88d5543fe5dfad594b264b72fd55352b74623a3a27e48a779290b0b8e9d44576cc33e3e2e797287c9d567d75b2d2dd24bd05eafe2fac2eceb1df69a0b177e1875ea3f59f931f56cf12c9e69192e66cfee668bb774b8a63f6a5e7336abd5b75deeef825a86055d5bffcd6dcb942ee66af5e99ec671174c92cb2e7e7d6f5886b9ff453513c46f949f1ef9015bb01", 1320, "2ed749e6a4454269c25356b0b1443e8f" },
  { "many small blocks (memLevel 1), long matches", "74525b0e02210c544fc2d5f69548946d82fee8e9c54c977660f9014a67a6cfb4bdb3c435a42947d173b967d925cc92e62da7690f2fd9e34290eff65ca7030803202325558697080e044d85dabfbd4e225dae374a1446f9ad0e1fd39fc8b1c04cbf182ac3170890038d3281e311f3fc61875ebe655d23b55cb0fbe25909284a18327014138fc634028739eec1287c9f788267f5d598d6c5ae8c7694bea5fe3d5837cdc10268398ed914385ad03611df369e1a29d1c07974a395af43a8fbfadf4c6efc8fcf32cb61188841e8fd6fdd4a5509cb737e2245998e31065ce8267439ecf98ddbc0f7b76c4316a28f622a4961a7d665b4156fb5c95d3b7ea4fef726bb3add7924681409e2d3334b5fd3e124f2dfc45c5d897fdb26037897c2421273822b1cd0202d8a680842b920a41e5d450461477b03f167d29b37571a934d0ab37379af09760b247a5afb052387a72f843442d46a508f487a050dd5a72e4868705576c1f687baeebb1ca08de6283ce99718ba084ca5fb77dbb7071e7d4495de1395571b9f0146e7507d0ea4e11ce1a21c9ae9754efe4f3e48640f8ef4c84d7f82767a95aab11c20aa4454c0e6875d9b662a1a20fe67f28768eafac613864a9b26a2d7ffac4ea3cbe3c38899243108c430f0ffbfce2da5a565e6128a4c0a2642b6da74773361e53382ab99592fab6e5c4dd78327fd4fa5184a017f9b12eab41de78b614df701f9ba83c26df56c67967eb3c69221dc4b4ad81ee804fa8d6e8cee0185058d56c4cea3a9a8f25031eb7a302053efb5e6978e9030d39484e60394e50041c05f46368e898d0f6778e9f0d2fdd3f4a7a9e89812c66e892898a0a84efd89cb3fdaeeddc519f9566a2ddbadc75f697c36130279f79e8bcb10c65841c3aa3d3ecf77e0c418c950febc6b94de39772e6001a727cd7cbc88288b4c4ae958fb2f711a1e754f29e667790cf7013353abd33207b29e954ff32d749c6be0624cce9752fc2b97a209a3cba309634f5477fb7d20ef03dbbc4c17a2bd2976865c6172f7ba1f636692043108c3c0ffff3a875425426ad9dcc30c182f5203f4456ad3f5edaffa971e34f9ae4ca1a26f74849c8d479315521634b746f3fd82f3a9f62dae2a6d1f55c390fb4e863adc600ae759dd47b0da544c6658c46055c1478c7287bb9a8604cc3a9d5c051ecfbb28f1c5bc41facafff46e15dec7424dcce2507f239ab48f7937e118fa2ebc2115b9eb7c05008e16a8e2a2c42b126c87abc6672266d617bcae08a9b89a3b7fd080669a96e280107795c7852411c46b5cb26ac665863394603cc84329ba7b6b52ff96d42ad8712edf594c70925a67c4eceb2d40376f2788d1bd8e369e9f3c87b2e5bb54de91ed6490b06400742a2eaa3c474aa17d8431520375e24d201f1a11e727436b5da15a862c26449a309d93d9dab3566100d4d1ac3a5066fb6e062dc0d61fc2cc1d0b62188481beffa9d3c5806670b7cde6611ba10fa3dde8572b28f0eb390dc69418a490b2239ced7e8974c49e375e715c0a1683c92260de5f8c62869ec464ad2d0477b5fe2d0ca28cf275f326ce991233ded9ea317447daa28e9660873a61a8a85aed9829e0b66aaf00de66932bdc21b3a807e8e51cdec362dc2c9c9eec02624dd30bf53c3bfd255d52daa9ce81cde6190b3c932b896a6c63aa980928cf012ccae40e55fcb7dc3e5541438e18c2eca711e351bd65d406468fc12d5ae5346a1b0477b6f7e90b2c47e5f0ee8304d37c8d7e2042b460282a9f8fc4815dd89253d615e3167c71f350d02f453e8ddff83be5e60e154add981b84b6fe9756930817d8be00b8d40128b696397b7445bc39c5de2c3dd3d1b8aa2237bf3b3e68e28f31334882108841a0ff7fb5372b848678dc2a57c731810e93cd577ad74e4ac1d07525f3f65b95c586a864e46a402b7f03b01f98132ba55dd09e9206d401c71c161f58f75573fc1b9bf347ebd3b03780db417c0bd42c43bbbb85bfe4f11cdbef0c2376c35c967ccd04ae245c2e55bb2919387070c308bf9fbd483a0e83b7890b0e79e001b3043d7c042753d1e554c8510a7097e63c7a9283a05927e8c1d525e18572b0d686b27ffa18bb8dd7ea5f83d53215f002ff2210787c33b77a33749f0b20667dfc48bb368394875c7131dada012fec026794896fc899b247d90286b98c9d8d0ee5665136f3ee4a514302e0f3c8f2e94fce2c9636f6bcf43249f4e9391d47e9b19c60b484bee7538950f71372a2440917189ac7adfa97992f946a5dca1e88dd369481f565cc0c9220044218b8ff7ff5de2c48bad107a825c390a4e108dfaa39c7d537a2bf3b824cff0f360e66bac11d35fafc68f12f856786942efe6dac74b5f0e802340014c92e0d172bfc14204043902fe836371c7cbd80df0b03a22748ee3bd1097728b032cbc4d1f11a0a212c85d720a429eeb954556ffa2eac54d155fd566b3ab5634cd078bf4d816031c78feac8eb75fe87f05a139b63a9251b1c82a0e54c1766da2bc835ff3188dffaf2918e58c93184e59ae7c5f6ef3c216607ef55135df1fd59ef24a0747c221007c2ddc4a13b6c9f5c735932959d867197e0431a40d63124c94e7706915a97cf6b658a7017bd98e23d11954f7f2818d28a598ff2a3d2f174c0d918fcf1f99b92076779001a2d6731dbb6f70a705b20dd79780bdbce10eb69cf65df9f473b6ffedbb1571c8861188082f7bf7551bb92fdcc17ccc0a22a71fceb7c7605eede2977698b43d82795cf7a4d1fbbd9a96eae27d15d706390394ae0bc8ecc0f63f2def9e428def3f2a283fffe3d7a8b1a47f712a1979f3b99458bd87bdab16df8be8f9b89021be17d3ce65fa86660cee77114af73f47c4f0300000000000000000000000000000000000080bff000", 36214, "f6efa9b9cd6c773ed208847e0a144644" },
}
for _, c in ipairs(INFLATE) do
  local out, err = rh.inflate(unhex(c[2]), c[3])
  check(c[1], out ~= nil and #out == c[3] and rh.md5(out) == c[4], err)
end
check("corrupt input is an error, not a crash", rh.inflate("\255\255\255\255") == nil)

print("=== cartridge and disc rules ===")
local dir = (os.getenv("TEMP") or os.getenv("TMP") or "."):gsub("\\", "/") .. "/rom_hash_test_" .. tostring(os.time())
os.execute('mkdir "' .. dir:gsub("/", "\\") .. '" 2>nul')
local function write(name, bytes)
  local p = dir .. "/" .. name
  local f = assert(io.open(p, "wb"))
  f:write(bytes)
  f:close()
  return p
end
local seed = 12345
local function rnd(n)
  local t = {}
  for i = 1, n do
    seed = (seed * 1103515245 + 12345) % 2147483648
    t[i] = string.char(seed % 256)
  end
  return table.concat(t)
end
local function hash(p)
  local r, e = rh.rom_md5(p)
  return r and (r.md5 or r.format) or e
end

local body = rnd(40000)
check("NES: the iNES header is not hashed", hash(write("a.nes", "NES\26" .. rnd(12) .. body)) == rh.md5(body))
local smc = rnd(65536)
check("SNES: a 512-byte copier header is not hashed", hash(write("b.smc", rnd(512) .. smc)) == rh.md5(smc))
local z64 = "\128\55\18\64" .. rnd(4092)
local v64, n64 = {}, {}
for i = 1, #z64, 2 do v64[#v64 + 1] = z64:sub(i + 1, i + 1) .. z64:sub(i, i) end
for i = 1, #z64, 4 do n64[#n64 + 1] = z64:sub(i, i + 3):reverse() end
check("N64 .z64 is hashed as it is", hash(write("c.z64", z64)) == rh.md5(z64))
check("N64 .v64 is made big-endian first", hash(write("d.v64", table.concat(v64))) == rh.md5(z64))
check("N64 .n64 is made big-endian first", hash(write("e.n64", table.concat(n64))) == rh.md5(z64))
local md = rnd(16384 * 2)
local smd = {}
for b = 0, 1 do
  local blk = md:sub(b * 16384 + 1, (b + 1) * 16384)
  local odd, even = {}, {}
  for j = 0, 8191 do
    even[#even + 1] = blk:sub(2 * j + 1, 2 * j + 1)
    odd[#odd + 1] = blk:sub(2 * j + 2, 2 * j + 2)
  end
  smd[#smd + 1] = table.concat(odd) .. table.concat(even)
end
check("Genesis SMD: header removed, blocks de-interleaved", hash(write("f.smd", "\170\187\6" .. rnd(509) .. table.concat(smd))) == rh.md5(md))

local function u16(n) return string.char(n % 256, math.floor(n / 256) % 256) end
local function u32(n) return u16(n % 65536) .. u16(math.floor(n / 65536)) end
local function stored_zip(files)
  local locals, central, off = {}, {}, 0
  for _, f in ipairs(files) do
    local name, data = f[1], f[2]
    local lh = "PK\3\4" .. u16(20) .. u16(0) .. u16(0) .. u32(0) .. u32(0) .. u32(#data) .. u32(#data) .. u16(#name) .. u16(0) .. name
    central[#central + 1] = "PK\1\2" .. u16(20) .. u16(20) .. u16(0) .. u16(0) .. u32(0) .. u32(0) .. u32(#data) .. u32(#data)
      .. u16(#name) .. u16(0) .. u16(0) .. u16(0) .. u16(0) .. u32(0) .. u32(off) .. name
    locals[#locals + 1] = lh .. data
    off = off + #lh + #data
  end
  local cd = table.concat(central)
  return table.concat(locals) .. cd .. "PK\5\6" .. u16(0) .. u16(0) .. u16(#files) .. u16(#files) .. u32(#cd) .. u32(off) .. u16(0)
end
local sfc = rnd(32768)
check("zip: the console ROM is picked over a readme", hash(write("g.zip", stored_zip({ { "readme.txt", "hi" }, { "game.sfc", sfc } }))) == rh.md5(sfc))
local chips = {}
for k = 1, 5 do chips[k] = { "chip" .. k .. ".u" .. k, rnd(64) } end
check("zip: an arcade romset is not hashed", hash(write("h.zip", stored_zip(chips))) == "arcade_zip")
check(".chd is left to title matching", hash(write("i.chd", rnd(100))) == "chd")
write("j.m3u", "# disc list\nmissing.cue\na.nes\n")
check(".m3u: the first listed file that exists", hash(dir .. "/j.m3u") == rh.md5(body))
check("a missing file", hash(dir .. "/nope.sfc") == "file_not_found")

-- PS1 disc: SYSTEM.CNF names the boot exe; 2048-byte sectors, and raw 2352-byte Mode 2 sectors (user data at +24).
local function rec(name, lba, size)
  local l = 33 + #name
  if l % 2 == 1 then l = l + 1 end
  return string.char(l, 0) .. u32(lba) .. u32(0) .. u32(size) .. u32(0) .. string.rep("\0", 14) .. string.char(#name) .. name
    .. string.rep("\0", l - 33 - #name)
end
local exe = rnd(5000)
local cnf = "BOOT = cdrom:\\SLUS_000.01;1\r\nTCB = 4\r\n"
local function pad(s) return s .. string.rep("\0", 2048 - #s) end
local sectors = {}
sectors[16] = pad("\1CD001" .. string.rep("\0", 150) .. rec("\0", 18, 2048):sub(1, 34))
sectors[18] = pad(rec("\0", 18, 2048) .. rec("\1", 18, 2048) .. rec("SYSTEM.CNF;1", 19, #cnf) .. rec("SLUS_000.01;1", 20, #exe))
sectors[19] = pad(cnf)
for k = 0, 2 do sectors[20 + k] = pad(exe:sub(k * 2048 + 1, (k + 1) * 2048)) end
local iso, raw = {}, {}
for i = 0, 22 do
  local s = sectors[i] or string.rep("\0", 2048)
  iso[#iso + 1] = s
  raw[#raw + 1] = string.rep("\0", 24) .. s .. string.rep("\0", 280)
end
check("PS1 .iso: the boot exe is hashed", hash(write("k.iso", table.concat(iso))) == rh.md5(exe))
check("PS1 raw .bin (Mode 2): sector headers are not hashed", hash(write("l.bin", table.concat(raw))) == rh.md5(exe))
local gen = rnd(4096)
check("a .bin that is not a disc is a cartridge (Genesis)", hash(write("m.bin", gen)) == rh.md5(gen))

os.execute('rmdir /s /q "' .. dir:gsub("/", "\\") .. '" 2>nul')
print("\n" .. (failures == 0 and "ALL PASS" or (failures .. " FAILURE(S)")))
os.exit(failures == 0 and 0 or 1)
