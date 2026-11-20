using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using static APL.Setup.Strings;

namespace APL.Setup
{
    /// <summary>
    /// --shot &lt;folder&gt;: renders every page and state with fake data to PNG, without showing a window
    /// and without running anything, to check the design in both languages.
    /// </summary>
    internal static class Shots
    {
        private static int W = 1100, H = 720;
        private static string dir, prefix;
        private static MainWindow main;

        internal static int Run(string folder)
        {
            dir = folder;
            Directory.CreateDirectory(dir);
            prefix = French ? "fr-" : "en-";
            main = new MainWindow(true);
            main.Runner.Root = @"C:\APL Launcher";
            // Render the content on its own: a window that is never shown has no size.
            var root = main.Root;
            main.Window.Content = null;
            TextElement.SetFontFamily(root, main.Window.FontFamily);
            TextElement.SetFontSize(root, main.Window.FontSize);
            TextElement.SetForeground(root, main.Window.Foreground);
            TextOptions.SetTextFormattingMode(root, TextFormattingMode.Ideal);
            root.UseLayoutRounding = true;

            var install = main.Install;
            var ok = new VetroInfo { Ip = "192.168.1.42", Version = "1.4.2" };

            // ---------- Your TV (the first page) ----------
            main.Choice.Select("tizen", true);
            Shot("00-platform-samsung", true);
            main.Choice.Select("tizen", false);
            Shot("00a-platform-samsung-noroot", true);
            main.Choice.Select("webos", true);
            Shot("00b-platform-lg-root", true);
            main.Choice.Select("webos", false);
            Shot("00c-platform-lg-noroot", true);
            main.Choice.Select("android", true);
            Shot("00d-platform-android", true);
            main.Choice.Select("tizen", true);
            main.Navigate("install");

            // ---------- Install ----------
            install.SetScreen("192.168.1.42", ok);
            install.SetCheck(Json.Parse(@"{""tizen"":""C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat"",""sdb"":""C:\\tizen-studio\\tools\\sdb.exe"",
                ""certificate"":{""dir"":""C:\\Users\\Knikt\\SamsungCertificate\\APLauncher"",""expires"":""2027-05-14"",""valid"":true},
                ""profile"":""APLauncher"",""csharp"":true,""net6"":false}"));
            install.SetKeys("8d1f0c2e9b7a4c35e6f1a2b3c4d5e6f7", "", "",
                new[] { new Site { Name = "Molotov", Url = "https://app.molotov.tv" }, new Site { Name = "Crunchyroll", Url = "https://www.crunchyroll.com" } });
            Shot("01-install", true);

            install.ShowScanResults(new List<VetroInfo> { ok, new VetroInfo { Ip = "192.168.1.57", Version = "1.4.0", Model = "QE55Q80T" } }, false);
            Shot("02-install-scan");
            install.ShowScanResults(new List<VetroInfo>(), false);
            Shot("02b-install-scan-none");
            install.ShowScanResults(new List<VetroInfo>(), false);
            ((UIElement)FindIn(install.View, "ScanPanel")).Visibility = Visibility.Collapsed;

            install.SetScreen("192.168.1.42", null);
            install.SetCheck(Json.Parse(@"{""tizen"":null,""sdb"":null,
                ""certificate"":{""dir"":""C:\\Users\\Knikt\\SamsungCertificate\\APL"",""expires"":""2025-09-30"",""valid"":false},
                ""profile"":null,""csharp"":false,""net6"":false}"));
            install.SetKeys("", "", "", new Site[0]);
            Shot("03-install-missing", true);
            install.SetScreen("192.168.1.42", new VetroInfo { Ip = "192.168.1.42", AgentReady = false });
            install.SetCheck(Json.Parse(@"{""tizen"":""C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat"",""sdb"":""C:\\tizen-studio\\tools\\sdb.exe"",""certificate"":null,""profile"":null,""csharp"":true,""net6"":true}"));
            Shot("04-install-notready");

            install.SetScreen("192.168.1.42", ok);
            main.Runner.Fake(T("Installing…"));
            install.BeginProgress();
            install.SetStep(1, 5);
            install.FakeLine("Looking for Tizen Studio on the PC…");
            install.FakeLine("OK: C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat");
            install.SetStep(2, 5);
            install.FakeLine("Keys saved.");
            install.SetStep(3, 5);
            install.FakeLine("Certificate: C:\\Users\\Knikt\\SamsungCertificate\\APLauncher (until 2027-05-14)");
            install.SetStep(4, 5);
            install.FakeLine("Building APL-Launcher.wgt (412 files)…");
            Shot("05-install-progress");
            FindIn<Expander>(install.View, "Details").IsExpanded = true;
            Shot("05b-install-progress-details");
            main.Runner.Fake(null);
            install.FakeLine("ERROR: signing failed");
            install.Failed("Tizen Studio could not sign the package: the certificate password is wrong.");
            Shot("06-install-failed", true);
            install.ShowFinish(true);
            Shot("07-install-finish", true);
            install.SetRemapStatus(Status.Ok, T("The buttons are set up. Press Home on the remote to try it."), null);
            Shot("07b-install-finish-remap", true);
            install.SetRemapStatus(Status.Fail, "Vetro did not accept the buttons: the remote is not selected in Remapper.", "Remapper: no device selected\r\nAPL-RESULT fail …");
            Shot("07c-install-finish-remap-failed", true);
            install.ShowView("form");

            // ---------- Optimize ----------
            main.Navigate("optimize");
            Shot("08-optimize-start");
            main.Optimize.ShowPlan(Json.Parse(FakePlan));
            Shot("09-optimize-plan", true);
            FindIn<Expander>(main.Optimize.View, "KeptExpander").IsExpanded = true;
            Shot("09b-optimize-plan-kept", true);
            main.Optimize.SetAsked(3, 14, true);
            var _ = main.Ask(T("Optimize the screen?"), T("It takes a minute or two. Restore undoes it, and uninstalled apps can come back from the App Store."),
                             T("Optimize"), glyph: "\uE945", tileColor: "Orange", bullets: main.Optimize.ConfirmBullets());
            Shot("10-optimize-confirm");
            main.HideSheet();
            main.Runner.Fake(T("Optimizing…"));
            main.Optimize.BeginRun();
            main.Optimize.SetProgress(46, "Turning off Samsung components (7/14)");
            Shot("11-optimize-progress");
            main.Runner.Fake(null);
            main.Optimize.ShowDone();
            Shot("12-optimize-done");
            main.Optimize.Failed("Vetro is not responding: the screen went to standby.");
            Shot("12b-optimize-failed");

            // ---------- Restore ----------
            main.Navigate("restore");
            Shot("13-restore");
            FindIn<CheckBox>(main.Restore.View, "UninstallToggle").IsChecked = true;
            _ = main.Ask(T("Restore the screen?"), T("The screen goes back to Samsung's menus. You can install APL Launcher again at any time."),
                         T("Restore and uninstall"), danger: true, glyph: "\uE777", tileColor: "Indigo",
                         bullets: new[] { T("Home goes back to Samsung"), T("Key interception is turned off"), T("The optimization is undone"), T("APL Launcher is uninstalled from the screen") });
            Shot("14-restore-confirm");
            main.HideSheet();
            main.Runner.Fake(T("Restoring…"));
            main.Restore.BeginRun();
            main.Restore.SetStep(1, 3);
            main.Restore.SetStep(2, 3);
            Shot("15-restore-progress");
            main.Runner.Fake(null);
            main.Restore.ShowDone(false);
            Shot("16-restore-done", true);

            // ---------- Tools, About, error ----------
            main.Navigate("tools");
            Shot("17-tools", true);
            main.Navigate("about");
            Shot("18-about", true);
            main.ShowError("Access to the path 'C:\\Users\\Knikt\\AppData\\Local\\APL-Launcher\\setup' is denied.");
            Shot("19-error");
            main.HideSheet();

            // ---------- LG (webOS) ----------
            string sshCheck = @"{""ssh"":""C:\\Windows\\System32\\OpenSSH\\ssh.exe"",""sshVersion"":""9.5"",""password"":""C:\\Windows\\System32\\OpenSSH\\ssh.exe"",""version"":""1.0.24""}";
            main.SetPlatform("webos", true, false);
            main.Navigate("install");
            var lgPage = main.Webos;
            lgPage.SetCheck(Json.Parse(sshCheck));
            lgPage.SetScreen("192.168.1.15", 3001, 22);
            Shot("30-lg-root", true);
            lgPage.ShowScanResults(new List<KeyValuePair<string, Dictionary<int, bool>>>
            {
                new KeyValuePair<string, Dictionary<int, bool>>("192.168.1.15", new Dictionary<int, bool> { { 3001, true }, { 22, true }, { 9922, false }, { 9991, false } })
            });
            Shot("31-lg-scan");
            lgPage.ShowScanResults(new List<KeyValuePair<string, Dictionary<int, bool>>>());
            lgPage.SetScreen("192.168.1.15", 3001);
            Shot("31b-lg-no-ssh");
            lgPage.SetScreen("192.168.1.15", 3001, 22);
            main.Runner.Fake(T("Installing…"));
            lgPage.BeginProgress();
            lgPage.SetStep(1, 5);
            lgPage.FakeLine("APL Launcher 1.0.24: 223 files, 5.9 MB");
            lgPage.SetStep(2, 5);
            lgPage.FakeLine("Rooted TV, Homebrew Channel found.");
            lgPage.SetStep(3, 5);
            lgPage.FakeLine("Package sent (5.9 MB), checked.");
            Shot("32-lg-progress");
            main.Runner.Fake(null);
            lgPage.ShowFinish();
            Shot("33-lg-finish", true);
            lgPage.ShowView("form");
            main.SetPlatform("webos", false, false);
            lgPage.SetCheck(Json.Parse(sshCheck));
            lgPage.SetScreen("192.168.1.15", 3001, 9922);
            Shot("34-lg-devmode", true);
            lgPage.ShowFinish();
            Shot("34b-lg-devmode-finish", true);
            lgPage.ShowView("form");

            // ---------- Android TV ----------
            main.SetPlatform("android", true, false);
            main.Navigate("install");
            main.Android.SetCheck(Json.Parse(@"{""adb"":null,""apk"":null}"));
            main.Android.SetScreen("192.168.1.30", 5555);
            Shot("35-android", true);
            main.Android.ShowFinish();
            Shot("36-android-finish", true);
            main.Android.ShowView("form");
            main.SetPlatform("tizen", true, false);

            // ---------- the smallest window allowed (960 × 640, minus the title bar) ----------
            W = 944;
            H = 600;
            main.Navigate("install");
            install.ShowView("form");
            Shot("20-min-install", true);
            install.ShowFinish(true);
            Shot("21-min-finish", true);
            main.Navigate("optimize");
            main.Optimize.ShowPlan(Json.Parse(FakePlan));
            Shot("22-min-optimize", true);
            main.Navigate("restore");
            Shot("23-min-restore", true);
            main.Navigate("tools");
            Shot("24-min-tools", true);

            if (French)
            {
                List<string> missing;
                lock (Missing) missing = Missing.OrderBy(m => m, StringComparer.Ordinal).ToList();
                File.WriteAllLines(Path.Combine(dir, "missing-fr.txt"), missing, new UTF8Encoding(false));
            }
            return 0;
        }

        private const string FakePlan = @"{
 ""uninstall"": [{""appId"":""3201608010191"",""name"":""Rakuten TV""},{""appId"":""3201907018807"",""name"":""Apple Music""},{""appId"":""111477001101"",""name"":""Deezer""}],
 ""silence"": [{""appId"":""com.samsung.tv.adagent-service"",""name"":""Ad agent"",""area"":""ads""},
   {""appId"":""com.samsung.tv.targeted-ad-service"",""name"":""Targeted ads"",""area"":""ads""},
   {""appId"":""com.samsung.tv.adplayer"",""name"":""Ad player"",""area"":""ads""},
   {""appId"":""com.samsung.tv.acr"",""name"":""Content recognition (ACR)"",""area"":""tracking""},
   {""appId"":""com.samsung.tizen.samsung-analytics"",""name"":""Samsung Analytics"",""area"":""tracking""},
   {""appId"":""com.samsung.tv.bixby"",""name"":""Bixby"",""area"":""voice""},
   {""appId"":""com.samsung.tv.voice-guide"",""name"":""Voice extras"",""area"":""voice""},
   {""appId"":""com.samsung.tv.ambient"",""name"":""Ambient mode"",""area"":""ambient""},
   {""appId"":""com.samsung.tv.store-mode"",""name"":""Store demo"",""area"":""store""},
   {""appId"":""com.samsung.tv.hotel-mode"",""name"":""Hotel mode"",""area"":""store""},
   {""appId"":""com.samsung.tv.smartthings"",""name"":""SmartThings"",""area"":""samsung""},
   {""appId"":""com.samsung.tv.iot-hub"",""name"":""IoT hub"",""area"":""samsung""},
   {""appId"":""com.samsung.tv.remote-diagnostics"",""name"":""Remote diagnostics"",""area"":""diagnostics""},
   {""appId"":""com.samsung.tv.crash-reporter"",""name"":""Crash reporter"",""area"":""diagnostics""}],
 ""youtube"": [{""appId"":""9Ur5IzDKqV.TizenYouTube"",""name"":""YouTube""}],
 ""kept"": [""APL Launcher"",""Vetro"",""TizenBrew"",""TizenTube"",""Netflix"",""Prime Video"",""Disney+"",""Samsung TV Plus"",""App Store"",""Steam Link"",""Internet""],
 ""dnsCount"": 12 }";

        // ---------- rendering ----------

        private static void Shot(string name, bool full = false)
        {
            var root = main.Root;
            Layout(root, H);
            Save(root, H, name);
            if (!full) return;
            // The whole page, to check what is below the fold.
            var sv = FindIn<ScrollViewer>(VisiblePage(), "Scroll");
            double extra = sv.ExtentHeight - sv.ViewportHeight;
            if (extra > 1)
            {
                Layout(root, H + extra);
                Save(root, H + extra, name + "-full");
                Layout(root, H);
            }
        }

        private static FrameworkElement VisiblePage()
        {
            foreach (var p in new Page[] { main.Choice, main.Install, main.Webos, main.Android, main.Optimize, main.Restore, main.Tools, main.About })
                if (p.View.Visibility == Visibility.Visible) return p.View;
            return main.Install.View;
        }

        private static T FindIn<T>(FrameworkElement root, string name) where T : class { return Ui.Find<T>(root, name); }
        private static object FindIn(FrameworkElement root, string name) { return root.FindName(name); }

        private static void Layout(FrameworkElement e, double h)
        {
            DoEvents();
            e.Measure(new Size(W, h));
            e.Arrange(new Rect(0, 0, W, h));
            e.UpdateLayout();
            DoEvents();
            e.UpdateLayout();
        }

        private static void Save(FrameworkElement e, double h, string name)
        {
            var bmp = new RenderTargetBitmap(W, (int)Math.Ceiling(h), 96, 96, PixelFormats.Pbgra32);
            bmp.Render(e);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            using (var fs = File.Create(Path.Combine(dir, prefix + name + ".png"))) enc.Save(fs);
        }

        private static void DoEvents()
        {
            var frame = new DispatcherFrame();
            Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(() => frame.Continue = false));
            Dispatcher.PushFrame(frame);
        }
    }
}
