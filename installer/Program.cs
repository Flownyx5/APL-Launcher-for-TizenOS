using System;
using System.IO;
using System.Reflection;
using System.Runtime.Versioning;
using System.Text;
using System.Windows;
using System.Windows.Threading;

// Without this attribute the runtime falls back to .NET 4.0 behaviour (no per-monitor DPI in WPF).
[assembly: TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]
[assembly: AssemblyTitle("APL Launcher Setup")]
[assembly: AssemblyProduct("APL Launcher")]
[assembly: AssemblyDescription("Installs APL Launcher on a Samsung Tizen screen through Vetro")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Knikt (Gero Corp.) — MIT License")]
[assembly: AssemblyVersion(APL.Setup.BuildInfo.Version)]
[assembly: AssemblyFileVersion(APL.Setup.BuildInfo.Version)]
[assembly: AssemblyInformationalVersion(APL.Setup.BuildInfo.Version)]

namespace APL.Setup
{
    internal static class Program
    {
        /// <summary>Hidden test arguments: --shot &lt;folder&gt; renders every view with fake data,
        /// --root &lt;folder&gt; runs the scripts of another folder (fake scripts for tests).</summary>
        internal static string ShotFolder, RootOverride;

        [STAThread]
        private static int Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Log.Error("unhandled", e.ExceptionObject as Exception);
            string lang = null;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].ToLowerInvariant();
                string next = i + 1 < args.Length ? args[i + 1] : null;
                if (a == "--lang" && next != null) { lang = next.ToLowerInvariant(); i++; }
                else if (a == "--shot" && next != null) { ShotFolder = Path.GetFullPath(next); i++; }
                else if (a == "--root" && next != null) { RootOverride = Path.GetFullPath(next); i++; }
            }
            Strings.Init(lang);

            try
            {
                var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                app.DispatcherUnhandledException += OnUiException;
                Theme.Load(app);
                if (ShotFolder != null) return Shots.Run(ShotFolder);

                Log.Info("start " + BuildInfo.Version + " (" + (Strings.French ? "fr" : "en") + ")");
                var main = new MainWindow(false);
                return app.Run(main.Window);
            }
            catch (Exception ex)
            {
                Log.Error("startup", ex);
                if (ShotFolder != null) return 1;
                // Last resort only: the themed window could not even be built.
                MessageBox.Show(Strings.T("APL Launcher Setup could not start.") + "\n\n" + ex.Message +
                                "\n\n" + Log.FilePath, "APL Launcher Setup", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
        }

        private static void OnUiException(object sender, DispatcherUnhandledExceptionEventArgs e)
        {
            Log.Error("ui", e.Exception);
            e.Handled = true;   // keep the window: a broken button must not close the app in the middle of an install
            var w = MainWindow.Current;
            if (w != null) w.ShowError(e.Exception.Message);
        }
    }

    /// <summary>%LOCALAPPDATA%\APL-Launcher\setup.log — never contains keys.</summary>
    internal static class Log
    {
        internal static readonly string FilePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "APL-Launcher", "setup.log");
        private static readonly object Gate = new object();

        internal static void Info(string text) { Write("info", text); }

        internal static void Error(string where, Exception ex)
        {
            Write("error", where + ": " + (ex == null ? "(unknown)" : ex.ToString()));
        }

        private static void Write(string level, string text)
        {
            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                    // Keep the log small: start over past 1 MB.
                    var fi = new FileInfo(FilePath);
                    if (fi.Exists && fi.Length > 1024 * 1024) fi.Delete();
                    File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " [" + level + "] " + text + "\r\n",
                                       new UTF8Encoding(false));
                }
            }
            catch { }
        }
    }
}
