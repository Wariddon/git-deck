using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Git Deck")]
[assembly: System.Reflection.AssemblyProduct("Git Deck — Local Repository Manager")]
[assembly: System.Reflection.AssemblyCompany("Wariddon Rattanamalee")]
[assembly: System.Reflection.AssemblyCopyright("Created by Wariddon Rattanamalee with OpenAI Codex")]
[assembly: System.Reflection.AssemblyDescription("A compact local Git desktop workspace for Windows")]
[assembly: System.Reflection.AssemblyVersion("1.7.1.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.7.1.0")]

internal static class GitDeckLauncher
{
    private const string AppUrl = "http://127.0.0.1:8765/";

    [STAThread]
    private static void Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string server = Path.Combine(root, "git-dashboard-server.ps1");
        if (!File.Exists(server))
        {
            MessageBox.Show("git-dashboard-server.ps1 was not found\n\nPlace GitDeck.exe in the same folder as the scripts and web directory", "Git Deck", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // The frameless window is open (perhaps hidden in the tray): hand it the request and leave.
        IntPtr hosted = FindHostedWindow();
        if (hosted != IntPtr.Zero)
        {
            string folder = FolderArgument(args), action = ActionArgument(args);
            SendCommand(hosted, folder != null ? "open:" + folder : action != null ? "do:" + action : "show");
            return;
        }
        // Already open: bring that window back without a splash.
        if (FolderArgument(args) == null && IsReady())
        {
            IntPtr open = FindAppWindow();
            if (open != IntPtr.Zero) { FocusWindow(open); return; }
        }

        // Like Sourcetree: a small brand card shows at once and stays until the app window appears.
        SetProcessDPIAware();
        Application.EnableVisualStyles();
        string error = null;
        using (var splash = new SplashForm())
        {
            splash.Shown += (sender, e) =>
            {
                var worker = new Thread(() =>
                {
                    try { error = StartAndOpen(root, server, args); }
                    catch (Exception ex) { error = ex.Message; }
                    try { splash.BeginInvoke((Action)splash.Close); } catch (InvalidOperationException) { }
                });
                worker.IsBackground = true;
                worker.Start();
            };
            Application.Run(splash);
        }
        if (error != null) { MessageBox.Show(error, "Git Deck", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
        // Frameless window (WebView2): this process keeps running and hosts it until it is closed.
        if (hostedUrl != null) Hosted.Run(hostedUrl, FindEdge());
    }

    // Set by StartAndOpen when Git Deck opens in its own frameless window instead of Edge.
    private static string hostedUrl;

    // Starts the server when needed, opens the window and waits for it; returns an error message or null.
    private static string StartAndOpen(string root, string server, string[] args)
    {
        bool ownsMutex;
        using (var mutex = new Mutex(true, "Local\\GitDeckServerLauncher", out ownsMutex))
        {
            try
            {
                if (!IsReady())
                {
                    if (ownsMutex) StartServer(root, server);
                    if (!WaitUntilReady(TimeSpan.FromSeconds(20)))
                        return "Git Deck local service did not start within 20 seconds\n\nRun git-dashboard.bat --console to inspect the error";
                }
                // Frameless window when the WebView2 files are next to GitDeck.exe and the runtime is
                // installed (Windows 11 has it); otherwise an Edge app window as before.
                if (FindAppWindow() == IntPtr.Zero || FolderArgument(args) != null)
                {
                    string url = AppUrl;
                    string folder = FolderArgument(args);
                    if (folder != null) url += "?path=" + Uri.EscapeDataString(folder);
                    string action = ActionArgument(args);
                    if (action != null) url += (url.Contains("?") ? "&" : "?") + "do=" + action;
                    if (Hosted.Available(AppDomain.CurrentDomain.BaseDirectory)) { hostedUrl = url; return null; }
                }
                bool appWindow = OpenAppWindow(args);
                // Keep the splash until the Git Deck window shows (a browser tab cannot be detected).
                var until = DateTime.UtcNow + TimeSpan.FromSeconds(appWindow ? 20 : 2);
                while (DateTime.UtcNow < until && FindAppWindow() == IntPtr.Zero) Thread.Sleep(150);
                return null;
            }
            finally { if (ownsMutex) mutex.ReleaseMutex(); }
        }
    }

    private static string FolderArgument(string[] args)
    {
        if (args == null || args.Length == 0 || string.IsNullOrWhiteSpace(args[0])) return null;
        string requested = args[0].Trim().Trim('"');
        try { requested = Path.GetFullPath(requested); } catch { return null; }
        return Directory.Exists(requested) ? requested : null;
    }

    // Jump List tasks start GitDeck.exe with "--do <task>"; only these tasks are passed on.
    private static readonly string[] Actions = { "today", "mini", "day-close", "dashboard", "palette" };
    private static string ActionArgument(string[] args)
    {
        if (args == null || args.Length < 2 || args[0] != "--do") return null;
        return Array.IndexOf(Actions, args[1]) >= 0 ? args[1] : null;
    }

    // The frameless window of another GitDeck.exe, visible or hidden in the tray.
    private static IntPtr FindHostedWindow()
    {
        IntPtr found = IntPtr.Zero;
        int self = Process.GetCurrentProcess().Id;
        EnumWindows((window, parameter) =>
        {
            var text = new StringBuilder(512);
            GetWindowText(window, text, text.Capacity);
            if (!text.ToString().StartsWith("Git Deck —", StringComparison.Ordinal)) return true;
            uint pid; GetWindowThreadProcessId(window, out pid);
            if (pid == self) return true;
            try { if (Process.GetProcessById((int)pid).ProcessName.Equals("GitDeck", StringComparison.OrdinalIgnoreCase)) { found = window; return false; } } catch { }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    [StructLayout(LayoutKind.Sequential)] internal struct COPYDATASTRUCT { public IntPtr Data; public int Size; public IntPtr Text; }
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, ref COPYDATASTRUCT data);
    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int process);

    private static void SendCommand(IntPtr window, string command)
    {
        uint pid; GetWindowThreadProcessId(window, out pid);
        AllowSetForegroundWindow((int)pid);
        IntPtr text = Marshal.StringToHGlobalUni(command);
        try
        {
            var data = new COPYDATASTRUCT { Data = (IntPtr)0x47444B, Size = (command.Length + 1) * 2, Text = text };
            SendMessage(window, 0x004A, IntPtr.Zero, ref data); // WM_COPYDATA
        }
        finally { Marshal.FreeHGlobal(text); }
    }

    private static void FocusWindow(IntPtr window)
    {
        if (IsIconic(window)) ShowWindow(window, 9); // SW_RESTORE
        SetForegroundWindow(window);
    }

    private static bool IsReady()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(AppUrl + "api/health");
            request.Timeout = 700;
            request.ReadWriteTimeout = 700;
            using (var response = (HttpWebResponse)request.GetResponse())
                return response.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    private static bool WaitUntilReady(TimeSpan timeout)
    {
        var started = DateTime.UtcNow;
        while (DateTime.UtcNow - started < timeout)
        {
            if (IsReady()) return true;
            Thread.Sleep(250);
        }
        return false;
    }

    private static void StartServer(string root, string server)
    {
        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            // The hidden server stops by itself once every Git Deck window has closed.
            // -NoBrowser: this launcher opens the window itself (with ?path= support).
            Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + server + "\" -NoBrowser -IdleShutdownSeconds 90",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        Process.Start(start);
    }

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

    // An open Git Deck app window: its title is the page title ("Git Deck — …"). Browser tabs
    // are skipped because their window titles end with the browser name.
    private static IntPtr FindAppWindow()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, parameter) =>
        {
            if (!IsWindowVisible(window)) return true;
            var text = new StringBuilder(512);
            GetWindowText(window, text, text.Capacity);
            string title = text.ToString();
            // — = em dash; escaped so the result does not depend on the source code page.
            if (title.StartsWith("Git Deck —", StringComparison.Ordinal) && title.IndexOf("Microsoft", StringComparison.OrdinalIgnoreCase) < 0 && title.IndexOf("Chrome", StringComparison.OrdinalIgnoreCase) < 0)
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // Returns true when Git Deck opened in its own app window (Edge), false for a browser tab.
    private static bool OpenAppWindow(string[] args)
    {
        string url = AppUrl;
        string folder = FolderArgument(args);
        bool specificFolder = folder != null;
        if (specificFolder) url += "?path=" + Uri.EscapeDataString(folder);
        // Like Sourcetree: opening Git Deck again brings the existing window back instead of a second one.
        IntPtr existing = specificFolder ? IntPtr.Zero : FindAppWindow();
        if (existing != IntPtr.Zero)
        {
            FocusWindow(existing);
            return true;
        }
        string edge = FindEdge();
        if (edge != null)
        {
            Process.Start(new ProcessStartInfo(edge, "--app=\"" + url + "\" --start-maximized") { UseShellExecute = true });
            return true;
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return false;
    }

    // Edge lives in Program Files (x86) on most machines, but per-machine x64 and
    // per-user installs use the other two folders.
    private static string FindEdge()
    {
        var folders = new[] {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };
        foreach (string folder in folders)
        {
            if (string.IsNullOrEmpty(folder)) continue;
            string candidate = Path.Combine(folder, "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}

// The startup card: brand green, the logo tile and the name (web/index.html + startup.css draw the same).
internal sealed class SplashForm : Form
{
    private readonly Image logo;
    private readonly float scale;

    public SplashForm()
    {
        using (var screen = Graphics.FromHwnd(IntPtr.Zero)) scale = screen.DpiX / 96f;
        Text = "Git Deck";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.None;
        ClientSize = new Size((int)(460 * scale), (int)(250 * scale));
        BackColor = Color.FromArgb(0x0B, 0x6E, 0x47);
        DoubleBuffered = true;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        var stream = typeof(SplashForm).Assembly.GetManifestResourceStream("GitDeck.logo.png");
        if (stream != null) logo = Image.FromStream(stream);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        Font font;
        try { font = new Font("Segoe UI Semilight", 42f * scale, FontStyle.Regular, GraphicsUnit.Pixel); }
        catch (ArgumentException) { font = new Font("Segoe UI", 42f * scale, FontStyle.Regular, GraphicsUnit.Pixel); }
        using (font)
        using (var white = new SolidBrush(Color.White))
        {
            const string name = "Git Deck";
            SizeF text = g.MeasureString(name, font, PointF.Empty, StringFormat.GenericTypographic);
            float icon = logo != null ? 72 * scale : 0;
            float gap = logo != null ? 16 * scale : 0;
            float left = (ClientSize.Width - (icon + gap + text.Width)) / 2f;
            if (logo != null) DrawTile(g, left, (ClientSize.Height - icon) / 2f, icon);
            g.DrawString(name, font, white, left + icon + gap, (ClientSize.Height - text.Height) / 2f, StringFormat.GenericTypographic);
        }
    }

    // The logo tile from web/index.html (72x72 viewBox): a white rounded square with two branches
    // merging into one, in the brand green, so the web splash continues from exactly this picture.
    private void DrawTile(Graphics g, float x, float y, float size)
    {
        float k = size / 72f;
        Func<float, float> X = v => x + v * k;
        Func<float, float> Y = v => y + v * k;
        var green = Color.FromArgb(0x0B, 0x6E, 0x47);
        using (var tile = new GraphicsPath())
        using (var white = new SolidBrush(Color.White))
        using (var fill = new SolidBrush(green))
        using (var pen = new Pen(green, 5 * k))
        {
            float r = 18 * k * 2, left = X(2), top = Y(2), w = 68 * k;
            tile.AddArc(left, top, r, r, 180, 90);
            tile.AddArc(left + w - r, top, r, r, 270, 90);
            tile.AddArc(left + w - r, top + w - r, r, r, 0, 90);
            tile.AddArc(left, top + w - r, r, r, 90, 90);
            tile.CloseFigure();
            g.FillPath(white, tile);
            pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
            g.DrawBezier(pen, X(22), Y(21), X(22), Y(37), X(36), Y(35), X(36), Y(51));
            g.DrawBezier(pen, X(50), Y(21), X(50), Y(37), X(36), Y(35), X(36), Y(51));
            g.FillEllipse(fill, X(22 - 6), Y(21 - 6), 12 * k, 12 * k);
            g.FillEllipse(fill, X(50 - 6), Y(21 - 6), 12 * k, 12 * k);
            g.FillEllipse(fill, X(36 - 7), Y(51 - 7), 14 * k, 14 * k);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && logo != null) logo.Dispose();
        base.Dispose(disposing);
    }
}

// The frameless Git Deck window (WebView2). Kept in its own classes so that GitDeck.exe still starts
// (and falls back to an Edge app window) when the WebView2 files or runtime are missing: these types
// are only loaded when Available() is called.
internal static class Hosted
{
    private static readonly string[] Files = { "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll" };

    public static bool Available(string folder)
    {
        foreach (string file in Files) if (!File.Exists(Path.Combine(folder, file))) return false;
        try { return !string.IsNullOrEmpty(RuntimeVersion()); }
        catch { return false; }
    }

    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private static string RuntimeVersion() { return Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString(null); }

    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    public static void Run(string url, string edge)
    {
        using (var window = new AppWindow(url, edge)) Application.Run(window);
    }
}

// A normal resizable window whose title bar is removed (WM_NCCALCSIZE): Windows still gives it the
// resize borders, the shadow, rounded corners, snap and the maximize animation. The page draws its own
// top bar: areas marked `app-region: drag` move the window (WebView2 non-client regions) and its window
// buttons send "window:minimize|maximize|close" (web/window-frame.js).
internal sealed class AppWindow : Form
{
    private const int WM_NCCALCSIZE = 0x0083;
    private readonly Microsoft.Web.WebView2.WinForms.WebView2 view;
    private readonly string url;
    private readonly string edge;
    private readonly string origin;

    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct NCCALCSIZE_PARAMS { public RECT Rect0, Rect1, Rect2; public IntPtr Position; }
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    public AppWindow(string url, string edge)
    {
        this.url = url;
        this.edge = edge;
        origin = new Uri(url).GetLeftPart(UriPartial.Authority);
        Text = "Git Deck — Local Repository Manager";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        BackColor = Color.FromArgb(0x0B, 0x6E, 0x47);
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1440, 900);
        MinimumSize = new Size(760, 520);
        WindowState = FormWindowState.Maximized;
        view = new Microsoft.Web.WebView2.WinForms.WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        Controls.Add(view);
        Load += async (sender, e) =>
        {
            try
            {
                string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GitDeck", "WebView2");
                var environment = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, data, null);
                await view.EnsureCoreWebView2Async(environment);
                var core = view.CoreWebView2;
                core.Settings.IsNonClientRegionSupportEnabled = true;
                core.Settings.IsStatusBarEnabled = false;
                core.DocumentTitleChanged += (s, a) => { Text = core.DocumentTitle; };
                core.WebMessageReceived += (s, a) => OnMessage(a.TryGetWebMessageAsString());
                // Git Deck pages stay here; links to GitLab, GitHub and other sites open in the browser.
                core.NavigationStarting += (s, a) => { if (!Local(a.Uri)) { a.Cancel = true; OpenOutside(a.Uri); } };
                core.NewWindowRequested += (s, a) => { if (!Local(a.Uri)) { a.Handled = true; OpenOutside(a.Uri); } };
                core.NavigationCompleted += (s, a) =>
                {
                    pageReady = true; SendState();
                    var queued = waiting.ToArray(); waiting.Clear();
                    foreach (string message in queued) Post(message);
                };
                core.Navigate(url);
            }
            catch (Exception ex)
            {
                // The runtime could not start: fall back to the Edge app window and leave.
                try { if (edge != null) Process.Start(new ProcessStartInfo(edge, "--app=\"" + url + "\" --start-maximized") { UseShellExecute = true }); else Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
                catch { MessageBox.Show(ex.Message, "Git Deck", MessageBoxButtons.OK, MessageBoxIcon.Error); }
                Close();
            }
        };
        Resize += (sender, e) => { if (WindowState != FormWindowState.Minimized) restoreTo = WindowState; SendState(); };
        // System tray: Git Deck keeps running when its window is closed; Quit ends it.
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Git Deck", null, (s, a) => ShowApp());
        menu.Items.Add("Command…  (Win+Shift+G)", null, (s, a) => { ShowApp(); Post("palette:open"); });
        menu.Items.Add("Today", null, (s, a) => { ShowApp(); Post("do:today"); });
        menu.Items.Add("Mini mode", null, (s, a) => Post("do:mini"));
        menu.Items.Add("Close the day", null, (s, a) => { ShowApp(); Post("do:day-close"); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit Git Deck", null, (s, a) => { quitting = true; Close(); });
        tray = new NotifyIcon { Icon = Icon ?? SystemIcons.Application, Text = "Git Deck", ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += (s, a) => ShowApp();
        FormClosing += (s, a) =>
        {
            if (quitting || a.CloseReason != CloseReason.UserClosing) return;
            a.Cancel = true; Hide();
            if (!toldAboutTray) { toldAboutTray = true; tray.ShowBalloonTip(4000, "Git Deck", "Still running here. Win+Shift+G or a click brings it back; right-click for quick actions or Quit.", ToolTipIcon.Info); }
        };
        FormClosed += (s, a) => { tray.Visible = false; tray.Dispose(); Desktop.ClearBadge(ref badge); };
    }

    private readonly NotifyIcon tray;
    private bool quitting, toldAboutTray, pageReady;
    private FormWindowState restoreTo = FormWindowState.Maximized;
    private IntPtr badge = IntPtr.Zero;
    private int badgeCount = -1;
    private string jumpList = "";
    private readonly System.Collections.Generic.List<string> waiting = new System.Collections.Generic.List<string>();

    private void ShowApp()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = restoreTo;
        Activate();
    }

    // Messages for the page wait until it has loaded.
    private void Post(string message)
    {
        if (!pageReady || view.CoreWebView2 == null) { waiting.Add(message); return; }
        try { view.CoreWebView2.PostWebMessageAsString(message); } catch { }
    }

    // A command from another GitDeck.exe (Jump List, Explorer menu, a second start): show and pass it on.
    private void OnCommand(string command)
    {
        if (string.IsNullOrEmpty(command)) return;
        if (command == "do:mini") { Post(command); return; }
        ShowApp();
        if (command.StartsWith("open:", StringComparison.Ordinal) || command.StartsWith("do:", StringComparison.Ordinal)) Post(command);
    }

    private bool Local(string address)
    {
        return address != null && (address.StartsWith(origin + "/", StringComparison.OrdinalIgnoreCase) || address == origin || address.StartsWith("about:", StringComparison.OrdinalIgnoreCase) || address.StartsWith("data:", StringComparison.OrdinalIgnoreCase));
    }

    private static void OpenOutside(string address)
    {
        Uri parsed;
        if (!Uri.TryCreate(address, UriKind.Absolute, out parsed) || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps && parsed.Scheme != Uri.UriSchemeMailto)) return;
        try { Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true }); } catch { }
    }

    private void OnMessage(string message)
    {
        if (message == "window:minimize") WindowState = FormWindowState.Minimized;
        else if (message == "window:maximize") WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
        else if (message == "window:close") Close();
        else if (message == "window:state") SendState();
        else if (message.StartsWith("box:", StringComparison.Ordinal)) OnBox(message);
        else if (message != null && message.StartsWith("badge:", StringComparison.Ordinal))
        {
            // The number of things waiting, on the taskbar button (web/desktop-bridge.js).
            int count;
            if (int.TryParse(message.Substring(6), out count) && count != badgeCount) { badgeCount = count; Desktop.SetBadge(Handle, count, ref badge); }
        }
        else if (message != null && message.StartsWith("jump:", StringComparison.Ordinal))
        {
            // Recent repositories for the Jump List: one "name<TAB>path" per line.
            string list = message.Substring(5);
            if (list != jumpList) { jumpList = list; Desktop.SetJumpList(Application.ExecutablePath, list); }
        }
    }

    private void SendState()
    {
        try { if (view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsString(WindowState == FormWindowState.Maximized ? "window:maximized" : "window:restored"); } catch { }
    }

    // The cube (web/cube-box.js): the window is square and cut to the cube's outline, so the desktop shows
    // around it and clicks outside go through. Maximized (the full window for long diffs) has no cut.
    [DllImport("user32.dll")] private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);
    [DllImport("gdi32.dll")] private static extern IntPtr CreatePolygonRgn(int[] points, int count, int mode);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    private bool boxOn;

    private double BoxScale() { try { return GetDpiForWindow(Handle) / 96.0; } catch { return 1.0; } }

    private void SizeClient(int side, bool corner)
    {
        if (WindowState != FormWindowState.Normal) WindowState = FormWindowState.Normal;
        MinimumSize = new Size(120, 120);
        var area = Screen.FromControl(this).WorkingArea;
        Size = new Size(side, side);
        Size = new Size(side + (Width - ClientSize.Width), side + (Height - ClientSize.Height));
        var margin = PointToScreen(Point.Empty);
        int dx = margin.X - Left, dy = margin.Y - Top;
        Location = corner ? new Point(area.Right - side - 16 - dx, area.Bottom - side - 16 - dy) : new Point(area.Left + (area.Width - side) / 2 - dx, area.Top + (area.Height - side) / 2 - dy);
    }

    private void OnBox(string message)
    {
        if (message == "box:on") { boxOn = true; var area = Screen.FromControl(this).WorkingArea; SizeClient(Math.Min(area.Width, area.Height) - 24, false); SendState(); }
        else if (message == "box:small") SizeClient((int)(190 * BoxScale()), true);
        else if (message == "box:off") { boxOn = false; SetWindowRgn(Handle, IntPtr.Zero, true); MinimumSize = new Size(760, 520); WindowState = FormWindowState.Maximized; }
        else if (!boxOn || WindowState == FormWindowState.Maximized) return;
        else if (message == "box:round")
        {
            var margin = PointToScreen(Point.Empty);
            int x = margin.X - Left, y = margin.Y - Top, radius = (int)(20 * BoxScale());
            SetWindowRgn(Handle, CreateRoundRectRgn(x, y, x + ClientSize.Width + 1, y + ClientSize.Height + 1, radius, radius), true);
        }
        else if (message.StartsWith("box:poly:", StringComparison.Ordinal))
        {
            var parts = message.Substring(9).Split(',');
            if (parts.Length < 6 || parts.Length % 2 != 0) return;
            var margin = PointToScreen(Point.Empty);
            int dx = margin.X - Left, dy = margin.Y - Top; double scale = BoxScale();
            var points = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++)
            {
                double value;
                if (!double.TryParse(parts[i], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value)) return;
                points[i] = (int)Math.Round(value * scale) + (i % 2 == 0 ? dx : dy);
            }
            SetWindowRgn(Handle, CreatePolygonRgn(points, points.Length / 2, 2), true);
        }
    }

    protected override void OnResize(EventArgs e)
    {
        if (boxOn && IsHandleCreated && WindowState == FormWindowState.Maximized) SetWindowRgn(Handle, IntPtr.Zero, true);
        base.OnResize(e);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Recalculate the frame now that WM_NCCALCSIZE removes the title bar.
        SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020); // NOSIZE NOMOVE NOZORDER FRAMECHANGED
        // Win+Shift+G from anywhere shows Git Deck with the command box (Ctrl+Alt+G if Windows has it taken).
        if (!RegisterHotKey(Handle, 1, 0x0008 | 0x0004 | 0x4000, 0x47)) RegisterHotKey(Handle, 1, 0x0002 | 0x0001 | 0x4000, 0x47); // WIN SHIFT / CTRL ALT, NOREPEAT, G
        // Clipboard ticket radar: a copied ticket key (AP2365-3320) is offered to the page.
        AddClipboardFormatListener(Handle);
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        UnregisterHotKey(Handle, 1);
        RemoveClipboardFormatListener(Handle);
        base.OnHandleDestroyed(e);
    }

    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] private static extern bool AddClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] private static extern bool RemoveClipboardFormatListener(IntPtr window);
    private static readonly System.Text.RegularExpressions.Regex TicketKey = new System.Text.RegularExpressions.Regex(@"^[A-Z][A-Z0-9]{1,9}-\d{1,12}$");
    private string lastClip = "";

    // Only short text that is exactly a ticket key leaves the clipboard; anything else is ignored.
    private void OnClipboard()
    {
        try
        {
            if (!Clipboard.ContainsText()) return;
            var text = Clipboard.GetText().Trim();
            if (text.Length > 24) return;
            text = text.ToUpperInvariant();
            if (!TicketKey.IsMatch(text) || text == lastClip) return;
            lastClip = text;
            Post("ticket:" + text);
        }
        catch { }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0312 && m.WParam == (IntPtr)1) // WM_HOTKEY: show with the command box, or put it away
        {
            if (Visible && WindowState != FormWindowState.Minimized && ActiveForm == this) WindowState = FormWindowState.Minimized;
            else { ShowApp(); Post("palette:open"); }
            return;
        }
        if (m.Msg == 0x031D) { OnClipboard(); return; } // WM_CLIPBOARDUPDATE
        if (m.Msg == 0x004A) // WM_COPYDATA from another GitDeck.exe
        {
            var data = (GitDeckLauncher.COPYDATASTRUCT)Marshal.PtrToStructure(m.LParam, typeof(GitDeckLauncher.COPYDATASTRUCT));
            if (data.Data == (IntPtr)0x47444B && data.Size > 0 && data.Size < 8192) OnCommand(Marshal.PtrToStringUni(data.Text).TrimEnd('\0'));
            m.Result = (IntPtr)1;
            return;
        }
        if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
        {
            // Let Windows size the borders, then give the title bar back to the client area. Maximized
            // windows hang over the screen edge by the frame width, so keep that much off the top.
            var before = (NCCALCSIZE_PARAMS)Marshal.PtrToStructure(m.LParam, typeof(NCCALCSIZE_PARAMS));
            base.WndProc(ref m);
            var after = (NCCALCSIZE_PARAMS)Marshal.PtrToStructure(m.LParam, typeof(NCCALCSIZE_PARAMS));
            after.Rect0.Top = before.Rect0.Top + (IsZoomed(m.HWnd) ? GetSystemMetrics(33) + GetSystemMetrics(92) : 0); // SM_CYFRAME + SM_CXPADDEDBORDER
            Marshal.StructureToPtr(after, m.LParam, false);
            m.Result = IntPtr.Zero;
            return;
        }
        base.WndProc(ref m);
    }
}

// Taskbar number (overlay icon) and Jump List (recent repositories + tasks) through the Windows shell
// COM interfaces. Every call is best effort: a failure leaves the taskbar as it was.
internal static class Desktop
{
    [ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eedaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        void HrInit(); void AddTab(IntPtr hwnd); void DeleteTab(IntPtr hwnd); void ActivateTab(IntPtr hwnd); void SetActiveAlt(IntPtr hwnd);
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
        void SetProgressValue(IntPtr hwnd, ulong completed, ulong total); void SetProgressState(IntPtr hwnd, int flags);
        void RegisterTab(IntPtr tab, IntPtr hwnd); void UnregisterTab(IntPtr tab); void SetTabOrder(IntPtr tab, IntPtr before); void SetTabActive(IntPtr tab, IntPtr hwnd, uint reserved);
        void ThumbBarAddButtons(IntPtr hwnd, uint count, IntPtr buttons); void ThumbBarUpdateButtons(IntPtr hwnd, uint count, IntPtr buttons); void ThumbBarSetImageList(IntPtr hwnd, IntPtr images);
        void SetOverlayIcon(IntPtr hwnd, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
        void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string tip); void SetThumbnailClip(IntPtr hwnd, IntPtr clip);
    }
    [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")] private class TaskbarList { }

    [ComImport, Guid("92CA9DCD-5622-4BBA-A805-5E9F541BD8C9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IObjectArray { void GetCount(out uint count); void GetAt(uint index, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object item); }
    [ComImport, Guid("5632B1A4-E38A-400A-928A-D4CD63230295"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IObjectCollection
    {
        void GetCount(out uint count); void GetAt(uint index, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object item);
        void AddObject([MarshalAs(UnmanagedType.Interface)] object item); void AddFromArray(IObjectArray items); void RemoveObjectAt(uint index); void Clear();
    }
    [ComImport, Guid("2D3468C1-36A7-43B6-AC24-D3F02FD9607A")] private class EnumerableObjectCollection { }
    [ComImport, Guid("6332DEBF-87B5-4670-90C0-5E57B408A49E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICustomDestinationList
    {
        void SetAppID([MarshalAs(UnmanagedType.LPWStr)] string id);
        void BeginList(out uint minSlots, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object removed);
        void AppendCategory([MarshalAs(UnmanagedType.LPWStr)] string category, IObjectArray items);
        void AppendKnownCategory(int category); void AddUserTasks(IObjectArray tasks); void CommitList();
        void GetRemovedDestinations(ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object removed);
        void DeleteList([MarshalAs(UnmanagedType.LPWStr)] string id); void AbortList();
    }
    [ComImport, Guid("77F10CF0-3DB5-4966-B520-B7C54FD35ED6")] private class DestinationList { }
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int max, IntPtr data, uint flags); void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int max); void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int max); void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int max); void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out short key); void SetHotkey(short key); void GetShowCmd(out int show); void SetShowCmd(int show);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int max, out int index); void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved); void Resolve(IntPtr hwnd, uint flags); void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")] private class ShellLink { }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore { void GetCount(out uint count); void GetAt(uint index, out PropertyKey key); void GetValue(ref PropertyKey key, out PropVariant value); void SetValue(ref PropertyKey key, ref PropVariant value); void Commit(); }
    [StructLayout(LayoutKind.Sequential)] private struct PropertyKey { public Guid Format; public uint Id; }
    [StructLayout(LayoutKind.Sequential)] private struct PropVariant { public ushort Type; public ushort R1, R2, R3; public IntPtr Value; public IntPtr Value2; }
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);

    private static ITaskbarList3 taskbar;

    public static void ClearBadge(ref IntPtr icon) { if (icon != IntPtr.Zero) { DestroyIcon(icon); icon = IntPtr.Zero; } }

    // A red dot with the count (9+ above nine) over the taskbar button; none for zero.
    public static void SetBadge(IntPtr window, int count, ref IntPtr icon)
    {
        try
        {
            if (taskbar == null) { taskbar = (ITaskbarList3)new TaskbarList(); taskbar.HrInit(); }
            IntPtr next = IntPtr.Zero;
            if (count > 0)
            {
                using (var bitmap = new Bitmap(32, 32))
                using (var g = Graphics.FromImage(bitmap))
                using (var red = new SolidBrush(Color.FromArgb(0xE5, 0x53, 0x4B)))
                using (var font = new Font("Segoe UI", count > 9 ? 13f : 17f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var center = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                    g.FillEllipse(red, 0, 0, 31, 31);
                    g.DrawString(count > 9 ? "9+" : count.ToString(), font, Brushes.White, new RectangleF(0, 1, 32, 32), center);
                    next = bitmap.GetHicon();
                }
            }
            taskbar.SetOverlayIcon(window, next, count > 0 ? count + " waiting" : "");
            ClearBadge(ref icon); icon = next;
        }
        catch { }
    }

    private static IShellLinkW Link(string exe, string arguments, string title)
    {
        var link = (IShellLinkW)new ShellLink();
        link.SetPath(exe); link.SetArguments(arguments); link.SetIconLocation(exe, 0); link.SetDescription(title);
        var store = (IPropertyStore)link;
        var key = new PropertyKey { Format = new Guid("F29F85E0-4FF9-1068-AB91-08002B27B3D9"), Id = 2 }; // PKEY_Title
        var value = new PropVariant { Type = 31, Value = Marshal.StringToCoTaskMemUni(title) }; // VT_LPWSTR
        try { store.SetValue(ref key, ref value); store.Commit(); } finally { Marshal.FreeCoTaskMem(value.Value); }
        return link;
    }

    // Recent repositories ("name<TAB>path" lines) and the fixed tasks.
    public static void SetJumpList(string exe, string recent)
    {
        try
        {
            var list = (ICustomDestinationList)new DestinationList();
            uint slots; object removed; var iid = typeof(IObjectArray).GUID;
            list.BeginList(out slots, ref iid, out removed);
            var repos = (IObjectCollection)new EnumerableObjectCollection();
            int added = 0;
            foreach (string line in (recent ?? "").Split('\n'))
            {
                string[] parts = line.Split('\t');
                if (parts.Length != 2 || parts[1].Length == 0 || !Directory.Exists(parts[1]) || added >= 10) continue;
                repos.AddObject(Link(exe, "\"" + parts[1] + "\"", parts[0])); added++;
            }
            if (added > 0) list.AppendCategory("Recent repositories", (IObjectArray)repos);
            var tasks = (IObjectCollection)new EnumerableObjectCollection();
            tasks.AddObject(Link(exe, "--do today", "Today"));
            tasks.AddObject(Link(exe, "--do palette", "Command…"));
            tasks.AddObject(Link(exe, "--do mini", "Mini mode"));
            tasks.AddObject(Link(exe, "--do day-close", "Close the day"));
            list.AddUserTasks((IObjectArray)tasks);
            list.CommitList();
        }
        catch { }
    }
}
