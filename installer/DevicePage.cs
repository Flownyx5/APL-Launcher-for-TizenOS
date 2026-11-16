using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using static APL.Setup.Strings;

namespace APL.Setup
{
    /// <summary>
    /// Install on an LG TV (webOS: scripts\install-webos.ps1) or an Android TV (scripts\install-android.ps1).
    /// The same page for both; what it asks depends on the TV and on root (chosen on the first page).
    /// </summary>
    internal sealed class DevicePage : Page
    {
        private const string LgDeveloper = "https://webostv.developer.lge.com/develop/getting-started/developer-mode-app";
        private const string WtfBro = "https://e.nya.je/getroot/";

        private readonly bool lg;
        private readonly string script, ipFile;
        private bool rooted = true;

        private readonly ScrollViewer scroll;
        private readonly TextBlock title, subtitle, footerHint, overallText, overallPercent, failText, doneText;
        private readonly StackPanel formView, progressView, finishView, finishSteps;
        private readonly Grid footerMark, failMark, doneMark;
        private readonly Border footer, failCard;
        private readonly Button installButton, retryButton, backButton, newInstall;
        private readonly ProgressBar overallBar;
        private readonly Expander details;
        private readonly TextBox logBox;
        private StepList steps;

        // the form
        private TextBox ipBox, passwordBox, passphraseBox, pairPortBox, pairCodeBox, tmdbBox, youTubeBox, fanartBox;
        private CheckBox homeToggle, debloatToggle, homeServiceToggle, aplTvToggle, fourKToggle;
        private bool withAplTv;     // what the running install was asked for (its list of steps)

        private static string AplTvHelp()
        {
            return T("The IPTV player in the same style, for your own M3U playlists, Xtream accounts and Jellyfin, Emby or Plex servers. It comes with no channels. Its Continue Watching shows on APL Launcher's Home Screen.");
        }
        private Grid statusMark;
        private TextBlock statusText, statusHelp, pcText;
        private Grid pcMark;
        private StackPanel accessBody, scanPanel;
        private Button findButton;
        private List<Site> sites = new List<Site>();

        private object check;
        private bool checking, scanning;
        private string checkError;
        private Dictionary<int, bool> ports;      // what answered at the IP typed
        private int seq;
        private readonly DispatcherTimer debounce;

        internal DevicePage(MainWindow main, string platform) : base(main, platform, "DevicePage.xaml")
        {
            lg = platform == "webos";
            script = lg ? "install-webos.ps1" : "install-android.ps1";
            ipFile = lg ? "webos-ip.txt" : "android-ip.txt";
            scroll = F<ScrollViewer>("Scroll");
            title = F<TextBlock>("PageTitle");
            subtitle = F<TextBlock>("PageSubtitle");
            formView = F<StackPanel>("FormView");
            progressView = F<StackPanel>("ProgressView");
            finishView = F<StackPanel>("FinishView");
            finishSteps = F<StackPanel>("FinishSteps");
            footerHint = F<TextBlock>("FooterHint");
            overallText = F<TextBlock>("OverallText");
            overallPercent = F<TextBlock>("OverallPercent");
            failText = F<TextBlock>("FailText");
            doneText = F<TextBlock>("DoneText");
            footerMark = F<Grid>("FooterMark");
            failMark = F<Grid>("FailMark");
            doneMark = F<Grid>("DoneMark");
            footer = F<Border>("Footer");
            failCard = F<Border>("FailCard");
            installButton = F<Button>("InstallButton");
            retryButton = F<Button>("RetryButton");
            backButton = F<Button>("BackButton");
            newInstall = F<Button>("NewInstall");
            overallBar = F<ProgressBar>("OverallBar");
            details = F<Expander>("Details");
            logBox = F<TextBox>("LogBox");
            failMark.Children.Add(Ui.Badge(Status.Fail, 24));
            doneMark.Children.Add(Ui.Badge(Status.Ok, 46));

            installButton.Click += (s, e) => StartInstall();
            retryButton.Click += (s, e) => StartInstall();
            backButton.Click += (s, e) => ShowView("form");
            newInstall.Click += (s, e) => ShowView("form");
            debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            debounce.Tick += (s, e) => { debounce.Stop(); Probe(); };

            BuildForm();
            ShowView("form");
        }

        internal string Ip { get { return ipBox.Text.Trim(); } }

        // ================= the form =================

        private void BuildForm()
        {
            formView.Children.Clear();

            // ---- the TV ----
            StackPanel body;
            formView.Children.Add(Card("", lg ? "Red" : "Green", T("TV"),
                lg ? T("Your LG TV, turned on and on the same network as this PC.") : T("Your Android TV or Google TV, turned on and on the same network as this PC."), out body));
            body.Children.Add(Ui.Text(T("IP address of the TV"), "Section", new Thickness(2, 0, 0, 8)));
            var ipRow = new Grid();
            ipRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(240) });
            ipRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ipRow.ColumnDefinitions.Add(new ColumnDefinition());
            ipBox = new TextBox { Tag = "192.168.1.50" };
            ipRow.Children.Add(ipBox);
            findButton = new Button { Style = Ui.Res<Style>("Button.Secondary"), Margin = new Thickness(10, 0, 0, 0) };
            var fb = new StackPanel { Orientation = Orientation.Horizontal };
            fb.Children.Add(new TextBlock { Style = Ui.Res<Style>("Text.Icon"), Text = "", FontSize = 13, Margin = new Thickness(0, 1, 9, 0) });
            fb.Children.Add(new TextBlock { Text = T("Find") });
            findButton.Content = fb;
            Grid.SetColumn(findButton, 1);
            ipRow.Children.Add(findButton);
            body.Children.Add(ipRow);
            var st = new Grid { Margin = new Thickness(2, 14, 0, 0) };
            st.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(20) });
            st.ColumnDefinitions.Add(new ColumnDefinition());
            statusMark = new Grid { Width = 14, Height = 14, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 3, 0, 0) };
            st.Children.Add(statusMark);
            var stTexts = new StackPanel();
            statusText = Ui.Text("", "Body");
            statusHelp = Ui.Text("", "Secondary", new Thickness(0, 3, 0, 0));
            stTexts.Children.Add(statusText);
            stTexts.Children.Add(statusHelp);
            Grid.SetColumn(stTexts, 1);
            st.Children.Add(stTexts);
            body.Children.Add(st);
            scanPanel = new StackPanel { Visibility = Visibility.Collapsed, Margin = new Thickness(0, 18, 0, 0) };
            body.Children.Add(scanPanel);
            ipBox.TextChanged += (s, e) => OnIpChanged();
            findButton.Click += (s, e) => Scan();

            // ---- access: root, Developer Mode, or adb ----
            formView.Children.Add(Card(lg ? "" : "", "Indigo", lg ? (rooted ? T("Root access") : T("Developer Mode")) : T("Debugging"),
                lg ? (rooted ? T("The Setup connects to the TV over SSH, as root.") : T("LG's own way to install apps from a PC, without root."))
                   : T("adb, Android's own tool: the Setup finds it or downloads it from Google."), out accessBody));
            if (lg && rooted)
            {
                accessBody.Children.Add(Field(T("Root password"), T("SSH, as set in the Homebrew Channel. alpine unless you changed it."), out passwordBox, "alpine"));
                accessBody.Children.Add(Ui.Text(T("Not rooted yet? [Root an LG TV with WTFBro]({0}) (depends on the TV's firmware), then the Homebrew Channel's settings: SSH Server on.", WtfBro), "Secondary", new Thickness(2, 6, 0, 4)));
            }
            else if (lg)
            {
                string[] how =
                {
                    T("On the TV, install **Developer Mode** from LG's app store, and sign in with an LG developer account ([free]({0})).", LgDeveloper),
                    T("Turn on **Dev Mode Status** (the TV restarts), then open Developer Mode again and turn on **Key Server**."),
                    T("Type the **passphrase** it shows (6 characters) below.")
                };
                for (int i = 0; i < how.Length; i++) accessBody.Children.Add(InstallPage.Numbered(i + 1, how[i]));
                accessBody.Children.Add(Ui.Separator(new Thickness(0, 8, 0, 4)));
                accessBody.Children.Add(Field(T("Passphrase"), T("Shown in the Developer Mode app, under Key Server."), out passphraseBox, "A1B2C3"));
            }
            else
            {
                string[] how =
                {
                    T("On the TV, **Settings › Device Preferences › About**: press OK seven times on **Build** (Android TV OS build on Google TV)."),
                    T("In **Developer options**, turn on **USB debugging** or **Network debugging**."),
                    T("Click Install, then on the TV allow debugging from this PC (tick **Always allow**).")
                };
                for (int i = 0; i < how.Length; i++) accessBody.Children.Add(InstallPage.Numbered(i + 1, how[i]));
                accessBody.Children.Add(Ui.Separator(new Thickness(0, 8, 0, 4)));
                var pair = new Grid { Margin = new Thickness(0, 12, 0, 4) };
                pair.ColumnDefinitions.Add(new ColumnDefinition());
                pair.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
                pair.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
                var pt = new StackPanel { Margin = new Thickness(0, 0, 16, 0), VerticalAlignment = VerticalAlignment.Center };
                pt.Children.Add(Ui.Text(T("Pairing code (optional)"), "Label"));
                pt.Children.Add(Ui.Text(T("Only with Wireless debugging (Android 11 and later): its port and code, from “Pair device with pairing code”."), "Secondary", new Thickness(0, 2, 0, 0)));
                pair.Children.Add(pt);
                pairPortBox = new TextBox { Tag = T("Port"), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
                pairCodeBox = new TextBox { Tag = T("Code"), VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(pairPortBox, 1);
                Grid.SetColumn(pairCodeBox, 2);
                pair.Children.Add(pairPortBox);
                pair.Children.Add(pairCodeBox);
                accessBody.Children.Add(pair);
            }
            var pcRow = new Grid { Margin = new Thickness(2, 10, 0, 0) };
            pcRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(20) });
            pcRow.ColumnDefinitions.Add(new ColumnDefinition());
            pcMark = new Grid { Width = 14, Height = 14, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 3, 0, 0) };
            pcRow.Children.Add(pcMark);
            pcText = Ui.Text("", "Secondary");
            Grid.SetColumn(pcText, 1);
            pcRow.Children.Add(pcText);
            accessBody.Children.Add(pcRow);

            // ---- options ----
            StackPanel opts;
            formView.Children.Add(Card("", "Purple", T("Options"), T("All optional. Leave a key empty to do without that feature."), out opts));
            // The keys: in the package on LG; sent to the app over adb on Android TV (its .apk is signed with APL Launcher's key)
            opts.Children.Add(Field(T("TMDB key"), T("The live Top Shelf, and artwork for films and series."), out tmdbBox, T("Not set")));
            opts.Children.Add(Ui.Separator(new Thickness(0)));
            opts.Children.Add(Field(T("YouTube key"), T("Shows YouTube trends in the Top Shelf."), out youTubeBox, T("Not set")));
            opts.Children.Add(Ui.Separator(new Thickness(0)));
            opts.Children.Add(Field(T("Fanart.tv key"), T("HD logos and textless backgrounds."), out fanartBox, T("Not set")));
            if (lg)
            {
                if (rooted)
                {
                    opts.Children.Add(Ui.Separator(new Thickness(0)));
                    opts.Children.Add(ToggleRow(T("Home opens APL Launcher"), T("The TV also starts on it, and Guide opens the Control Center. Settings › General & Privacy switches back to LG's Home."), out homeToggle, Saved.LgHomeIsApl()));
                    opts.Children.Add(Ui.Separator(new Thickness(0)));
                    opts.Children.Add(ToggleRow(T("Debloat the TV"), T("Stops LG's ads, viewing tracking, telemetry and extra services (about 390 MB of memory freed on a G5). The TV's software updates stay blocked either way: they would remove the root."), out debloatToggle, true));
                }
                opts.Children.Add(Ui.Separator(new Thickness(0)));
                opts.Children.Add(ToggleRow(T("Interface in 4K"), T("Sharper text and glass, but less smooth: in 4K the TV spends about 10 ms of each frame on the picture alone. Off: 1920 x 1080, enlarged by the TV, smooth everywhere. On a rooted TV it can be changed later in Settings › Appearance."), out fourKToggle, false));
                opts.Children.Add(Ui.Separator(new Thickness(0)));
                opts.Children.Add(ToggleRow(T("Also install APL TV"), AplTvHelp(), out aplTvToggle, true));
                if (!rooted) opts.Children.Add(Ui.Text(T("The debloat (LG's ads and tracking stopped) needs a rooted TV."), "Secondary", new Thickness(2, 4, 0, 4)));
            }
            else
            {
                opts.Children.Add(Ui.Separator(new Thickness(0)));
                opts.Children.Add(ToggleRow(T("Home opens APL Launcher"), T("Turns on APL Launcher's remote buttons service (Accessibility). Twice Home: the App Switcher; held: the Control Center."), out homeServiceToggle, true));
                opts.Children.Add(Ui.Separator(new Thickness(0)));
                opts.Children.Add(ToggleRow(T("Also install APL TV"), AplTvHelp(), out aplTvToggle, true));
            }
            RenderStatus();
            RenderPc();
        }

        private Border Card(string glyph, string color, string head, string sub, out StackPanel body)
        {
            var card = new Border { Style = Ui.Res<Style>("Card") };
            var sp = new StackPanel();
            card.Child = sp;
            var g = new Grid { Margin = new Thickness(0, 0, 0, 14) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            var tile = new Border { Style = Ui.Res<Style>("IconTile"), Background = Ui.Brush(color) };
            tile.Child = new TextBlock { Style = Ui.Res<Style>("Text.Icon"), Text = glyph, Foreground = Brushes.White };
            g.Children.Add(tile);
            var texts = new StackPanel { Margin = new Thickness(14, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            texts.Children.Add(Ui.Text(head, "H2"));
            texts.Children.Add(Ui.Text(sub, "Secondary", new Thickness(0, 2, 0, 0)));
            Grid.SetColumn(texts, 1);
            g.Children.Add(texts);
            sp.Children.Add(g);
            body = sp;
            return card;
        }

        private static FrameworkElement Field(string label, string help, out TextBox box, string placeholder)
        {
            var g = new Grid { Margin = new Thickness(0, 12, 0, 12) };
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(290) });
            var t = new StackPanel { Margin = new Thickness(0, 0, 20, 0), VerticalAlignment = VerticalAlignment.Center };
            t.Children.Add(Ui.Text(label, "Label"));
            t.Children.Add(Ui.Text(help, "Secondary", new Thickness(0, 2, 0, 0)));
            g.Children.Add(t);
            box = new TextBox { Tag = placeholder, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(box, 1);
            g.Children.Add(box);
            return g;
        }

        private static FrameworkElement ToggleRow(string label, string help, out CheckBox toggle, bool on)
        {
            var g = new Grid { Margin = new Thickness(0, 14, 0, 12) };
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var t = new StackPanel { Margin = new Thickness(0, 0, 20, 0), VerticalAlignment = VerticalAlignment.Center };
            t.Children.Add(Ui.Text(label, "Label"));
            var h = Ui.Text(help, "Secondary", new Thickness(0, 2, 0, 0));
            h.TextWrapping = TextWrapping.Wrap;
            t.Children.Add(h);
            g.Children.Add(t);
            toggle = new CheckBox { Style = Ui.Res<Style>("Toggle"), IsChecked = on, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(toggle, 1);
            g.Children.Add(toggle);
            return g;
        }

        /// <summary>Root or not (LG), from the first page: the form changes, what was typed stays.</summary>
        internal void SetRooted(bool r)
        {
            if (!lg) r = true;
            if (r == rooted && ipBox != null) return;
            string ip = ipBox != null ? ipBox.Text : "", pw = passwordBox != null ? passwordBox.Text : "", pass = passphraseBox != null ? passphraseBox.Text : "";
            string tm = tmdbBox != null ? tmdbBox.Text : "", yt = youTubeBox != null ? youTubeBox.Text : "", fa = fanartBox != null ? fanartBox.Text : "";
            bool tv = aplTvToggle == null || aplTvToggle.IsChecked == true;
            rooted = r;
            passwordBox = passphraseBox = null;
            BuildForm();
            aplTvToggle.IsChecked = tv;
            ipBox.Text = ip;
            if (passwordBox != null) passwordBox.Text = pw;
            if (passphraseBox != null) passphraseBox.Text = pass;
            if (tmdbBox != null) { tmdbBox.Text = tm; youTubeBox.Text = yt; fanartBox.Text = fa; }
            ShowView("form");
        }

        internal void Prefill()
        {
            ipBox.Text = SavedIp();
            var k = Saved.Keys();
            tmdbBox.Text = k.Tmdb; youTubeBox.Text = k.YouTube; fanartBox.Text = k.Fanart;
            if (lg) sites = k.Sites;
        }

        private string SavedIp()
        {
            try
            {
                string f = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "APL-Launcher", ipFile);
                return System.IO.File.Exists(f) ? System.IO.File.ReadAllText(f).Trim() : "";
            }
            catch { return ""; }
        }

        // ================= views =================

        internal void ShowView(string v)
        {
            Ui.Show(formView, v == "form");
            Ui.Show(footer, v == "form");
            Ui.Show(progressView, v == "progress");
            Ui.Show(finishView, v == "finish");
            string tv = lg ? T("LG TV") : "Android TV";
            title.Text = v == "form" ? T("Install on {0}", lg ? "LG" : "Android TV") : v == "progress" ? T("Installing APL Launcher") : T("Done");
            subtitle.Text = v == "form" ? (lg ? (rooted ? T("Rooted LG TV: APL Launcher with every root feature, in about a minute.") : T("LG TV without root: APL Launcher through LG's Developer Mode."))
                                              : T("APL Launcher as the TV's launcher, in a minute."))
                          : v == "progress" ? T("Keep the TV on and this PC awake.") : T("APL Launcher is on your {0}.", tv);
            scroll.ScrollToTop();
            UpdateActions();
        }

        // ================= the TV at that address =================

        private void OnIpChanged()
        {
            ports = null;
            seq++;
            RenderStatus();
            Main.OnScreenChanged();
            debounce.Stop();
            if (Vetro.IsIPv4(Ip) && !Main.Offline) debounce.Start();
        }

        private int[] PortsToTry { get { return lg ? new[] { 3001, 22, 9922, 9991 } : new[] { 5555 }; } }

        private async void Probe()
        {
            string ip = Ip;
            if (!Vetro.IsIPv4(ip)) return;
            int mine = ++seq;
            RenderStatus(true);
            var result = await ProbeAsync(ip, PortsToTry, 900);
            if (mine != seq || ip != Ip) return;
            ports = result;
            RenderStatus();
            Main.OnScreenChanged();
        }

        private static async Task<Dictionary<int, bool>> ProbeAsync(string ip, int[] list, int timeoutMs)
        {
            var tasks = list.Select(p => Open(ip, p, timeoutMs)).ToArray();
            bool[] r = await Task.WhenAll(tasks);
            var d = new Dictionary<int, bool>();
            for (int i = 0; i < list.Length; i++) d[list[i]] = r[i];
            return d;
        }

        private static async Task<bool> Open(string ip, int port, int timeoutMs)
        {
            using (var c = new TcpClient())
            {
                try
                {
                    var connect = c.ConnectAsync(ip, port);
                    var done = await Task.WhenAny(connect, Task.Delay(timeoutMs));
                    if (done != connect) return false;
                    await connect;
                    return c.Connected;
                }
                catch { return false; }
            }
        }

        private bool Has(int port) { bool b; return ports != null && ports.TryGetValue(port, out b) && b; }

        /// <summary>Test hook (--shot): what answered.</summary>
        internal void SetScreen(string ip, params int[] open)
        {
            ipBox.Text = ip;
            ports = PortsToTry.ToDictionary(p => p, p => open.Contains(p));
            RenderStatus();
            Main.OnScreenChanged();
        }

        private void RenderStatus(bool checkingNow = false)
        {
            statusMark.Children.Clear();
            Ui.Show(statusHelp, false);
            statusText.Foreground = Ui.Brush("Text2");
            string ip = Ip;
            if (!Vetro.IsIPv4(ip))
            {
                statusMark.Children.Add(Ui.Dot("Text3", 10));
                statusText.Text = ip.Length == 0 ? T("Type the TV's IP address, or click Find.") : T("This is not an IP address yet (example: 192.168.1.50).");
                return;
            }
            if (checkingNow || ports == null)
            {
                statusMark.Children.Add(Ui.Spinner(14));
                statusText.Text = T("Looking for the TV at {0}…", ip);
                return;
            }
            statusText.Foreground = Ui.Brush("Text");
            string color, text, help = null;
            if (lg && rooted)
            {
                if (Has(22)) { color = "Green"; text = T("SSH answers: rooted LG TV ready"); }
                else if (Has(3001)) { color = "Orange"; text = T("LG TV found, but SSH doesn't answer"); help = T("In the Homebrew Channel's settings, turn on SSH Server. Not rooted? Turn the root switch off on the first page."); }
                else { color = "Red"; text = T("No LG TV answers at this address"); help = T("Check that the TV is on and on the same network (Settings › Network › Wi-Fi Connection › Advanced Wi-Fi Settings for its IP)."); }
            }
            else if (lg)
            {
                if (Has(9922) && Has(9991)) { color = "Green"; text = T("Developer Mode is on, Key Server too"); }
                else if (Has(9922)) { color = "Orange"; text = T("Developer Mode is on, Key Server is off"); help = T("In the Developer Mode app, turn on Key Server."); }
                else if (Has(3001)) { color = "Orange"; text = T("LG TV found, Developer Mode is off"); help = T("Follow the steps below, then the status here turns green."); }
                else { color = "Red"; text = T("No LG TV answers at this address"); help = T("Check that the TV is on and on the same network (Settings › Network › Wi-Fi Connection › Advanced Wi-Fi Settings for its IP)."); }
            }
            else
            {
                if (Has(5555)) { color = "Green"; text = T("Network debugging answers"); }
                else { color = "Orange"; text = T("No answer on port 5555 yet"); help = T("Turn on Network debugging (or Wireless debugging with a pairing code) in the TV's Developer options. The Setup tries again when you click Install."); }
            }
            statusMark.Children.Add(Ui.Dot(color, 10));
            statusText.Text = text;
            if (help != null) { Ui.Rich(statusHelp, help); Ui.Show(statusHelp, true); }
        }

        /// <summary>Find: the TVs that answer on the local network (LG: port 3001; Android: adb's 5555).</summary>
        private async void Scan()
        {
            if (scanning) return;
            scanning = true;
            UpdateActions();
            scanPanel.Children.Clear();
            Ui.Show(scanPanel, true);
            var head = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 0, 0, 10) };
            head.Children.Add(Ui.Spinner(14));
            head.Children.Add(Ui.Text(lg ? T("Looking for LG TVs on your network…") : T("Looking for Android TVs with Network debugging on your network…"), "Secondary", new Thickness(10, 0, 0, 0)));
            var bar = new ProgressBar { Height = 4 };
            scanPanel.Children.Add(head);
            scanPanel.Children.Add(bar);
            var found = new List<KeyValuePair<string, Dictionary<int, bool>>>();
            try
            {
                var targets = new List<string>();
                foreach (string prefix in Vetro.LocalPrefixes().Take(4)) for (int i = 1; i <= 254; i++) targets.Add(prefix + i);
                int done = 0, main = lg ? 3001 : 5555;
                using (var gate = new SemaphoreSlim(64))
                {
                    var all = targets.Select(async ip =>
                    {
                        await gate.WaitAsync();
                        try
                        {
                            if (await Open(ip, main, 500))
                            {
                                var p = await ProbeAsync(ip, PortsToTry, 900);
                                lock (found) found.Add(new KeyValuePair<string, Dictionary<int, bool>>(ip, p));
                            }
                        }
                        finally
                        {
                            gate.Release();
                            int n = Interlocked.Increment(ref done);
                            if (n % 16 == 0) await bar.Dispatcher.InvokeAsync(() => bar.Value = n * 100.0 / targets.Count);
                        }
                    }).ToArray();
                    await Task.WhenAll(all);
                }
            }
            catch (Exception ex) { Log.Error("scan", ex); }
            scanning = false;
            ShowScanResults(found.OrderBy(f => f.Key, StringComparer.Ordinal).ToList());
            UpdateActions();
        }

        internal void ShowScanResults(List<KeyValuePair<string, Dictionary<int, bool>>> found)
        {
            scanPanel.Children.Clear();
            Ui.Show(scanPanel, true);
            var head = new Grid { Margin = new Thickness(2, 0, 0, 10) };
            head.Children.Add(Ui.Text(found.Count == 0 ? T("No TV found") : found.Count == 1 ? T("1 TV found") : T("{0} TVs found", found.Count), "Section"));
            var close = Ui.Button(T("Close"), "Plain", () => Ui.Show(scanPanel, false));
            close.HorizontalAlignment = HorizontalAlignment.Right;
            close.Height = 24;
            close.Margin = new Thickness(0, -6, -10, -6);
            head.Children.Add(close);
            scanPanel.Children.Add(head);
            if (found.Count == 0)
            {
                scanPanel.Children.Add(Ui.Text(lg ? T("Check that the TV is on and on the same network as this PC, or type its IP address.")
                                                  : T("Network debugging must be on (Developer options). Or type the TV's IP address."), "Secondary", new Thickness(2, 0, 0, 0)));
                return;
            }
            foreach (var f in found)
            {
                var hit = f;
                var g = new Grid();
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.ColumnDefinitions.Add(new ColumnDefinition());
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.Children.Add(Ui.Tile("", lg ? "Red" : "Green", 28));
                var texts = new StackPanel { Margin = new Thickness(12, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
                texts.Children.Add(new TextBlock { Text = hit.Key, FontSize = 14, FontWeight = FontWeights.SemiBold });
                bool b;
                string sub = lg ? "LG" + (hit.Value.TryGetValue(22, out b) && b ? " · " + T("SSH root") : "") + (hit.Value.TryGetValue(9922, out b) && b ? " · " + T("Developer Mode") : "")
                                : T("Network debugging");
                texts.Children.Add(new TextBlock { Text = sub, FontSize = 12, Foreground = Ui.Brush("Text2") });
                Grid.SetColumn(texts, 1);
                g.Children.Add(texts);
                var use = new TextBlock { Text = T("Use"), Foreground = Ui.Brush("Link"), VerticalAlignment = VerticalAlignment.Center, FontWeight = FontWeights.SemiBold };
                Grid.SetColumn(use, 2);
                g.Children.Add(use);
                var row = new Button { Style = Ui.Res<Style>("Button.Row"), Content = g, Margin = new Thickness(0, 0, 0, 6) };
                row.Click += (s, e) =>
                {
                    Ui.Show(scanPanel, false);
                    ipBox.Text = hit.Key;
                    debounce.Stop();
                    seq++;
                    ports = hit.Value;
                    RenderStatus();
                    Main.OnScreenChanged();
                };
                scanPanel.Children.Add(row);
            }
        }

        // ================= this PC (the script's -CheckOnly) =================

        internal async void RunCheck()
        {
            if (Main.Offline || Main.Runner.Root == null || Main.Runner.Busy || checking) return;
            checking = true;
            check = null;
            checkError = null;
            RenderPc();
            object answer = null;
            ScriptResult r;
            try { r = await Main.Runner.Run(script, new[] { "-CheckOnly" }, T("Checking this PC…"), l => { if (l.Kind == LineKind.Check) answer = l.Json; }); }
            catch (Exception ex) { Log.Error("check " + script, ex); r = new ScriptResult { Ok = false, Message = ex.Message }; }
            checking = false;
            check = answer;
            if (answer == null) checkError = r.Ok ? T("The check gave no answer.") : r.Message;
            RenderPc();
            UpdateActions();
        }

        internal void SetCheck(object json) { check = json; checking = false; RenderPc(); UpdateActions(); }

        private bool PcOk
        {
            get
            {
                if (check == null) return false;
                if (!lg) return true;                                   // adb is downloaded when missing
                return !string.IsNullOrEmpty(Json.Str(check, rooted ? "password" : "ssh"));
            }
        }

        private void RenderPc()
        {
            if (pcMark == null) return;
            pcMark.Children.Clear();
            if (check == null)
            {
                pcMark.Children.Add(checking || checkError == null ? (UIElement)Ui.Spinner(14) : Ui.Dot("Red", 10));
                pcText.Text = checking || checkError == null ? T("Checking this PC…") : checkError;
                return;
            }
            if (lg)
            {
                string ssh = Json.Str(check, rooted ? "password" : "ssh"), v = Json.Str(check, "sshVersion");
                if (!string.IsNullOrEmpty(ssh)) { pcMark.Children.Add(Ui.Dot("Green", 10)); pcText.Text = T("This PC: SSH ready (OpenSSH {0}).", v ?? "?"); }
                else if (rooted && !string.IsNullOrEmpty(Json.Str(check, "ssh")))
                {
                    pcMark.Children.Add(Ui.Dot("Red", 10));
                    Ui.Rich(pcText, T("This PC's SSH (OpenSSH {0}) can't take the password on its own: install [Git for Windows](https://git-scm.com/download/win), or update Windows.", v ?? "?"));
                }
                else { pcMark.Children.Add(Ui.Dot("Red", 10)); pcText.Text = T("No SSH client: Windows Settings › System › Optional features › OpenSSH Client."); }
            }
            else
            {
                string adb = Json.Str(check, "adb"), apk = Json.Str(check, "apk");
                pcMark.Children.Add(Ui.Dot("Green", 10));
                pcText.Text = (string.IsNullOrEmpty(adb) ? T("adb will be downloaded from Google (about 7 MB).") : T("adb: {0}", adb)) + " " +
                              (string.IsNullOrEmpty(apk) ? T("The package comes from the latest GitHub release.") : T("Package: {0}", System.IO.Path.GetFileName(apk)));
            }
        }

        // ================= install =================

        private bool CanInstall { get { return Blocker() == null; } }

        private string Blocker()
        {
            if (Main.ScriptsError != null) return T("The scripts could not be prepared.");
            if (!Vetro.IsIPv4(Ip)) return T("Type the TV's IP address first.");
            if (check == null) return checking || checkError == null ? T("Checking this PC…") : T("This PC could not be checked.");
            if (!PcOk) return T("This PC needs an SSH client (see above).");
            if (lg && !rooted && (passphraseBox == null || passphraseBox.Text.Trim().Length < 4)) return T("Type Developer Mode's passphrase.");
            if (Main.Runner.Busy) return T("Wait for the current task to finish ({0}).", Main.Runner.TaskName);
            return null;
        }

        internal override void UpdateActions()
        {
            if (installButton == null || findButton == null) return;
            installButton.IsEnabled = CanInstall;
            findButton.IsEnabled = !scanning;
            retryButton.IsEnabled = !Main.Runner.Busy;
            string block = Blocker();
            footerMark.Children.Clear();
            footerMark.Children.Add(Ui.Dot(block == null ? "Green" : "Orange", 9));
            footerHint.Text = block ?? T("Ready to install on {0}.", Ip);
        }

        private async void StartInstall()
        {
            if (!CanInstall) return;
            var args = new List<string> { "-Unattended", "-TvIp", Ip };
            var secrets = new List<string>();
            string tm = tmdbBox.Text.Trim(), yt = youTubeBox.Text.Trim(), fa = fanartBox.Text.Trim();
            secrets.AddRange(new[] { tm, yt, fa });
            if (lg)
            {
                string sitesJson = "[" + string.Join(",", sites.Select(s => "{\"name\":" + Json.Quote(s.Name) + ",\"url\":" + Json.Quote(s.Url) + "}")) + "]";
                args.AddRange(new[] { "-Tmdb", tm, "-YouTube", yt, "-Fanart", fa, "-Sites", Convert.ToBase64String(Encoding.UTF8.GetBytes(sitesJson)) });
                if (fourKToggle != null && fourKToggle.IsChecked == true) args.Add("-FourK");
                if (rooted)
                {
                    string pw = passwordBox.Text.Length > 0 ? passwordBox.Text : "alpine";
                    args.Add("-Rooted");
                    args.Add("-Password"); args.Add(Convert.ToBase64String(Encoding.UTF8.GetBytes(pw)));
                    if (homeToggle.IsChecked != true) args.Add("-NoHome");
                    Saved.SaveLgHome(homeToggle.IsChecked == true);     // the same choice next time
                    if (debloatToggle.IsChecked != true) args.Add("-NoDebloat");
                }
                else
                {
                    args.Add("-Passphrase"); args.Add(passphraseBox.Text.Trim());
                    secrets.Add(passphraseBox.Text.Trim());
                }
            }
            else
            {
                if (pairPortBox.Text.Trim().Length > 0 && pairCodeBox.Text.Trim().Length > 0)
                {
                    args.AddRange(new[] { "-PairPort", pairPortBox.Text.Trim(), "-PairCode", pairCodeBox.Text.Trim() });
                    secrets.Add(pairCodeBox.Text.Trim());
                }
                args.AddRange(new[] { "-Tmdb", tm, "-YouTube", yt, "-Fanart", fa });
                if (homeServiceToggle.IsChecked != true) args.Add("-NoHomeService");
            }
            withAplTv = aplTvToggle.IsChecked == true;
            if (withAplTv) args.Add("-AplTv");
            BeginProgress();
            ScriptResult r;
            try { r = await Main.Runner.Run(script, args, T("Installing…"), OnLine, secrets.Where(s => s.Length > 0), true); }
            catch (Exception ex) { Log.Error("install " + script, ex); r = new ScriptResult { Ok = false, Message = ex.Message }; }
            if (r.Ok) await Succeeded(); else Failed(r.Message);
        }

        // The steps, in the scripts' order (APL TV after the launcher, before the root features)
        private string[] StepTitles()
        {
            var t = new List<string>();
            if (lg)
            {
                t.AddRange(new[] { T("Package"), T("Connection"), T("Install") });
                if (withAplTv) t.Add("APL TV");
                if (rooted) t.Add(T("Root features"));
                t.Add(T("Opening"));
            }
            else
            {
                t.AddRange(new[] { T("Tools"), T("Package"), T("Connection"), T("Install") });
                if (withAplTv) t.Add("APL TV");
            }
            return t.ToArray();
        }

        private string[] StepDetails()
        {
            var d = new List<string>();
            if (lg)
            {
                d.AddRange(new[] { T("APL Launcher with your keys"), rooted ? T("SSH, as root") : T("Developer Mode's key"), T("LG's own installer") });
                if (withAplTv) d.Add(T("The IPTV player, from its latest release"));
                if (rooted) d.Add(T("Home, picture settings, debloat"));
                d.Add(T("APL Launcher opens on the TV"));
            }
            else
            {
                d.AddRange(new[] { T("adb on this PC"), T("APL Launcher for Android"), T("Allow this PC on the TV"), T("The package, then Home") });
                if (withAplTv) d.Add(T("The IPTV player, from its latest release"));
            }
            return d.ToArray();
        }

        internal void BeginProgress()
        {
            steps = new StepList(F<StackPanel>("Steps"), StepTitles(), StepDetails());
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
                case LineKind.Step: SetStep(l.Number, l.Total); AppendLog(logBox, "» " + l.Text); break;
                case LineKind.Result: if (!l.Ok) AppendLog(logBox, "✗ " + l.Text); break;
                case LineKind.Log:
                    if (l.Text.Trim().Length == 0) break;
                    AppendLog(logBox, l.Text);
                    if (steps != null) steps.SetLive(l.Text);
                    break;
            }
        }

        internal void FakeLine(string line) { OnLine(ScriptLine.Parse(line, false)); }

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

        private async Task Succeeded()
        {
            steps.AllDone();
            Ui.SetProgress(overallBar, 100);
            overallText.Text = T("Done");
            overallPercent.Text = Percent(100);
            await Task.Delay(700);
            ShowFinish();
        }

        internal void Failed(string message)
        {
            if (steps != null) steps.Fail();
            failText.Text = string.IsNullOrWhiteSpace(message) ? T("The installation did not finish.") : message;
            overallText.Text = T("Stopped");
            Ui.Show(failCard, true);
            details.IsExpanded = true;
            Reveal(failCard);
            UpdateActions();
        }

        internal void ShowFinish()
        {
            finishSteps.Children.Clear();
            string[] how;
            if (lg && rooted)
            {
                bool home = homeToggle == null || homeToggle.IsChecked == true;
                doneText.Text = T("With the root features: picture settings, closing apps, Guide = Control Center.");
                how = home ? new[]
                {
                    T("Press **Home**: APL Launcher opens (twice quickly: the App Switcher). The TV now starts on it."),
                    T("**Guide** opens the Control Center over the app you are in; Back goes back to it."),
                    T("LG's Home again: APL Launcher › **Settings › General & Privacy › Start on APL Launcher**.")
                } : new[]
                {
                    T("Open APL Launcher from LG's app list."),
                    T("Home opens it later if you want: APL Launcher › **Settings › General & Privacy › Start on APL Launcher**.")
                };
            }
            else if (lg)
            {
                doneText.Text = T("Through LG's Developer Mode: without the root features.");
                how = new[]
                {
                    T("Open APL Launcher from LG's app list (Home keeps opening LG's Home without root)."),
                    T("The first time, LG asks whether APL Launcher may control the TV: choose **Allow**."),
                    T("Developer Mode lasts 1000 hours: APL Launcher renews it by itself every day.")
                };
            }
            else
            {
                doneText.Text = T("As a launcher app, with its remote buttons service.");
                how = new[]
                {
                    T("Press **Home**: APL Launcher opens. Twice quickly: the App Switcher. Held: the Control Center."),
                    T("If Home still opens the TV's own launcher, APL Launcher's **Settings › Android TV** has the steps."),
                    T("Never use Force stop on APL Launcher: Android then turns its remote buttons service off.")
                };
            }
            if (withAplTv) how = how.Concat(new[] { T("**APL TV** is installed too (unless the details above say otherwise): open it and add your playlist from your phone with its QR code.") }).ToArray();
            for (int i = 0; i < how.Length; i++) finishSteps.Children.Add(InstallPage.Numbered(i + 1, how[i]));
            ShowView("finish");
        }
    }
}
