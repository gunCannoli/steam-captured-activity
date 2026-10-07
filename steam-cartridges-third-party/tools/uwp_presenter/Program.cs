using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Vortice.Direct3D11;
using Vortice.DXGI;
using WinRT;

[ComImport]
[Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager {
    [PreserveSig]
    int ActivateApplication([In] string appUserModelId, [In] string? arguments, [In] uint options, out uint processId);
    [PreserveSig]
    int ActivateForFile([In] string appUserModelId, [In] IntPtr itemArray, [In] string? verb, out uint processId);
    [PreserveSig]
    int ActivateForProtocol([In] string appUserModelId, [In] IntPtr itemArray, out uint processId);
}

[ComImport]
[Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
class ApplicationActivationManager { }

[ComImport]
[Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IGraphicsCaptureItemInterop {
    IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
    IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
}

[ComImport]
[Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDirect3DDxgiInterfaceAccess {
    [PreserveSig]
    int GetInterface([In] ref Guid iid, out IntPtr p);
}

static class Program {
    [DllImport("api-ms-win-core-winrt-string-l1-1-0.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string sourceString, int length, out IntPtr hstring);

    [DllImport("api-ms-win-core-winrt-string-l1-1-0.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int WindowsDeleteString(IntPtr hstring);

    [DllImport("api-ms-win-core-winrt-l1-1-0.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int RoGetActivationFactory(IntPtr activatableClassId, [In] ref Guid iid, out IntPtr factory);

    [DllImport("d3d11.dll", PreserveSig = true)]
    static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr CreateWindowEx(
        uint dwExStyle, string lpClassName, string lpWindowName, uint dwStyle,
        int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll")]
    static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    static extern bool UpdateWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int DefWindowProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern ushort RegisterClassEx([In] ref WNDCLASSEX lpwcx);

    [DllImport("user32.dll")]
    static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    static extern bool TranslateMessage([In] ref MSG lpMsg);

    [DllImport("user32.dll")]
    static extern IntPtr DispatchMessage([In] ref MSG lpMsg);

    [DllImport("user32.dll")]
    static extern void PostQuitMessage(int nExitCode);

    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    delegate bool EnumChildWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern bool EnumChildWindows(IntPtr hWndParent, EnumChildWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll")]
    static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);

    static void EnumerateAllWindows(EnumWindowsProc proc) {
        IntPtr desk = OpenInputDesktop(0, false, 0x01FF);
        if (desk != IntPtr.Zero) {
            EnumDesktopWindows(desk, proc, IntPtr.Zero);
            CloseDesktop(desk);
        } else {
            EnumWindows(proc, IntPtr.Zero);
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("kernel32.dll")]
    static extern bool AttachConsole(int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll")]
    static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll")]
    static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct PROCESSENTRY32 {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    static HashSet<uint> GetProcessFamily(uint rootPid) {
        var set = new HashSet<uint>();
        if (rootPid > 0) set.Add(rootPid);
        IntPtr snap = CreateToolhelp32Snapshot(0x00000002 /* TH32CS_SNAPPROCESS */, 0);
        if (snap == IntPtr.Zero || snap == (IntPtr)(-1)) return set;
        var pe = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32)) };
        var parentMap = new Dictionary<uint, uint>();
        if (Process32First(snap, ref pe)) {
            do {
                parentMap[pe.th32ProcessID] = pe.th32ParentProcessID;
            } while (Process32Next(snap, ref pe));
        }
        CloseHandle(snap);

        bool added;
        do {
            added = false;
            foreach (var kvp in parentMap) {
                if (set.Contains(kvp.Value) && !set.Contains(kvp.Key)) {
                    set.Add(kvp.Key);
                    added = true;
                }
            }
        } while (added);
        return set;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
        public int Width => Right - Left;
        public int Height => Bottom - Top;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int x, y; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct WNDCLASSEX {
        public uint cbSize;
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    static IntPtr targetHwnd = IntPtr.Zero;
    static uint targetPid = 0;
    static IntPtr presenterHwnd = IntPtr.Zero;
    static WndProcDelegate? wndProcDelegate;
    static readonly List<string> logPaths = new();
    static readonly object logLock = new();

    static void InitLogging(string? customLogPath) {
        AttachConsole(-1);
        var candidates = new List<string>();

        if (!string.IsNullOrWhiteSpace(customLogPath)) {
            candidates.Add(customLogPath);
        }

        // Beside executable
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        candidates.Add(Path.Combine(baseDir, "uwp_presenter.log"));

        // Steam cartridges config dir (shared across dev and prod)
        try {
            string steamConfig = @"C:\game\steam\millennium\config\steam-cartridges";
            if (Directory.Exists(steamConfig)) {
                candidates.Add(Path.Combine(steamConfig, "uwp_presenter.log"));
            }
        } catch { }

        // LocalAppData
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string fallbackDir = Path.Combine(localAppData, "steam-cartridges-third-party");
        try { Directory.CreateDirectory(fallbackDir); } catch { }
        candidates.Add(Path.Combine(fallbackDir, "uwp_presenter.log"));

        foreach (var p in candidates) {
            try {
                string? dir = Path.GetDirectoryName(p);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) {
                    Directory.CreateDirectory(dir);
                }
                File.AppendAllText(p, $"--- SENSOR LOG SESSION START {DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} ---{Environment.NewLine}");
                if (!logPaths.Contains(p)) logPaths.Add(p);
            } catch { }
        }
    }

    static void Log(string sensor, string msg) {
        string timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
        string line = $"[{timestamp}] [{sensor}] {msg}";
        Console.WriteLine(line);
        Trace.WriteLine(line);
        lock (logLock) {
            foreach (var path in logPaths) {
                try {
                    File.AppendAllText(path, line + Environment.NewLine);
                } catch { }
            }
        }
    }

    static string GetProcessName(uint pid) {
        try {
            using var p = Process.GetProcessById((int)pid);
            return p.ProcessName;
        } catch {
            return "Unknown";
        }
    }

    static string SafeGetClassName(IntPtr hWnd) {
        var sb = new StringBuilder(256);
        GetClassName(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static string SafeGetWindowText(IntPtr hWnd) {
        var sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam) {
        const uint WM_DESTROY = 0x0002;
        const uint WM_KEYDOWN = 0x0100;
        const uint WM_KEYUP = 0x0101;
        const uint WM_CHAR = 0x0102;
        const uint WM_LBUTTONDOWN = 0x0201;
        const uint WM_LBUTTONUP = 0x0202;
        const uint WM_RBUTTONDOWN = 0x0204;
        const uint WM_RBUTTONUP = 0x0205;
        const uint WM_MOUSEMOVE = 0x0200;
        const uint WM_MOUSEWHEEL = 0x020A;
        const uint WM_SETFOCUS = 0x0007;

        switch (msg) {
            case WM_DESTROY:
                Log("SENSOR:LIFECYCLE", "Presenter WM_DESTROY received. Exiting message loop.");
                PostQuitMessage(0);
                return IntPtr.Zero;

            case WM_SETFOCUS:
                Log("SENSOR:INPUT", "Presenter received WM_SETFOCUS.");
                break;

            case WM_LBUTTONDOWN:
            case WM_LBUTTONUP:
            case WM_RBUTTONDOWN:
            case WM_RBUTTONUP:
            case WM_MOUSEMOVE:
            case WM_MOUSEWHEEL:
            case WM_KEYDOWN:
            case WM_KEYUP:
            case WM_CHAR:
                if (targetHwnd != IntPtr.Zero) {
                    PostMessage(targetHwnd, msg, wParam, lParam);
                }
                break;
        }
        return (IntPtr)DefWindowProc(hWnd, msg, wParam, lParam);
    }

    static string[] TokenizeCommandLine(string cmdLine) {
        var list = new List<string>();
        var sb = new StringBuilder();
        bool inQuote = false;
        for (int i = 0; i < cmdLine.Length; i++) {
            char c = cmdLine[i];
            if (c == '"') {
                inQuote = !inQuote;
            } else if (char.IsWhiteSpace(c) && !inQuote) {
                if (sb.Length > 0) {
                    list.Add(sb.ToString());
                    sb.Clear();
                }
            } else {
                sb.Append(c);
            }
        }
        if (sb.Length > 0) list.Add(sb.ToString());
        return list.ToArray();
    }

    static string Arg(string[] args, string name, string def = "") {
        for (int i = 0; i < args.Length; i++) {
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase)) {
                return i + 1 < args.Length ? args[i + 1] : def;
            }
            if (args[i].StartsWith(name + "=", StringComparison.OrdinalIgnoreCase)) {
                return args[i].Substring(name.Length + 1).Trim('"');
            }
        }
        return def;
    }

    [STAThread]
    static void Main(string[] args) {
        if (args.Length == 1 && args[0].Contains("--")) {
            args = TokenizeCommandLine(args[0]);
        }

        string customLog = Arg(args, "--log");
        InitLogging(customLog);

        Log("SENSOR:BOOT", $"UWP Overlay Presenter started. PID: {Environment.ProcessId}, Args: {string.Join(" ", args)}");
        Log("SENSOR:BOOT", $"OS: {Environment.OSVersion}, 64-bit OS: {Environment.Is64BitOperatingSystem}, 64-bit Process: {Environment.Is64BitProcess}");
        Log("SENSOR:BOOT", $"Active Log Destinations: {string.Join(", ", logPaths)}");

        string aumid = Arg(args, "--aumid");
        string exePath = Arg(args, "--exe");
        string pidStr = Arg(args, "--pid");
        string title = Arg(args, "--title", "Steam UWP Presenter");
        string timeoutStr = Arg(args, "--timeout");
        int timeoutSec = int.TryParse(timeoutStr, out int tSec) ? tSec : 0;

        if (timeoutSec > 0) {
            var earlyTimeoutThread = new Thread(() => {
                Thread.Sleep(timeoutSec * 1000);
                Log("SENSOR:LIFECYCLE", $"CLI timeout ({timeoutSec}s) elapsed. Closing presenter...");
                if (presenterHwnd != IntPtr.Zero) {
                    PostMessage(presenterHwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
                } else {
                    Environment.Exit(0);
                }
            }) { IsBackground = true };
            earlyTimeoutThread.Start();
        }

        // 1. Activation Phase
        if (!string.IsNullOrEmpty(aumid)) {
            Log("SENSOR:ACTIVATE", $"Requesting activation for AUMID: '{aumid}'");
            bool activated = false;
            try {
                var mgr = new ApplicationActivationManager() as IApplicationActivationManager;
                if (mgr != null) {
                    int hr = mgr.ActivateApplication(aumid, null, 0, out targetPid);
                    if (hr == 0 && targetPid > 0) {
                        Log("SENSOR:ACTIVATE", $"SUCCESS: IApplicationActivationManager activated AUMID '{aumid}' -> PID {targetPid} (hr=0x{hr:X8})");
                        activated = true;
                    } else {
                        Log("SENSOR:ACTIVATE", $"WARNING: IApplicationActivationManager returned hr=0x{hr:X8}, PID={targetPid}");
                    }
                } else {
                    Log("SENSOR:ACTIVATE", "WARNING: ApplicationActivationManager cast to IApplicationActivationManager returned null.");
                }
            } catch (Exception ex) {
                Log("SENSOR:ACTIVATE", $"COM Activation Exception: {ex.GetType().Name} - {ex.Message}");
            }

            if (!activated) {
                Log("SENSOR:ACTIVATE", $"Attempting Shell fallback activation via explorer.exe shell:AppsFolder\\{aumid}...");
                try {
                    var psi = new ProcessStartInfo("explorer.exe", $@"shell:AppsFolder\{aumid}") {
                        UseShellExecute = true
                    };
                    Process.Start(psi);
                    Log("SENSOR:ACTIVATE", "Shell fallback activation command dispatched.");
                } catch (Exception ex) {
                    Log("SENSOR:ACTIVATE", $"Shell fallback failed: {ex.Message}");
                }
            }
        } else if (!string.IsNullOrEmpty(exePath)) {
            try {
                var psi = new ProcessStartInfo(exePath) { UseShellExecute = true };
                var p = Process.Start(psi);
                if (p != null) {
                    targetPid = (uint)p.Id;
                    Log("SENSOR:ACTIVATE", $"Started executable: '{exePath}' -> PID {targetPid}");
                }
            } catch (Exception ex) {
                Log("SENSOR:ACTIVATE", $"Failed to start executable: {ex.Message}");
            }
        } else if (!string.IsNullOrEmpty(pidStr) && uint.TryParse(pidStr, out uint p)) {
            targetPid = p;
            Log("SENSOR:ACTIVATE", $"Using target PID from CLI: {targetPid}");
        }

        // 2. Window Discovery Phase
        Log("SENSOR:WINDOW_SCAN", $"Scanning for target window (Target PID: {targetPid}, Target Title: '{title}')...");
        
        IntPtr foundWindow = IntPtr.Zero;
        string foundReason = "";
        string foundClass = "";
        string foundTitle = "";
        uint foundPid = targetPid;
        RECT foundRect = new RECT { Left = 100, Top = 100, Right = 1380, Bottom = 820 };
        int scanIteration = 0;
        int maxIterations = 80; // 80 * 250ms = 20 seconds max

        while (foundWindow == IntPtr.Zero && scanIteration < maxIterations) {
            scanIteration++;
            var candidates = new List<(IntPtr hwnd, uint pid, string procName, string className, string winTitle, RECT rect, bool visible, bool iconic)>();

            EnumerateAllWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd) && !IsIconic(hWnd)) {
                    GetWindowThreadProcessId(hWnd, out uint wPid);
                    GetWindowRect(hWnd, out RECT rect);
                    if (rect.Width > 50 && rect.Height > 50) {
                        string cls = SafeGetClassName(hWnd);
                        string txt = SafeGetWindowText(hWnd);
                        string pName = GetProcessName(wPid);
                        candidates.Add((hWnd, wPid, pName, cls, txt, rect, true, false));
                    }
                }
                return true;
            });

            var processFamily = targetPid > 0 ? GetProcessFamily(targetPid) : new HashSet<uint>();

            if (scanIteration == 1 || scanIteration % 8 == 1) {
                Log("SENSOR:WINDOW_SCAN", $"Scan tick #{scanIteration}/{maxIterations}: Found {candidates.Count} visible candidate windows (ProcessFamily: [{string.Join(",", processFamily)}]).");
                if (scanIteration == 1) {
                    foreach (var c in candidates) {
                        Log("SENSOR:WINDOW_SCAN", $"  Candidate HWND=0x{c.hwnd.ToInt64():X8} | PID={c.pid} ({c.procName}) | Class='{c.className}' | Title='{c.winTitle}' | Rect=[{c.rect.Left},{c.rect.Top} {c.rect.Width}x{c.rect.Height}]");
                    }
                }
            }

            foreach (var c in candidates) {
                // Check A: Direct PID Match or Child/Descendant Process Match
                if (processFamily.Contains(c.pid)) {
                    foundWindow = c.hwnd;
                    foundReason = c.pid == targetPid
                        ? $"Direct PID match ({c.pid} == {targetPid})"
                        : $"ProcessFamily descendant match ({c.pid} ({c.procName}) child of {targetPid})";
                    foundClass = c.className;
                    foundTitle = c.winTitle;
                    foundPid = c.pid;
                    foundRect = c.rect;
                    break;
                }

                // Check B: ApplicationFrameWindow hosting target app
                if (c.className == "ApplicationFrameWindow" || c.procName.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) {
                    IntPtr childTargetHwnd = IntPtr.Zero;
                    uint matchedChildPid = 0;
                    EnumChildWindows(c.hwnd, (hChild, lParam) => {
                        GetWindowThreadProcessId(hChild, out uint childPid);
                        if (processFamily.Contains(childPid)) {
                            childTargetHwnd = hChild;
                            matchedChildPid = childPid;
                            return false;
                        }
                        string childTitle = SafeGetWindowText(hChild);
                        if (!string.IsNullOrEmpty(title) && childTitle.Contains(title, StringComparison.OrdinalIgnoreCase)) {
                            childTargetHwnd = hChild;
                            matchedChildPid = childPid;
                            return false;
                        }
                        return true;
                    }, IntPtr.Zero);

                    if (childTargetHwnd != IntPtr.Zero) {
                        foundWindow = c.hwnd; // Capture the top-level ApplicationFrameWindow
                        foundReason = $"ApplicationFrameWindow container child matched (Child HWND=0x{childTargetHwnd.ToInt64():X}, PID={matchedChildPid})";
                        foundClass = c.className;
                        foundTitle = c.winTitle;
                        foundPid = matchedChildPid > 0 ? matchedChildPid : c.pid;
                        foundRect = c.rect;
                        break;
                    }
                }

                // Check C: Title Match (if window is large enough and not presenter's own window)
                if (!string.IsNullOrEmpty(title) && c.winTitle.Contains(title, StringComparison.OrdinalIgnoreCase)) {
                    if (c.rect.Width >= 200 && c.rect.Height >= 200 && c.className != "SteamUWPPresenterClass") {
                        foundWindow = c.hwnd;
                        foundReason = $"Title match ('{c.winTitle}' contains '{title}')";
                        foundClass = c.className;
                        foundTitle = c.winTitle;
                        foundPid = c.pid;
                        foundRect = c.rect;
                        break;
                    }
                }
            }

            if (foundWindow != IntPtr.Zero) break;

            Thread.Sleep(250);
        }

        RECT targetRect = new RECT { Left = 100, Top = 100, Right = 1380, Bottom = 820 };
        uint finalTargetPid = targetPid;
        if (foundWindow != IntPtr.Zero) {
            targetHwnd = foundWindow;
            targetRect = foundRect;
            finalTargetPid = foundPid;
            Log("SENSOR:WINDOW_SCAN", $"TARGET WINDOW ACQUIRED: HWND=0x{targetHwnd.ToInt64():X8} | Title='{foundTitle}' | Class='{foundClass}' | PID={finalTargetPid} ({GetProcessName(finalTargetPid)}) | Rect=[{targetRect.Left},{targetRect.Top} {targetRect.Width}x{targetRect.Height}] | Reason: {foundReason}");
        } else {
            Log("SENSOR:WINDOW_SCAN", "WARNING: No target window handle resolved after scan. Window capture will fall back to Primary Monitor.");
        }

        // 3. Presenter Window Setup
        string className = "SteamUWPPresenterClass";
        IntPtr hInst = GetModuleHandle(null);
        wndProcDelegate = WndProc;
        var wc = new WNDCLASSEX {
            cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)),
            style = 0,
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(wndProcDelegate),
            hInstance = hInst,
            lpszClassName = className
        };
        RegisterClassEx(ref wc);

        int winWidth = Math.Max(targetRect.Width, 640);
        int winHeight = Math.Max(targetRect.Height, 480);

        presenterHwnd = CreateWindowEx(
            0,
            className,
            title,
            0x00CF0000 | 0x10000000, // WS_OVERLAPPEDWINDOW | WS_VISIBLE
            targetRect.Left, targetRect.Top, winWidth, winHeight,
            IntPtr.Zero, IntPtr.Zero, hInst, IntPtr.Zero);

        Log("SENSOR:D3D11", $"Presenter window created. HWND=0x{presenterHwnd.ToInt64():X8}, Initial Size: {winWidth}x{winHeight}");

        // 4. Direct3D 11 & DXGI SwapChain Setup
        D3D11.D3D11CreateDevice(
            null,
            Vortice.Direct3D.DriverType.Hardware,
            DeviceCreationFlags.BgraSupport,
            new[] { Vortice.Direct3D.FeatureLevel.Level_11_0 },
            out ID3D11Device? device,
            out ID3D11DeviceContext? context);

        using var dxgiDevice = device!.QueryInterface<IDXGIDevice>();
        using var dxgiAdapter = dxgiDevice.GetAdapter();
        using var dxgiFactory = dxgiAdapter.GetParent<IDXGIFactory2>();

        Log("SENSOR:D3D11", $"D3D11 Device initialized. FeatureLevel: {device.FeatureLevel}, Adapter: {dxgiAdapter.Description.Description}, Dedicated VRAM: {dxgiAdapter.Description.DedicatedVideoMemory / (1024 * 1024)} MB");

        var swapDesc = new SwapChainDescription1 {
            Width = (uint)winWidth,
            Height = (uint)winHeight,
            Format = Format.B8G8R8A8_UNorm,
            Stereo = false,
            SampleDescription = new SampleDescription(1, 0),
            BufferUsage = Usage.RenderTargetOutput,
            BufferCount = 2,
            Scaling = Scaling.Stretch,
            SwapEffect = SwapEffect.FlipDiscard,
            AlphaMode = AlphaMode.Ignore
        };

        var swapChain = dxgiFactory.CreateSwapChainForHwnd(device, presenterHwnd, swapDesc);
        Log("SENSOR:D3D11", $"DXGI SwapChain created: {swapDesc.Width}x{swapDesc.Height}, Format={swapDesc.Format}, Buffers=2, FlipDiscard");

        CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.NativePointer, out IntPtr winrtDevicePtr);
        var winrtDevice = MarshalInterface<IDirect3DDevice>.FromAbi(winrtDevicePtr);

        // 5. Windows.Graphics.Capture Session Setup
        string captureClassName = "Windows.Graphics.Capture.GraphicsCaptureItem";
        WindowsCreateString(captureClassName, captureClassName.Length, out IntPtr hstr);
        Guid interopGuid = new Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");
        RoGetActivationFactory(hstr, ref interopGuid, out IntPtr factoryPtr);
        WindowsDeleteString(hstr);
        var interop = (IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(factoryPtr);
        Guid itemGuid = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");

        IntPtr itemPtr = IntPtr.Zero;
        if (targetHwnd != IntPtr.Zero) {
            try {
                itemPtr = interop.CreateForWindow(targetHwnd, ref itemGuid);
                Log("SENSOR:CAPTURE", $"GraphicsCaptureItemInterop.CreateForWindow(0x{targetHwnd.ToInt64():X8}) -> Ptr=0x{itemPtr.ToInt64():X}");
            } catch (Exception ex) {
                Log("SENSOR:CAPTURE", $"CreateForWindow failed: {ex.Message}");
            }
        }

        if (itemPtr == IntPtr.Zero) {
            IntPtr mon = MonitorFromWindow(presenterHwnd, 1);
            itemPtr = interop.CreateForMonitor(mon, ref itemGuid);
            Log("SENSOR:CAPTURE", $"FALLBACK: GraphicsCaptureItemInterop.CreateForMonitor(0x{mon.ToInt64():X8}) -> Ptr=0x{itemPtr.ToInt64():X}");
        }

        var item = MarshalInterface<GraphicsCaptureItem>.FromAbi(itemPtr);
        Log("SENSOR:CAPTURE", $"Capturing Item: '{item.DisplayName}' ({item.Size.Width}x{item.Size.Height})");

        var framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
            winrtDevice,
            DirectXPixelFormat.B8G8R8A8UIntNormalized,
            2,
            item.Size);

        using var session = framePool.CreateCaptureSession(item);

        // Suppress yellow security border
        try {
            session.IsBorderRequired = false;
            Log("SENSOR:CAPTURE", "SUCCESS: session.IsBorderRequired = false applied (yellow border suppressed).");
        } catch (Exception ex) {
            Log("SENSOR:CAPTURE", $"NOTE: session.IsBorderRequired failed: {ex.Message}");
        }

        // Enable cursor capture
        try {
            session.IsCursorCaptureEnabled = true;
            Log("SENSOR:CAPTURE", "session.IsCursorCaptureEnabled = true applied.");
        } catch (Exception ex) {
            Log("SENSOR:CAPTURE", $"NOTE: session.IsCursorCaptureEnabled failed: {ex.Message}");
        }

        ID3D11Texture2D? backBuffer = swapChain.GetBuffer<ID3D11Texture2D>(0);
        int frameCounter = 0;
        int droppedFrames = 0;
        var sw = Stopwatch.StartNew();
        var fpsTimer = Stopwatch.StartNew();
        int fpsFrameCount = 0;
        bool firstFrameLogged = false;

        framePool.FrameArrived += (sender, e) => {
            using var frame = sender.TryGetNextFrame();
            if (frame != null) {
                var surface = frame.Surface;
                var access = surface.As<IDirect3DDxgiInterfaceAccess>();
                Guid textureGuid = new Guid("6f15aaf2-d208-4e89-9ab4-489535d34f9c");
                int hr = access.GetInterface(ref textureGuid, out IntPtr texturePtr);
                if (hr == 0 && texturePtr != IntPtr.Zero) {
                    using var srcTexture = new ID3D11Texture2D(texturePtr);
                    lock (context!) {
                        uint srcW = srcTexture.Description.Width;
                        uint srcH = srcTexture.Description.Height;

                        // Dynamic swapchain resize if surface dimensions differ
                        if (backBuffer == null || backBuffer.Description.Width != srcW || backBuffer.Description.Height != srcH) {
                            Log("SENSOR:STREAM", $"Surface dimension changed/detected ({srcW}x{srcH} vs backBuffer {backBuffer?.Description.Width ?? 0}x{backBuffer?.Description.Height ?? 0}). Resizing swapchain...");
                            backBuffer?.Dispose();
                            backBuffer = null;
                            swapChain.ResizeBuffers(2, (uint)srcW, (uint)srcH, Format.B8G8R8A8_UNorm, SwapChainFlags.None);
                            backBuffer = swapChain.GetBuffer<ID3D11Texture2D>(0);
                            Log("SENSOR:STREAM", $"Swapchain resized to {srcW}x{srcH} successfully.");
                        }

                        if (backBuffer != null) {
                            context.CopyResource(backBuffer, srcTexture);
                            swapChain.Present(1, PresentFlags.None);
                            frameCounter++;
                            fpsFrameCount++;

                            if (!firstFrameLogged) {
                                firstFrameLogged = true;
                                Log("SENSOR:STREAM", $"FIRST FRAME PRESENTED! Latency: {sw.ElapsedMilliseconds} ms, Surface: {srcW}x{srcH}");
                            }
                        } else {
                            droppedFrames++;
                        }
                    }
                }
            }

            // Periodic heartbeat sensor (every 1 second)
            if (fpsTimer.ElapsedMilliseconds >= 1000) {
                double fps = (fpsFrameCount * 1000.0) / fpsTimer.ElapsedMilliseconds;
                Log("SENSOR:STREAM", $"Stream Heartbeat: Uptime={sw.Elapsed.TotalSeconds:F1}s | FPS={fps:F1} | TotalPresented={frameCounter} | Dropped={droppedFrames} | TargetHwnd=0x{targetHwnd.ToInt64():X}");
                fpsTimer.Restart();
                fpsFrameCount = 0;
            }
        };

        session.StartCapture();
        Log("SENSOR:STREAM", "Presentation capture loop active.");

        // 6. Target Process Lifecycle Watcher
        if (finalTargetPid > 0) {
            var watchThread = new Thread(() => {
                try {
                    var proc = Process.GetProcessById((int)finalTargetPid);
                    Log("SENSOR:LIFECYCLE", $"Process watcher active for PID {finalTargetPid} ({proc.ProcessName}).");
                    proc.WaitForExit();
                    Log("SENSOR:LIFECYCLE", $"Target process PID {finalTargetPid} exited (ExitCode: {proc.ExitCode}). Closing presenter...");
                    PostMessage(presenterHwnd, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
                } catch (Exception ex) {
                    Log("SENSOR:LIFECYCLE", $"Process watcher notice: {ex.Message}");
                }
            }) { IsBackground = true };
            watchThread.Start();
        }

        ShowWindow(presenterHwnd, 1);
        UpdateWindow(presenterHwnd);

        // 7. Message Loop
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }

        // 8. Teardown
        Log("SENSOR:LIFECYCLE", "Shutting down presenter and cleaning up resources...");
        session.Dispose();
        framePool.Dispose();
        backBuffer?.Dispose();
        swapChain.Dispose();
        dxgiFactory.Dispose();
        dxgiAdapter.Dispose();
        dxgiDevice.Dispose();
        context?.Dispose();
        device?.Dispose();
        DestroyWindow(presenterHwnd);

        double totalSec = sw.Elapsed.TotalSeconds;
        double avgFps = totalSec > 0 ? (frameCounter / totalSec) : 0;
        Log("SENSOR:LIFECYCLE", $"Shutdown complete. Session Duration: {totalSec:F2}s, Total Frames: {frameCounter}, Average FPS: {avgFps:F1}");
    }
}
