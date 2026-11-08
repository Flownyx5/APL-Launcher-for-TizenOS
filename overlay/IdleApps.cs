using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Tizen.NUI;

namespace APL
{
    /// <summary>
    /// Apps left in the background close after a while (10 minutes by default). The screen keeps every
    /// app it opened until its 1.8 GB run out, and then everything slows down. The app in front is never
    /// closed. Only the launcher's apps and those once seen in front count, plus Samsung's own that open
    /// by themselves: services stay, and so do the launcher, Samsung's home, the TV inputs and what
    /// receives AirPlay. Samsung's own that were never in front close after a minute: they reopen at
    /// every wake-up and hold about 250 MB that the app being watched needs.
    /// Some come back by themselves a minute or two after being closed (the screen preloads Netflix and
    /// YouTube's engine so they open faster): closing those only makes it start them over and over, so
    /// one that came back twice in a row is left alone, until it is used.
    /// </summary>
    internal sealed class IdleApps
    {
        private const uint CheckMs = 60000;
        private const int UnusedMinutes = 1;
        private const int ComebackMinutes = 5, ComebacksToLeave = 2;
        // The Frame's Art Mode (org.tizen.art-app) is a screen mode, not an app left open: closing it breaks Art Mode
        private static readonly string[] Never = { "APLauncher.", "apl.launcher.", "vetrotvapp", "com.samsung.tv.csfs", "com.samsung.tv.home.sidebar", "com.samsung.tv.coba.newhome", "org.tizen.tv-viewer", "org.tizen.art-app" };
        private static readonly string[] Receivers = { "airplay", "ScreenMirroring", "multiscreen" };
        // Samsung's that open by themselves, as in the launcher's bootCleanup (not art-app, see Never)
        private static readonly HashSet<string> SelfOpening = new HashSet<string> {
            "com.samsung.tv.home.media", "com.samsung.tv.mycontents", "com.samsung.tv.quicklaunch", "org.tizen.browser",
            "com.samsung.tv.bixbycapsuleviewer", "com.samsung.tv.aria-video", "com.samsung.tv.cobalt-yt",
            "MCmYXNxgcu.DisneyPlus", "org.tizen.netflix-app", "org.tizen.primevideo", "HEPsqFNie0.tvplusstandalone" };
        private static readonly Regex Running = new Regex(@"^\s*([A-Za-z0-9_.-]+) \(\d+\)\s*$");

        private readonly Dictionary<string, DateTime> lastUsed = new Dictionary<string, DateTime>();
        private readonly HashSet<string> seenInFront = new HashSet<string>();
        private readonly Dictionary<string, DateTime> closedAt = new Dictionary<string, DateTime>();
        private readonly Dictionary<string, int> comebacks = new Dictionary<string, int>();
        private readonly HashSet<string> leftAlone = new HashSet<string>();
        private HashSet<string> homeApps = new HashSet<string>();
        private string front = "";
        private int minutes = 10;
        private Timer timer;
        private bool checking;

        public void Start()
        {
            timer = new Timer(CheckMs);
            timer.Tick += delegate { Check(); return true; };
            if (minutes > 0) timer.Start();
        }

        /// <summary>From the launcher's settings: minutes in the background before an app closes, 0 for never.</summary>
        public void Configure(string value)
        {
            int m;
            if (!int.TryParse(value, out m)) return;
            minutes = Math.Max(0, m);
            if (timer == null) return;
            if (minutes > 0) timer.Start();
            else timer.Stop();
        }

        /// <summary>The apps on the launcher's home, "id;id": they count even before being seen in front.</summary>
        public void HomeApps(string list)
        {
            homeApps = new HashSet<string>((list ?? "").Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries));
        }

        /// <summary>The app now in front: it, and the one it replaces, were in use until now.</summary>
        public void Front(string app)
        {
            DateTime now = DateTime.UtcNow;
            if (front.Length > 0) lastUsed[front] = now;
            front = app ?? "";
            if (front.Length == 0) return;
            lastUsed[front] = now;
            seenInFront.Add(front);
            // Opened by the user: an ordinary app again
            closedAt.Remove(front);
            comebacks.Remove(front);
            leftAlone.Remove(front);
        }

        private bool Closable(string id)
        {
            foreach (string prefix in Never) if (id.StartsWith(prefix, StringComparison.Ordinal)) return false;
            foreach (string part in Receivers) if (id.IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0) return false;
            return seenInFront.Contains(id) || homeApps.Contains(id) || SelfOpening.Contains(id);
        }

        /// <summary>Running again soon after it was closed, without being opened: true once it did so twice in a row.</summary>
        private bool CameBack(string id, DateTime now)
        {
            DateTime closed;
            if (!closedAt.TryGetValue(id, out closed)) return false;
            closedAt.Remove(id);
            if ((now - closed).TotalMinutes >= ComebackMinutes) { comebacks.Remove(id); return false; }
            int count;
            comebacks.TryGetValue(id, out count);
            comebacks[id] = ++count;
            if (count < ComebacksToLeave) return false;
            leftAlone.Add(id);
            Program.Note("idle: " + id + " comes back by itself after being closed: left alone");
            return true;
        }

        private async void Check()
        {
            if (checking || minutes <= 0) return;
            checking = true;
            try
            {
                Front(Program.FullscreenApp());
                string list = await Vetro.Exec("app_launcher -S 2>/dev/null");
                DateTime now = DateTime.UtcNow;
                List<string> idle = new List<string>();
                foreach (string line in list.Split('\n'))
                {
                    Match m = Running.Match(line);
                    if (!m.Success) continue;
                    string id = m.Groups[1].Value;
                    if (id == front || !Closable(id) || leftAlone.Contains(id)) continue;
                    if (CameBack(id, now)) continue;
                    DateTime used;
                    // Already in the background when this app started: its time starts now
                    if (!lastUsed.TryGetValue(id, out used)) { lastUsed[id] = now; continue; }
                    int limit = SelfOpening.Contains(id) && !seenInFront.Contains(id) ? Math.Min(UnusedMinutes, minutes) : minutes;
                    if ((now - used).TotalMinutes >= limit) idle.Add(id);
                }
                if (idle.Count == 0) return;
                string command = "";
                foreach (string id in idle)
                {
                    command += "app_launcher -k " + id + " >/dev/null 2>&1; ";
                    lastUsed.Remove(id);
                    closedAt[id] = now;
                }
                await Vetro.Exec(command + "true");
                Program.Note("idle: closed " + string.Join(", ", idle));
            }
            catch (Exception ex) { Program.Note("idle: " + ex.Message); }
            finally { checking = false; }
        }
    }
}
