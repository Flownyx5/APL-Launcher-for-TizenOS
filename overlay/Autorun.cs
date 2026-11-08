using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace APL
{
    /// <summary>
    /// Start on APL Launcher (launcher/js/system.js, homeAppSet) makes the launcher the screen's home app
    /// and turns Autorun Smart Hub on, so that after a full start-up the launcher is on screen in about a
    /// second. But with Autorun on, the screen also opens Samsung's home at every wake from standby, which
    /// shows until the launcher replaces it. So Autorun is turned off while the screen sleeps and on again
    /// once it is awake: a wake goes back to the app that was in front, with no Samsung home, and a full
    /// start-up still brings the launcher at once. (On the M8, with Autorun off: a wake on the launcher
    /// comes back on the TV input for a moment, and the bridge opens the launcher again; a wake on
    /// AquaPlay comes straight back to AquaPlay.)
    ///
    /// Only on a screen whose standby is a real one, the same processes coming back: on The Frame a wake
    /// from deep standby is a full start-up, which needs Autorun on. Learned at the first wake: this app
    /// saw the screen go to sleep and is still there afterwards (data/resumes).
    /// A power cut during the standby leaves Autorun off: it is put back at the next start of this app, and
    /// APL Boot replaces the TV input with the launcher meanwhile.
    /// Everything goes through Vetro, as root, and checks the screen's values first: nothing changes when
    /// the launcher is not the home app (Start on APL Launcher off) or when Autorun was off anyway.
    /// </summary>
    internal sealed class Autorun
    {
        private const string StateKey = "memory/pm/state";                     // 1: on; 3 and 4: screen off, standby
        private const string Key = "db/menu/smart_hub/ontvsetting/auto_start";
        private const string IsHome = "[ \"$(vconftool get db/appfw/home_appid 2>/dev/null | awk '{print $4}')\" = APLauncher.Home ]";
        private const int Tries = 24, EveryMs = 15000;                          // Vetro's agent can take 90 s after a wake

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void VconfChanged(IntPtr node, IntPtr data);
        [DllImport("libvconf.so.0")] private static extern int vconf_notify_key_changed(string key, VconfChanged callback, IntPtr data);
        [DllImport("libvconf.so.0")] private static extern int vconf_get_int(string key, out int value);

        private readonly string offFlag, resumesFlag;
        private VconfChanged changed;                                            // kept: the platform calls it
        private int lastState = 1, putting;
        private bool sawSleep;

        /// <summary>When the screen last came back from standby (UTC; MinValue: not since this app started).</summary>
        public DateTime WokeAt { get; private set; } = DateTime.MinValue;

        public Autorun(string dataDir)
        {
            offFlag = Path.Combine(dataDir, "autorun-off");
            resumesFlag = Path.Combine(dataDir, "resumes");
        }

        public void Start()
        {
            try
            {
                changed = delegate { OnState(); };
                int result = vconf_notify_key_changed(StateKey, changed, IntPtr.Zero);
                if (result != 0) Program.Note("autorun watch: " + result);
            }
            catch (Exception ex) { Program.Note("autorun watch: " + ex.Message); }
            lastState = State();
            if (lastState == 1 && File.Exists(offFlag)) PutBack("left off by a power cut or a restart");
        }

        private static int State()
        {
            try { int value; return vconf_get_int(StateKey, out value) == 0 ? value : -1; }
            catch (Exception) { return -1; }
        }

        private void OnState()
        {
            int now = State();
            if (now < 1 || now == lastState) return;
            int was = lastState;
            lastState = now;
            if (now >= 3 && was < 3)
            {
                sawSleep = true;
                if (File.Exists(resumesFlag)) TurnOff();
            }
            else if (now == 1 && was >= 3)
            {
                WokeAt = DateTime.UtcNow;
                if (sawSleep && !File.Exists(resumesFlag))
                {
                    try { File.WriteAllText(resumesFlag, DateTime.Now.ToString("s")); } catch (Exception) { }
                    Program.Note("autorun: this screen comes back from standby, Autorun Smart Hub will be off while it sleeps");
                }
                if (File.Exists(offFlag)) PutBack("awake");
            }
        }

        /// <summary>Going to sleep: about 17 s before the apps freeze, Vetro still answers.</summary>
        private async void TurnOff()
        {
            if (File.Exists(offFlag)) return;                                    // still off from the last standby
            try
            {
                File.WriteAllText(offFlag, DateTime.Now.ToString("s"));          // first: the apps may freeze any moment
                string output = await Vetro.ExecWhenReady("if " + IsHome + " && [ \"$(vconftool get " + Key + " 2>/dev/null | awk '{print $4}')\" = 1 ]; " +
                                                          "then vconftool set -f -t int " + Key + " 0 && echo turned-off; fi");
                if (output.Contains("turned-off")) Program.Note("autorun: Autorun Smart Hub off for the standby");
                else File.Delete(offFlag);                                       // not ours to change
            }
            catch (Exception ex)
            {
                Program.Note("autorun off: " + ex.Message);
                try { File.Delete(offFlag); } catch (Exception) { }
            }
        }

        /// <summary>Awake: on again, as soon as Vetro runs commands. Waits for the next wake if the screen sleeps again.</summary>
        private async void PutBack(string why)
        {
            if (System.Threading.Interlocked.Exchange(ref putting, 1) != 0) return;
            try
            {
                for (int i = 0; i < Tries; i++)
                {
                    if (State() != 1) return;                                    // asleep again: the flag stays
                    try
                    {
                        string output = await Vetro.ExecWhenReady("if " + IsHome + "; then vconftool set -f -t int " + Key + " 1; fi; vconftool get " + Key);
                        File.Delete(offFlag);
                        Program.Note("autorun: Autorun Smart Hub on again (" + why + "): " + output.Trim());
                        return;
                    }
                    catch (Exception ex) { if (i == 0) Program.Note("autorun on: " + ex.Message + ", trying again"); }
                    await Task.Delay(EveryMs);
                }
                Program.Note("autorun on: Vetro never answered, at the next start");
            }
            finally { putting = 0; }
        }
    }
}
