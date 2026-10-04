// Launch-tracking probe (investigation only, docs/plans/steam-cartridges-store-launch-tracking-plan.md § 6-7). Not product code.
// Build (PowerShell; Git Bash mangles the /switches), in this folder:
//   & C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /r:System.Management.dll `
//     /r:System.Windows.Forms.dll /r:System.Drawing.dll /out:ltprobe.exe ltprobe.cs carrier.cs
// Modes: e0 (who Steam tracks), reap (option R, run outside Steam), epic (option W), uwp (U1), pkg (U2), carrier (C), pkgof, ps.
// Runs: take the Steam lock (AGENTS.md Routine 0); `node lt.mjs add "LT-<name>" <exe> <startDir> <options>` makes a throwaway
// shortcut (lt.mjs refuses to edit or remove one not named LT-), then e1.ps1 (R), e2.ps1 (W), e3.ps1 (U1/U0), e4.ps1 / e4b.ps1 (U2),
// e5.ps1 (G), e6.ps1 / e6c.ps1 (C and its control); e7_matching.lua is offline. Remove the LT- shortcuts and release the lock after.
// Every line goes to ltprobe.log next to the exe. Command lines of other processes are never logged
// (an Epic game's carries a live exchange code); only image paths, pids and times.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class P
{
    static string Self = Process.GetCurrentProcess().MainModule.FileName;
    static string LogPath = Path.Combine(Path.GetDirectoryName(Self), "ltprobe.log");
    static string Tag = "";

    static void Log(string msg)
    {
        string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " [" + Process.GetCurrentProcess().Id + " " + Tag + "] " + msg;
        for (int i = 0; i < 5; i++)
        {
            try { File.AppendAllText(LogPath, line + Environment.NewLine); return; } catch { Thread.Sleep(20); }
        }
    }

    static string Arg(string[] a, string name, string def = null)
    {
        int i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length ? a[i + 1] : def;
    }

    static int Main(string[] a)
    {
        string mode = a.Length > 0 ? a[0] : "sleep";
        Tag = mode + (a.Length > 2 && mode == "sleep" ? ":" + a[2] : "");
        if (Arg(a, "--manifests") != null) ManifestsDir = Arg(a, "--manifests");
        try
        {
            Log("start mode=" + mode + " ppid=" + ParentPid(Process.GetCurrentProcess().Id) + " inJob=" + InJob());
            switch (mode)
            {
                case "sleep": Thread.Sleep(1000 * (a.Length > 1 ? int.Parse(a[1]) : 120)); Log("exit"); return 0;
                case "e0": return E0(a);
                case "reap": return Reap(a);
                case "epic": return Epic(a);
                case "uwp": return Uwp(a);
                case "pkg": return Pkg(a);
                case "carrier": return Carrier.Run(a, Log, Activate, WaitGoneQuiet);
                case "pkgof":Log("pid " + a[1] + " package=" + PackageOf(int.Parse(a[1])) + " ppid=" + ParentPid(int.Parse(a[1]))); return 0;
                case "ps":foreach (var p in Procs()) Log(p.Pid + " ppid=" + p.Ppid + " " + p.Name + " " + p.Path); return 0;
                default: Log("unknown mode"); return 64;
            }
        }
        catch (Exception e) { Log("EXC " + e); return 99; }
    }

    // ---------- E0: which processes does Steam track? ----------
    static int E0(string[] a)
    {
        string q = "\"" + Self + "\"";
        Log("child pid=" + Spawn(q + " sleep 150 e0-child", 0));
        Log("breakaway pid=" + Spawn(q + " sleep 150 e0-breakaway", CREATE_BREAKAWAY_FROM_JOB));
        try
        {
            var psi = new ProcessStartInfo(Self, "sleep 150 e0-shellexec") { UseShellExecute = true };
            Log("shellexec pid=" + Process.Start(psi).Id);
        }
        catch (Exception e) { Log("shellexec failed " + e.Message); }
        try
        {
            // Explorer opens the exe with no arguments (mode "sleep" with the tag "noargs").
            Process.Start(new ProcessStartInfo("explorer.exe", q) { UseShellExecute = false });
            Log("explorer asked");
        }
        catch (Exception e) { Log("explorer failed " + e.Message); }
        try
        {
            using (var cls = new System.Management.ManagementClass("Win32_Process"))
            {
                var inp = cls.GetMethodParameters("Create");
                inp["CommandLine"] = q + " sleep 150 e0-wmi";
                var outp = cls.InvokeMethod("Create", inp, null);
                Log("wmi rc=" + outp["ReturnValue"] + " pid=" + outp["ProcessId"]);
            }
        }
        catch (Exception e) { Log("wmi failed " + e.Message); }
        Log("orphan-via-cmd pid(cmd)=" + Spawn("cmd.exe /c start \"\" " + q + " sleep 150 e0-orphan", CREATE_NO_WINDOW));
        int hold = int.Parse(Arg(a, "--hold", "60"));
        Thread.Sleep(hold * 1000);
        Log("e0 parent exits after " + hold + " s");
        return 0;
    }

    // ---------- R: the reaper, run outside Steam's tree ----------
    static int Reap(string[] a)
    {
        string root = Norm(Arg(a, "--root"));
        string app = Arg(a, "--app");
        long since = long.Parse(Arg(a, "--since", "0")); // unix ms; only launchers started at or after it are ended
        int grace = int.Parse(Arg(a, "--grace", "30"));
        bool dry = a.Contains("--dry");
        Log("reap root=" + root + " app=" + app + " since=" + since + " grace=" + grace + " dry=" + dry);
        int timeout = int.Parse(Arg(a, "--timeout", "600"));
        var sw = Stopwatch.StartNew();
        bool seen = false;
        DateTime lastSeen = DateTime.MinValue;
        while (true)
        {
            var game = Procs().Where(p => Under(p.Path, root)).ToList();
            if (game.Count > 0)
            {
                if (!seen) Log("game seen: " + string.Join(", ", game.Select(p => p.Name + "#" + p.Pid)));
                seen = true; lastSeen = DateTime.Now;
            }
            else if (seen && (DateTime.Now - lastSeen).TotalSeconds >= 5) break;
            else if (!seen && sw.Elapsed.TotalSeconds > timeout) { Log("no game within " + timeout + " s: nothing done"); return 2; }
            Thread.Sleep(3000);
        }
        Log("game gone (last seen " + lastSeen.ToString("HH:mm:ss.fff") + ")");
        return EndLauncher(app, lastSeen, grace, since, dry);
    }

    static int EndLauncher(string app, DateTime gameGone, int grace, long since, bool dry)
    {
        var sync = WaitCloudSync(app, gameGone, grace);
        Log(sync != null ? "cloud sync line seen: " + sync : "no cloud sync line within " + grace + " s");
        string why = PendingDownload();
        if (why != null) { Log("REFUSE: download or install pending (" + why + "): launcher left running"); return 3; }
        var launchers = Procs().Where(p => p.Name.Equals("EpicGamesLauncher.exe", StringComparison.OrdinalIgnoreCase)).ToList();
        var mine = launchers.Where(p => p.StartMs >= since).ToList();
        foreach (var p in launchers.Except(mine)) Log("leave launcher #" + p.Pid + " (started before the launch)");
        if (mine.Count == 0) { Log("no launcher to end"); return 0; }
        foreach (var p in mine)
        {
            Log((dry ? "DRY would end " : "end ") + "launcher tree #" + p.Pid);
            if (!dry) Run("taskkill.exe", "/T /F /PID " + p.Pid);
        }
        Log("launcher ended");
        return 0;
    }

    static string WaitCloudSync(string app, DateTime after, int grace)
    {
        string log = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA"), @"EpicGamesLauncher\Saved\Logs\EpicGamesLauncher.log");
        var until = DateTime.Now.AddSeconds(grace);
        DateTime afterUtc = after.ToUniversalTime().AddSeconds(-3);
        var rx = new Regex(@"^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\].*Cloud Sync: Upload Complete \S*" + Regex.Escape(app ?? "") + @"\b");
        while (DateTime.Now < until)
        {
            try
            {
                using (var fs = new FileStream(log, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var sr = new StreamReader(fs))
                {
                    if (fs.Length > 400000) fs.Seek(-400000, SeekOrigin.End);
                    string l;
                    while ((l = sr.ReadLine()) != null)
                    {
                        var m = rx.Match(l);
                        if (!m.Success) continue;
                        var t = new DateTime(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value),
                            int.Parse(m.Groups[4].Value), int.Parse(m.Groups[5].Value), int.Parse(m.Groups[6].Value), int.Parse(m.Groups[7].Value), DateTimeKind.Utc);
                        if (t >= afterUtc) return t.ToLocalTime().ToString("HH:mm:ss.fff");
                    }
                }
            }
            catch (Exception e) { Log("launcher log read: " + e.Message); }
            Thread.Sleep(1000);
        }
        return null;
    }

    static string ManifestsDir = @"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests";
    static string PendingDownload()
    {
        string dir = ManifestsDir;
        try
        {
            string pend = Path.Combine(dir, "Pending");
            if (Directory.Exists(pend) && Directory.EnumerateFileSystemEntries(pend).Any()) return "Manifests\\Pending not empty";
            foreach (var f in Directory.GetFiles(dir, "*.item"))
                if (Regex.IsMatch(File.ReadAllText(f), "\"bIsIncompleteInstall\"\\s*:\\s*true")) return Path.GetFileName(f) + " incomplete";
        }
        catch (Exception e) { return "cannot read manifests: " + e.Message; }
        return null;
    }

    // ---------- W: Epic wrapper ----------
    static int Epic(string[] a)
    {
        string link = Arg(a, "--link"), root = Norm(Arg(a, "--root")), app = Arg(a, "--app");
        int grace = int.Parse(Arg(a, "--grace", "30")), timeout = int.Parse(Arg(a, "--timeout", "180"));
        long since = NowMs();
        var running = Procs().Where(p => p.Name.Equals("EpicGamesLauncher.exe", StringComparison.OrdinalIgnoreCase)).ToList();
        if (running.Count > 0)
        {
            string why = PendingDownload();
            if (why != null) Log("launcher running and " + why + ": NOT closed (the game will start outside Steam's tree)");
            else
            {
                foreach (var p in running) { Log("close running launcher tree #" + p.Pid); Run("taskkill.exe", "/T /F /PID " + p.Pid); }
                for (int i = 0; i < 40 && Procs().Any(p => p.Name.Equals("EpicGamesLauncher.exe", StringComparison.OrdinalIgnoreCase)); i++) Thread.Sleep(250);
                Log("launcher gone");
            }
        }
        string exe = LauncherExe();
        Log("start launcher " + exe + " with the link");
        var lp = Process.Start(new ProcessStartInfo(exe, link) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) });
        Log("launcher child pid=" + lp.Id);
        var sw = Stopwatch.StartNew();
        bool seen = false; DateTime lastSeen = DateTime.MinValue;
        while (true)
        {
            var game = Procs().Where(p => Under(p.Path, root)).ToList();
            if (game.Count > 0)
            {
                if (!seen) Log("game seen after " + sw.Elapsed.TotalSeconds.ToString("0.0") + " s: " + string.Join(", ", game.Select(p => p.Name + "#" + p.Pid + " ppid=" + p.Ppid)));
                seen = true; lastSeen = DateTime.Now;
            }
            else if (seen && (DateTime.Now - lastSeen).TotalSeconds >= 5) break;
            else if (!seen && sw.Elapsed.TotalSeconds > timeout) { Log("game did not start within " + timeout + " s: launcher left alone, exit 2"); return 2; }
            Thread.Sleep(1000);
        }
        Log("game gone (last seen " + lastSeen.ToString("HH:mm:ss.fff") + ")");
        int rc = EndLauncher(app, lastSeen, grace, since, false);
        Log("wrapper exits rc=" + rc);
        return rc;
    }

    static string LauncherExe()
    {
        using (var k = Microsoft.Win32.Registry.ClassesRoot.OpenSubKey(@"com.epicgames.launcher\shell\open\command"))
        {
            string cmd = (string)k.GetValue("");
            var m = Regex.Match(cmd, "^\\s*\"([^\"]+)\"");
            return m.Success ? m.Groups[1].Value : cmd.Split(' ')[0];
        }
    }

    // ---------- U1: UWP activation ----------
    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IApplicationActivationManager
    {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string aumid, [MarshalAs(UnmanagedType.LPWStr)] string args, int options, out uint pid);
        [PreserveSig] int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string aumid, IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint pid);
        [PreserveSig] int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string aumid, IntPtr items, out uint pid);
    }
    [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] class ApplicationActivationManager { }

    public static uint Activate(string aumid, out int hr)
    {
        var m = (IApplicationActivationManager)new ApplicationActivationManager();
        uint pid;
        hr = m.ActivateApplication(aumid, null, 0, out pid);
        return pid;
    }

    static int Uwp(string[] a)
    {
        string aumid = Arg(a, "--aumid"), root = Norm(Arg(a, "--root", ""));
        int hr; uint pid = Activate(aumid, out hr);
        Log("ActivateApplication hr=0x" + hr.ToString("X8") + " pid=" + pid + " ppid(of game)=" + ParentPid((int)pid));
        if (hr != 0) return 1;
        WaitGone((int)pid, root);
        Log("game gone: wrapper exits");
        return 0;
    }

    static void WaitGone(int pid, string root)
    {
        while (true)
        {
            bool alive = Procs().Any(p => p.Pid == pid || (root != "" && Under(p.Path, root)));
            if (!alive) { Thread.Sleep(2000); if (!Procs().Any(p => p.Pid == pid || (root != "" && Under(p.Path, root)))) return; }
            Thread.Sleep(1000);
        }
    }

    public delegate uint ActivateFn(string aumid, out int hr);
    static bool WaitGoneQuiet(int pid, string root)
    {
        return Procs().Any(p => p.Pid == pid || (root != "" && Under(p.Path, root)));
    }

    // ---------- U2: a packaged exe as our own child ----------
    static int Pkg(string[] a)
    {
        string full = Arg(a, "--full"), exe = Arg(a, "--exe"), args = Arg(a, "--args", ""), ac = Arg(a, "--appcontainer"), act = Arg(a, "--activate");
        int hold = int.Parse(Arg(a, "--hold", "60"));
        var attrs = new List<KeyValuePair<IntPtr, byte[]>>();
        var pins = new List<GCHandle>();
        IntPtr list = IntPtr.Zero; IntPtr size = IntPtr.Zero;
        int count = (full != null ? 1 : 0) + (ac != null ? 1 : 0);
        InitializeProcThreadAttributeList(IntPtr.Zero, count, 0, ref size);
        list = Marshal.AllocHGlobal(size);
        if (!InitializeProcThreadAttributeList(list, count, 0, ref size)) { Log("InitializeProcThreadAttributeList err=" + Marshal.GetLastWin32Error()); return 1; }
        IntPtr fullPtr = IntPtr.Zero, capsPtr = IntPtr.Zero, sid = IntPtr.Zero;
        if (full != null)
        {
            fullPtr = Marshal.StringToHGlobalUni(full);
            if (!UpdateProcThreadAttribute(list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_PACKAGE_FULL_NAME, fullPtr, (IntPtr)((full.Length + 1) * 2), IntPtr.Zero, IntPtr.Zero))
                Log("Update(PACKAGE_FULL_NAME) err=" + Marshal.GetLastWin32Error());
        }
        if (ac != null)
        {
            int hr = DeriveAppContainerSidFromAppContainerName(ac, out sid);
            Log("DeriveAppContainerSid hr=0x" + hr.ToString("X8"));
            var caps = new SECURITY_CAPABILITIES { AppContainerSid = sid, Capabilities = IntPtr.Zero, CapabilityCount = 0, Reserved = 0 };
            capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(caps));
            Marshal.StructureToPtr(caps, capsPtr, false);
            if (!UpdateProcThreadAttribute(list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, capsPtr, (IntPtr)Marshal.SizeOf(caps), IntPtr.Zero, IntPtr.Zero))
                Log("Update(SECURITY_CAPABILITIES) err=" + Marshal.GetLastWin32Error());
        }
        var si = new STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(si); si.lpAttributeList = list;
        PROCESS_INFORMATION pi;
        string cmd = "\"" + exe + "\"" + (args != "" ? " " + args : "");
        bool ok = CreateProcessW(null, new StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, Path.GetDirectoryName(exe), ref si, out pi);
        int err = ok ? 0 : Marshal.GetLastWin32Error();
        Log("CreateProcess(" + Path.GetFileName(exe) + ", full=" + (full != null) + ", appcontainer=" + (ac != null) + ") ok=" + ok + " err=" + err + (ok ? " child pid=" + pi.dwProcessId : ""));
        if (ok)
        {
            Thread.Sleep(3000);
            var c = Procs().FirstOrDefault(p => p.Pid == pi.dwProcessId);
            Log("child after 3 s: " + (c != null ? "alive " + c.Name + " ppid=" + c.Ppid + " pkg=" + PackageOf(pi.dwProcessId) : "gone, exit code=" + ExitCode(pi.hProcess)));
            if (act != null)
            {
                int hr; uint apid = Activate(act, out hr);
                Log("then ActivateApplication hr=0x" + hr.ToString("X8") + " pid=" + apid + (apid == pi.dwProcessId ? " (= our child)" : " (another process, ppid=" + ParentPid((int)apid) + ")"));
            }
            Thread.Sleep(hold * 1000);
            Log("pkg wrapper exits; child " + (Procs().Any(p => p.Pid == pi.dwProcessId) ? "still alive" : "gone"));
        }
        return ok ? 0 : 1;
    }

    // ---------- helpers ----------
    class Proc { public int Pid, Ppid; public string Name, Path; public long StartMs; }

    static List<Proc> Procs()
    {
        var res = new List<Proc>();
        IntPtr snap = CreateToolhelp32Snapshot(2, 0);
        var e = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W)) };
        if (Process32FirstW(snap, ref e))
        {
            do
            {
                var p = new Proc { Pid = (int)e.th32ProcessID, Ppid = (int)e.th32ParentProcessID, Name = e.szExeFile, Path = "" };
                IntPtr h = OpenProcess(0x1000, false, e.th32ProcessID);
                if (h != IntPtr.Zero)
                {
                    var sb = new StringBuilder(1024); int n = sb.Capacity;
                    if (QueryFullProcessImageNameW(h, 0, sb, ref n)) p.Path = sb.ToString();
                    long c, x, k, u;
                    if (GetProcessTimes(h, out c, out x, out k, out u)) p.StartMs = (c - 116444736000000000L) / 10000;
                    CloseHandle(h);
                }
                res.Add(p);
            } while (Process32NextW(snap, ref e));
        }
        CloseHandle(snap);
        return res;
    }

    static string Norm(string p) { return p == null ? null : p.TrimEnd('\\', '/').Replace('/', '\\'); }
    static bool Under(string path, string root) { return root != null && root != "" && path != null && path.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase); }
    static long NowMs() { return (DateTime.UtcNow.Ticks - 621355968000000000L) / 10000; }
    static int ParentPid(int pid) { var p = Procs().FirstOrDefault(x => x.Pid == pid); return p != null ? p.Ppid : -1; }

    static string InJob()
    {
        bool r; IsProcessInJob(Process.GetCurrentProcess().Handle, IntPtr.Zero, out r);
        return r.ToString();
    }

    static string PackageOf(int pid)
    {
        IntPtr h = OpenProcess(0x1000, false, (uint)pid);
        if (h == IntPtr.Zero) return "?";
        int len = 0; GetPackageFullName(h, ref len, null);
        var sb = new StringBuilder(len + 1);
        int rc = GetPackageFullName(h, ref len, sb);
        CloseHandle(h);
        return rc == 0 ? sb.ToString() : "none(" + rc + ")";
    }

    static string ExitCode(IntPtr h) { uint c; return GetExitCodeProcess(h, out c) ? "0x" + c.ToString("X") : "?"; }

    static int Spawn(string cmd, uint flags)
    {
        var si = new STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        PROCESS_INFORMATION pi;
        if (!CreateProcessW(null, new StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, null, ref si, out pi))
        { Log("CreateProcess failed err=" + Marshal.GetLastWin32Error() + " for flags 0x" + flags.ToString("X")); return -1; }
        return (int)pi.dwProcessId;
    }

    static void Run(string exe, string args)
    {
        var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true });
        string o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd(); p.WaitForExit();
        Log(Path.GetFileName(exe) + " rc=" + p.ExitCode + " " + Regex.Replace(o, @"\s+", " ").Trim());
    }

    const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000, CREATE_NO_WINDOW = 0x08000000, EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const int PROC_THREAD_ATTRIBUTE_PACKAGE_FULL_NAME = 0x00020008, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32W { public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile; }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr val, IntPtr size, IntPtr prev, IntPtr retSize);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32W e);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32W e);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr h, int flags, StringBuilder sb, ref int size);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long c, out long x, out long k, out long u);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool result);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetPackageFullName(IntPtr h, ref int len, StringBuilder sb);
}
