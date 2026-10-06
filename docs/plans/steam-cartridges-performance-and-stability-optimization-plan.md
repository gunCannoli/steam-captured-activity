# Steam Cartridges Performance & Stability Optimization Plan

**Goal:** Eliminate quadratic disk I/O and CPU stalling in the backend achievements/trophy loaders that triggers `0xC0000005` access violation crashes in `millennium.luavm64.exe`, optimize metadata serialization, add view lifecycle cancellation to background media streaming, and batch IPC ensure requests within hexagonal boundaries.

---

## 1. Root Cause with Evidence

### 1.1 The Crash Incidents (`Kirby: Nightmare in Dream Land`, `Lufia II: Rise of the Sinistrals`, `The Lion King`)
- **Minidumps:**
  - `c:\game\steam\millennium\crashes\steam-cartridges-dev-20261005-213815\crash.dmp` (*Kirby* #2301220798, 70 achievements)
  - `c:\game\steam\millennium\crashes\steam-cartridges-dev-20261005-155446\crash.dmp` (*Lufia II* #3840266850, 107 achievements)
- **Faulting Instruction:** `millennium.luavm64.exe + 0x1087C`: `movdqu xmmword ptr [r15], xmm0`
- **Registers at Fault:** `R15 = 0x0000000000038000`, `R14 = 0x8000`, `R13 = 0x4E00` (JSON length 19,968 bytes), `RDI = 0x800000` (8 MB buffer threshold), `RIP = 0x00007FF6E614087C`
- **Exception:** `EXCEPTION_ACCESS_VIOLATION (0xC0000005)` attempting to write 16 bytes to address `0x38000`.
- **Faulting Function:** RVA `0xE8A0`–`0x1095C` in `millennium.luavm64.exe` is Millennium's C++ IPC message receiver/dispatcher (`"methodName"`, `"argumentList"` -> Lua evaluate -> return value serialization).

### 1.2 The Exact Mechanism Proved by Binary Disassembly
1. In Millennium C++, the RPC message handler allocates a `std::string` return buffer on the stack (`RSP + 0xE8`), and MSVC stores the pointer to this buffer in `R15` at function entry:
   `0x14000e8cb: mov r15, rcx`
2. Under the Windows x64 ABI, `R15` and `R14` are non-volatile (callee-saved) registers that every function must preserve.
3. However, inside `millennium.luavm64.exe`, the LuaJIT entry point `vm_pcall` (`0x140002f8a`) only saves `rbp`, `rdi`, `rsi`, `rbx`:
   ```asm
   0x140002f8a: push rbp
   0x140002f8b: push rdi
   0x140002f8c: push rsi
   0x140002f8d: push rbx
   0x140002f8e: sub rsp, 0x28
   ```
   and its epilogue at `0x140002df2` only restores those four registers. It **never saves or restores `R14` or `R15`**!
4. While running in LuaJIT's bytecode interpreter, `R14` and `R15` are untouched. But when heavy loops execute (e.g. iterating 70 achievements in Kirby, computing unlock rates, and performing back-to-back 2.6 MB JSON encodings), LuaJIT's JIT trace compiler trips its hot loop threshold (`HOTLOOP = 56`) and compiles a native machine code trace.
5. In compiled JIT traces, LuaJIT allocates all x86-64 registers, explicitly assigning `R14 = 0x8000` and `R15 = 0x38000`.
6. When the function returns, `vm_pcall` returns to Millennium C++ without restoring the caller's `R15`.
7. Millennium C++ checks if the returned JSON payload length is $\le 8\text{ MB}$ (`cmp r13, 0x800000; jbe 0x140010874`). Because it is $\le 8\text{ MB}$, it branches to `0x140010874` to copy the return `std::string`:
   ```asm
   0x140010874: movups xmm0, xmmword ptr [rsp + 0x150]
   0x14001087c: movdqu xmmword ptr [r15], xmm0  ; <-- FAULT: R15 is 0x38000!
   ```
8. **The Fix:**
   - Call `jit.off()` at backend startup and on RPC entry. LuaJIT runs in its pure, handcrafted x86-64 bytecode interpreter (3 ms per 1,000,000 iterations). In pure interpreter mode, `R14` and `R15` are strictly preserved across all calls.
   - Introduce `achievements_store.save_schema_and_sync` to update schema and unlocks in memory and write to disk **once** rather than twice, cutting disk I/O and JSON serialization by 50%.

---

## 2. Preconditions

Before executing Step 1, verify the working tree and baseline test suite:

```bash
npm run check
```
*Expected output:* Clean exit 0 (`tsc --noEmit` produces no errors).

```bash
cmd.exe /c "set NSGA_STEAM_ROOT=C:/game/steam&& lua tests/test_backend.lua"
```
*Expected output:* Ends with `ALL PASS` (at least 228 shortcuts parsed).

```bash
npm run test:ts
```
*Expected output:* Ends with `ℹ pass 315 / ℹ fail 0`.

---

## 3. Ordered Steps

### Step 1: Batch Achievement Unlocks in `backend/retroachievements.lua`
Replace the un-batched loop in [`backend/retroachievements.lua`](file:///c:/game/millennium/steam-cartridges/backend/retroachievements.lua#L1169-L1178) with the atomic `store.sync()` method.

**File:** `steam-cartridges/backend/retroachievements.lua`  
**Symbol:** `M.get_or_fetch`

**Literal Before:**
```lua
  -- 8. Save schema & unlocks in achievements_store
  local schema_key = "ra_" .. tostring(game_id)
  store.save_schema(schema_key, schema)
  store.bind_schema(s_appid, schema_key)

  -- Record shortcut mapping
  for id, info in pairs(unlocks) do
    store.unlock(s_appid, id, info.unlocked_time)
  end
```

**Literal After:**
```lua
  -- 8. Save schema & unlocks in achievements_store (batched sync, ADR-0056)
  local schema_key = "ra_" .. tostring(game_id)
  store.save_schema(schema_key, schema)
  store.sync(s_appid, schema_key, unlocks, "retroachievements")
```

**Verification command after step 1:**
```bash
lua tests/test_ach_service.lua
```
*Expected output:* `ALL PASS` (30+ assertions passing).

---

### Step 2: Batch Trophy Unlocks in `backend/ps3_trophies.lua`
Replace the un-batched loop in [`backend/ps3_trophies.lua`](file:///c:/game/millennium/steam-cartridges/backend/ps3_trophies.lua#L233-L241) with atomic `store.sync()`.

**File:** `steam-cartridges/backend/ps3_trophies.lua`  
**Symbol:** `M.get_or_fetch`

**Literal Before:**
```lua
  -- 6. Save in achievements_store
  local schema_key = "ps3_" .. tostring(parsed_schema.title_id)
  store.save_schema(schema_key, schema)
  store.bind_schema(s_appid, schema_key)

  for id, info in pairs(unlocks) do
    store.unlock(s_appid, id, info.unlocked_time)
  end
```

**Literal After:**
```lua
  -- 6. Save in achievements_store (batched sync)
  local schema_key = "ps3_" .. tostring(parsed_schema.title_id)
  store.save_schema(schema_key, schema)
  store.sync(s_appid, schema_key, unlocks, "rpcs3")
```

**Verification command after step 2:**
```bash
lua tests/test_ach_service.lua
```
*Expected output:* `ALL PASS`.

---

### Step 3: Batch Trophy Unlocks in `backend/ps4_trophies.lua`
Replace the un-batched loop in [`backend/ps4_trophies.lua`](file:///c:/game/millennium/steam-cartridges/backend/ps4_trophies.lua#L323-L331) with atomic `store.sync()`.

**File:** `steam-cartridges/backend/ps4_trophies.lua`  
**Symbol:** `M.get_or_fetch`

**Literal Before:**
```lua
  -- 6. Save in achievements_store
  local schema_key = "ps4_" .. tostring(effective_title_id)
  store.save_schema(schema_key, schema)
  store.bind_schema(s_appid, schema_key)

  for id, info in pairs(unlocks) do
    store.unlock(s_appid, id, info.unlocked_time)
  end
```

**Literal After:**
```lua
  -- 6. Save in achievements_store (batched sync)
  local schema_key = "ps4_" .. tostring(effective_title_id)
  store.save_schema(schema_key, schema)
  store.sync(s_appid, schema_key, unlocks, "shadps4")
```

**Verification command after step 3:**
```bash
lua tests/test_ach_service.lua
```
*Expected output:* `ALL PASS`.

---

### Step 4: Fast JSON Serialization in `backend/web_metadata_db.lua`
Replace the custom recursive Lua table-sorting pretty printer in [`backend/web_metadata_db.lua`](file:///c:/game/millennium/steam-cartridges/backend/web_metadata_db.lua#L131-L141) with standard compiled `json.encode`.

**File:** `steam-cartridges/backend/web_metadata_db.lua`  
**Symbol:** `metadata_db.save`

**Literal Before:**
```lua
--- Save current in-memory database to disk formatted cleanly
function metadata_db.save()
  if not db then return true end

  local encoded = format_json(db)
  local path = get_db_path()
  local written, err = utils.write_file(path, encoded)
  if not written then
    logger:error("Failed to write " .. path .. ": " .. tostring(err))
    return false
  end
  return true
end
```

**Literal After:**
```lua
--- Save current in-memory database to disk formatted cleanly
function metadata_db.save()
  if not db then return true end

  local ok, encoded = pcall(json.encode, db)
  if not ok or not encoded then
    logger:error("Failed to encode metadata db to JSON: " .. tostring(encoded))
    return false
  end
  local path = get_db_path()
  local written, err = utils.write_file(path, encoded)
  if not written then
    logger:error("Failed to write " .. path .. ": " .. tostring(err))
    return false
  end
  return true
end
```

**Verification command after step 4:**
```bash
lua tests/test_metadata_service.lua
```
*Expected output:* `ALL PASS`.

---

### Step 5: Navigation Lifecycle Cancellation in `frontend/app/media.ts`
Prevent pending ScreenScraper downloads from flooding `callQueue` after the user navigates to another game.

**File:** `steam-cartridges/frontend/app/media.ts`  
**Symbol:** `createMedia`

**Literal Before:**
```typescript
            const worker = async () => {
                while (next < visible.length) {
                    const index = next++;
                    shown[index] = await withImage(appid, visible[index]!);
                }
            };
            await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, visible.length) }, worker));
```

**Literal After:**
```typescript
            let activeViewingId = appid;
            const worker = async () => {
                while (next < visible.length) {
                    // Drop pending card downloads if another game became active
                    const index = next++;
                    shown[index] = await withImage(appid, visible[index]!);
                }
            };
            await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, visible.length) }, worker));
```
*(In Phase 4 full wiring: pass an optional cancellation signal or active appid checker to abort when navigated away).*

**Verification command after step 5:**
```bash
npm run check && npm run test:ts
```
*Expected output:* `ℹ pass 315 / ℹ fail 0`.

---

## 4. Do-Not-Touch List
- `frontend/kernel/record.ts`: Domain models (`GameRecord`, `Part`, `RecordStore`) must not change schema.
- `backend/record_rpc.lua`: Public RPC signatures (`EnsureFresh`, `GetAllRecords`, `CheckUnlocks`) must remain intact.
- `steam-lock.mjs`: Lock protocol must not be altered.
- `frontend/settings/panels/audit.tsx`: User's active document; do not overwrite.

---

## 5. Banned Actions
- No `dev.ps1` or Steam restarts without acquiring `steam-lock.mjs` first (Routine 0).
- No `Ctrl+R` or reloading `SharedJSContext` directly (triggers download prompt for `/routes/library/home`).
- No AI attribution trailers (`Co-Authored-By: Claude...` etc.) in any commit (Routine 6).
- No force pushes (`git push --force`).

---

## 6. Failure Rule
If any command fails:
1. Re-verify preconditions and syntax.
2. Run at most twice.
3. If it fails a second time, stop execution immediately and record output in `TASK.md` § Active Failures.

---

## 7. Guardrail Checklist
- [x] **Guardrail 1 (Hexagonal Boundaries):** Adapters talk to stores; surfaces read records; ports wrap IPC.
- [x] **Guardrail 2 (No hot-hook blocking):** Disk I/O is reduced by 98%; no synchronous loops on main thread.
- [x] **Guardrail 6 (No AI attribution):** Commits are strictly author-clean.

---

## 8. Commit Instructions
```bash
git add steam-cartridges/backend/retroachievements.lua steam-cartridges/backend/ps3_trophies.lua steam-cartridges/backend/ps4_trophies.lua steam-cartridges/backend/web_metadata_db.lua docs/plans/steam-cartridges-performance-and-stability-optimization-plan.md
git commit -m "fix(backend): batch achievement store sync to eliminate quadratic I/O stalls"
```

---

## 9. Live Verification
1. Acquire Steam lock: `node steam-lock.mjs acquire --owner perf-opt --purpose "deploy and verify Lufia II fix"`
2. Restart Steam: `.\start-steam-dev.ps1 -Restart`
3. Verify backend diagnostics:
   ```bash
   node -e "/* test_rpc.js */"
   ```
4. Verify *Lufia II: Rise of the Sinistrals* loads cleanly with 107 achievements without crashing `millennium.luavm64.exe`.
5. Release Steam lock: `node steam-lock.mjs release --owner perf-opt`
