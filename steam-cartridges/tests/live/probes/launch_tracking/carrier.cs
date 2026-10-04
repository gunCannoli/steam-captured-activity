// E6: the overlay carrier. Activates the game (as U1), then shows a full-screen, transparent (colour key), click-through,
// topmost, never-activated window that presents OpenGL frames, so Steam's overlay (injected into this Steam-started
// process) has a swap chain to draw on. Exits when the game is gone.
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class Carrier
{
    class W : Form
    {
        IntPtr dc, rc;
        public W()
        {
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
            StartPosition = FormStartPosition.Manual; Bounds = Screen.PrimaryScreen.Bounds;
            BackColor = Color.Black; TransparencyKey = Color.Black; Text = "LT carrier";
        }
        protected override CreateParams CreateParams
        {
            get { var c = base.CreateParams; c.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x08000000; return c; } // LAYERED|TRANSPARENT|TOOLWINDOW|NOACTIVATE
        }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            dc = GetDC(Handle);
            var pfd = new PFD { nSize = (short)Marshal.SizeOf(typeof(PFD)), nVersion = 1, dwFlags = 0x4 | 0x20 | 0x1, iPixelType = 0, cColorBits = 32, cAlphaBits = 8, cDepthBits = 24, iLayerType = 0 };
            int pf = ChoosePixelFormat(dc, ref pfd);
            SetPixelFormat(dc, pf, ref pfd);
            rc = wglCreateContext(dc); wglMakeCurrent(dc, rc);
            Log("carrier window " + Handle + " pixelformat=" + pf + " glctx=" + rc);
        }
        public void Frame() { glClearColor(0, 0, 0, 0); glClear(0x4000); SwapBuffers(dc); }
        protected override void OnPaintBackground(PaintEventArgs e) { }
        protected override void OnPaint(PaintEventArgs e) { }
    }

    static Action<string> Log;

    public static int Run(string[] a, Action<string> log, P.ActivateFn activate, Func<int, string, bool> alive)
    {
        Log = log;
        string aumid = Arg(a, "--aumid"), root = (Arg(a, "--root") ?? "").TrimEnd('\\');
        int hr; uint pid = activate(aumid, out hr);
        Log("carrier: ActivateApplication hr=0x" + hr.ToString("X8") + " pid=" + pid);
        var w = new W();
        int frames = 0; DateTime goneSince = DateTime.MinValue;
        var t = new Timer { Interval = 33 };
        t.Tick += (s, e) =>
        {
            w.Frame(); frames++;
            if (frames % 30 == 0)
            {
                if (alive((int)pid, root)) goneSince = DateTime.MinValue;
                else if (goneSince == DateTime.MinValue) goneSince = DateTime.Now;
                else if ((DateTime.Now - goneSince).TotalSeconds > 3) { Log("carrier: game gone after " + frames + " frames"); t.Stop(); w.Close(); }
            }
        };
        w.Shown += (s, e) => t.Start();
        Application.Run(w);
        return 0;
    }

    static string Arg(string[] a, string name) { int i = Array.IndexOf(a, name); return i >= 0 && i + 1 < a.Length ? a[i + 1] : null; }

    [StructLayout(LayoutKind.Sequential)]
    struct PFD { public short nSize, nVersion; public int dwFlags; public byte iPixelType, cColorBits, cRedBits, cRedShift, cGreenBits, cGreenShift, cBlueBits, cBlueShift, cAlphaBits, cAlphaShift, cAccumBits, cAccumRedBits, cAccumGreenBits, cAccumBlueBits, cAccumAlphaBits, cDepthBits, cStencilBits, cAuxBuffers, iLayerType, bReserved; public int dwLayerMask, dwVisibleMask, dwDamageMask; }
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("gdi32.dll")] static extern int ChoosePixelFormat(IntPtr dc, ref PFD p);
    [DllImport("gdi32.dll")] static extern bool SetPixelFormat(IntPtr dc, int f, ref PFD p);
    [DllImport("gdi32.dll")] static extern bool SwapBuffers(IntPtr dc);
    [DllImport("opengl32.dll")] static extern IntPtr wglCreateContext(IntPtr dc);
    [DllImport("opengl32.dll")] static extern bool wglMakeCurrent(IntPtr dc, IntPtr rc);
    [DllImport("opengl32.dll")] static extern void glClearColor(float r, float g, float b, float a);
    [DllImport("opengl32.dll")] static extern void glClear(uint mask);
}
