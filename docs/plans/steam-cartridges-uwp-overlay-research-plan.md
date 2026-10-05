# Research & Investigation Plan: Steam Overlay on Xbox UWP Games

**Status:** Draft / Proposed (2026-10-04).  
**Context:** In `steam-cartridges-store-launch-tracking-plan.md`, launch tracking for Xbox UWP was solved via `U0` (`SystemUWPLauncher.exe` / direct exe mapping), giving Steam running state, playtime tracking, and an active session timeline. However, Xbox UWP games still lack the **Steam Overlay** (Shift+Tab, in-game achievement banners, and Steam Game Recording captures). This plan investigates technical paths to enable the Steam Overlay for Xbox UWP games.  
**Audience:** Developer/Agent researching Windows UWP isolation, Steam's native overlay injection pipeline, and candidate wrapper architectures.  
**Decision Owner:** The user.

---

## 1. Executive Summary & The Core Problem

When Steam launches a game, it achieves overlay rendering and controller tracking through a tightly coupled native pipeline:
1. Steam creates or tracks the process hierarchy via Win32 `CreateProcess`.
2. Steam injects `GameOverlayRenderer64.dll` into the root process and hooks `CreateProcess` / `LoadLibrary` to propagate into child processes.
3. `GameOverlayRenderer64.dll` hooks the 3D graphics presentation pipeline (`IDXGISwapChain::Present`, Vulkan, OpenGL, D3D9/11/12).
4. `GameOverlayRenderer64.dll` reports the hooked rendering PID to `steamclient64.dll` via shared IPC (`GameOverlayRender_PIDStream`).
5. `steamclient64.dll` (`CSteamEngine::CheckForOverlayInstancesNeeded`) verifies the PID belongs to a tracked shortcut child, then spawns `gameoverlayui64.exe -pid <PID> -steampid <SteamPID> -gameid <GameID>`.
6. `gameoverlayui64.exe` renders the overlay UI offscreen using CEF and shares textures and synchronization events (`GameOverlayRender_PaintCmdStream_<PID>`, `GameOverlay_InGameRenderingCompleted_<PID>`) with `GameOverlayRenderer64.dll`, which composites the UI onto the game's swapchain before `Present`.
7. Steam Game Recording (`g_GRS.StartRecording`) hooks into this same swapchain to capture video frames.

### Why This Fails Completely on Xbox UWP Games: The Four Barriers

| Barrier | Description | Observed Evidence |
|---|---|---|
| **B1. Process Ancestry & COM Activation** | UWP games are not spawned by `CreateProcess` from our shortcut. They are activated via COM RPC (`IApplicationActivationManager` / `svchost.exe` - DcomLaunch). Steam's process tree tracking is completely severed. | E3/E4 in launch tracking plan; parent PID of `Minesweeper.exe` is `svchost.exe` (1624). |
| **B2. AppContainer File ACL Isolation** | UWP apps run in a sandboxed `AppContainer` token (Low/AppContainer Integrity Level). Files outside the package directory cannot be loaded unless their NTFS DACL explicitly grants `Read & Execute` to `ALL APPLICATION PACKAGES` (`S-1-15-2-1`). | Win32 Error 5 (`ERROR_ACCESS_DENIED`) on unauthorized DLL loads. |
| **B3. Kernel Object & IPC Isolation** | `GameOverlayRenderer64.dll` relies on named synchronization primitives (`GameOverlayRender_PIDStream`, `Global\Steam_GameOverlayInjector_%s`, `GameOverlay_InputEventStream_%s`, etc.). Inside an AppContainer, unqualified object names are redirected to private namespaces (`\Sessions\<n>\AppContainerNamedObjects\<PackageSID>\`), and `Global\` access is denied. Medium IL `steamclient64.dll` cannot see or open these objects. | String analysis of `steamclient64.dll` and `gameoverlayui.dll`. |
| **B4. The Focus & Presentation Trap (E6 Lesson)** | In experiment E6, a transparent OpenGL carrier window was hooked by Steam (`gameoverlayui64.exe` started for PID 18352). But when an achievement occurred, Steam checked `GetForegroundWindow()`. Because `Minesweeper.exe` had foreground focus, Steam fell back to **desktop toasts**. Furthermore, Shift+Tab went to the game, and Steam Game Recording recorded blank transparent carrier frames. | E6: CDP target was `notificationtoasts_..._desktop`; `console_log.txt` showed overlay hooked the carrier, but toasts bypassed it. |

---

## 2. Analysis of Prior Art: SISR and GlosSI

The user suggested investigating how **SISR** (https://github.com/Alia5/SISR) allows Steam Input on UWP games and whether the same approach applies to the overlay.

### 2.1 What SISR Actually Does
- **Repository:** `Alia5/SISR` (Steam Input System Redirector, GPL-3.0, Go/C++).
- **Primary Function:** Emulates a system-wide Xbox 360 controller using kernel drivers (VIIPER / USBIP-Win2 / ViGEmBus).
- **Mechanism:**
  1. A Steam shortcut launches `SISR.exe`.
  2. Steam attaches Steam Input to `SISR.exe`.
  3. `SISR.exe` captures controller input from Steam Input and forwards it through the virtual controller driver.
  4. The UWP game receives controller events from the virtual Xbox 360 controller as standard OS game controller inputs.
- **SISR & The Steam Overlay on UWP:**
  - SISR includes a transparent window mode (`--w true --f true`), **BUT SISR's official documentation explicitly states:**
    > *"Enable Steam Overlay does currently also not work with UWP games"*
  - **Verdict on SISR:** SISR solves **Steam Input** (controller remapping), but it does **not** solve the Steam Overlay for UWP games. It suffers from the exact same limitation observed in our E6 experiment.

### 2.2 What GlosSI / GloSC Did (The Predecessor)
- **GlosSI (Global Steam Input):**
  - Attempted an "experimental UWP overlay" by creating a transparent window.
  - To display above fullscreen UWP games, it used the undocumented private Windows API `CreateWindowInBand` with `ZBID_IMMERSIVE_INACTIVEMOBODY` or `ZBID_SYSTEM_TOOLS` (bypassing normal `ZBID_DESKTOP` Z-order layering).
  - Calling `CreateWindowInBand` requires Microsoft signature verification or DLL injection into an immersive system process (e.g. `RuntimeBroker.exe`).
  - Required the UWP game to run in borderless windowed mode.
  - Required manual focus toggling (Alt+Tab or hotkey interception) to switch focus between the game and the overlay window.
  - Did **not** support Steam Game Recording (video frames remained blank).

---

## 3. Four Architectural Approaches to Research

We evaluate four distinct technical paths to achieve overlay functionality or its equivalent on Xbox UWP games.

```
+----------------------------------------------------------------------------------------------------+
|                                    CANDIDATE ARCHITECTURES                                         |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [Option 1: Mirrored Presentation Wrapper]  <-- RECOMMENDED FOR FULL CAPABILITIES                 |
|  Steam -> wrapper.exe (Hooked by Steam Overlay & Recording)                                       |
|               |                                                                                    |
|               +-- Captures UWP window via Windows.Graphics.Capture API (Zero-copy GPU texture)     |
|               +-- Renders game frame into wrapper DXGI SwapChain                                   |
|               +-- Steam Overlay & Recording composites natively on top of game frames              |
|               +-- Wrapper is genuine Foreground Window -> In-game toasts & Shift+Tab work!        |
|                                                                                                    |
|  [Option 2: Focus-Arbitrated Carrier Window] (Advanced E6 / GlosSI)                                |
|  Steam -> carrier.exe (Transparent Window hooked by Steam)                                         |
|               |                                                                                    |
|               +-- Hooks global Shift+Tab / Guide button                                            |
|               +-- On hotkey: Temporarily forces carrier to Foreground -> Steam Overlay opens       |
|               +-- On close: Restores focus to UWP game                                             |
|               * LIMITATION: Recording captures blank frames; Toasts require synthetic focus flip   |
|                                                                                                    |
|  [Option 3: Direct AppContainer Injection + IPC Proxy]                                             |
|  Inject GameOverlayRenderer64.dll into UWP process + Proxy Named Objects                           |
|               * SEVERE BLOCKER: Steam CSteamEngine rejects untracked PIDs ('Unknown ePidType')    |
|               * High complexity, anti-cheat risks, requires DLL hooks on Windows IPC APIs          |
|                                                                                                    |
|  [Option 4: Millennium Native HUD / Toast Overlay]                                                |
|  Let UWP run naturally (U0) + Render custom Topmost Toast/HUD via Millennium / enhanced-notifs     |
|               * Lightweight, zero driver, zero injection risk                                      |
|               * Solves in-game toasts (1.0s push), but does not provide Shift+Tab or Recording     |
+----------------------------------------------------------------------------------------------------+
```

---

### Detailed Comparison Matrix

| Feature | Option 1: Mirrored Presenter Wrapper | Option 2: Focus Arbitrator Carrier | Option 3: Direct AppContainer Injection | Option 4: Millennium Native Overlay |
|---|---|---|---|---|
| **In-Game Toasts (not Desktop)** | **Yes** (Wrapper has focus) | **Partial** (Requires focus flip on toast) | **Yes** (if PID accepted) | **Yes** (Native top-level window) |
| **Shift+Tab / Overlay UI** | **Yes** (Native) | **Yes** (via hotkey intercept & focus flip) | **Yes** (if PID accepted) | **No** (Toasts/HUD only) |
| **Steam Game Recording** | **Yes** (Records game visuals) | **No** (Blank transparent frames) | **Yes** | **No** |
| **Steam Input Support** | **Yes** (Native) | **Partial** (Needs ViGEmBus like SISR) | **No** | **No** (Uses U0/Native) |
| **Exclusive Fullscreen** | **Yes** (Wrapper handles presentation) | **No** (Borderless only) | **Yes** | **No** (Borderless only) |
| **Driver / Admin Needed?** | **No** (Pure Win32 + WinRT) | **No** (or inject for WindowBand) | **No** (ACL grant needed) | **No** |
| **Feasibility / Risk** | **High Feasibility** (Clean WinRT API) | **Medium** (Focus race conditions) | **Low Feasibility** (Blocked by Steam Engine) | **Very High Feasibility** (Already proven) |

---

## 4. Deep Dive into the Top Options

### 4.1 Option 1: Mirrored Presentation Wrapper (The Modern Compositor)
- **Concept:** Since Windows 10 (version 1803+), the `Windows.Graphics.Capture` WinRT API allows modern, secure screen and window capture.
  - Uses Desktop Duplication / DWM composition directly on the GPU.
  - Zero-copy: yields a `Direct3D11CaptureFrame` whose underlying DXGI surface can be rendered directly by a Direct3D 11/12 device with negligible latency (<1 ms) and 60/120+ FPS.
  - Bypasses AppContainer security boundaries because DWM already possesses the composition surface.
- **How it integrates with Steam:**
  1. The Steam shortcut points to `uwp_presenter.exe <AUMID>`.
  2. Steam launches `uwp_presenter.exe`, tracking it as the root process and injecting `GameOverlayRenderer64.dll`.
  3. `uwp_presenter.exe` launches the UWP game via COM (`IApplicationActivationManager`).
  4. Once the UWP window appears, `uwp_presenter.exe` initiates a `GraphicsCaptureItem` on the UWP window handle and copies incoming textures to its own Direct3D swapchain.
  5. `uwp_presenter.exe` is the active, focused foreground window.
  6. Mouse, keyboard, and controller input are forwarded to the UWP game window (or controller via Steam Input / XInput passthrough).
  7. **Outcome:**
     - `gameoverlayui64.exe` attaches to `uwp_presenter.exe`.
     - Shift+Tab and Guide button bring up the Steam overlay directly on top of the mirrored game stream.
     - Achievement notifications post as true in-game toasts.
     - Steam Game Recording captures actual gameplay frames.

### 4.2 Option 2: Focus-Arbitrated Carrier Window (Refined E6)
- **Concept:** Take the OpenGL/D3D carrier window from E6 and solve its focus flaw.
  - Instead of leaving the carrier completely unactivated (`WS_EX_NOACTIVATE`), install a low-level keyboard hook (`WH_KEYBOARD_LL`) or XInput polling thread inside the carrier to detect the Steam Overlay hotkey (Shift+Tab or Guide button).
  - When pressed:
    1. Call `SetForegroundWindow(carrierHwnd)`.
    2. Synthesize the hotkey event into the carrier message loop.
    3. Steam's `GameOverlayRenderer64.dll` detects the hotkey and opens `gameoverlayui64.exe`.
  - When the overlay is dismissed (monitored via `SteamOverlayRunning_%d` event or Window focus loss):
    1. Restore foreground focus to the UWP game window (`SetForegroundWindow(uwpGameHwnd)`).
- **Limitation:** Steam Game Recording remains black/transparent because the carrier renders nothing behind the overlay.

### 4.3 Option 4: Millennium Custom In-Game HUD / Toast Overlay
- **Concept:** For users who primarily want **in-game achievement toasts** (not necessarily the full Shift+Tab browser overlay):
  - In `steam-cartridges-store-unlock-detection-research.md`, Windows push notifications for Xbox achievements arrive in **1.0 second**.
  - `enhanced-notifications` already renders custom themed banners (PS5, SteamStation, Xbox).
  - Instead of relying on Steam's `gameoverlayui64.exe`, create a dedicated transparent borderless overlay popup that positions itself directly over the UWP game window whenever an achievement fires.
  - Completely non-invasive: no DLL injection, no graphics hooking, 100% reliable.

---

## 5. Research & Investigation Spikes (Ordered Steps)

To determine the best path forward, execute the following technical spikes:

### Spike 1: Validate SISR on UWP Game
*   **Goal:** Conclusively verify whether SISR provides any overlay capabilities on UWP games or if it is strictly Steam Input controller redirection.
*   **Action:**
    1. Install SISR on a test target or inspect SISR source code (`alia5/SISR/internal/overlay`).
    2. Confirm whether `--w true --f true` produces an interactive Steam overlay over `Minesweeper.exe`.
    3. Document findings in research log.

### Spike 2: AppContainer DLL Injection Feasibility Probe
*   **Goal:** Empirically verify whether `GameOverlayRenderer64.dll` can be injected into `Minesweeper.exe` and whether Steam's engine accepts or rejects the PID.
*   **Action:**
    1. Grant `Read & Execute` on `C:\game\steam\GameOverlayRenderer64.dll` to `ALL APPLICATION PACKAGES` (`icacls C:\game\steam\GameOverlayRenderer64.dll /grant "*S-1-15-2-1:(RX)"`).
    2. Write a minimal probe script using `CreateRemoteThread` + `LoadLibraryW` to inject `GameOverlayRenderer64.dll` into a running `Minesweeper.exe` PID.
    3. Inspect `C:\game\steam\logs\gameprocess_log.txt` and `console_log.txt`:
       - Does `GameOverlayRenderer64.dll` crash or detach?
       - Does `steamclient64.dll` log `Unknown ePidType in PID stream`?

### Spike 3: Windows.Graphics.Capture Zero-Copy Presenter Prototype (Option 1)
*   **Goal:** Build a minimal C# prototype using `csc.exe` / .NET that captures the `Minesweeper.exe` window using `Windows.Graphics.Capture` and renders to a D3D11 swapchain.
*   **Action:**
    1. Launch the prototype via a Steam shortcut.
    2. Confirm Steam injects `GameOverlayRenderer64.dll` into the prototype.
    3. Verify:
       - Does Shift+Tab open over the game visuals?
       - Does `NotificationStore.TestAchievement` display as an in-game toast?
       - Does `g_GRS.StartRecording` capture the actual gameplay frames?
       - Measure latency and input responsiveness.

### Spike 4: Focus-Arbitrated Carrier Prototype (Option 2)
*   **Goal:** Test whether dynamic foreground focus flipping allows Shift+Tab to toggle cleanly between the UWP game and the carrier window.
*   **Action:**
    1. Modify the `ltprobe` carrier mode to intercept Shift+Tab and toggle `SetForegroundWindow`.
    2. Observe whether the transition feels seamless or causes UWP window stutter/minimize.

---

## 6. Recommendations & Next Steps

1. **Rule out pure SISR for Overlay:** Treat SISR as a controller-redirection reference only. SISR does not provide the Steam overlay on UWP.
2. **Prioritize Spike 3 (Mirrored Presenter Wrapper):** This is the only architecture that can deliver the **full Steam feature suite**: in-game toasts, interactive Shift+Tab, and Steam Game Recording captures.
3. **Keep Option 4 (Millennium Native Overlay Toast) as the High-Reliability Fallback:** If a presentation wrapper introduces too much complexity for simple casual games, Millennium can render custom in-game achievement banners directly above the UWP window using Windows push logs in 1.0 second.
