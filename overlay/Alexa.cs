using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace APL
{
    /// <summary>
    /// Lets an Echo in the same home drive the screen, with no skill or account: each app and command
    /// is announced on the local network as a smart plug (Belkin WeMo protocol, which Echo devices
    /// find by themselves). "Alexa, turn on TizenTube" then arrives here as "plug on".
    /// It only ever runs the short list below; it reads nothing and answers nothing else.
    /// </summary>
    internal class Alexa
    {
        private const int FirstPort = 49320;            // 52300 and 52312 are taken by the screen
        private const string Multicast = "239.255.255.250";

        public class Device
        {
            public string Name, Target, Serial;
            public int Port;
            public bool State;
        }

        private readonly List<Device> devices = new List<Device>();
        private readonly Action<Device, bool> onCommand;
        private readonly object sync = new object();
        private UdpClient ssdp;
        private List<TcpListener> listeners = new List<TcpListener>();
        private string address = "";
        private bool running;

        public Alexa(Action<Device, bool> command) { onCommand = command; }

        /// <summary>"Name=target;Name=target": the launcher's apps, plus the screen's own commands.</summary>
        public void Start(string list)
        {
            Stop();
            devices.Clear();
            Add(Text.T("Screen"), "cmd:screen");
            Add(Text.T("Home"), "cmd:home");
            Add(Text.T("alexa|Game Mode"), "cmd:game");         // the name the Echo hears (Text.cs)
            Add("AirPods", "cmd:airpods");
            foreach (string entry in (list ?? "").Split(';'))
            {
                int eq = entry.IndexOf('=');
                if (eq > 0) Add(entry.Substring(0, eq), entry.Substring(eq + 1));
            }
            address = LocalAddress();
            if (string.IsNullOrEmpty(address)) { Program.Note("alexa: no address"); return; }
            running = true;
            foreach (Device d in devices) Serve(d);
            ListenDiscovery();
        }

        public void Stop()
        {
            running = false;
            List<TcpListener> old;
            lock (sync) { old = listeners; listeners = new List<TcpListener>(); }
            foreach (TcpListener l in old) { try { l.Stop(); } catch (Exception) { } }
            if (ssdp != null) { try { ssdp.Close(); } catch (Exception) { } ssdp = null; }
        }

        private void Add(string name, string target)
        {
            Device d = new Device();
            d.Name = name;
            d.Target = target;
            d.Port = FirstPort + devices.Count;
            // Stable, so that an Echo keeps knowing this plug after a restart
            uint hash = 2166136261;
            foreach (char c in target) hash = (hash ^ c) * 16777619;
            d.Serial = "APL" + hash.ToString("X8");
            devices.Add(d);
        }

        private static string LocalAddress()
        {
            try
            {
                using (Socket s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp))
                {
                    s.Connect("192.0.2.1", 9);       // nothing is sent: this only picks the network interface
                    return ((IPEndPoint)s.LocalEndPoint).Address.ToString();
                }
            }
            catch (Exception ex) { Program.Note("alexa address: " + ex.Message); return ""; }
        }

        // ---------- discovery ----------
        private async void ListenDiscovery()
        {
            UdpClient socket = null;
            try
            {
                socket = ssdp = new UdpClient();
                socket.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                socket.Client.Bind(new IPEndPoint(IPAddress.Any, 1900));
                socket.JoinMulticastGroup(IPAddress.Parse(Multicast), IPAddress.Parse(address));
                while (running && socket == ssdp)
                {
                    UdpReceiveResult r = await socket.ReceiveAsync();
                    string text = Encoding.ASCII.GetString(r.Buffer);
                    if (text.StartsWith("M-SEARCH", StringComparison.Ordinal) &&
                        (text.Contains("urn:Belkin:device:**") || text.Contains("ssdp:all") || text.Contains("upnp:rootdevice")))
                    {
                        Answer(r.RemoteEndPoint);
                    }
                }
            }
            catch (Exception ex)
            {
                // Closed by Stop(): the list changed or the bridge was turned off
                if (socket == ssdp && running) Program.Note("alexa discovery: " + ex.Message);
            }
        }

        private async void Answer(IPEndPoint to)
        {
            try
            {
                foreach (Device d in devices)
                {
                    string reply = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=86400\r\nDATE: " + DateTime.UtcNow.ToString("r") + "\r\nEXT:\r\n" +
                                   "LOCATION: http://" + address + ":" + d.Port + "/setup.xml\r\n" +
                                   "OPT: \"http://schemas.upnp.org/upnp/1/0/\"; ns=01\r\n01-NLS: " + d.Serial + "\r\n" +
                                   "SERVER: Unspecified, UPnP/1.0, Unspecified\r\nX-User-Agent: redsonic\r\n" +
                                   "ST: urn:Belkin:device:**\r\nUSN: uuid:Socket-1_0-" + d.Serial + "::urn:Belkin:device:**\r\n\r\n";
                    byte[] bytes = Encoding.ASCII.GetBytes(reply);
                    await ssdp.SendAsync(bytes, bytes.Length, to);
                    await Task.Delay(30);
                }
            }
            catch (Exception ex) { Program.Note("alexa answer: " + ex.Message); }
        }

        // ---------- each plug ----------
        private async void Serve(Device d)
        {
            TcpListener listener = new TcpListener(IPAddress.Any, d.Port);
            try
            {
                listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                listener.Start();
                lock (sync) listeners.Add(listener);
                while (running)
                {
                    TcpClient client = await listener.AcceptTcpClientAsync();
                    Handle(client, d);
                }
            }
            catch (Exception ex)
            {
                bool current;
                lock (sync) current = listeners.Contains(listener);
                if (current) Program.Note("alexa " + d.Port + ": " + ex.Message);
            }
        }

        private async void Handle(TcpClient client, Device d)
        {
            try
            {
                using (client)
                {
                    NetworkStream stream = client.GetStream();
                    stream.ReadTimeout = 4000;
                    StringBuilder text = new StringBuilder();
                    byte[] buffer = new byte[4096];
                    int contentLength = -1, bodyAt = -1;
                    while (bodyAt < 0 || text.Length < bodyAt + contentLength)
                    {
                        int read = await stream.ReadAsync(buffer, 0, buffer.Length);
                        if (read <= 0) break;
                        text.Append(Encoding.UTF8.GetString(buffer, 0, read));
                        if (bodyAt < 0)
                        {
                            string sofar = text.ToString();
                            int split = sofar.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                            if (split >= 0)
                            {
                                bodyAt = split + 4;
                                contentLength = HeaderLength(sofar.Substring(0, split));
                            }
                        }
                        if (text.Length > 65536) return;
                    }
                    string request = text.ToString();
                    string body;
                    string type = "text/xml; charset=\"utf-8\"";
                    if (request.StartsWith("GET /setup.xml", StringComparison.Ordinal)) body = SetupXml(d);
                    else if (request.StartsWith("GET /eventservice.xml", StringComparison.Ordinal)) body = ServiceXml();
                    else if (request.StartsWith("GET /metainfoservice.xml", StringComparison.Ordinal)) body = ServiceXml();
                    else if (request.StartsWith("POST /upnp/control/basicevent1", StringComparison.Ordinal)) body = Control(d, request);
                    else
                    {
                        byte[] missing = Encoding.ASCII.GetBytes("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        await stream.WriteAsync(missing, 0, missing.Length);
                        return;
                    }
                    byte[] content = Encoding.UTF8.GetBytes(body);
                    string head = "HTTP/1.1 200 OK\r\nCONTENT-TYPE: " + type + "\r\nCONTENT-LENGTH: " + content.Length +
                                  "\r\nDATE: " + DateTime.UtcNow.ToString("r") + "\r\nEXT:\r\nSERVER: Unspecified, UPnP/1.0, Unspecified\r\n" +
                                  "X-User-Agent: redsonic\r\nCONNECTION: close\r\n\r\n";
                    byte[] headBytes = Encoding.ASCII.GetBytes(head);
                    await stream.WriteAsync(headBytes, 0, headBytes.Length);
                    await stream.WriteAsync(content, 0, content.Length);
                }
            }
            catch (Exception ex) { Program.Note("alexa request: " + ex.Message); }
        }

        private static int HeaderLength(string head)
        {
            foreach (string line in head.Split('\n'))
            {
                if (!line.StartsWith("content-length:", StringComparison.OrdinalIgnoreCase)) continue;
                int n;
                if (int.TryParse(line.Substring(15).Trim(), out n)) return n;
            }
            return 0;
        }

        private string Control(Device d, string request)
        {
            bool set = request.IndexOf("#SetBinaryState", StringComparison.OrdinalIgnoreCase) >= 0;
            if (set)
            {
                bool on = request.Contains("<BinaryState>1</BinaryState>");
                d.State = on;
                onCommand(d, on);
            }
            string action = set ? "SetBinaryStateResponse" : "GetBinaryStateResponse";
            return "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>" +
                   "<u:" + action + " xmlns:u=\"urn:Belkin:service:basicevent:1\"><BinaryState>" + (d.State ? 1 : 0) + "</BinaryState></u:" + action + ">" +
                   "</s:Body></s:Envelope>";
        }

        private static string SetupXml(Device d)
        {
            return "<?xml version=\"1.0\"?><root xmlns=\"urn:Belkin:device-1-0\"><device>" +
                   "<deviceType>urn:Belkin:device:controllee:1</deviceType><friendlyName>" + System.Security.SecurityElement.Escape(d.Name) + "</friendlyName>" +
                   "<manufacturer>Belkin International Inc.</manufacturer><modelName>Emulated Socket</modelName><modelNumber>3.1415</modelNumber>" +
                   "<UDN>uuid:Socket-1_0-" + d.Serial + "</UDN><serialNumber>" + d.Serial + "</serialNumber><binaryState>0</binaryState>" +
                   "<serviceList><service><serviceType>urn:Belkin:service:basicevent:1</serviceType><serviceId>urn:Belkin:serviceId:basicevent1</serviceId>" +
                   "<controlURL>/upnp/control/basicevent1</controlURL><eventSubURL>/upnp/event/basicevent1</eventSubURL><SCPDURL>/eventservice.xml</SCPDURL></service></serviceList>" +
                   "</device></root>";
        }

        private static string ServiceXml()
        {
            return "<?xml version=\"1.0\"?><scpd xmlns=\"urn:Belkin:service-1-0\"><actionList>" +
                   "<action><name>SetBinaryState</name><argumentList><argument><retval/><name>BinaryState</name><relatedStateVariable>BinaryState</relatedStateVariable><direction>in</direction></argument></argumentList></action>" +
                   "<action><name>GetBinaryState</name><argumentList><argument><retval/><name>BinaryState</name><relatedStateVariable>BinaryState</relatedStateVariable><direction>out</direction></argument></argumentList></action>" +
                   "</actionList><serviceStateTable><stateVariable sendEvents=\"yes\"><name>BinaryState</name><dataType>Boolean</dataType><defaultValue>0</defaultValue></stateVariable></serviceStateTable></scpd>";
        }

        /// <summary>The list as the launcher last sent it, kept so that the plugs come back after a restart.</summary>
        public static string LoadList(string file)
        {
            try { return File.Exists(file) ? File.ReadAllText(file) : ""; }
            catch (Exception) { return ""; }
        }
    }
}
