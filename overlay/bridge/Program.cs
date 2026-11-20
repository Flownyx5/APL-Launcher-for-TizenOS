using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Tizen.Applications;
using Tizen.Applications.Messages;

namespace APL.Bridge
{
    /// <summary>
    /// The launcher's private bridge to Vetro in the hybrid package, where the web one
    /// (launcher/bridge/service.js) never runs. Same ports and messages, same behaviour:
    ///   - relay: the launcher (launcher/js/system.js, bridgeRequest) sends { id, method, path, body } to
    ///     the trusted port APL_BRIDGE, this service asks Vetro (whose answers the page cannot read, CORS)
    ///     and answers on APL_BRIDGE_REPLY with { id, status, part, parts, body }, large answers in pieces;
    ///   - wake-up and Art Mode (as service.js 1.0.4): the launcher says when it is in front ({ front });
    ///     hidden by the screen going to sleep, by Art Mode or by another app? Back from sleep or out of
    ///     Art Mode on the TV input (source 0) or Samsung's home, the launcher is opened again; an HDMI
    ///     input, another app or the launcher itself are left alone.
    /// Everything runs on the app's main loop: async continuations come back on Tizen's
    /// synchronization context, where the message port is used.
    /// </summary>
    internal class Program : ServiceApplication
    {
        private const string PortName = "APL_BRIDGE";
        private const string LauncherId = "APLauncher.Home", ReplyPort = "APL_BRIDGE_REPLY";
        // APL Overlay: in the launcher's package (Tizen 7 and newer), or a package of its own (Tizen 6)
        private static readonly string[] OverlayIds = { "APLauncher.Overlay", "apl.launcher.overlay" };
        private const int Chunk = 4000;                       // characters per message, as service.js
        private static readonly TimeSpan IdleAfter = TimeSpan.FromMinutes(15);
        private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan RelayTimeout = TimeSpan.FromSeconds(150), ShellTimeout = TimeSpan.FromSeconds(20);
        private static readonly Regex Allowed = new Regex(@"^/(status|screen|tv-settings|tv-menu|exec|components/action|control|apps|remap|quick)(/|\?|$)");

        // Going to sleep, the screen hides the launcher and sets memory/pm/state (1 = on); about 17 s
        // later it freezes the apps, and the tick then misses its beats (the fallback signal).
        private const int SleepChecks = 4;
        private static readonly TimeSpan Poll = TimeSpan.FromSeconds(3), Tick = TimeSpan.FromSeconds(5), Asleep = TimeSpan.FromSeconds(20);
        private static readonly TimeSpan HiddenGrace = TimeSpan.FromSeconds(45), WakeWatch = TimeSpan.FromSeconds(90), Settle = TimeSpan.FromSeconds(15);
        // The Frame: Art Mode hides the launcher but the screen stays on (pm/state 1); leaving it with the
        // power key shows the TV input. Watched while Art Mode is in front.
        private static readonly Regex ArtApp = new Regex(@"^org\.tizen\.art-app$");
        private static readonly TimeSpan ArtPoll = TimeSpan.FromSeconds(1.5);
        // Right after a wake the first readings are not reliable yet (no app in front, or a short-lived one), and
        // Vetro's agent drops ~1.5 s later for ~15 s: read back to back for a while, and only take another app
        // for the user's choice once it has stayed in front.
        private static readonly TimeSpan WakeFast = TimeSpan.FromSeconds(6), OtherAppStays = TimeSpan.FromSeconds(4);
        private const string StateCommand = "vconftool get memory/pm/state; vconftool get memory/appfw/current_fullscreen_appid; vconftool get memory/system/source_type";

        // Answers go through the platform call without a local port: with one attached (MessagePort.Send,
        // whichever port) the screen refuses every message to the launcher's page ("Can't send message").
        [DllImport("libcapi-message-port.so.1")] private static extern int message_port_send_trusted_message(string appId, string port, IntPtr bundle);

        // The screen state keys read straight from the platform: no need for Vetro, whose agent restarts for
        // ~15 s right after a wake, just when the reading matters most.
        [DllImport("libvconf.so.0")] private static extern int vconf_get_int(string key, out int value);
        [DllImport("libvconf.so.0")] private static extern IntPtr vconf_get_str(string key);
        [DllImport("libc.so.6")] private static extern void free(IntPtr p);
        private static bool keysLogged, appsLogged;
        // Read every second straight from the platform when it lets us: sleep and wake are then seen at once,
        // whatever the launcher reported and whether Vetro answers or not.
        private static readonly TimeSpan ScreenEvery = TimeSpan.FromSeconds(1);
        private bool watchingScreen, frontAtSleep;

        private MessagePort port;
        private CancellationTokenSource idle;
        private bool launcherFront, sleeping, waking, inArt;
        private DateTime hiddenAt = DateTime.MinValue, lastTick = DateTime.UtcNow;
        private static int hostIndex;

        private sealed class State
        {
            public string Pm, App;
            public int Source = -1;
            public bool SourceKnown;
        }

        protected override void OnCreate()
        {
            base.OnCreate();
            APL.VetroPort.Log = Note;
            try
            {
                port = new MessagePort(PortName, true);
                port.MessageReceived += OnMessage;
                port.Listen();
                Note("listening on " + PortName);
            }
            catch (Exception ex) { Note("listen failed: " + ex.Message); }
            WatchScreen();
            if (!watchingScreen) Ticking();
            StopLater();
        }

        protected override void OnTerminate()
        {
            try { port?.StopListening(); } catch (Exception) { }
            base.OnTerminate();
        }

        /// <summary>Exits after a while without a request, but stays while the launcher is in front or the screen sleeps on it.</summary>
        private void StopLater()
        {
            idle?.Cancel();
            idle = null;
            if (launcherFront || sleeping || waking || inArt) return;
            var cts = new CancellationTokenSource();
            idle = cts;
            IdleExit(cts.Token);
        }

        private async void IdleExit(CancellationToken token)
        {
            try { await Task.Delay(IdleAfter, token); } catch (OperationCanceledException) { return; }
            Note("idle, exiting");
            try { Exit(); } catch (Exception) { }
        }

        private void OnMessage(object sender, MessageReceivedEventArgs e)
        {
            string front = Item(e.Message, "front");
            if (front.Length > 0)
            {
                // The launcher came in front ("1") or left it ("0")
                launcherFront = front == "1";
                if (!launcherFront) { hiddenAt = DateTime.UtcNow; CheckSleep(SleepChecks); }
                StopLater();
                return;
            }
            StopLater();
            string id = Item(e.Message, "id"), method = Item(e.Message, "method"), path = Item(e.Message, "path"), body = Item(e.Message, "body");
            if (method.Length == 0) method = "GET";
            if (!Allowed.IsMatch(path) || (method != "GET" && method != "POST"))
            {
                Answer(id, 404, "{\"error\":\"not relayed\"}");
                return;
            }
            Relay(id, method, path, body);
        }

        private async void Relay(string id, string method, string path, string body)
        {
            var (status, text) = await Vetro(method, path, body, RelayTimeout);
            Answer(id, status, text);
        }

        private void Answer(string id, int status, string body)
        {
            body = body ?? "";
            int parts = Math.Max(1, (body.Length + Chunk - 1) / Chunk);
            for (int i = 0; i < parts; i++)
            {
                try
                {
                    var m = new Bundle();
                    m.AddItem("id", id);
                    m.AddItem("status", status.ToString());
                    m.AddItem("part", i.ToString());
                    m.AddItem("parts", parts.ToString());
                    m.AddItem("body", body.Substring(i * Chunk, Math.Min(Chunk, body.Length - i * Chunk)));
                    int rc = message_port_send_trusted_message(LauncherId, ReplyPort, m.SafeBundleHandle.DangerousGetHandle());
                    GC.KeepAlive(m);
                    if (rc != 0) { Note("answer " + id + " part " + i + ": rc " + rc + " (0x" + rc.ToString("x8") + ")"); return; }
                }
                catch (Exception ex) { Note("answer " + id + ": " + ex.Message); return; }
            }
        }

        // ---------- Vetro ----------

        /// <summary>
        /// The addresses tried, in order: loopback, the same in IPv6 form (Tizen 9 refuses 127.0.0.1 to some
        /// apps), then the screen's own LAN addresses (The Frame 2025 drops both loopback forms; Vetro listens
        /// on every interface). Read each time, so a LAN address that came up late is there.
        /// </summary>
        private static List<string> cachedHosts;
        private static DateTime hostsUntil = DateTime.MinValue;
        private static readonly TimeSpan HostsFor = TimeSpan.FromMinutes(1);

        /// <summary>The address list, built at most once a minute (requests come every 100 ms at times), or again after every address failed.</summary>
        private static List<string> Hosts()
        {
            var cached = cachedHosts;
            if (cached != null && DateTime.UtcNow < hostsUntil) return cached;
            cached = BuildHosts();
            cachedHosts = cached;
            hostsUntil = DateTime.UtcNow + HostsFor;
            return cached;
        }

        private static void ForgetHosts() { hostsUntil = DateTime.MinValue; }

        private static List<string> BuildHosts()
        {
            var hosts = new List<string> { "127.0.0.1", "::ffff:127.0.0.1" };
            try
            {
                foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var a in nic.GetIPProperties().UnicastAddresses)
                        if (a.Address.AddressFamily == AddressFamily.InterNetwork && !System.Net.IPAddress.IsLoopback(a.Address))
                            hosts.Add(a.Address.ToString());
                }
            }
            catch (Exception) { }
            return hosts.Distinct().ToList();
        }

#if TIZEN6
        /// <summary>The Tizen 6 build (.NET Core 3.1) has no ConnectAsync that takes a token: the token closes the socket instead.</summary>
        private static async Task ConnectWithin(TcpClient client, string host, int port, CancellationToken token)
        {
            using (token.Register(() => client.Dispose()))
            {
                try { await client.ConnectAsync(host, port); }
                catch (Exception) when (token.IsCancellationRequested) { throw new OperationCanceledException(token); }
            }
        }
#endif

        /// <summary>
        /// A request to Vetro: status and body. Starts with the address that worked last; one that does not let us
        /// connect within 5 s moves on to the next. Once connected, a slow answer is only a timeout. Only a
        /// successful connection is remembered, so requests failing at the same time cannot push each other off
        /// an address that works.
        /// </summary>
        private static async Task<(int, string)> Vetro(string method, string path, string body, TimeSpan timeout)
        {
            var hosts = Hosts();
            int vetroPort = APL.VetroPort.Current(Hosts);     // 8099, or the port Vetro was built with (overlay/VetroPort.cs)
            int start = Volatile.Read(ref hostIndex);
            string lastError = "";
            for (int tries = 0; tries < hosts.Count; tries++)
            {
                int index = (start + tries) % hosts.Count;
                string host = hosts[index];
                var client = new TcpClient(host.Contains(':') ? AddressFamily.InterNetworkV6 : AddressFamily.InterNetwork);
                try
                {
                    using (var connect = new CancellationTokenSource(ConnectTimeout))
                    {
#if TIZEN6
                        try { await ConnectWithin(client, host, vetroPort, connect.Token); }
#else
                        try { await client.ConnectAsync(host, vetroPort, connect.Token); }
#endif
                        catch (Exception ex)
                        {
                            lastError = host + ": " + (ex is OperationCanceledException ? "no answer" : ex.Message);
                            if (tries + 1 < hosts.Count) Note("Vetro " + lastError + ", trying " + hosts[(index + 1) % hosts.Count]);
                            continue;
                        }
                        if (index != Volatile.Read(ref hostIndex)) { Volatile.Write(ref hostIndex, index); Note("Vetro reached on " + host); }
                    }
                    using (var answer = new CancellationTokenSource(timeout))
                    {
                        try { return await Exchange(client, method, path, body, answer.Token); }
                        catch (OperationCanceledException) { return (504, "{\"ok\":false,\"error\":\"Vetro did not answer in time\"}"); }
                        catch (Exception ex) { return (502, "{\"ok\":false,\"error\":\"Vetro unreachable: " + JsonText(ex.Message) + "\"}"); }
                    }
                }
                finally { client.Dispose(); }
            }
            ForgetHosts();                     // every address failed: the network may have changed
            APL.VetroPort.Recheck();           // or Vetro moved to another port
            return (502, "{\"ok\":false,\"error\":\"Vetro unreachable on port " + vetroPort + ": " + JsonText(lastError) + "\"}");
        }

        /// <summary>Plain HTTP/1.0, as the Overlay does (overlay/Vetro.cs).</summary>
        private static async Task<(int, string)> Exchange(TcpClient client, string method, string path, string body, CancellationToken ct)
        {
            NetworkStream stream = client.GetStream();
            byte[] content = Encoding.UTF8.GetBytes(body ?? "");
            string head = method + " " + path + " HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n" +
                          "Content-Type: application/json\r\nContent-Length: " + content.Length + "\r\n\r\n";
            byte[] headBytes = Encoding.ASCII.GetBytes(head);
            await stream.WriteAsync(headBytes, 0, headBytes.Length, ct);
            if (content.Length > 0) await stream.WriteAsync(content, 0, content.Length, ct);
            var all = new MemoryStream();
            byte[] buffer = new byte[16384];
            int read;
            while ((read = await stream.ReadAsync(buffer, 0, buffer.Length, ct)) > 0) all.Write(buffer, 0, read);
            string text = Encoding.UTF8.GetString(all.ToArray());
            int split = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            int status = 502;
            Match m = Regex.Match(text, @"^HTTP/\d\.\d (\d{3})");
            if (m.Success) status = int.Parse(m.Groups[1].Value);
            return (status, split < 0 ? "" : text.Substring(split + 4));
        }

        private static string JsonText(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "'"); }

        /// <summary>A root command through Vetro's /exec: its output, "" when Vetro does not answer (it restarts at wake-up).</summary>
        private static async Task<string> Shell(string command)
        {
            var (status, text) = await Vetro("POST", "/exec", JsonSerializer.Serialize(new { cmd = command }), ShellTimeout);
            if (status != 200) return "";
            try
            {
                using (var doc = JsonDocument.Parse(text))
                    return doc.RootElement.TryGetProperty("output", out var o) ? o.GetString() ?? "" : "";
            }
            catch (Exception) { return ""; }
        }

        private static string VconfValue(string output, string key)
        {
            Match m = Regex.Match(output, Regex.Escape(key) + @", value = (\S+)");
            return m.Success ? m.Groups[1].Value : null;
        }

        /// <summary>
        /// Screen state, app in front and source: straight from the platform where it lets us (vconf, then the
        /// app manager for the app in front), Vetro only for what is still missing.
        /// </summary>
        private static async Task<State> ReadState()
        {
            State st = ReadDirect() ?? new State();
            if (st.App == null) st.App = await FrontApp();
            bool needSource = st.App != null && st.App.Contains("tv-viewer") && !st.SourceKnown;
            if (st.Pm != null && st.App != null && !needSource) return st;
            string output = await Shell(StateCommand);
            if (st.Pm == null) st.Pm = VconfValue(output, "memory/pm/state");
            if (st.App == null) st.App = VconfValue(output, "current_fullscreen_appid");
            if (!st.SourceKnown && int.TryParse(VconfValue(output, "source_type"), out int source)) { st.Source = source; st.SourceKnown = true; }
            return st;
        }

        /// <summary>What vconf lets us read directly; null fields are the ones it refused.</summary>
        private static State ReadDirect()
        {
            var st = new State();
            int rcPm = -1, rcSource = -1;
            bool appRead = false;
            try
            {
                rcPm = vconf_get_int("memory/pm/state", out int pm);
                if (rcPm == 0) st.Pm = pm.ToString();
                IntPtr p = vconf_get_str("memory/appfw/current_fullscreen_appid");
                if (p != IntPtr.Zero)
                {
                    appRead = true;
                    string app = Marshal.PtrToStringUTF8(p);
                    free(p);
                    if (!string.IsNullOrEmpty(app)) st.App = app;
                }
                rcSource = vconf_get_int("memory/system/source_type", out int source);
                if (rcSource == 0) { st.Source = source; st.SourceKnown = true; }
            }
            catch (Exception ex) { Note("direct read: " + ex.Message); }
            if (!keysLogged)
            {
                keysLogged = true;
                Note("direct read: pm/state " + (rcPm == 0 ? "ok" : "refused") + ", app in front " + (appRead ? (st.App ?? "empty") : "refused") +
                     ", source " + (rcSource == 0 ? "ok" : "refused"));
            }
            return st;
        }

        /// <summary>The app in front from the app manager, when vconf does not give it: null if unknown. APL Overlay
        /// is never the one: it shows over the others (a package of its own on Tizen 6, apl.launcher.overlay).</summary>
        private static async Task<string> FrontApp()
        {
            try
            {
                var front = (await ApplicationManager.GetRunningApplicationsAsync())
                    .Where(a => a.State.ToString() == "Foreground" && Array.IndexOf(OverlayIds, a.ApplicationId) < 0)
                    .Select(a => a.ApplicationId).ToList();
                if (!appsLogged) { appsLogged = true; Note("app manager, in front: " + (front.Count > 0 ? string.Join(", ", front) : "none")); }
                return front.Count == 1 ? front[0] : null;          // several: not sure which one shows, ask Vetro
            }
            catch (Exception ex)
            {
                if (!appsLogged) { appsLogged = true; Note("app manager: " + ex.Message); }
                return null;
            }
        }

        /// <summary>The screen shows the TV input (antenna, no device) or Samsung's home: the launcher should come back.</summary>
        private static bool OnTvInput(State st)
        {
            return !string.IsNullOrEmpty(st.App) &&
                   ((st.App.Contains("tv-viewer") && st.Source == 0) || st.App.Contains("csfs") || st.App.Contains("home.sidebar") ||
                    st.App.Contains("coba.newhome") || st.App.Contains("home.media"));   // the new Home of the 2025 screens
        }

        private static void OpenLauncher(string why)
        {
            Note("opening the launcher: " + why);
            try { AppControl.SendLaunchRequest(new AppControl { Operation = AppControlOperations.Default, ApplicationId = LauncherId }); }
            catch (Exception ex) { Note("launch: " + ex.Message); }
        }

        // ---------- sleep, wake-up, Art Mode ----------

        /// <summary>The launcher was just hidden: by another app, by Art Mode, or by the screen going to sleep?</summary>
        private async void CheckSleep(int tries)
        {
            while (true)
            {
                if (sleeping || waking || inArt) return;
                State st = await ReadState();
                if (!watchingScreen && !string.IsNullOrEmpty(st.Pm) && st.Pm != "1") { sleeping = true; Note("the screen is going to sleep"); StopLater(); WatchWake(); return; }
                if (!string.IsNullOrEmpty(st.App) && ArtApp.IsMatch(st.App)) { inArt = true; Note("Art Mode in front"); StopLater(); WatchArt(); return; }
                if (tries <= 1 || launcherFront) return;
                tries--;
                await Task.Delay(TimeSpan.FromSeconds(1));
            }
        }

        /// <summary>The reading that shows the wake is passed on: Vetro restarts its agent a moment later and only
        /// answers again after about 15 s, so reading again would keep the TV input on screen meanwhile.</summary>
        private async void WatchWake()
        {
            while (true)
            {
                State st = await ReadState();
                if (st.Pm == "1") { sleeping = false; Note("woke up, in front: " + (string.IsNullOrEmpty(st.App) ? "nothing yet" : st.App)); WokeUp(true, st); return; }
                await Task.Delay(Poll);
            }
        }

        /// <summary>Art Mode in front: wait until it is left. To the TV input or Samsung's home, the launcher comes back.</summary>
        private async void WatchArt()
        {
            while (true)
            {
                if (launcherFront || !inArt) { inArt = false; StopLater(); return; }
                State st = await ReadState();
                if (launcherFront) { inArt = false; StopLater(); return; }
                if (!string.IsNullOrEmpty(st.Pm) && st.Pm != "1")                                                                      // Art Mode, then off
                {
                    inArt = false;
                    if (watchingScreen) { StopLater(); return; }        // the screen watcher saw it too
                    sleeping = true; StopLater(); WatchWake(); return;
                }
                if (string.IsNullOrEmpty(st.App) || ArtApp.IsMatch(st.App)) { await Task.Delay(ArtPoll); continue; }
                inArt = false;
                if (OnTvInput(st)) OpenLauncher("left Art Mode to " + st.App);
                StopLater();
                return;
            }
        }

        /// <summary>
        /// Reads memory/pm/state straight from the platform every second (when it lets us). Off: remembers whether
        /// the launcher was on screen (or Art Mode over it). Back on, or the loop missing its beats because the apps
        /// were frozen: a wake, handled by WokeUp. Nothing here needs Vetro.
        /// </summary>
        private async void WatchScreen()
        {
            if (ReadDirect().Pm == null) { Note("screen watch: pm/state not readable directly, using the launcher's reports"); return; }
            watchingScreen = true;
            Note("screen watch: on");
            bool on = true;
            DateTime last = DateTime.UtcNow;
            while (true)
            {
                await Task.Delay(ScreenEvery);
                DateTime now = DateTime.UtcNow, before = last;
                bool frozen = now - before > Asleep;
                last = now;
                string pm = ReadDirect().Pm;
                if (pm == null) continue;
                bool nowOn = pm != "3" && pm != "4";
                // Judged at the last beat before a freeze: after a long sleep the launcher's "hidden" is always old
                bool wasFront = launcherFront || inArt || (hiddenAt > DateTime.MinValue && before - hiddenAt < HiddenGrace);
                if (on && !nowOn)
                {
                    frontAtSleep = wasFront;
                    sleeping = true;
                    Note("the screen is going to sleep" + (frontAtSleep ? "" : " (launcher not in front)"));
                    StopLater();
                }
                else if ((!on && nowOn) || (frozen && nowOn))
                {
                    bool back = on ? wasFront : frontAtSleep;           // frozen without an "off" reading: judge now
                    sleeping = false;
                    Note("woke up" + (frozen ? " (after a freeze)" : ""));
                    inArt = false;
                    WokeUp(back, null);
                }
                on = nowOn;
            }
        }

        /// <summary>Fallback: the apps were frozen during the sleep, so the tick misses its beats.</summary>
        private async void Ticking()
        {
            while (true)
            {
                await Task.Delay(Tick);
                DateTime now = DateTime.UtcNow;
                if (now - lastTick > Asleep)
                    WokeUp(launcherFront || sleeping || (hiddenAt > DateTime.MinValue && lastTick - hiddenAt < HiddenGrace), null);
                lastTick = now;
            }
        }

        private async void WokeUp(bool wasFront, State first)
        {
            if (waking) return;
            if (!wasFront) { StopLater(); return; }
            waking = true;
            DateTime woke = DateTime.UtcNow, until = woke + WakeWatch, launcherSince = DateTime.MinValue, otherSince = DateTime.MinValue;
            string other = null;
            bool Decided(State st)                // true when nothing more is needed
            {
                if (st == null || string.IsNullOrEmpty(st.App)) return false;
                if (OnTvInput(st)) { OpenLauncher("woke up on " + st.App); return true; }
                // Art Mode in front at wake: leaving it later is watched like any other Art Mode
                if (ArtApp.IsMatch(st.App)) { inArt = true; Note("Art Mode in front after the wake"); WatchArt(); return true; }
                if (st.App != LauncherId)
                {
                    // Another app: the user's choice only if it stays (wake-up screens come and go)
                    if (st.App != other) { other = st.App; otherSince = DateTime.UtcNow; return false; }
                    if (DateTime.UtcNow - otherSince < OtherAppStays) return false;
                    Note(st.App + " stayed in front: left alone");
                    return true;
                }
                other = null;
                if (launcherSince == DateTime.MinValue) launcherSince = DateTime.UtcNow;
                return DateTime.UtcNow - launcherSince > Settle;              // the screen came back on it
            }
            if (!Decided(first))
            {
                while (true)
                {
                    State st = await ReadState();
                    if (Decided(st) || DateTime.UtcNow > until) break;
                    // Back to back at first (a reading takes ~0.5 s), never faster than 10 a second
                    await Task.Delay(DateTime.UtcNow - woke > WakeFast ? Poll : TimeSpan.FromMilliseconds(100));
                }
            }
            waking = false;
            StopLater();
        }

        private static string Item(Bundle b, string key)
        {
            try { return b.Contains(key) ? b.GetItem<string>(key) ?? "" : ""; }
            catch (Exception) { return ""; }
        }

        /// <summary>The package's data folder, next to the Overlay's overlay.log: bridge.log.</summary>
        private static void Note(string message)
        {
            try
            {
                string file = Path.Combine(Current.DirectoryInfo.Data, "bridge.log");
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
