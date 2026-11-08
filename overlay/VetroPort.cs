using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace APL
{
    /// <summary>
    /// Vetro's port, found as the web bridge finds it (launcher/bridge/service.js): 8099, unless Vetro was built
    /// with another one (VETRO_PORT=… node build.cjs), which some people do because another app holds 8099
    /// (tizen-youtube; Reddit, 1.0.22). Then nothing answers on 8099, or another app does.
    /// Checked once per run with /status, in the background: requests never wait for it. When the port is not
    /// Vetro's, 8099 is tried, then every port open on the screen at once, and the one that answers like Vetro
    /// is kept in the package's data folder (vetro-port), shared by APL Overlay, the .NET bridge and the web
    /// bridge. Compiled into both the Overlay and the bridge (bridge/Bridge.csproj).
    /// </summary>
    internal static class VetroPort
    {
        internal const int Default = 8099;
        private static readonly int[] NotVetro = { 8001, 8002 };     // the screen's own remote API
        /// <summary>Tried when the open ports cannot be read.</summary>
        private static readonly int[] UsualPorts = { 8098, 8100, 8097, 9000, 9099, 8090, 8088, 8080, 8888, 9090, 8199, 18099 };
        private static readonly TimeSpan ProbeConnect = TimeSpan.FromSeconds(1.5), ProbeAnswer = TimeSpan.FromSeconds(3);
        private static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(30);
        private const int MaxProbes = 64;
        private const string FileName = "vetro-port";

        private static int port, saved, checking;
        private static bool checkedOk;
        private static long nextCheckTicks;
        private static string lastProblem = "";

        /// <summary>Where a found port or a failed search is written (the Overlay's or the bridge's log). May stay null.</summary>
        internal static Action<string> Log;

        static VetroPort()
        {
            saved = Remembered();
            if (saved == 0) saved = Default;
            port = saved;
        }

        /// <summary>The port to use now. The first call of the run, and the first after <see cref="Recheck"/>, starts the
        /// check in the background with the addresses <paramref name="hosts"/> gives.</summary>
        internal static int Current(Func<IList<string>> hosts)
        {
            if (!Volatile.Read(ref checkedOk) && DateTime.UtcNow.Ticks >= Interlocked.Read(ref nextCheckTicks) &&
                Interlocked.CompareExchange(ref checking, 1, 0) == 0)
            {
                Task.Run(() => Check(hosts()));
            }
            return Volatile.Read(ref port);
        }

        /// <summary>Vetro could not be reached on the port from any address: it may have moved, so it is looked for again.</summary>
        internal static void Recheck() { Volatile.Write(ref checkedOk, false); }

        private enum Kind { Vetro, Other, Refused, Blocked }

        private static async Task Check(IList<string> hosts)
        {
            try
            {
                DateTime t0 = DateTime.UtcNow;
                int current = Volatile.Read(ref port);
                var tried = new List<int> { current };
                string host = null, why = null;
                // The first address that is not blocked (Tizen 9 refuses 127.0.0.1 to some apps, The Frame 2025 both loopback forms)
                foreach (string h in hosts)
                {
                    Kind kind = await Probe(h, current);
                    if (kind == Kind.Blocked) continue;
                    if (kind == Kind.Vetro) { Found(current, null, t0); return; }
                    host = h;
                    why = (kind == Kind.Refused ? "nothing on " : "another app on ") + current;
                    break;
                }
                if (host == null) { GaveUp("no address reached"); return; }
                if (current != Default)
                {
                    tried.Add(Default);
                    if (await Probe(host, Default) == Kind.Vetro) { Found(Default, "usual port", t0); return; }
                }
                List<int> ports = ListeningPorts();
                string from = "open ports";
                if (ports.Count == 0) { ports = UsualPorts.ToList(); from = "usual ports"; }
                ports = ports.Where(p => !tried.Contains(p)).Take(MaxProbes).ToList();
                Kind[] kinds = await Task.WhenAll(ports.Select(p => Probe(host, p)));
                for (int i = 0; i < ports.Count; i++)
                    if (kinds[i] == Kind.Vetro) { Found(ports[i], "found among " + ports.Count + " " + from, t0); return; }
                GaveUp(why + ", not among " + ports.Count + " " + from);
            }
            catch (Exception ex) { GaveUp(ex.Message); }
            finally { Volatile.Write(ref checking, 0); }
        }

        private static void Found(int p, string how, DateTime t0)
        {
            if (p != Volatile.Read(ref port) || how != null)
                Log?.Invoke("Vetro on port " + p + " (" + (how ?? "checked") + ", " + (int)(DateTime.UtcNow - t0).TotalMilliseconds + " ms)");
            Volatile.Write(ref port, p);
            Volatile.Write(ref checkedOk, true);
            lastProblem = "";
            if (p == saved) return;
            saved = p;
            try
            {
                string file = FilePath();
                if (p == Default) { if (File.Exists(file)) File.Delete(file); }      // the usual port leaves no file behind
                else File.WriteAllText(file, p.ToString());
            }
            catch (Exception) { }
        }

        private static void GaveUp(string why)
        {
            Interlocked.Exchange(ref nextCheckTicks, (DateTime.UtcNow + RetryAfter).Ticks);
            if (why == lastProblem) return;
            lastProblem = why;
            Log?.Invoke("Vetro's port: " + why);
        }

        private static string FilePath()
        {
            try { return Path.Combine(Tizen.Applications.Application.Current.DirectoryInfo.Data, FileName); }
            catch (Exception) { return "/opt/usr/home/owner/apps_rw/APLauncher/data/" + FileName; }
        }

        private static bool Valid(int p) { return p >= 1024 && p <= 65535 && !NotVetro.Contains(p); }

        private static int Remembered()
        {
            try
            {
                int p;
                string file = FilePath();
                if (File.Exists(file) && int.TryParse(File.ReadAllText(file).Trim(), out p) && Valid(p)) return p;
            }
            catch (Exception) { }
            return 0;
        }

        /// <summary>The ports open on the screen (LISTEN in /proc/net/tcp and tcp6), smallest first.</summary>
        private static List<int> ListeningPorts()
        {
            var ports = new SortedSet<int>();
            foreach (string file in new[] { "/proc/net/tcp", "/proc/net/tcp6" })
            {
                string[] lines;
                try { lines = File.ReadAllLines(file); }
                catch (Exception) { continue; }
                for (int i = 1; i < lines.Length; i++)
                {
                    string[] f = lines[i].Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (f.Length < 4 || f[3] != "0A") continue;
                    int colon = f[1].LastIndexOf(':');
                    int p;
                    if (colon < 0 || !int.TryParse(f[1].Substring(colon + 1), System.Globalization.NumberStyles.HexNumber, null, out p)) continue;
                    if (Valid(p)) ports.Add(p);
                }
            }
            return ports.ToList();
        }

        /// <summary>Vetro's /status: its build ("app", with its version) and its root agent ("agent").</summary>
        private static bool IsVetro(string body)
        {
            try
            {
                using (JsonDocument doc = JsonDocument.Parse(body))
                {
                    JsonElement root = doc.RootElement, app, version, agent;
                    if (root.ValueKind != JsonValueKind.Object) return false;
                    if (root.TryGetProperty("app", out app) && app.ValueKind == JsonValueKind.Object &&
                        app.TryGetProperty("version", out version) && version.ValueKind == JsonValueKind.String) return true;
                    return root.TryGetProperty("agent", out agent) && agent.ValueKind == JsonValueKind.Object;
                }
            }
            catch (Exception) { return false; }
        }

        /// <summary>GET /status on one address and port. The token closes the socket, which ends a slow attempt on every runtime.</summary>
        private static async Task<Kind> Probe(string host, int p)
        {
            using (var client = new TcpClient(host.Contains(':') ? AddressFamily.InterNetworkV6 : AddressFamily.InterNetwork))
            {
                try
                {
                    using (var connect = new CancellationTokenSource(ProbeConnect))
                    using (connect.Token.Register(() => client.Dispose()))
                    {
                        try { await client.ConnectAsync(host, p); }
                        catch (Exception) when (connect.IsCancellationRequested) { return Kind.Blocked; }
                    }
                }
                catch (SocketException ex) when (ex.SocketErrorCode == SocketError.ConnectionRefused) { return Kind.Refused; }
                catch (Exception) { return Kind.Blocked; }
                try
                {
                    using (var answer = new CancellationTokenSource(ProbeAnswer))
                    using (answer.Token.Register(() => client.Dispose()))
                    {
                        NetworkStream stream = client.GetStream();
                        byte[] head = Encoding.ASCII.GetBytes("GET /status HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
                        await stream.WriteAsync(head, 0, head.Length);
                        var all = new MemoryStream();
                        byte[] buffer = new byte[8192];
                        int read;
                        while ((read = await stream.ReadAsync(buffer, 0, buffer.Length)) > 0)
                        {
                            all.Write(buffer, 0, read);
                            if (all.Length > 262144) return Kind.Other;
                        }
                        string text = Encoding.UTF8.GetString(all.ToArray());
                        int split = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                        return split >= 0 && IsVetro(text.Substring(split + 4)) ? Kind.Vetro : Kind.Other;
                    }
                }
                catch (Exception) { return Kind.Other; }
            }
        }
    }
}
