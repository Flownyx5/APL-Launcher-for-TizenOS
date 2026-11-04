using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Controls;
using static APL.Setup.Strings;

namespace APL.Setup
{
    internal sealed class ToolsPage : Page
    {
        private readonly Button preview, vetro, repair, sources, tv;
        private readonly TextBlock vetroText, toolsHint;

        internal ToolsPage(MainWindow main) : base(main, "tools", "ToolsPage.xaml")
        {
            preview = F<Button>("PreviewButton");
            vetro = F<Button>("VetroButton");
            repair = F<Button>("RepairButton");
            sources = F<Button>("SourcesButton");
            tv = F<Button>("TvButton");
            vetroText = F<TextBlock>("VetroText");
            toolsHint = F<TextBlock>("ToolsHint");
            preview.Click += (s, e) => Preview();
            vetro.Click += (s, e) => Ui.Open(Vetro.Url(Main.Ip));
            repair.Click += (s, e) => Console("repair-tizenbrew.ps1", T("Repair TizenBrew"));
            sources.Click += (s, e) => Console("diagnose-sources.ps1", T("Diagnose inputs"));
            tv.Click += (s, e) => Console("diagnose-tv.ps1", T("Diagnose the screen"));
        }

        internal override void UpdateActions()
        {
            bool busy = Main.Runner.Busy, ready = Main.Runner.Root != null;
            preview.IsEnabled = ready;
            vetro.IsEnabled = Vetro.IsIPv4(Main.Ip);
            repair.IsEnabled = sources.IsEnabled = tv.IsEnabled = ready && !busy;
            toolsHint.Text = busy ? T("One task at a time: wait for the current one to finish ({0}).", Main.Runner.TaskName)
                                  : T("Repair and the diagnostics open in their own window, because they ask questions.");
        }

        private void Console(string script, string title)
        {
            try { Main.Runner.OpenConsole(script, title); }
            catch (Exception ex) { Log.Error("console " + script, ex); Main.ShowError(ex.Message); }
        }

        /// <summary>Like PREVIEW.bat: Edge or Chrome in app mode, else the default browser.</summary>
        private void Preview()
        {
            string page = Path.Combine(Main.Runner.Root, "launcher", "index.html");
            if (!File.Exists(page)) { Main.ShowError(T("The launcher files are missing: {0}", page)); return; }
            string url = new Uri(page).AbsoluteUri;
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf = Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            foreach (string exe in new[]
            {
                Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(local, @"Google\Chrome\Application\chrome.exe")
            })
            {
                if (!File.Exists(exe)) continue;
                try
                {
                    Process.Start(new ProcessStartInfo(exe, "--app=\"" + url + "\" --window-size=1400,820") { UseShellExecute = false });
                    return;
                }
                catch (Exception ex) { Log.Error("preview " + exe, ex); }
            }
            Ui.Open(page);
        }
    }

    internal sealed class AboutPage : Page
    {
        internal const string GitHub = "https://github.com/Flownyx5/APL-Launcher-for-TizenOS";

        internal AboutPage(MainWindow main) : base(main, "about", "AboutPage.xaml")
        {
            F<System.Windows.Controls.Image>("BigIcon").Source = Ui.AppIcon();
            F<TextBlock>("VersionText").Text = T("Version {0}", BuildInfo.Version);
            F<Button>("GitHubLink").Click += (s, e) => Ui.Open(GitHub);
            F<Button>("CompatLink").Click += (s, e) => Ui.Open(GitHub + "/blob/main/docs/compatibility.md");
            F<Button>("LicenseLink").Click += (s, e) => Ui.Open(GitHub + "/blob/main/LICENSE");
        }
    }
}
