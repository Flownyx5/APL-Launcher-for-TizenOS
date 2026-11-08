using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Tizen.Applications;

namespace APL.Boot
{
    /// <summary>
    /// APLauncher.Boot: after a full start-up (power cut, restart), the screen comes back on its last
    /// input (the aerial page, an HDMI input) or on Samsung's home, never on the launcher. The bridge
    /// (launcher/bridge/service.js) was meant to open it, but a web service's on-boot is dropped when
    /// the package is a hybrid one: the screen registers it with Onboot 0. A .NET service's is kept.
    ///
    /// Every second and a half during the first minutes, while Samsung's own screen is in front (the TV
    /// input, Samsung TV Plus, Samsung's home), this asks the system to show the launcher (an app-control
    /// launch: no Vetro needed, it may not be up yet). It stops once the launcher has stayed in front for
    /// half a minute (TV Plus can come up late), once another app is in front (the screen's "Autorun
    /// last app" opened it: that is the user's choice), or after a time limit.
    /// The launcher starts it as soon as it loads (launcher.js, startBootKeeper): with Start on APL
    /// Launcher it loads about a second after power-on, in the background, Autorun Smart Hub being off
    /// so that a wake goes back to the last app instead of Samsung's home. The on-boot start (~1 min)
    /// stays as a fallback. Started later than the boot window (by hand, a crash restart), it does nothing.
    /// </summary>
    internal class Program : ServiceApplication
    {
        private const string Launcher = "APLauncher.Home";
        private const string FullscreenKey = "memory/appfw/current_fullscreen_appid";
        private const double BootWindowS = 300;   // older than this: not a start-up
        private const int EveryMs = 1500;
        private const int LimitS = 240;           // give up after this long
        private const int StableTicks = 20;       // the launcher counts as there after 30 s in front
        private const int OtherTicks = 3;         // another app 4.5 s in front: the user's choice
        private const int MaxLaunches = 30;

        [DllImport("libvconf.so.0")] private static extern IntPtr vconf_get_str(string key);
        [DllImport("libc.so.6")] private static extern void free(IntPtr pointer);

        private Timer timer;
        private DateTime started;
        private int launches, inFront, elsewhere;
        private string lastSeen = null;
        private int done;

        protected override void OnCreate()
        {
            base.OnCreate();
            double up = Uptime();
            Note("start, uptime " + up.ToString("F0") + " s");
            if (up > BootWindowS) { Finish("not a start-up"); return; }
            started = DateTime.UtcNow;
            timer = new Timer(Tick, null, 0, EveryMs);
        }

        private void Tick(object state)
        {
            if (done != 0) return;
            try
            {
                string fg = Foreground();
                if (fg != lastSeen) { Note("in front: " + (fg.Length > 0 ? fg : "(nothing)")); lastSeen = fg; }

                if (fg == Launcher)
                {
                    elsewhere = 0;
                    if (++inFront >= StableTicks) Finish("the launcher is in front");
                    return;
                }
                inFront = 0;

                if ((DateTime.UtcNow - started).TotalSeconds > LimitS) { Finish("time limit, " + launches + " launch(es)"); return; }

                if (IsSamsungScreen(fg))
                {
                    elsewhere = 0;
                    if (launches >= MaxLaunches) { Finish("too many launches"); return; }
                    launches++;
                    Note("opening the launcher (" + launches + ")");
                    // apl_action boot: not a Home press for the launcher (two launches close together
                    // would read as Home twice, the App Switcher)
                    var request = new AppControl { Operation = AppControlOperations.Default, ApplicationId = Launcher };
                    request.ExtraData.Add("apl_action", "boot");
                    AppControl.SendLaunchRequest(request);
                }
                else if (++elsewhere >= OtherTicks)
                {
                    Finish(fg + " stays in front: left as it is");
                }
            }
            catch (Exception ex) { Note("tick: " + ex.Message); }
        }

        /// <summary>What the screen shows by itself after a start-up, before any app is chosen.</summary>
        private static bool IsSamsungScreen(string app)
        {
            if (string.IsNullOrEmpty(app)) return true;
            return app == "org.tizen.tv-viewer" || app.Contains("csfs") || app.Contains("home.sidebar") ||
                   app.Contains("home.media") || app.Contains("coba.newhome") ||
                   app.Contains("tvplus");   // Samsung TV Plus: the TV input's channel on screens without a tuner (M8)
        }

        private void Finish(string why)
        {
            if (Interlocked.Exchange(ref done, 1) != 0) return;
            Note("done: " + why);
            try { timer?.Dispose(); } catch (Exception) { }
            try { Exit(); } catch (Exception ex) { Note("exit: " + ex.Message); }
        }

        private static string Foreground()
        {
            IntPtr text = vconf_get_str(FullscreenKey);
            if (text == IntPtr.Zero) return "";
            string app = Marshal.PtrToStringUTF8(text);
            free(text);
            return app ?? "";
        }

        private static double Uptime()
        {
            try { return double.Parse(File.ReadAllText("/proc/uptime").Split(' ')[0], System.Globalization.CultureInfo.InvariantCulture); }
            catch (Exception) { return 0; }
        }

        /// <summary>The package's data folder, shared with the Overlay (overlay.log): boot.log.</summary>
        private static void Note(string message)
        {
            try
            {
                string file = Path.Combine(Current.DirectoryInfo.Data, "boot.log");
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
