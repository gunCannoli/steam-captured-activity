--- millennium_patch.lua - Hot-patch for Millennium luavm64 host bridge crash (0xC0000005 at 0x1087C).
---
--- Root Cause:
--- In millennium.luavm64.exe (v3.5.0), MSVC allocates R15 as the return std::string buffer pointer
--- at 0x14000e8cb (mov r15, rcx) and also spills it to [RSP + 0xE8].
--- However, LuaJIT's vm_pcall entry and interpreter do not preserve R14 and R15 under
--- the Windows x64 ABI. Whenever Lua runs, R15 is clobbered with LuaJIT internal pointers (e.g. 0x38000).
--- When Lua returns to Millennium C++, Millennium executes:
---   0x14001087c: movdqu [r15], xmm0
--- which writes to invalid address 0x38000 and crashes with EXCEPTION_ACCESS_VIOLATION (0xC0000005).
---
--- Fix:
--- Hot-patch the jbe at RVA 0x1055f in millennium.luavm64.exe to route through a 26-byte
--- trampoline at RVA 0x231b80 (.text section alignment padding) that reloads R15 from [RSP + 0xE8]
--- before executing movdqu [r15], xmm0.

local logger = require("logger")

local M = {}

function M.apply()
  local ok_ffi, ffi = pcall(require, "ffi")
  if not ok_ffi or not ffi then return false, "ffi not available" end

  local ok, success, msg = pcall(function()
    ffi.cdef[[
      void* GetModuleHandleA(const char* lpModuleName);
      int VirtualProtect(void* lpAddress, size_t dwSize, unsigned long flNewProtect, unsigned long* lpflOldProtect);
    ]]

    local hModule = ffi.C.GetModuleHandleA(nil)
    if hModule == nil then return false, "cannot get module handle" end
    local base = ffi.cast("uintptr_t", hModule)

    -- Target offsets in millennium.luavm64.exe (v3.5.0)
    -- RVA 0x1055f: 0f 86 0f 03 00 00 (jbe +0x30f -> 0x10874)
    -- Target trampoline RVA 0x231b80 (.text section padding)
    local jbe_addr = ffi.cast("uint8_t*", base + 0x1055f)
    local tramp_addr = ffi.cast("uint8_t*", base + 0x231b80)

    -- Verify signature at 0x1055f
    local sig = { 0x0f, 0x86, 0x0f, 0x03, 0x00, 0x00 }
    local already_patched = { 0x0f, 0x86, 0x1b, 0x16, 0x22, 0x00 }

    local is_already = true
    for i = 0, 5 do
      if jbe_addr[i] ~= already_patched[i + 1] then
        is_already = false
        break
      end
    end
    if is_already then
      return true, "already patched"
    end

    local matches = true
    for i = 0, 5 do
      if jbe_addr[i] ~= sig[i + 1] then
        matches = false
        break
      end
    end

    if not matches then
      return false, "signature mismatch (different millennium build)"
    end

    -- Trampoline bytes (26 bytes)
    local tramp = ffi.new("uint8_t[26]", {
      -- 1. mov r15, [rsp + 0xe8] (reload caller's std::string buffer pointer)
      0x4c, 0x8b, 0xbc, 0x24, 0xe8, 0x00, 0x00, 0x00,
      -- 2. movups xmm0, [rsp + 0x150] (original instruction at 0x10874)
      0x0f, 0x10, 0x84, 0x24, 0x50, 0x01, 0x00, 0x00,
      -- 3. movdqu [r15], xmm0 (original instruction at 0x1087c)
      0xf3, 0x41, 0x0f, 0x7f, 0x07,
      -- 4. jmp 0x10881 (resume function flow at xor r13d, r13d)
      0xe9, 0xe7, 0xec, 0xdd, 0xff,
    })

    -- New jbe at 0x1055f (jbe +0x22161b -> tramp_addr)
    local new_jbe = ffi.new("uint8_t[6]", { 0x0f, 0x86, 0x1b, 0x16, 0x22, 0x00 })

    local old_prot = ffi.new("unsigned long[1]")
    local PAGE_EXECUTE_READWRITE = 0x40

    -- Protect and write trampoline
    if ffi.C.VirtualProtect(ffi.cast("void*", tramp_addr), 32, PAGE_EXECUTE_READWRITE, old_prot) == 0 then
      return false, "VirtualProtect failed on trampoline"
    end
    ffi.copy(tramp_addr, tramp, 26)
    ffi.C.VirtualProtect(ffi.cast("void*", tramp_addr), 32, old_prot[0], old_prot)

    -- Protect and write jbe
    if ffi.C.VirtualProtect(ffi.cast("void*", jbe_addr), 6, PAGE_EXECUTE_READWRITE, old_prot) == 0 then
      return false, "VirtualProtect failed on jbe"
    end
    ffi.copy(jbe_addr, new_jbe, 6)
    ffi.C.VirtualProtect(ffi.cast("void*", jbe_addr), 6, old_prot[0], old_prot)

    return true, "patched"
  end)

  if ok and success then
    logger:info("Millennium luavm64 R15 preservation hot-patch active: " .. tostring(msg))
    return true
  else
    logger:warn("Millennium luavm64 R15 preservation hot-patch skipped: " .. tostring(msg or success))
    return false
  end
end

return M
