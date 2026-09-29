using System;
using System.Diagnostics;
using System.IO;
using System.Net;
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
            MessageBox.Show("ไม่พบ git-dashboard-server.ps1\n\nวาง GitDeck.exe ไว้ในโฟลเดอร์เดียวกับ scripts และ web", "Git Deck", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
                    MessageBox.Show("Git Deck local service เปิดไม่สำเร็จภายใน 20 วินาที\n\nลองรัน git-dashboard.bat เพื่อตรวจข้อความผิดพลาด", "Git Deck", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
            Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + server + "\" -IdleShutdownSeconds 90",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        Process.Start(start);
    }

    private static void OpenAppWindow(string[] args)
    {
        string url = AppUrl;
        if (args != null && args.Length > 0 && !string.IsNullOrWhiteSpace(args[0]))
        {
            string requested = args[0].Trim().Trim('"');
            try { requested = Path.GetFullPath(requested); } catch { requested = string.Empty; }
            if (!string.IsNullOrEmpty(requested) && Directory.Exists(requested))
                url += "?path=" + Uri.EscapeDataString(requested);
        }
        string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe");
        if (File.Exists(edge))
        {
            Process.Start(new ProcessStartInfo(edge, "--app=\"" + url + "\" --start-maximized") { UseShellExecute = true });
            return;
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}
