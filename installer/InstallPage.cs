using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using static APL.Setup.Strings;

namespace APL.Setup
{
    internal sealed class InstallPage : Page
    {
        internal const string VetroGuide = "https://github.com/andrearicci93/vetro";
        private const string TizenDownload = "https://developer.tizen.org/development/tizen-studio/download";
        private const string BuildToolsDownload = "https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022";
        private const string Net6Download = "https://dotnet.microsoft.com/download/dotnet/6.0";

        private readonly ScrollViewer scroll;
        private readonly TextBlock title, subtitle;
        private readonly StackPanel formView, progressView, finishView;
        private readonly TextBox ipBox, tmdbBox, youTubeBox, fanartBox, logBox;
        private readonly Button findButton, checkAgain, addSite, installButton, retryButton, backButton, openVetro, remapButton, continueButton, newInstall;
        private readonly CheckBox optimizeAfter, aplTvToggle;
        private readonly Grid vetroMark, footerMark, failMark, doneMark;
        private readonly TextBlock vetroText, vetroHelp, footerHint, overallText, overallPercent, failText;
        private readonly StackPanel scanPanel, pcRows, sitesList, remapStatus;
        private readonly Border footer, failCard, continueCard;
        private readonly ProgressBar overallBar;
        private readonly Expander details;
        private readonly StepList steps;

        /// <summary>The APL-CHECK answer of install.ps1 -CheckOnly (null until it came).</summary>
        internal object Check;
        private bool checking;
        private string checkError;
        private bool scanning;
        private bool optimizeChosen;
        private int statusSeq;
        private readonly DispatcherTimer debounce, recheck;

        internal InstallPage(MainWindow main) : base(main, "install", "InstallPage.xaml")
        {
            scroll = F<ScrollViewer>("Scroll");
            title = F<TextBlock>("PageTitle");
            subtitle = F<TextBlock>("PageSubtitle");
            formView = F<StackPanel>("FormView");
            progressView = F<StackPanel>("ProgressView");
            finishView = F<StackPanel>("FinishView");
            ipBox = F<TextBox>("IpBox");
            tmdbBox = F<TextBox>("TmdbBox");
            youTubeBox = F<TextBox>("YouTubeBox");
            fanartBox = F<TextBox>("FanartBox");
            logBox = F<TextBox>("LogBox");
            findButton = F<Button>("FindButton");
            checkAgain = F<Button>("CheckAgain");
            addSite = F<Button>("AddSite");
            installButton = F<Button>("InstallButton");
            retryButton = F<Button>("RetryButton");
            backButton = F<Button>("BackButton");
            openVetro = F<Button>("OpenVetro");
            remapButton = F<Button>("RemapButton");
            continueButton = F<Button>("ContinueButton");
            newInstall = F<Button>("NewInstall");
            optimizeAfter = F<CheckBox>("OptimizeAfter");
            aplTvToggle = F<CheckBox>("AplTvToggle");
            vetroMark = F<Grid>("VetroMark");
            footerMark = F<Grid>("FooterMark");
            failMark = F<Grid>("FailMark");
            doneMark = F<Grid>("DoneMark");
            vetroText = F<TextBlock>("VetroText");
            vetroHelp = F<TextBlock>("VetroHelp");
            footerHint = F<TextBlock>("FooterHint");
            overallText = F<TextBlock>("OverallText");
            overallPercent = F<TextBlock>("OverallPercent");
            failText = F<TextBlock>("FailText");
            scanPanel = F<StackPanel>("ScanPanel");
            pcRows = F<StackPanel>("PcRows");
            sitesList = F<StackPanel>("SitesList");
            remapStatus = F<StackPanel>("RemapStatus");
            footer = F<Border>("Footer");
            failCard = F<Border>("FailCard");
            continueCard = F<Border>("ContinueCard");
            overallBar = F<ProgressBar>("OverallBar");
            details = F<Expander>("Details");

            steps = new StepList(F<StackPanel>("Steps"),
                new[] { T("Tools"), T("Settings"), T("Certificate"), T("Build"), T("Install on the screen") },
                new[] { T("Tizen Studio and sdb on this PC"), T("Your keys and websites"), T("Your Samsung certificate"),
                        T("The launcher and APL Overlay"), T("Through Vetro, then the launcher opens") });
            failMark.Children.Add(Ui.Badge(Status.Fail, 24));
            doneMark.Children.Add(Ui.Badge(Status.Ok, 46));

            // Finish view texts (bold parts and links need code)
            Ui.Rich(F<TextBlock>("ScreenPath"), T("With the remote, open **Settings › All Settings › Advanced Features** and set:"));
            F<TextBlock>("SmartHubName").Text = T("Autorun Smart Hub");
            F<TextBlock>("LastAppName").Text = T("Autorun Last App");
            var vsteps = F<StackPanel>("VetroSteps");
            string[] howTo =
            {
                T("Open Vetro, then **Remapper**."),
                T("In the device list, pick your remote: **Smart Control 2016** over Bluetooth, or **wt61p807 rc device** for infrared only."),
                T("Map **Home** to **APL Launcher**."),
                T("Turn on **Remote interception**.")
            };
            for (int i = 0; i < howTo.Length; i++) vsteps.Children.Add(Numbered(i + 1, howTo[i]));
            F<TextBlock>("RemapIntro").Text = T("Then click below: the app hands Home and ⏯ to APL Overlay (and TV Plus or Prime Video when AquaPlay or TizenTube is installed).");

            // Events
            ipBox.TextChanged += (s, e) => OnIpChanged();
            findButton.Click += (s, e) => Scan();
            checkAgain.Click += (s, e) => RunCheck();
            addSite.Click += (s, e) => { var box = AddSite("", ""); box.Focus(); };
            installButton.Click += (s, e) => StartInstall();
            retryButton.Click += (s, e) => StartInstall();
            backButton.Click += (s, e) => ShowView("form");
            newInstall.Click += (s, e) => ShowView("form");
            openVetro.Click += (s, e) => Ui.Open(Vetro.Url(Main.Ip));
            remapButton.Click += (s, e) => Remap();
            continueButton.Click += (s, e) => { Main.Navigate("optimize"); Main.Optimize.ReadPlan(); };

            debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            debounce.Tick += (s, e) => { debounce.Stop(); CheckVetro(false); };
            // Keeps the status live: the screen may be turned on or off while the window is open.
            recheck = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            recheck.Tick += (s, e) => { if (Main.Platform == "tizen" && Vetro.IsIPv4(Main.Ip) && Main.Window.IsActive) CheckVetro(true); };

            AddSite("", "");
            ShowView("form");
            RenderVetro();
            RenderPc();
        }

        /// <summary>What the scripts saved last time. Called once every page exists (the IP fans out to them).</summary>
        internal void Prefill()
        {
            var keys = Saved.Keys();
            SetKeys(keys.Tmdb, keys.YouTube, keys.Fanart, keys.Sites);
            ipBox.Text = Saved.TvIp();
            recheck.Start();
        }

        internal static FrameworkElement Numbered(int n, string text)
        {
            var g = new Grid { Margin = new Thickness(0, 5, 0, 5) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(26) });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.Children.Add(new TextBlock { Text = n + ".", FontSize = 14, Foreground = Ui.Brush("Text3"), FontWeight = FontWeights.SemiBold });
            var tb = Ui.Text(text, "Body");
            tb.Foreground = Ui.Brush("Text2");
            Grid.SetColumn(tb, 1);
            g.Children.Add(tb);
            return g;
        }

        // ================= views =================

        internal void ShowView(string v)
        {
            Ui.Show(formView, v == "form");
            Ui.Show(footer, v == "form");
            Ui.Show(progressView, v == "progress");
            Ui.Show(finishView, v == "finish");
            title.Text = v == "form" ? T("Install") : v == "progress" ? T("Installing APL Launcher") : T("Almost done");
            subtitle.Text = v == "form" ? T("Puts APL Launcher on your Samsung screen in a few minutes.")
                          : v == "progress" ? T("Keep the screen on and this PC awake. It takes a few minutes.")
                          : T("APL Launcher is on your screen. Two settings to finish, only once.");
            scroll.ScrollToTop();
            UpdateActions();
        }

        // ================= screen: IP, Vetro status, scan =================

        private void OnIpChanged()
        {
            Main.Ip = ipBox.Text.Trim();
            Main.Vetro = null;
            Main.VetroChecked = false;
            statusSeq++;
            RenderVetro();
            Main.OnScreenChanged();
            debounce.Stop();
            if (Vetro.IsIPv4(Main.Ip) && !Main.Offline) debounce.Start();
        }

        private async void CheckVetro(bool quiet)
        {
            string ip = Main.Ip;
            if (!Vetro.IsIPv4(ip)) return;
            int seq = ++statusSeq;
            if (!quiet) RenderVetro(true);
            var info = await Vetro.StatusAsync(ip, 2500, CancellationToken.None, true);
            if (seq != statusSeq || ip != Main.Ip) return;   // the address changed meanwhile
            bool changed = !Main.VetroChecked || (Main.Vetro == null) != (info == null) ||
                           (info != null && (info.AgentReady != Main.Vetro.AgentReady || info.Version != Main.Vetro.Version));
            Main.Vetro = info;
            Main.VetroChecked = true;
            if (changed || !quiet)
            {
                RenderVetro();
                Main.OnScreenChanged();
            }
        }

        /// <summary>Test hook (--shot): pretends Vetro answered.</summary>
        internal void SetScreen(string ip, VetroInfo info)
        {
            ipBox.Text = ip;
            Main.Vetro = info;
            Main.VetroChecked = true;
            RenderVetro();
            Main.OnScreenChanged();
        }

        private void RenderVetro(bool checkingNow = false)
        {
            vetroMark.Children.Clear();
            vetroHelp.Inlines.Clear();
            Ui.Show(vetroHelp, false);
            string ip = Main.Ip;
            if (!Vetro.IsIPv4(ip))
            {
                vetroMark.Children.Add(Ui.Dot("Text3", 10));
                vetroText.Text = ip.Length == 0 ? T("Type the screen's IP address, or click Find.") : T("This is not an IP address yet (example: 192.168.1.50).");
                vetroText.Foreground = Ui.Brush("Text2");
                return;
            }
            if (checkingNow || !Main.VetroChecked)
            {
                vetroMark.Children.Add(Ui.Spinner(14));
                vetroText.Text = T("Looking for Vetro at {0}…", ip);
                vetroText.Foreground = Ui.Brush("Text2");
                return;
            }
            vetroText.Foreground = Ui.Brush("Text");
            var v = Main.Vetro;
            if (v != null && v.AgentReady)
            {
                vetroMark.Children.Add(Ui.Dot("Green", 10));
                vetroText.Text = string.IsNullOrEmpty(v.Version) ? T("Vetro is running") : T("Vetro is running · version {0}", v.Version);
            }
            else if (v != null)
            {
                vetroMark.Children.Add(Ui.Dot("Orange", 10));
                vetroText.Text = T("Vetro answers, but its root service is not ready yet");
                Ui.Rich(vetroHelp, T("Open Vetro once on the screen and wait a minute."));
                Ui.Show(vetroHelp, true);
            }
            else
            {
                vetroMark.Children.Add(Ui.Dot("Red", 10));
                vetroText.Text = T("Vetro is not responding");
                Ui.Rich(vetroHelp, T("Vetro is required. Check that the screen is on and that Vetro is installed on it. [How to install Vetro]({0})", VetroGuide));
                Ui.Show(vetroHelp, true);
            }
        }

        private async void Scan()
        {
            if (scanning) return;
            scanning = true;
            UpdateActions();
            scanPanel.Children.Clear();
            Ui.Show(scanPanel, true);
            var head = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 0, 0, 10) };
            head.Children.Add(Ui.Spinner(14));
            head.Children.Add(Ui.Text(T("Looking for screens with Vetro on your network…"), "Secondary", new Thickness(10, 0, 0, 0)));
            var bar = new ProgressBar { Height = 4 };
            scanPanel.Children.Add(head);
            scanPanel.Children.Add(bar);
            var progress = new Progress<double>(p => bar.Value = p * 100);
            List<VetroInfo> found;
            try { found = await Vetro.ScanAsync(progress, CancellationToken.None); }
            catch (Exception ex) { Log.Error("scan", ex); found = new List<VetroInfo>(); }
            scanning = false;
            ShowScanResults(found, Vetro.LocalPrefixes().Count == 0);
            UpdateActions();
        }

        /// <summary>The screens that answered, as rows to click. Also used by --shot.</summary>
        internal void ShowScanResults(List<VetroInfo> found, bool noNetwork)
        {
            scanPanel.Children.Clear();
            Ui.Show(scanPanel, true);
            var head = new Grid { Margin = new Thickness(2, 0, 0, 10) };
            head.Children.Add(Ui.Text(found.Count == 0 ? T("No screen found") : found.Count == 1 ? T("1 screen found") : T("{0} screens found", found.Count), "Section"));
            var close = Ui.Button(T("Close"), "Plain", () => Ui.Show(scanPanel, false));
            close.HorizontalAlignment = HorizontalAlignment.Right;
            close.Height = 24;
            close.Margin = new Thickness(0, -6, -10, -6);
            head.Children.Add(close);
            scanPanel.Children.Add(head);
            if (found.Count == 0)
            {
                scanPanel.Children.Add(Ui.Text(noNetwork
                    ? T("This PC is not connected to a local network.")
                    : T("Check that the screen is on, on the same network as this PC, and that Vetro is installed. You can also type its IP address: on the screen, Settings › General › Network › Network Status › IP Settings."), "Secondary"));
                return;
            }
            foreach (var f in found)
            {
                var info = f;
                var g = new Grid();
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.ColumnDefinitions.Add(new ColumnDefinition());
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.Children.Add(Ui.Tile("\uE7F4", "Accent", 28));
                var texts = new StackPanel { Margin = new Thickness(12, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
                texts.Children.Add(new TextBlock { Text = info.Ip, FontSize = 14, FontWeight = FontWeights.SemiBold });
                string sub = string.IsNullOrEmpty(info.Version) ? "Vetro" : "Vetro " + info.Version;
                if (!string.IsNullOrEmpty(info.Model)) sub = info.Model + " · " + sub;
                texts.Children.Add(new TextBlock { Text = sub, FontSize = 12, Foreground = Ui.Brush("Text2"), FontWeight = FontWeights.Normal });
                Grid.SetColumn(texts, 1);
                g.Children.Add(texts);
                var use = new TextBlock { Text = T("Use"), Foreground = Ui.Brush("Link"), VerticalAlignment = VerticalAlignment.Center, FontWeight = FontWeights.SemiBold };
                Grid.SetColumn(use, 2);
                g.Children.Add(use);
                var row = new Button { Style = Ui.Res<Style>("Button.Row"), Content = g, Margin = new Thickness(0, 0, 0, 6) };
                row.Click += (s, e) =>
                {
                    Ui.Show(scanPanel, false);
                    ipBox.Text = info.Ip;
                    // The scan just heard it: show it at once instead of waiting for the next check.
                    Main.Vetro = info;
                    Main.VetroChecked = true;
                    statusSeq++;
                    debounce.Stop();
                    RenderVetro();
                    Main.OnScreenChanged();
                };
                scanPanel.Children.Add(row);
            }
        }

        // ================= this PC (install.ps1 -CheckOnly) =================

        internal void OnScriptsReady() { RunCheck(); }

        private async void RunCheck()
        {
            if (Main.Offline) return;
            if (Main.ScriptsError != null || Main.Runner.Root == null) { RenderPc(); return; }
            if (Main.Runner.Busy) return;
            checking = true;
            Check = null;
            checkError = null;
            RenderPc();
            UpdateActions();
            object answer = null;
            ScriptResult r;
            try
            {
                r = await Main.Runner.Run("install.ps1", new[] { "-CheckOnly" }, T("Checking this PC…"), line =>
                {
                    if (line.Kind == LineKind.Check) answer = line.Json;
                });
            }
            catch (Exception ex)
            {
                Log.Error("check", ex);
                r = new ScriptResult { Ok = false, Message = ex.Message };
            }
            checking = false;
            Check = answer;
            if (answer == null) checkError = r.Ok ? T("The check gave no answer.") : r.Message;
            RenderPc();
            UpdateActions();
        }

        /// <summary>Test hook (--shot).</summary>
        internal void SetCheck(object json)
        {
            Check = json;
            checking = false;
            RenderPc();
            UpdateActions();
        }

        private bool TizenOk { get { return Check != null && Json.Str(Check, "tizen") != null && Json.Str(Check, "sdb") != null; } }

        /// <summary>A valid certificate, or a Tizen signing profile (it can sign without a password file).</summary>
        private bool CertOk
        {
            get
            {
                if (Check == null) return false;
                object cert = Json.Get(Check, "certificate");
                return (cert != null && Json.Bool(cert, "valid")) || !string.IsNullOrEmpty(Json.Str(Check, "profile"));
            }
        }

        private void RenderPc()
        {
            pcRows.Children.Clear();
            if (Main.ScriptsError != null)
            {
                PcRow(Status.Fail, T("The scripts could not be prepared"), Main.ScriptsError);
                return;
            }
            if (checking || (Check == null && checkError == null))
            {
                PcRow(Status.Busy, T("Checking this PC…"), T("A few seconds."));
                return;
            }
            if (Check == null)
            {
                PcRow(Status.Fail, T("This PC could not be checked"), checkError);
                return;
            }

            string tizen = Json.Str(Check, "tizen"), sdb = Json.Str(Check, "sdb");
            if (tizen != null && sdb != null)
                PcRow(Status.Ok, "Tizen Studio", StudioFolder(tizen));
            else if (tizen != null)
                PcRow(Status.Fail, T("Tizen Studio is incomplete"), T("sdb.exe is missing. Install Tizen Studio again, with its command-line tools."),
                      T("Download Tizen Studio"), TizenDownload);
            else
                PcRow(Status.Fail, T("Tizen Studio is not installed"), T("Install Tizen Studio with its command-line tools (CLI) and the Samsung Certificate Extension, then click Check again."),
                      T("Download Tizen Studio"), TizenDownload);

            object cert = Json.Get(Check, "certificate");
            string profile = Json.Str(Check, "profile");
            string dir = cert != null ? Json.Str(cert, "dir") : null, expires = cert != null ? Json.Str(cert, "expires") : null;
            if (cert != null && Json.Bool(cert, "valid"))
                PcRow(Status.Ok, T("Samsung certificate"), expires != null ? T("{0} · valid until {1}", dir, Date(expires)) : dir);
            else if (!string.IsNullOrEmpty(profile))
                PcRow(Status.Ok, T("Samsung certificate"), T("Tizen Studio signing profile “{0}”", profile));
            else if (cert != null)
                PcRow(Status.Warn, T("Your Samsung certificate has expired"),
                      (expires != null ? T("{0} · expired on {1}.", dir, Date(expires)) : dir + ".") + " " +
                      T("Create a new author and distributor certificate in Tizen Studio's Certificate Manager, or with Apps2Samsung."));
            else
                PcRow(Status.Fail, T("No Samsung certificate"),
                      T("The screen only accepts apps signed by you. Create an author and a distributor certificate in Tizen Studio's Certificate Manager (Samsung Certificate Extension), or with Apps2Samsung."));

            // APL Overlay comes built in the launcher's package (hybrid .wgt): no C# compiler or .NET 6 needed on the PC any more.
        }

        /// <summary>C:\tizen-studio\tools\ide\bin\tizen.bat → C:\tizen-studio</summary>
        private static string StudioFolder(string tizenBat)
        {
            int i = tizenBat.IndexOf(@"\tools\", StringComparison.OrdinalIgnoreCase);
            return i > 0 ? tizenBat.Substring(0, i) : tizenBat;
        }

        /// <summary>A row of the "This PC" card; links come as text, url pairs.</summary>
        private void PcRow(Status s, string name, string detail, params string[] links)
        {
            if (pcRows.Children.Count > 0) pcRows.Children.Add(Ui.Separator(new Thickness(38, 0, 0, 0)));
            var g = new Grid { Margin = new Thickness(0, 12, 0, 12) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(38) });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            var badge = Ui.Badge(s, 22);
            badge.HorizontalAlignment = HorizontalAlignment.Left;
            badge.VerticalAlignment = VerticalAlignment.Top;
            badge.Margin = new Thickness(0, 0, 0, 0);
            g.Children.Add(badge);
            var texts = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            texts.Children.Add(Ui.Text(name, "Label"));
            if (!string.IsNullOrEmpty(detail)) texts.Children.Add(Ui.Text(detail, "Secondary", new Thickness(0, 2, 0, 0)));
            if (links.Length > 1)
            {
                var tb = new TextBlock { Style = Ui.Res<Style>("Text.Secondary"), Margin = new Thickness(0, 5, 0, 0) };
                for (int i = 0; i + 1 < links.Length; i += 2)
                {
                    if (i > 0) tb.Inlines.Add(new System.Windows.Documents.Run("   ·   ") { Foreground = Ui.Brush("Text3") });
                    tb.Inlines.Add(Ui.Link(links[i], links[i + 1]));
                }
                texts.Children.Add(tb);
            }
            Grid.SetColumn(texts, 1);
            g.Children.Add(texts);
            pcRows.Children.Add(g);
        }

        // ================= options =================

        internal TextBox AddSite(string name, string url)
        {
            var g = new Grid { Margin = new Thickness(0, 0, 0, 8) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(190) });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var nameBox = new TextBox { Text = name, Tag = T("Name"), Margin = new Thickness(0, 0, 8, 0) };
            var urlBox = new TextBox { Text = url, Tag = "https://…" };
            var remove = new Button { Style = Ui.Res<Style>("Button.Icon"), Content = "\uE711", ToolTip = T("Remove"), Margin = new Thickness(6, 0, 0, 0), FontSize = 11 };
            remove.Click += (s, e) =>
            {
                sitesList.Children.Remove(g);
                if (sitesList.Children.Count == 0) AddSite("", "");
            };
            Grid.SetColumn(urlBox, 1);
            Grid.SetColumn(remove, 2);
            g.Children.Add(nameBox);
            g.Children.Add(urlBox);
            g.Children.Add(remove);
            sitesList.Children.Add(g);
            return nameBox;
        }

        internal void SetKeys(string tmdb, string youtube, string fanart, IEnumerable<Site> sites)
        {
            tmdbBox.Text = tmdb;
            youTubeBox.Text = youtube;
            fanartBox.Text = fanart;
            sitesList.Children.Clear();
            foreach (var s in sites) AddSite(s.Name, s.Url);
            if (sitesList.Children.Count == 0) AddSite("", "");
        }

        private List<Site> Sites()
        {
            var list = new List<Site>();
            foreach (var g in sitesList.Children.OfType<Grid>())
            {
                var boxes = g.Children.OfType<TextBox>().ToList();
                string name = boxes[0].Text.Trim(), url = boxes[1].Text.Trim();
                if (url.Length == 0) continue;
                if (!url.Contains("://")) url = "https://" + url;
                if (name.Length == 0)
                {
                    Uri u;
                    name = Uri.TryCreate(url, UriKind.Absolute, out u) ? u.Host.Replace("www.", "") : url;
                }
                list.Add(new Site { Name = name, Url = url });
            }
            return list;
        }

        // ================= install =================

        private bool CanInstall
        {
            get { return Main.ScreenReady && TizenOk && CertOk && Main.Runner.Root != null && !Main.Runner.Busy; }
        }

        private string Blocker()
        {
            if (Main.ScriptsError != null) return T("The scripts could not be prepared.");
            if (!Vetro.IsIPv4(Main.Ip)) return T("Type the screen's IP address first.");
            if (!Main.VetroChecked) return T("Looking for Vetro on the screen…");
            if (Main.Vetro == null) return T("Vetro must answer on the screen.");
            if (!Main.Vetro.AgentReady) return T("Vetro's root service must be ready.");
            if (Check == null) return checking || checkError == null ? T("Checking this PC…") : T("This PC could not be checked.");
            if (!TizenOk) return T("Tizen Studio is needed on this PC.");
            if (!CertOk) return T("A Samsung certificate is needed.");
            if (Main.Runner.Busy) return T("Wait for the current task to finish ({0}).", Main.Runner.TaskName);
            return null;
        }

        internal override void UpdateActions()
        {
            bool busy = Main.Runner.Busy;
            installButton.IsEnabled = CanInstall;
            findButton.IsEnabled = !scanning;
            checkAgain.IsEnabled = !busy && Main.Runner.Root != null;
            retryButton.IsEnabled = !busy && Main.ScreenReady;
            remapButton.IsEnabled = !busy && Main.ScreenReady;
            openVetro.IsEnabled = Vetro.IsIPv4(Main.Ip);

            string block = Blocker();
            footerMark.Children.Clear();
            footerMark.Children.Add(block == null ? (UIElement)Ui.Dot("Green", 9) : Ui.Dot(Main.VetroChecked || Check != null ? "Orange" : "Text3", 9));
            footerHint.Text = block ?? (Main.Vetro != null && !string.IsNullOrEmpty(Main.Vetro.Version)
                ? T("Ready to install on {0} (Vetro {1}).", Main.Ip, Main.Vetro.Version)
                : T("Ready to install on {0}.", Main.Ip));
        }

        private async void StartInstall()
        {
            if (!CanInstall) return;
            optimizeChosen = optimizeAfter.IsChecked == true;
            string tmdb = tmdbBox.Text.Trim(), yt = youTubeBox.Text.Trim(), fanart = fanartBox.Text.Trim();
            string sitesJson = "[" + string.Join(",", Sites().Select(s => "{\"name\":" + Json.Quote(s.Name) + ",\"url\":" + Json.Quote(s.Url) + "}")) + "]";
            // Base64: JSON quotes do not survive powershell.exe's command line reliably.
            string sitesArg = Convert.ToBase64String(Encoding.UTF8.GetBytes(sitesJson));
            var args = new List<string> { "-Unattended", "-TvIp", Main.Ip, "-Tmdb", tmdb, "-YouTube", yt, "-Fanart", fanart, "-Sites", sitesArg };
            if (aplTvToggle.IsChecked == true) args.Add("-AplTv");

            BeginProgress();
            ScriptResult r;
            try
            {
                r = await Main.Runner.Run("install.ps1", args.ToArray(), T("Installing…"), OnLine, new[] { tmdb, yt, fanart }, true);
            }
            catch (Exception ex)
            {
                Log.Error("install", ex);
                r = new ScriptResult { Ok = false, Message = ex.Message };
            }
            if (r.Ok) await Succeeded(); else Failed(r.Message);
        }

        internal void BeginProgress()
        {
            steps.Reset();
            logBox.Clear();
            details.IsExpanded = false;
            Ui.Show(failCard, false);
            overallBar.BeginAnimation(System.Windows.Controls.Primitives.RangeBase.ValueProperty, null);
            overallBar.Value = 0;
            overallText.Text = T("Starting…");
            overallPercent.Text = "";
            ShowView("progress");
        }

        private void OnLine(ScriptLine l)
        {
            switch (l.Kind)
            {
                case LineKind.Step:
                    SetStep(l.Number, l.Total);
                    AppendLog(logBox, "» " + l.Text);
                    break;
                case LineKind.Result:
                    if (!l.Ok) AppendLog(logBox, "✗ " + l.Text);
                    break;
                case LineKind.Log:
                    if (l.Text.Trim().Length == 0) break;
                    AppendLog(logBox, l.Text);
                    steps.SetLive(l.Text);
                    break;
            }
        }

        /// <summary>Step n of total starts. Public for --shot.</summary>
        internal void SetStep(int n, int total)
        {
            total = Math.Max(total, steps.Count);
            steps.Start(n);
            double pct = Math.Min(97, (n - 1) * 100.0 / total + 4);
            Ui.SetProgress(overallBar, pct);
            if (Main.Offline) { overallBar.BeginAnimation(System.Windows.Controls.Primitives.RangeBase.ValueProperty, null); overallBar.Value = pct; }
            overallText.Text = T("Step {0} of {1}", n, total);
            overallPercent.Text = Percent(pct);
            Main.SetSideDetail(T("Step {0} of {1}", n, total));
        }

        internal void FakeLine(string line) { OnLine(ScriptLine.Parse(line, false)); }

        private async Task Succeeded()
        {
            steps.AllDone();
            Ui.SetProgress(overallBar, 100);
            overallText.Text = T("Done");
            overallPercent.Text = Percent(100);
            await Task.Delay(700);   // let the last checkmark be seen
            ShowFinish(optimizeChosen);
        }

        internal void Failed(string message)
        {
            steps.Fail();
            failText.Text = string.IsNullOrWhiteSpace(message) ? T("The installation did not finish.") : message;
            overallText.Text = T("Stopped");
            Ui.Show(failCard, true);
            details.IsExpanded = true;
            Reveal(failCard);
            UpdateActions();
        }

        internal void ShowFinish(bool optimize)
        {
            optimizeChosen = optimize;
            Ui.Show(continueCard, optimize);
            remapStatus.Children.Clear();
            Ui.Show(remapStatus, false);
            ShowView("finish");
        }

        // ================= finish: hand the buttons to APL Overlay =================

        private async void Remap()
        {
            if (Main.Runner.Busy || !Main.ScreenReady) return;
            SetRemapStatus(Status.Busy, T("Setting up the buttons…"), null);
            var log = new StringBuilder();
            ScriptResult r;
            try
            {
                r = await Main.Runner.Run("05-build-overlay.ps1", new[] { "-TvIp", Main.Ip, "-RemapOnly" }, T("Setting up the buttons…"),
                                          l => { if (l.Kind == LineKind.Log && l.Text.Trim().Length > 0) log.AppendLine(l.Text); }, null, true);
            }
            catch (Exception ex)
            {
                Log.Error("remap", ex);
                r = new ScriptResult { Ok = false, Message = ex.Message };
            }
            if (r.Ok) SetRemapStatus(Status.Ok, T("The buttons are set up. Press Home on the remote to try it."), null);
            else SetRemapStatus(Status.Fail, string.IsNullOrWhiteSpace(r.Message) ? T("The buttons could not be set up.") : r.Message, log.ToString().TrimEnd());
        }

        internal void SetRemapStatus(Status s, string text, string log)
        {
            remapStatus.Children.Clear();
            Ui.Show(remapStatus, true);
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(30) });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            var badge = Ui.Badge(s, 20);
            badge.HorizontalAlignment = HorizontalAlignment.Left;
            badge.VerticalAlignment = VerticalAlignment.Top;
            g.Children.Add(badge);
            var tb = Ui.Text(text, "Body");
            if (s == Status.Busy) tb.Foreground = Ui.Brush("Text2");
            Grid.SetColumn(tb, 1);
            g.Children.Add(tb);
            remapStatus.Children.Add(g);
            if (!string.IsNullOrEmpty(log))
            {
                var exp = new Expander { Header = T("Details"), Margin = new Thickness(30, 8, 0, 0) };
                var box = new TextBox { Style = Ui.Res<Style>("LogBox"), Height = 160, Text = log };
                exp.Content = box;
                remapStatus.Children.Add(exp);
            }
            Reveal(remapStatus);
        }
    }
}
