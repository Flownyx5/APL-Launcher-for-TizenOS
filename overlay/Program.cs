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
        // The Smart Hub tile opened Samsung's home on purpose: leave it until something else is in front
        private bool samsungHomeWanted;
        private Alexa alexa;
        private string alexaFile, alexaList;
        private readonly KeyGuard keyGuard = new KeyGuard();
        private readonly IdleApps idleApps = new IdleApps();

        public Program() : base("", WindowMode.Transparent) { }

        protected override void OnCreate()
        {
            base.OnCreate();
            Window win = Window.Instance;
            win.BackgroundColor = new Color(0f, 0f, 0f, 0f);
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
            if (samsungHomeWanted)
            {
                if (IsSamsungHome(front)) return;          // the one the tile opened
                samsungHomeWanted = false;                 // the user went elsewhere: back to normal
            }
            if (!returnToLauncher || !IsSamsungHome(front)) return;
            Note("Samsung's home in front (" + front + ")");
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
            bool onHome = key.Foreground == Launcher || IsSamsungHome(key.Foreground);
            if (onHome) OpenLauncher();
            Press press = await Classify(key.Time);
            if (press == Press.Long) OpenControlCenter(key);
            else if (press == Press.Double) OpenLauncher("switcher");
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
            if (key.Foreground == Launcher) OpenLauncher("controlcenter");
            else panel.Open();
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

        private static bool IsSamsungHome(string app)
        {
            return string.IsNullOrEmpty(app) ? false : app.Contains("csfs") || app.Contains("home.sidebar");
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

        public static async void OpenLauncher(string action = "")
        {
            string data = string.IsNullOrEmpty(action) ? "" : " apl_action " + action;
            try { await Vetro.Exec("/usr/bin/app_launcher -s " + Launcher + data + " >/dev/null 2>&1"); }
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
