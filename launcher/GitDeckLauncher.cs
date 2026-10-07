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
[assembly: System.Reflection.AssemblyVersion("1.4.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.4.0.0")]

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
        if (error != null) MessageBox.Show(error, "Git Deck", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

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
