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
        private const int VetroPort = 8099;
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
        private const string StateCommand = "vconftool get memory/pm/state; vconftool get memory/appfw/current_fullscreen_appid; vconftool get memory/system/source_type";

        // Answers go through the platform call without a local port: with one attached (MessagePort.Send,
        // whichever port) the screen refuses every message to the launcher's page ("Can't send message").
        [DllImport("libcapi-message-port.so.1")] private static extern int message_port_send_trusted_message(string appId, string port, IntPtr bundle);

        private MessagePort port;
        private CancellationTokenSource idle;
        private bool launcherFront, sleeping, waking, inArt;
        private DateTime hiddenAt = DateTime.MinValue, lastTick = DateTime.UtcNow;
        private static int hostIndex;

        private sealed class State
        {
            public string Pm, App;
            public int Source = -1;
        }

        protected override void OnCreate()
        {
            base.OnCreate();
            try
            {
                port = new MessagePort(PortName, true);
                port.MessageReceived += OnMessage;
                port.Listen();
                Note("listening on " + PortName);
            }
            catch (Exception ex) { Note("listen failed: " + ex.Message); }
            Ticking();
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
        private static List<string> Hosts()
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

        /// <summary>
        /// A request to Vetro: status and body. An address that does not let us connect within 5 s moves on
        /// to the next one; once connected, a slow answer is only a timeout and the address is kept.
        /// </summary>
        private static async Task<(int, string)> Vetro(string method, string path, string body, TimeSpan timeout)
        {
            var hosts = Hosts();
            string lastError = "";
            for (int tries = 0; tries < hosts.Count; tries++)
            {
                string host = hosts[hostIndex % hosts.Count];
                var client = new TcpClient(host.Contains(':') ? AddressFamily.InterNetworkV6 : AddressFamily.InterNetwork);
                try
                {
                    using (var connect = new CancellationTokenSource(ConnectTimeout))
                    {
                        try { await client.ConnectAsync(host, VetroPort, connect.Token); }
                        catch (Exception ex)
                        {
                            lastError = host + ": " + (ex is OperationCanceledException ? "no answer" : ex.Message);
                            hostIndex = (hostIndex + 1) % hosts.Count;
                            if (tries + 1 < hosts.Count) Note("Vetro " + lastError + ", trying " + hosts[hostIndex % hosts.Count]);
                            continue;
                        }
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
            return (502, "{\"ok\":false,\"error\":\"Vetro unreachable: " + JsonText(lastError) + "\"}");
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

        /// <summary>Screen state, app in front and source in one read.</summary>
        private static async Task<State> ReadState()
        {
            string output = await Shell(StateCommand);
            var st = new State { Pm = VconfValue(output, "memory/pm/state"), App = VconfValue(output, "current_fullscreen_appid") };
            if (int.TryParse(VconfValue(output, "source_type"), out int source)) st.Source = source;
            return st;
        }

        /// <summary>The screen shows the TV input (antenna, no device) or Samsung's home: the launcher should come back.</summary>
        private static bool OnTvInput(State st)
        {
            return !string.IsNullOrEmpty(st.App) &&
                   ((st.App.Contains("tv-viewer") && st.Source == 0) || st.App.Contains("csfs") || st.App.Contains("home.sidebar"));
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
                if (!string.IsNullOrEmpty(st.Pm) && st.Pm != "1") { sleeping = true; Note("the screen is going to sleep"); StopLater(); WatchWake(); return; }
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
                if (st.Pm == "1") { sleeping = false; Note("woke up"); WokeUp(true, st); return; }
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
                if (!string.IsNullOrEmpty(st.Pm) && st.Pm != "1") { inArt = false; sleeping = true; StopLater(); WatchWake(); return; }   // Art Mode, then off
                if (string.IsNullOrEmpty(st.App) || ArtApp.IsMatch(st.App)) { await Task.Delay(ArtPoll); continue; }
                inArt = false;
                if (OnTvInput(st)) OpenLauncher("left Art Mode to " + st.App);
                StopLater();
                return;
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
            if (waking || !wasFront) return;
            waking = true;
            DateTime until = DateTime.UtcNow + WakeWatch, launcherSince = DateTime.MinValue;
            bool Decided(State st)                // true when nothing more is needed
            {
                if (st == null || string.IsNullOrEmpty(st.App)) return false;
                if (OnTvInput(st)) { OpenLauncher("woke up on " + st.App); return true; }
                if (st.App != LauncherId) return true;
                if (launcherSince == DateTime.MinValue) launcherSince = DateTime.UtcNow;
                return DateTime.UtcNow - launcherSince > Settle;              // the screen came back on it
            }
            if (!Decided(first))
            {
                while (true)
                {
                    State st = await ReadState();
                    if (Decided(st) || DateTime.UtcNow > until) break;
                    await Task.Delay(Poll);
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
