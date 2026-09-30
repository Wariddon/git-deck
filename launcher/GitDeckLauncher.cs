using System;
using System.Diagnostics;
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
[assembly: System.Reflection.AssemblyVersion("1.1.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.1.0.0")]

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

        bool ownsMutex;
        using (var mutex = new Mutex(true, "Local\\GitDeckServerLauncher", out ownsMutex))
        {
            if (!IsReady())
            {
                if (ownsMutex) StartServer(root, server);
                if (!WaitUntilReady(TimeSpan.FromSeconds(20)))
                {
                    MessageBox.Show("Git Deck local service did not start within 20 seconds\n\nRun git-dashboard.bat --console to inspect the error", "Git Deck", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
            }
            OpenAppWindow(args);
            if (ownsMutex) mutex.ReleaseMutex();
        }
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

    private static void OpenAppWindow(string[] args)
    {
        string url = AppUrl;
        bool specificFolder = false;
        if (args != null && args.Length > 0 && !string.IsNullOrWhiteSpace(args[0]))
        {
            string requested = args[0].Trim().Trim('"');
            try { requested = Path.GetFullPath(requested); } catch { requested = string.Empty; }
            if (!string.IsNullOrEmpty(requested) && Directory.Exists(requested))
            {
                url += "?path=" + Uri.EscapeDataString(requested);
                specificFolder = true;
            }
        }
        // Like Sourcetree: opening Git Deck again brings the existing window back instead of a second one.
        IntPtr existing = specificFolder ? IntPtr.Zero : FindAppWindow();
        if (existing != IntPtr.Zero)
        {
            if (IsIconic(existing)) ShowWindow(existing, 9); // SW_RESTORE
            SetForegroundWindow(existing);
            return;
        }
        string edge = FindEdge();
        if (edge != null)
        {
            Process.Start(new ProcessStartInfo(edge, "--app=\"" + url + "\" --start-maximized") { UseShellExecute = true });
            return;
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
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
