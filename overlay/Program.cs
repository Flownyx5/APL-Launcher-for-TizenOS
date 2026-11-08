using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Tizen.Applications;
using Tizen.NUI;

namespace APL
{
    /// <summary>
    /// APL Overlay: the Control Center over a video or an input.
    ///
    /// A web app such as the launcher is opaque for the screen's compositor, so the app under it
    /// stops. A native window with an alpha channel leaves it running. This app stays hidden in
    /// memory and receives the Home key from Vetro:
    ///   - launcher in front, or nothing playing: Home goes straight to the launcher;
    ///   - any other app in front: a short press goes to the launcher, a long press opens the panel.
    /// </summary>
    internal class Program : NUIApplication
    {
        private const string Launcher = "APLauncher.Home";
        private const string AquaPlay = "AquaPlay02.AquaPlay", TizenBrew = "xvvl3S1bvH.TizenBrewStandalone";
        private const int WaitLimitMs = 1500;
        private const uint HoldMs = 600, EveryMs = 170, TapMs = 250, RepressMs = 20, StaleMs = 700;

        private string lastKey;
        private bool keyDown;
        private uint pressedAt, actedAt, releasedAt, lastSeen;
        private Panel panel;
        private bool deciding;
        private DateTime handled = DateTime.MinValue;

        // Samsung's home comes back when an app closes: the launcher takes its place
        [DllImport("libvconf.so.0")] private static extern int vconf_notify_key_changed(string key, VconfChanged callback, IntPtr data);
        [DllImport("libvconf.so.0")] private static extern IntPtr vconf_get_str(string key);
        [DllImport("libc.so.6")] private static extern void free(IntPtr pointer);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void VconfChanged(IntPtr node, IntPtr data);
        private const string FullscreenKey = "memory/appfw/current_fullscreen_appid";
        private static VconfChanged fullscreenChanged;
        private Timer homeCheck;
        private bool returnToLauncher = true;
        // Settings › ⏯ in Apps: Play and Pause (false: the Control Center, as by default)
        private bool pauseInApps;
        // The Smart Hub tile opened Samsung's home on purpose: leave it until something else is in front
        private bool samsungHomeWanted;
        private Alexa alexa;
        private string alexaFile, alexaList;
        private readonly KeyGuard keyGuard = new KeyGuard();
        private readonly IdleApps idleApps = new IdleApps();
        private Autorun autorun;                     // Autorun Smart Hub off while the screen sleeps (Autorun.cs)
        private const double WakeWindowS = 120;      // Vetro's agent is back within ~90 s of a wake
        // After a full start, Home reaches the screen until Vetro takes it (about 70 s on the M8), as after a wake
        private const double StartWindowS = 180;
        private MemoryGuard memoryGuard;             // the launcher left out of the low-memory killer (MemoryGuard.cs)

        public Program() : base("", WindowMode.Transparent) { }

        protected override void OnCreate()
        {
            base.OnCreate();
            VetroPort.Log = Note;
            Window win = Window.Instance;
            win.BackgroundColor = new Color(0f, 0f, 0f, 0f);
#if TIZEN6
            // Tizen 6 (#21): an ordinary window shown over an app sent the app to the background (paused or
            // closed), Samsung's home showed behind the Control Center and Return to the Launcher put the
            // launcher over it. A see-through notification window stays above the app without taking its place
            // (window.priority.set in the manifest).
            try
            {
                win.SetTransparency(true);
                win.SetOpaqueState(false);
                win.Type = WindowType.Notification;
                bool level = win.SetNotificationLevel(NotificationLevel.Top);
                Note("window: notification, level " + (level ? "top" : "refused"));
            }
            catch (Exception ex) { Note("window: " + ex.Message); }
#endif
            win.Hide();
            string res = DirectoryInfo.Resource;
            string fonts = System.IO.Path.Combine(res, "fonts");
            if (Directory.Exists(fonts)) FontClient.Instance.AddCustomFontDirectory(fonts);
            panel = new Panel(win, res);
            win.KeyEvent += OnKey;
            MicButton.Watch(panel.Listen);
            WatchFullscreenApp();
            alexaFile = System.IO.Path.Combine(DirectoryInfo.Data, "alexa.txt");
            alexa = new Alexa(OnAlexa);
            if (File.Exists(alexaFile))
            {
                alexaList = Alexa.LoadList(alexaFile);
                alexa.Start(alexaList);
            }
            keyGuard.Start();
            idleApps.Front(FullscreenApp());
            idleApps.Start();
            autorun = new Autorun(DirectoryInfo.Data);
            autorun.Start();
            memoryGuard = new MemoryGuard();
            memoryGuard.Start();
            WatchVetroHold();
            // Samsung's home may already be in front when this app starts: Home pressed in the first seconds after
            // power-on, before Vetro takes the key and before the launcher opens this app. Handled like a change.
            OnFullscreenChanged();
        }

        /// <summary>The launcher's list of apps for the Echo; empty when the bridge is turned off.</summary>
        private void ConfigureAlexa(string enabled, string list)
        {
            try
            {
                if (enabled == "0")
                {
                    alexa.Stop();
                    if (File.Exists(alexaFile)) File.Delete(alexaFile);
                    alexaList = null;
                    return;
                }
                if (list == alexaList) return;
                alexaList = list;
                File.WriteAllText(alexaFile, list);
                alexa.Start(list);
            }
            catch (Exception ex) { Note("alexa config: " + ex.Message); }
        }

        /// <summary>"Alexa, turn on…": the panel shows what was understood, the launcher does the rest.</summary>
        private void OnAlexa(Alexa.Device device, bool on)
        {
            panel.ShowVoice(on ? device.Name : Text.T("{0} (off)", device.Name));
            panel.RunVoice(device.Target, on);
        }

        protected override void OnAppControlReceived(AppControlReceivedEventArgs e)
        {
            base.OnAppControlReceived(e);
            string action = Extra(e, "apl_action");
            string theme = Extra(e, "apl_theme");
            string back = Extra(e, "apl_return");
            if (!string.IsNullOrEmpty(theme)) panel.SetTheme(theme == "light");
            if (!string.IsNullOrEmpty(back)) returnToLauncher = back == "1";
            string pause = Extra(e, "apl_pause");
            if (!string.IsNullOrEmpty(pause)) pauseInApps = pause == "playpause";
            string lang = Extra(e, "apl_lang");
            // A new language renames the Echo's own plugs (Screen, Home…): forgetting the list starts them again below
            if (!string.IsNullOrEmpty(lang) && Text.SetLanguage(lang)) alexaList = null;
            string alexaOn = Extra(e, "apl_alexa_on");
            if (!string.IsNullOrEmpty(alexaOn)) ConfigureAlexa(alexaOn, Extra(e, "apl_alexa"));
            string idle = Extra(e, "apl_idle");
            if (!string.IsNullOrEmpty(idle)) idleApps.Configure(idle);
            string apps = Extra(e, "apl_apps");
            if (!string.IsNullOrEmpty(apps)) idleApps.HomeApps(apps);
            if (action == "stay") return;                  // started by the launcher, to be ready
            if (action == "samsung_home") { OpenSamsungHome(); return; }
            if (action == "open") { panel.Open(); return; }
            KeyPressed();
        }

        private static string Extra(AppControlReceivedEventArgs e, string key)
        {
            try
            {
                string value;
                return e.ReceivedAppControl.ExtraData.TryGet(key, out value) ? value : "";
            }
            catch (Exception) { return ""; }
        }

        private void WatchFullscreenApp()
        {
            try
            {
                fullscreenChanged = delegate { OnFullscreenChanged(); };
                int result = vconf_notify_key_changed(FullscreenKey, fullscreenChanged, IntPtr.Zero);
                if (result != 0) Note("vconf watch: " + result);
            }
            catch (Exception ex) { Note("vconf watch: " + ex.Message); }
        }

        /// <summary>Seconds since the screen started; unreadable counts as long ago (no start window).</summary>
        private static double Uptime()
        {
            try { return double.Parse(File.ReadAllText("/proc/uptime").Split(' ')[0], System.Globalization.CultureInfo.InvariantCulture); }
            catch (Exception) { return double.MaxValue; }
        }

        internal static string FullscreenApp()
        {
            IntPtr text = vconf_get_str(FullscreenKey);
            if (text == IntPtr.Zero) return "";
            string app = Marshal.PtrToStringUTF8(text);
            free(text);
            return app ?? "";
        }

        /// <summary>Samsung's home flashes by while apps start: it counts only if it stays.</summary>
        private void OnFullscreenChanged()
        {
            string front = FullscreenApp();
            idleApps.Front(front);
            memoryGuard?.FrontChanged();
            if (samsungHomeWanted)
            {
                if (IsSamsungHome(front)) return;          // the one the tile opened
                samsungHomeWanted = false;                 // the user went elsewhere: back to normal
            }
            if (!returnToLauncher || !IsSamsungHome(front)) return;
            Note("Samsung's home in front (" + front + ")");
            // Just after a wake, Vetro's agent restarts and Home reaches the screen, which opens its home; nothing
            // opens it by itself then (Autorun Smart Hub is off for the standby, Autorun.cs). The screen is busy
            // waking up and the 350 ms check fired 3 s late on the M8: the launcher goes on screen at once.
            if (autorun != null && (DateTime.UtcNow - autorun.WokeAt).TotalSeconds < WakeWindowS)
            {
                Note("just after a wake: launcher");
                homeCheck?.Stop();
                OpenLauncher();
                return;
            }
            // In the minutes after a full start, Home reaches the screen until Vetro's input helper takes the remote
            // (about 70 s on the M8), and the screen opens its home: no 350 ms on Samsung's home then, the launcher
            // goes over it at once (APL Boot does the same, more slowly). Once Vetro holds Home, Samsung's home in
            // front is something else, a flash while an app starts: the usual check.
            if (Uptime() < StartWindowS && !vetroHoldsHome)
            {
                Note("just after a start, before Vetro holds Home: launcher");
                homeCheck?.Stop();
                OpenLauncher();
                return;
            }
            CheckHomeStays();
        }

        /// <summary>
        /// Whether Vetro's input helper holds the remote, asked every 5 s during the minutes after a full start. Known
        /// in advance: asked when Samsung's home shows, Vetro took 5 s to answer at that time (the network was
        /// still coming up on the M8), and APL Boot had put the launcher back by then.
        /// </summary>
        private volatile bool vetroHoldsHome;
        private Timer holdWatch;
        private bool holdAsking;
        private void WatchVetroHold()
        {
            if (Uptime() >= StartWindowS) { vetroHoldsHome = true; return; }
            holdWatch = new Timer(5000);
            holdWatch.Tick += delegate
            {
                if (vetroHoldsHome || Uptime() >= StartWindowS) { vetroHoldsHome = true; return false; }
                AskVetroHold();
                return true;
            };
            holdWatch.Start();
            AskVetroHold();
        }
        private async void AskVetroHold()
        {
            if (holdAsking) return;
            holdAsking = true;
            try
            {
                if ((await Vetro.Exec("pgrep -f '[S]amsungTvRemoteInputAgent' >/dev/null && echo held")).Trim() == "held")
                {
                    vetroHoldsHome = true;
                    Note("Vetro holds Home (uptime " + Uptime().ToString("F0") + " s)");
                }
            }
            catch (Exception) { }                          // Vetro not up yet
            finally { holdAsking = false; }
        }

        /// <summary>Samsung's home counts only if it is still in front 350 ms later.</summary>
        private void CheckHomeStays()
        {
            if (homeCheck == null)
            {
                homeCheck = new Timer(350);
                homeCheck.Tick += delegate
                {
                    string now = FullscreenApp();
                    if (returnToLauncher && !samsungHomeWanted && IsSamsungHome(now)) { Note("still there after 350 ms: launcher"); OpenLauncher(); }
                    else Note("gone within 350 ms (" + now + ")");
                    return false;
                };
            }
            homeCheck.Stop();
            homeCheck.Start();
        }

        /// <summary>
        /// Vetro launches this app on each press of its keys and on each repeat of a held one, one
        /// after the other: a repeat can arrive seconds late. So a press is known by its time on the
        /// remote, and only one is handled at a time.
        /// </summary>
        private async void KeyPressed()
        {
            if (deciding) return;
            deciding = true;
            try
            {
                List<Vetro.KeyEvent> events = await Vetro.KeyEvents();
                int at = RemoteKeys.Latest(events);
                if (at < 0)
                {
                    OpenLauncher();
                    return;
                }
                Vetro.KeyEvent key = events[RemoteKeys.BurstStart(events, at)];
                DateTime latest = events[at].Time;
                bool isNew = key.Time > handled;
                if (latest > handled) handled = latest;
                if (!isNew) return;
                switch (key.Code)
                {
                    case RemoteKeys.Pause:
                        if (panel.IsOpen) panel.Close();
                        else if (pauseInApps && key.Foreground != Launcher && !IsSamsungHome(key.Foreground)) await PlayPause(key);
                        else OpenControlCenter(key);
                        break;
                    case RemoteKeys.TvPlus:
                        if (panel.IsOpen) panel.Close();
                        await ResumeApp(AquaPlay);
                        break;
                    case RemoteKeys.Prime:
                        if (panel.IsOpen) panel.Close();
                        await OpenTizenTube();
                        break;
                    default:
                        await HomePressed(key);
                        break;
                }
            }
            catch (Exception ex)
            {
                Note("key: " + ex.Message);
                OpenLauncher();
            }
            finally { deciding = false; }
        }

        private async Task HomePressed(Vetro.KeyEvent key)
        {
            Note("Home from Vetro, " + key.Foreground + " in front");
            if (panel.IsOpen)
            {
                panel.Close();
                OpenLauncher();
                return;
            }
            // On a home screen, Home does its job at once. An app in front has to wait.
            bool launcherFront = key.Foreground == Launcher;
            bool onHome = launcherFront || IsSamsungHome(key.Foreground);
            if (launcherFront) await LauncherKey(Blue);     // back to the Home Screen at rest
            else if (onHome) OpenLauncher();
            Press press = await Classify(key.Time);
            if (press == Press.Long) OpenControlCenter(key);
            else if (press == Press.Double) { if (launcherFront) await LauncherKey(Green); else OpenLauncher("switcher"); }
            else if (!onHome) OpenLauncher();
        }

        private async Task<Press> Classify(DateTime start)
        {
            DateTime limit = DateTime.UtcNow.AddMilliseconds(WaitLimitMs);
            while (DateTime.UtcNow < limit)
            {
                List<Vetro.KeyEvent> events = await Vetro.KeyEvents();
                foreach (Vetro.KeyEvent e in events)
                {
                    if (e.Code == RemoteKeys.Home && e.Down && e.Time > handled) handled = e.Time;
                }
                Press press = RemoteKeys.Decide(events, start, DateTime.UtcNow);
                if (press != Press.Undecided) return press;
                await Task.Delay(25);
            }
            return Press.Short;
        }

        /// <summary>The launcher has its own: this panel is for what plays over an app.</summary>
        private void OpenControlCenter(Vetro.KeyEvent key)
        {
            if (key.Foreground == Launcher) _ = LauncherKey(Red);
            else panel.Open();
        }

        /// <summary>
        /// Settings › ⏯ in Apps › Play and Pause: ⏯ in an app is the app's own. Vetro took the remote's
        /// key, so the same key is sent again as an injected one, which Vetro lets through (it filters the
        /// remote's device only). The Control Center stays on Home held and the red key there.
        /// </summary>
        private Task PlayPause(Vetro.KeyEvent key)
        {
            Note("⏯ to " + key.Foreground);
            return Vetro.Exec("/usr/bin/input_keyevent XF86PlayBack >/dev/null 2>&1");
        }

        /// <summary>
        /// The launcher in front gets Home's actions as keys: a launch request to the app already in
        /// front never reaches the page on some screens (The Frame 2025), an injected key does, and
        /// Vetro lets it through (it filters the remote's device only). launcher/js/launcher.js: blue
        /// for Home, green for the App Switcher, red for the Control Center. Vetro not up yet (right
        /// after a wake): the same action as a launch request, which most screens deliver.
        /// </summary>
        private const string Red = "XF86Red", Green = "XF86Green", Blue = "XF86Blue";
        private static async Task LauncherKey(string name)
        {
            try { await Vetro.ExecWhenReady("/usr/bin/input_keyevent " + name + " >/dev/null 2>&1"); }
            catch (Exception ex)
            {
                Note("launcher key: " + ex.Message + ", opening it instead");
                OpenLauncher(name == Green ? "switcher" : name == Red ? "controlcenter" : "");
            }
        }

        /// <summary>SkipReload: an app already open comes back as it was, video included, as in launcher/js/apps.js.</summary>
        private static Task ResumeApp(string app)
        {
            return Vetro.Exec("/usr/bin/app_launcher -s " + app + " SkipReload Yes >/dev/null 2>&1");
        }

        /// <summary>TizenTube starts through TizenBrew, and the launcher knows how. Already open, it just comes back.</summary>
        private static async Task OpenTizenTube()
        {
            string open = await Vetro.Exec("ps -eo args | grep -c 'bin/" + TizenBrew + "[ ]'");
            if (open.Trim() != "0") await ResumeApp(TizenBrew);
            else OpenLauncher("open:apl.tizentube");
        }

        /// <summary>Samsung's home: csfs, and on the 2025 screens with the new Home, coba.newhome and home.media (as in APL Boot).</summary>
        private static bool IsSamsungHome(string app)
        {
            return string.IsNullOrEmpty(app) ? false : app.Contains("csfs") || app.Contains("home.sidebar") ||
                                                       app.Contains("coba.newhome") || app.Contains("home.media");
        }

        /// <summary>
        /// The launcher's Smart Hub tile. Samsung's home ignores a plain app-control launch (Vetro's dock
        /// found the same); the platform's app_launcher, as root through Vetro, shows it. It then stays:
        /// "Return to the Launcher" waits until something else is in front (OnFullscreenChanged).
        /// </summary>
        private async void OpenSamsungHome()
        {
            samsungHomeWanted = true;
            Note("Smart Hub opened from the launcher");
            try { await Vetro.Exec("/usr/bin/app_launcher -s com.samsung.tv.csfs >/dev/null 2>&1"); }
            catch (Exception ex) { samsungHomeWanted = false; Note("Smart Hub: " + ex.Message); }
        }

        /// <summary>
        /// The platform's own launch request first (appmanager.launch, in both manifests): it needs neither Vetro
        /// nor the network. Right after a wake Vetro's agent restarts and the Wi-Fi is not back yet, and going
        /// through Vetro first left Samsung's home on screen for several seconds. Vetro only if that fails.
        /// </summary>
        public static async void OpenLauncher(string action = "")
        {
            try
            {
                var request = new AppControl { ApplicationId = Launcher, Operation = AppControlOperations.Default };
                if (!string.IsNullOrEmpty(action)) request.ExtraData.Add("apl_action", action);
                AppControl.SendLaunchRequest(request);
                return;
            }
            catch (Exception ex) { Note("launcher directly: " + ex.Message + ", through Vetro"); }
            string data = string.IsNullOrEmpty(action) ? "" : " apl_action " + action;
            try { await Vetro.ExecWhenReady("/usr/bin/app_launcher -s " + Launcher + data + " >/dev/null 2>&1"); }
            catch (Exception ex) { Note("launcher: " + ex.Message); }
        }

        private void OnKey(object sender, Window.KeyEventArgs e)
        {
            string name = e.Key.KeyPressedName;
            if (e.Key.State == Key.StateType.Down)
            {
                if (Counts(name, e.Key.Time)) panel.Key(name);
            }
            else if (name == lastKey)
            {
                keyDown = false;
                releasedAt = e.Key.Time;
            }
        }

        /// <summary>
        /// One press, one action, as in launcher/js/navigation.js. A held key shows up as repeats and
        /// as release + press within a few ms: they count only for the arrows, after a moment, at a
        /// steady pace. A real second press comes after a real release, or before TapMs. The release
        /// can get lost when the panel closes, hence the time limit.
        /// </summary>
        private bool Counts(string name, uint now)
        {
            bool held = name == lastKey && now - lastSeen < StaleMs && (keyDown || now - releasedAt < RepressMs);
            if (held && !keyDown && now - pressedAt < TapMs) held = false;
            keyDown = true;
            lastSeen = now;
            if (!held)
            {
                lastKey = name;
                pressedAt = actedAt = now;
                return true;
            }
            bool arrow = name == "Left" || name == "Right" || name == "Up" || name == "Down";
            if (!arrow || now - pressedAt < HoldMs || now - actedAt < EveryMs) return false;
            actedAt = now;
            return true;
        }

        /// <summary>The screen has no working system log: errors go to a small file in the app's data folder.</summary>
        public static void Note(string message)
        {
            try
            {
                string file = System.IO.Path.Combine(Current.DirectoryInfo.Data, "overlay.log");
                if (File.Exists(file) && new FileInfo(file).Length > 32768) File.Delete(file);
                File.AppendAllText(file, DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + "\n");
            }
            catch (Exception) { }
        }

        private static void Main(string[] args)
        {
            new Program().Run(args);
        }
    }
}
