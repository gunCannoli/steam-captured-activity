using System;
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
    int ActivateApplication([In] string appUserModelId, [In] string? arguments, [In] uint options, out uint processId);
    int ActivateForFile([In] string appUserModelId, [In] IntPtr itemArray, [In] string? verb, out uint processId);
    int ActivateForProtocol([In] string appUserModelId, [In] IntPtr itemArray, out uint processId);
}

[ComImport]
[Guid("45BA127D-10A8-46EA-8AB7-5651ABF60231")]
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

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("kernel32.dll")]
    static extern bool AttachConsole(int dwProcessId);

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
    static string logFile = "";

    static void Log(string msg) {
        string line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {msg}";
        Console.WriteLine(line);
        if (!string.IsNullOrEmpty(logFile)) {
            try { File.AppendAllText(logFile, line + Environment.NewLine); } catch { }
        }
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

        switch (msg) {
            case WM_DESTROY:
                PostQuitMessage(0);
                return IntPtr.Zero;
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

    static string Arg(string[] args, string name, string def = "") {
        int idx = Array.IndexOf(args, name);
        return idx >= 0 && idx + 1 < args.Length ? args[idx + 1] : def;
    }

    [STAThread]
    static void Main(string[] args) {
        AttachConsole(-1);
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        logFile = Path.Combine(baseDir, "uwp_presenter.log");
        try {
            if (!File.Exists(logFile)) File.WriteAllText(logFile, "");
        } catch {
            string localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? @"C:\temp";
            string logDir = Path.Combine(localAppData, "steam-cartridges-third-party");
            try { Directory.CreateDirectory(logDir); } catch { }
            logFile = Path.Combine(logDir, "uwp_presenter.log");
        }

        Log("UWP Overlay Presenter starting. Command line: " + string.Join(" ", args));

        string aumid = Arg(args, "--aumid");
        string exePath = Arg(args, "--exe");
        string pidStr = Arg(args, "--pid");
        string title = Arg(args, "--title", "Steam UWP Presenter");
        string timeoutStr = Arg(args, "--timeout");
        int timeoutSec = int.TryParse(timeoutStr, out int tSec) ? tSec : 0;

        if (!string.IsNullOrEmpty(aumid)) {
            try {
                var mgr = new ApplicationActivationManager() as IApplicationActivationManager;
                int hr = mgr!.ActivateApplication(aumid, null, 0, out targetPid);
                Log($"Activated AUMID: '{aumid}' -> PID {targetPid} (hr=0x{hr:X})");
            } catch (Exception ex) {
                Log("Failed to activate AUMID: " + ex.Message);
            }
        } else if (!string.IsNullOrEmpty(exePath)) {
            try {
                var psi = new ProcessStartInfo(exePath) { UseShellExecute = true };
                var p = Process.Start(psi);
                if (p != null) {
                    targetPid = (uint)p.Id;
                    Log($"Started executable: '{exePath}' -> PID {targetPid}");
                }
            } catch (Exception ex) {
                Log("Failed to start executable: " + ex.Message);
            }
        } else if (!string.IsNullOrEmpty(pidStr) && uint.TryParse(pidStr, out uint p)) {
            targetPid = p;
        }

        // Wait for target window
        if (targetPid > 0) {
            Log($"Searching for target window for PID {targetPid}...");
            for (int i = 0; i < 35 && targetHwnd == IntPtr.Zero; i++) {
                EnumWindows((hWnd, lParam) => {
                    if (IsWindowVisible(hWnd)) {
                        GetWindowThreadProcessId(hWnd, out uint wPid);
                        if (wPid == targetPid) {
                            targetHwnd = hWnd;
                            return false;
                        }
                    }
                    return true;
                }, IntPtr.Zero);
                if (targetHwnd == IntPtr.Zero) Thread.Sleep(200);
            }
        }

        RECT targetRect = new RECT { Left = 100, Top = 100, Right = 1380, Bottom = 820 };
        if (targetHwnd != IntPtr.Zero) {
            GetWindowRect(targetHwnd, out targetRect);
            Log($"Target window found: 0x{targetHwnd.ToInt64():X} ({targetRect.Width}x{targetRect.Height})");
        } else {
            Log($"No specific target window; using default {targetRect.Width}x{targetRect.Height}");
        }

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

        Log($"Presenter HWND created: 0x{presenterHwnd.ToInt64():X}");

        // Direct3D 11 & SwapChain setup
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
        Log("DXGI SwapChain created successfully.");

        CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.NativePointer, out IntPtr winrtDevicePtr);
        var winrtDevice = MarshalInterface<IDirect3DDevice>.FromAbi(winrtDevicePtr);

        string captureClassName = "Windows.Graphics.Capture.GraphicsCaptureItem";
        WindowsCreateString(captureClassName, captureClassName.Length, out IntPtr hstr);
        Guid interopGuid = new Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");
        RoGetActivationFactory(hstr, ref interopGuid, out IntPtr factoryPtr);
        WindowsDeleteString(hstr);
        var interop = (IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(factoryPtr);
        Guid itemGuid = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");

        IntPtr itemPtr = IntPtr.Zero;
        if (targetHwnd != IntPtr.Zero) {
            itemPtr = interop.CreateForWindow(targetHwnd, ref itemGuid);
        }
        if (itemPtr == IntPtr.Zero) {
            IntPtr mon = MonitorFromWindow(presenterHwnd, 1);
            itemPtr = interop.CreateForMonitor(mon, ref itemGuid);
        }

        var item = MarshalInterface<GraphicsCaptureItem>.FromAbi(itemPtr);
        Log($"Capturing Item: '{item.DisplayName}' ({item.Size.Width}x{item.Size.Height})");

        var framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
            winrtDevice,
            DirectXPixelFormat.B8G8R8A8UIntNormalized,
            2,
            item.Size);

        using var session = framePool.CreateCaptureSession(item);
        try {
            session.IsCursorCaptureEnabled = true;
        } catch { }

        ID3D11Texture2D? backBuffer = swapChain.GetBuffer<ID3D11Texture2D>(0);
        int frameCounter = 0;

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
                        if (backBuffer != null &&
                            backBuffer.Description.Width == srcTexture.Description.Width &&
                            backBuffer.Description.Height == srcTexture.Description.Height) {
                            context.CopyResource(backBuffer, srcTexture);
                        }
                        swapChain.Present(1, PresentFlags.None);
                        frameCounter++;
                    }
                }
            }
        };

        session.StartCapture();
        Log("Presentation loop started.");

        // Target Process Watcher
        if (targetPid > 0) {
            var watchThread = new Thread(() => {
                try {
                    var proc = Process.GetProcessById((int)targetPid);
                    proc.WaitForExit();
                    Log($"Target process {targetPid} exited. Closing presenter window.");
                    PostMessage(presenterHwnd, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
                } catch { }
            }) { IsBackground = true };
            watchThread.Start();
        }

        if (timeoutSec > 0) {
            var timeoutThread = new Thread(() => {
                Thread.Sleep(timeoutSec * 1000);
                Log($"Timeout of {timeoutSec}s elapsed. Closing presenter.");
                PostMessage(presenterHwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
            }) { IsBackground = true };
            timeoutThread.Start();
        }

        ShowWindow(presenterHwnd, 1);
        UpdateWindow(presenterHwnd);

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }

        Log("Shutting down presenter...");
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
        Log($"Shutdown complete. Presented {frameCounter} frames.");
    }
}
