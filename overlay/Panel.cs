using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Tizen.Network.Bluetooth;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace APL
{
    /// <summary>The Control Center, drawn like the launcher's own (launcher/js/controlcenter.js).</summary>
    internal class Panel
    {
        private const string Avoc = "busctl --system call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl ";
        private const string BtMgr = "gdbus call --system --dest com.samsung.tv.bt.connectionmanager --object-path /com/samsung/tv/bt/connectionmanager --method org.tizen.btapp.ApiInterface.";
        private const string SleepFile = "/tmp/apl-sleep-at";
        private const int PanelX = 1260, PanelWidth = 600, Half = 292, Gap = 16;

        private static readonly int[] Timers = { 0, 15, 30, 60, 90, 120 };
        private static readonly int[][] Modes = { new[] { 65536 }, new[] { 65537 }, new[] { 65552 }, new[] { 65538 } };
        private static readonly string[] ModeNames = { "Dynamic", "Standard", "Eco", "Movie" };

        private readonly Window win;
        private readonly string res;
        private readonly View dim;
        private readonly View root;
        private readonly TextLabel clock;
        private readonly TextLabel caption;
        private readonly Timer clockTimer;
        private readonly List<Tile> tiles = new List<Tile>();
        private View body;
        private Tile focused;
        private string view = "main";
        private bool light;

        // State read from the screen each time the panel opens
        private int backlight = -1, pictureMode;
        private bool gameAvailable, gameOn;
        private string network = "";
        private string audioName = "";          // empty: the TV speakers
        private string audioAddress = "";
        private int sleepTimer;
        private DateTime sleepAt = DateTime.MinValue;
        private List<Device> devices = new List<Device>();
        private Timer writeTimer;
        private bool writing;
        private int written = -1;
        private int mainFocus;
        private int scrollY;

        public bool IsOpen { get; private set; }

        private class Device
        {
            public string Name, Address;
            public bool Headphones;
        }

        private class Tile
        {
            public View Root;
            public View IconBack;
            public ImageView Icon;
            public TextLabel Title, Sub, Value;
            public View Bar, Fill;
            public ImageView Check;
            public string Kind;
            public string Name;
            public Func<string> SubText;
            public Func<bool> On;
            public Func<bool> Checked;
            public Color Tint;
            public Action Select;
            public Action<int> Adjust;
            public int X, Y, W, H;
        }

        public Panel(Window window, string resources)
        {
            win = window;
            res = resources;
            dim = new View();
            dim.Size2D = new Size2D(1920, 1080);
            dim.BackgroundColor = new Color(0f, 0f, 0f, 0.32f);
            dim.Opacity = 0f;
            win.Add(dim);
            root = new View();
            root.Size2D = new Size2D(PanelWidth + 80, 1080);
            root.Position2D = new Position2D(PanelX - 40, 0);
            root.Opacity = 0f;
            win.Add(root);
            clock = Label(34, "semiBold");
            clock.Position2D = new Position2D(46, 50);
            clock.Size2D = new Size2D(240, 60);
            root.Add(clock);
            caption = Label(22, "medium");
            caption.HorizontalAlignment = HorizontalAlignment.Center;
            caption.Size2D = new Size2D(PanelWidth, 34);
            caption.Position2D = new Position2D(40, 680);
            root.Add(caption);
            clockTimer = new Timer(20000);
            clockTimer.Tick += delegate { DrawClock(); return true; };
        }

        public void SetTheme(bool isLight)
        {
            light = isLight;
            if (IsOpen) Render(0);
        }

        // ---------- palette (the launcher's tvOS colours) ----------
        private Color TileColor { get { return light ? new Color(0.98f, 0.98f, 0.99f, 0.94f) : new Color(0.23f, 0.24f, 0.29f, 0.94f); } }
        private Color TextColor { get { return light ? new Color(0.11f, 0.11f, 0.12f, 1f) : new Color(1f, 1f, 1f, 1f); } }
        private Color SubColor { get { return light ? new Color(0.43f, 0.43f, 0.45f, 1f) : new Color(1f, 1f, 1f, 0.62f); } }
        private Color IconBackColor { get { return light ? new Color(0f, 0f, 0f, 0.07f) : new Color(1f, 1f, 1f, 0.14f); } }
        private static readonly Color FocusColor = new Color(0.96f, 0.96f, 0.97f, 1f);
        private static readonly Color FocusText = new Color(0.11f, 0.11f, 0.12f, 1f);
        private static readonly Color FocusSub = new Color(0.43f, 0.43f, 0.45f, 1f);
        private static readonly Color Blue = new Color(0.04f, 0.52f, 1f, 1f);
        private static readonly Color Green = new Color(0.19f, 0.82f, 0.35f, 1f);
        private static readonly Color Orange = new Color(1f, 0.62f, 0.04f, 1f);
        private static readonly Color Clear = new Color(0f, 0f, 0f, 0f);

        private TextLabel Label(float pixels, string weight)
        {
            TextLabel t = new TextLabel();
            t.PixelSize = pixels;
            t.FontFamily = "SF Pro Display";
            t.TextColor = TextColor;
            t.VerticalAlignment = VerticalAlignment.Center;
            t.FontStyle = new PropertyMap().Add("weight", new PropertyValue(weight));
            t.Ellipsis = true;
            return t;
        }

        private string IconFile(string name) { return System.IO.Path.Combine(res, "icons", name + ".svg"); }

        // ---------- open and close ----------
        public async void Open()
        {
            if (voice != null) { voiceTimer.Stop(); HideVoice(); }
            IsOpen = true;
            view = "main";
            mainFocus = 1;
            Render(mainFocus);
            DrawClock();
            clockTimer.Start();
            win.Show();
            win.Raise();
            Fade(1f);
            try { await ReadState(); if (IsOpen && view == "main") Refresh(); }
            catch (Exception ex) { Program.Note("read: " + ex.Message); }
        }

        // ---------- Alexa: a Siri-like glow along the bottom, over whatever plays ----------
        private const int VoiceMs = 3200, AnswerMs = 6000, HoldLimitMs = 20000;
        private bool listening;
        private View voice, voicePill;
        private ImageView voiceGlow, voiceOrb, listenOrb;
        private TextLabel voiceText;
        private Timer voiceTimer, voiceRaise;
        private Animation voicePulse, listenPulse, listenTurn, voiceFade;

        private void BuildVoice()
        {
            if (voice != null) return;
            voice = new View();
            voice.Size2D = new Size2D(1920, 1080);
            win.Add(voice);
            voiceGlow = new ImageView();
            voiceGlow.ResourceUrl = IconFile("alexa-glow");
            voiceGlow.Size2D = new Size2D(1920, 260);
            voiceGlow.Position2D = new Position2D(0, 820);
            voice.Add(voiceGlow);
            voicePill = new View();
            voicePill.Size2D = new Size2D(760, 112);
            voicePill.Position2D = new Position2D(580, 900);
            voicePill.CornerRadius = 56f;
            voicePill.BackgroundColor = new Color(0.08f, 0.09f, 0.12f, 0.9f);
            voice.Add(voicePill);
            voiceOrb = new ImageView();
            voiceOrb.ResourceUrl = IconFile("alexa-orb");
            voiceOrb.Size2D = new Size2D(72, 72);
            voiceOrb.PositionUsesPivotPoint = false;
            voiceOrb.PivotPoint = PivotPoint.Center;
            voiceOrb.Position2D = new Position2D(24, 20);
            voicePill.Add(voiceOrb);
            voiceText = Label(30, "semiBold");
            voiceText.TextColor = new Color(1f, 1f, 1f, 1f);
            voiceText.Position2D = new Position2D(116, 28);
            voiceText.Size2D = new Size2D(620, 56);
            voicePill.Add(voiceText);
            // The microphone has no words to show: the orb alone, larger, in the middle
            listenOrb = new ImageView();
            listenOrb.ResourceUrl = IconFile("alexa-orb");
            listenOrb.Size2D = new Size2D(132, 132);
            listenOrb.PositionUsesPivotPoint = false;
            listenOrb.PivotPoint = PivotPoint.Center;
            listenOrb.Position2D = new Position2D(894, 878);
            voice.Add(listenOrb);
            // Its colours turn slowly, as Siri's do; quarter turns, so that each step has one way to go
            KeyFrames turn = new KeyFrames();
            for (int i = 0; i <= 4; i++) turn.Add(i / 4f, new PropertyValue(new Rotation(new Radian(new Degree(90f * i)), PositionAxis.Z)));
            listenTurn = new Animation(5000);
            listenTurn.AnimateBetween(listenOrb, "Orientation", turn);
            listenTurn.Looping = true;
            voiceTimer = new Timer(VoiceMs);
            voiceTimer.Tick += delegate { HideVoice(); return false; };
            // An app that opens comes over this window: the glow goes back on top
            voiceRaise = new Timer(1300);
            voiceRaise.Tick += delegate { if (voice.Visibility) win.Raise(); return false; };
            voicePulse = Pulse(voiceOrb, 700, 1.16f);
        }

        private static Animation Pulse(View orb, int ms, float scale)
        {
#if TIZEN6
            // Tizen 6's NUI has no LoopingMode: the way back is in the key frames, over twice the time
            Animation a = new Animation(ms * 2);
            KeyFrames k = new KeyFrames();
            k.Add(0f, new Vector3(1f, 1f, 1f));
            k.Add(0.5f, new Vector3(scale, scale, 1f), new AlphaFunction(AlphaFunction.BuiltinFunctions.EaseInOut));
            k.Add(1f, new Vector3(1f, 1f, 1f), new AlphaFunction(AlphaFunction.BuiltinFunctions.EaseInOut));
            a.AnimateBetween(orb, "Scale", k);
            a.Looping = true;
#else
            Animation a = new Animation(ms);
            a.AnimateTo(orb, "Scale", new Vector3(scale, scale, 1f), new AlphaFunction(AlphaFunction.BuiltinFunctions.EaseInOut));
            a.Looping = true;
            a.LoopingMode = Animation.LoopingModes.AutoReverse;
#endif
            return a;
        }

        public void ShowVoice(string text)
        {
            if (IsOpen) { Say(Text.T("Alexa: {0}", text)); return; }
            BuildVoice();
            voiceText.Text = text;
            voicePill.Show();
            listenOrb.Hide();
            RevealVoice(VoiceMs);
            voicePulse.Play();
        }

        /// <summary>
        /// The microphone button: the orb beats fast while it is held, then slowly while Alexa answers.
        /// Nothing on the screen says when she has finished, so the glow leaves a few seconds later.
        /// </summary>
        public void Listen(bool held)
        {
            // A held key comes again and again: only the first press and the release count
            if (IsOpen || held == listening) return;
            listening = held;
            BuildVoice();
            voicePill.Hide();
            listenOrb.Show();
            if (listenPulse != null) { listenPulse.Stop(); listenPulse.Dispose(); }
            listenPulse = held ? Pulse(listenOrb, 380, 1.22f) : Pulse(listenOrb, 900, 1.1f);
            listenPulse.Play();
            listenTurn.Play();
            // A release that never comes must not leave the glow up: Alexa stops listening after 20 s
            RevealVoice(held ? HoldLimitMs : AnswerMs);
        }

        /// <summary>Fades the glow in, without taking the remote from the app underneath.</summary>
        private void RevealVoice(int ms)
        {
            Animation fading = voiceFade;
            voiceFade = null;
            if (fading != null) fading.Stop();
            bool shown = voice.Visibility && voice.Opacity > 0.5f;
            voice.Show();
            root.Opacity = 0f;
            dim.Opacity = 0f;
            win.SetAcceptFocus(false);
            win.Show();
            if (!shown)
            {
                voice.Opacity = 0f;
                Animation a = new Animation(220);
                a.AnimateTo(voice, "Opacity", 1f);
                a.Play();
            }
            voiceTimer.Stop();
            voiceTimer.Interval = (uint)ms;
            voiceTimer.Start();
            voiceRaise.Stop();
            voiceRaise.Start();
        }

        private void HideVoice()
        {
            listening = false;
            voicePulse.Stop();
            if (listenPulse != null) listenPulse.Stop();
            if (listenTurn != null) listenTurn.Stop();
            Animation fade = new Animation(300);
            voiceFade = fade;
            fade.AnimateTo(voice, "Opacity", 0f);
            fade.Finished += delegate
            {
                if (voiceFade != fade) return;              // shown again meanwhile
                voiceFade = null;
                voice.Hide();
                if (!IsOpen) win.Hide();
                win.SetAcceptFocus(true);
            };
            fade.Play();
        }

        /// <summary>Apps open through the launcher, which knows how to bring each one back.</summary>
        public async void RunVoice(string target, bool on)
        {
            try
            {
                if (target.StartsWith("app:", StringComparison.Ordinal))
                {
                    if (on) Program.OpenLauncher("open:" + target.Substring(4));
                    return;
                }
                if (target == "cmd:home") { if (on) Program.OpenLauncher(); return; }
                if (target == "cmd:screen") { if (!on) await Vetro.Exec("/usr/bin/input_keyevent XF86PowerOff"); return; }
                if (target == "cmd:game")
                {
                    await Vetro.Exec(Avoc + "SetGameMode ii 1 " + (on ? 1 : 0) + " 2>&1");
                    return;
                }
                if (target == "cmd:airpods")
                {
                    if (!on) { await Vetro.Exec(BtMgr + "disconnect_last_btspk_list 2>&1"); return; }
                    ReadDevices();
                    foreach (Device d in devices)
                    {
                        if (!d.Name.ToLowerInvariant().Contains("airpods")) continue;
                        await Vetro.Exec(BtMgr + "buds_switching_connect " + d.Address + " 2>&1");
                        return;
                    }
                }
            }
            catch (Exception ex) { Program.Note("voice: " + ex.Message); }
        }

        public void Close()
        {
            if (!IsOpen) return;
            IsOpen = false;
            clockTimer.Stop();
            FlushBacklight();
            win.Hide();
            root.Opacity = 0f;
            dim.Opacity = 0f;
        }

        private void Fade(float to)
        {
            Animation a = new Animation(170);
            a.AnimateTo(root, "Opacity", to);
            a.AnimateTo(dim, "Opacity", to);
            a.Play();
        }

        private void DrawClock() { clock.Text = DateTime.Now.ToString("HH:mm"); }

        // ---------- what the screen says ----------
        private async Task ReadState()
        {
            string answer = await Vetro.Exec(
                "echo bl $(" + Avoc + "GetBacklight i 0 2>/dev/null); " +
                "echo pm $(" + Avoc + "GetPictureMode i 0 2>/dev/null); " +
                "echo gc $(" + Avoc + "CheckGameMode 2>/dev/null); " +
                "echo gm $(" + Avoc + "GetGameMode i 0 2>/dev/null); " +
                "echo wi $(vconftool get memory/wifi/connected_ap_name 2>/dev/null | sed 's/.*value = //; s/ (String)//'); " +
                "echo sl $(cat " + SleepFile + " 2>/dev/null); " +
                "echo bt $(" + BtMgr + "get_connected_bt_speaker_info 2>/dev/null)");
            audioAddress = "";
            foreach (string line in answer.Split('\n'))
            {
                int space = line.IndexOf(' ');
                if (space < 0) continue;
                string key = line.Substring(0, space), value = line.Substring(space + 1).Trim();
                string[] words = value.Split(' ');
                if (key == "bl" && words.Length >= 3 && words[2] == "0") { int.TryParse(words[1], out backlight); written = backlight; }
                else if (key == "pm" && words.Length >= 2) int.TryParse(words[1], out pictureMode);
                else if (key == "gc") gameAvailable = words.Length >= 2 && words[1] == "1";
                else if (key == "gm") gameOn = gameAvailable && words.Length >= 2 && words[1] == "1";
                else if (key == "wi") network = value;
                else if (key == "sl")
                {
                    long at;
                    sleepAt = long.TryParse(value, out at) ? DateTime.UnixEpoch.AddSeconds(at) : DateTime.MinValue;
                    if (sleepAt < DateTime.UtcNow) sleepAt = DateTime.MinValue;
                }
                else if (key == "bt") ReadSpeaker(value);
            }
        }

        private void ReadSpeaker(string gdbusAnswer)
        {
            audioName = "";
            int a = gdbusAnswer.IndexOf("address", StringComparison.OrdinalIgnoreCase);
            if (gdbusAnswer.Contains("'null'") || a < 0) return;
            audioAddress = Field(gdbusAnswer, "address");
            string name = Field(gdbusAnswer, "name");
            if (!string.IsNullOrEmpty(name)) audioName = name;
        }

        /// <summary>Reads "key":"value" in a Samsung Bluetooth answer, a JSON text inside a gdbus string.</summary>
        private static string Field(string text, string key)
        {
            int i = text.IndexOf(key, StringComparison.OrdinalIgnoreCase);
            if (i < 0) return "";
            i = text.IndexOf(':', i);
            if (i < 0) return "";
            i = text.IndexOf('"', i);
            if (i < 0) return "";
            int j = text.IndexOf('"', i + 1);
            return j < 0 ? "" : text.Substring(i + 1, j - i - 1);
        }

        /// <summary>Paired sound devices: same rules as the launcher's Audio panel.</summary>
        private void ReadDevices()
        {
            devices = new List<Device>();
            foreach (BluetoothDevice b in BluetoothAdapter.GetBondedDevices())
            {
                string name = b.Name ?? "", low = name.ToLowerInvariant();
                BluetoothMajorDeviceClassType major = b.Class.MajorDeviceClassType;
                bool phones = low.Contains("airpods") || low.Contains("buds") || low.Contains("casque") || low.Contains("headphone") ||
                              low.Contains("headset") || low.Contains("écouteur") || low.Contains("beats");
                bool audio = phones || major == BluetoothMajorDeviceClassType.AudioVideo || low.Contains("enceinte") || low.Contains("speaker") || low.Contains("soundbar");
                if (!audio) continue;
                Device d = new Device();
                d.Name = name;
                d.Address = b.Address;
                d.Headphones = phones;
                devices.Add(d);
            }
        }

        // ---------- views ----------
        private void Render(int focusIndex)
        {
            if (body != null) { root.Remove(body); body.Dispose(); }
            body = new View();
            body.Size2D = new Size2D(PanelWidth + 80, 1000);
            body.Position2D = new Position2D(0, 0);
            root.Add(body);
            root.Remove(clock); root.Add(clock);
            root.Remove(caption); root.Add(caption);
            tiles.Clear();
            focused = null;
            scrollY = 0;
            caption.Text = "";
            clock.TextColor = TextColor;
            caption.TextColor = TextColor;
            if (view == "main") BuildMain();
            else if (view == "audio") BuildAudio();
            else if (view == "sources") BuildSources();
            int i = Math.Max(0, Math.Min(focusIndex, tiles.Count - 1));
            foreach (Tile t in tiles) Draw(t, false);
            if (tiles.Count > 0) Focus(tiles[i]);
        }

        private void Refresh()
        {
            foreach (Tile t in tiles) Draw(t, t == focused);
            if (focused != null && focused.Kind == "round") caption.Text = CaptionOf(focused);
        }

        private void BuildMain()
        {
            int y = 128;
            Tile sleep = Add("big", Text.T("Sleep"), "power", 0, y, Half, 252, null);
            sleep.Select = SleepNow;
            Tile wifi = Add("pill", "Wi-Fi", "wifi", Half + Gap, y, Half, 118, delegate { return string.IsNullOrEmpty(network) ? "—" : network; });
            wifi.Tint = Blue;
            wifi.On = delegate { return !string.IsNullOrEmpty(network); };
            wifi.Select = delegate { Close(); Program.OpenLauncher("connexions"); };
            Tile audio = Add("pill", Text.T("Audio"), "airplayAudio", Half + Gap, y + 134, Half, 118, delegate { return string.IsNullOrEmpty(audioName) ? Text.T("TV Speakers") : audioName; });
            audio.Select = delegate { ShowSub("audio"); };
            y += 268;
            Tile timer = Add("pill", Text.T("Sleep Timer"), "timer", 0, y, Half, 118, TimerText);
            timer.Tint = Orange;
            timer.On = delegate { return sleepAt > DateTime.UtcNow; };
            timer.Select = NextTimer;
            Tile settings = Add("pill", Text.T("Settings"), "gear", Half + Gap, y, Half, 118, delegate { return Text.T("All Settings"); });
            settings.Select = delegate { Close(); Program.OpenLauncher("settings"); };
            y += 134;
            int roundGap = (PanelWidth - 4 * 112) / 3;
            Tile game = Add("round", Text.T("Game Mode"), "gamepad", 0, y, 112, 112, delegate { return gameOn ? Text.T("On") : gameAvailable ? Text.T("Off") : Text.T("After switching to HDMI or USB-C"); });
            game.Tint = Green;
            game.On = delegate { return gameOn; };
            game.Select = ToggleGame;
            Tile image = Add("round", Text.T("Picture Mode"), "display", 112 + roundGap, y, 112, 112, ModeName);
            image.Select = NextMode;
            Tile sources = Add("round", Text.T("Sources"), "source", 2 * (112 + roundGap), y, 112, 112, delegate { return "HDMI, USB-C"; });
            sources.Select = delegate { ShowSub("sources"); };
            Tile mute = Add("round", Text.T("Mute"), "speakerMute", 3 * (112 + roundGap), y, 112, 112, null);
            mute.Select = ToggleMute;
            y += 112 + 48;
            caption.Position2D = new Position2D(40, y - 44);
            AddSlider(y);
        }

        private void AddSlider(int y)
        {
            Tile t = Add("slider", Text.T("Brightness"), "sun", 0, y, PanelWidth, 104, null);
            t.Adjust = AdjustBacklight;
            t.Bar = new View();
            t.Bar.Size2D = new Size2D(PanelWidth - 180, 16);
            t.Bar.Position2D = new Position2D(84, 44);
            t.Bar.CornerRadius = 8f;
            t.Root.Add(t.Bar);
            t.Fill = new View();
            t.Fill.Size2D = new Size2D(0, 16);
            t.Fill.CornerRadius = 8f;
            t.Bar.Add(t.Fill);
            t.Value = Label(25, "semiBold");
            t.Value.HorizontalAlignment = HorizontalAlignment.End;
            t.Value.Size2D = new Size2D(64, 40);
            t.Value.Position2D = new Position2D(PanelWidth - 90, 32);
            t.Root.Add(t.Value);
        }

        private void BuildAudio()
        {
            Heading(Text.T("Audio"));
            int y = 200;
            Tile tv = Row(Text.T("TV Speakers"), "display", y, delegate { return Text.T("Samsung screen"); });
            tv.Checked = delegate { return string.IsNullOrEmpty(audioAddress); };
            tv.Select = SpeakersToTv;
            y += 118;
            foreach (Device d in devices)
            {
                Device dev = d;
                Tile row = Row(dev.Name, dev.Headphones ? "headphones" : "speaker", y, delegate { return Same(dev.Address, audioAddress) ? Text.T("Connected") : Text.T("Not Connected"); });
                row.Checked = delegate { return Same(dev.Address, audioAddress); };
                row.Select = delegate { Connect(dev); };
                y += 118;
            }
        }

        private void BuildSources()
        {
            Heading(Text.T("Sources"));
            int y = 200;
            Tile hdmi = Row("HDMI", "hdmi", y, delegate { return Text.T("Console, PC, set-top box"); });
            hdmi.Select = delegate { SwitchSource(13, "HDMI 1"); };
            Tile usbc = Row("USB-C", "usbc", y + 118, delegate { return Text.T("Laptop, Mac, tablet"); });
            usbc.Select = delegate { SwitchSource(14, "USB-C"); };
        }

        private void Heading(string text)
        {
            TextLabel head = Label(32, "bold");
            head.Text = text;
            head.TextColor = TextColor;
            head.Position2D = new Position2D(48, 128);
            head.Size2D = new Size2D(PanelWidth, 56);
            body.Add(head);
            caption.Position2D = new Position2D(40, 900);
        }

        private Tile Row(string title, string icon, int y, Func<string> sub)
        {
            return Add("row", title, icon, 0, y, PanelWidth, 104, sub);
        }

        private Tile Add(string kind, string title, string icon, int x, int y, int w, int h, Func<string> sub)
        {
            Tile t = new Tile();
            t.Kind = kind;
            t.Name = title;
            t.SubText = sub;
            t.X = x; t.Y = y; t.W = w; t.H = h;
            t.Root = new View();
            t.Root.PositionUsesPivotPoint = false;
            t.Root.PivotPoint = PivotPoint.Center;
            t.Root.Size2D = new Size2D(w, h);
            t.Root.Position2D = new Position2D(40 + x, y);
            t.Root.CornerRadius = kind == "big" ? 60f : h / 2f;
            body.Add(t.Root);
            int iconSize, iconBack;
            if (kind == "big") { iconSize = 92; iconBack = 0; }
            else if (kind == "round") { iconSize = 44; iconBack = 0; }
            else if (kind == "slider") { iconSize = 38; iconBack = 0; }
            else if (kind == "row") { iconSize = 32; iconBack = 58; }
            else { iconSize = 38; iconBack = 56; }
            if (iconBack > 0)
            {
                t.IconBack = new View();
                t.IconBack.Size2D = new Size2D(iconBack, iconBack);
                t.IconBack.CornerRadius = iconBack / 2f;
                t.IconBack.Position2D = new Position2D(20, (h - iconBack) / 2);
                t.Root.Add(t.IconBack);
            }
            t.Icon = new ImageView();
            t.Icon.ResourceUrl = IconFile(icon);
            t.Icon.Size2D = new Size2D(iconSize, iconSize);
            if (iconBack > 0) t.Icon.Position2D = new Position2D(20 + (iconBack - iconSize) / 2, (h - iconSize) / 2);
            else if (kind == "big") t.Icon.Position2D = new Position2D((w - iconSize) / 2, 52);
            else if (kind == "slider") t.Icon.Position2D = new Position2D(28, (h - iconSize) / 2);
            else t.Icon.Position2D = new Position2D((w - iconSize) / 2, (h - iconSize) / 2);
            t.Root.Add(t.Icon);
            if (kind == "pill" || kind == "row")
            {
                int left = 20 + iconBack + 16;
                int check = kind == "row" ? 50 : 16;
                t.Title = Label(kind == "row" ? 25 : 24, "semiBold");
                t.Title.Text = title;
                t.Title.Position2D = new Position2D(left, h / 2 - 34);
                t.Title.Size2D = new Size2D(w - left - check, 34);
                t.Root.Add(t.Title);
                t.Sub = Label(21, "regular");
                t.Sub.Position2D = new Position2D(left, h / 2 + 2);
                t.Sub.Size2D = new Size2D(w - left - check, 30);
                t.Root.Add(t.Sub);
            }
            else if (kind == "big")
            {
                t.Title = Label(26, "semiBold");
                t.Title.Text = title;
                t.Title.HorizontalAlignment = HorizontalAlignment.Center;
                t.Title.Position2D = new Position2D(0, 166);
                t.Title.Size2D = new Size2D(w, 40);
                t.Root.Add(t.Title);
            }
            if (kind == "row")
            {
                t.Check = new ImageView();
                t.Check.ResourceUrl = IconFile("check");
                t.Check.Size2D = new Size2D(30, 30);
                t.Check.Position2D = new Position2D(w - 56, (h - 30) / 2);
                t.Root.Add(t.Check);
            }
            tiles.Add(t);
            return t;
        }

        private void Draw(Tile t, bool focus)
        {
            bool on = t.On != null && t.On();
            Color text = focus ? FocusText : TextColor;
            t.Root.BackgroundColor = focus ? FocusColor : (t.Kind == "round" && on ? t.Tint : TileColor);
            if (t.Title != null) t.Title.TextColor = text;
            if (t.Sub != null)
            {
                t.Sub.TextColor = focus ? FocusSub : SubColor;
                if (t.SubText != null) t.Sub.Text = t.SubText();
            }
            if (t.IconBack != null) t.IconBack.BackgroundColor = on && t.Tint != null ? t.Tint : focus ? new Color(0f, 0f, 0f, 0.07f) : IconBackColor;
            if (t.Kind == "round" && on) t.Icon.Color = focus ? t.Tint : new Color(1f, 1f, 1f, 1f);
            else if (t.IconBack != null && on && t.Tint != null) t.Icon.Color = new Color(1f, 1f, 1f, 1f);
            else t.Icon.Color = text;
            if (t.Check != null)
            {
                t.Check.Color = focus ? Blue : text;             // Color also sets the opacity
                t.Check.Opacity = t.Checked != null && t.Checked() ? 1f : 0f;
            }
            if (t.Kind == "slider")
            {
                t.Bar.BackgroundColor = focus ? new Color(0f, 0f, 0f, 0.12f) : light ? new Color(0f, 0f, 0f, 0.13f) : new Color(1f, 1f, 1f, 0.2f);
                t.Fill.BackgroundColor = text;
                t.Value.TextColor = text;
                DrawBacklight(t);
            }
        }

        private void DrawBacklight(Tile t)
        {
            int width = t.Bar.Size2D.Width;
            t.Fill.Size2D = new Size2D(backlight < 0 ? 0 : width * backlight / 50, 16);
            t.Value.Text = backlight < 0 ? "—" : backlight.ToString();
        }

        private string CaptionOf(Tile t)
        {
            return t.SubText != null ? t.Name + " · " + t.SubText() : t.Name;
        }

        private void Say(string text) { caption.Text = text; }

        // ---------- focus ----------
        private void Focus(Tile t)
        {
            Animation a = new Animation(140);
            if (focused != null)
            {
                Draw(focused, false);
                a.AnimateTo(focused.Root, "Scale", new Vector3(1f, 1f, 1f));
            }
            focused = t;
            t.Root.RaiseToTop();
            Draw(t, true);
            float scale = t.Kind == "round" ? 1.1f : t.Kind == "slider" ? 1.03f : 1.06f;
            a.AnimateTo(t.Root, "Scale", new Vector3(scale, scale, 1f));
            a.Play();
            caption.Text = t.Kind == "round" ? CaptionOf(t) : caption.Text;
            if (t.Kind != "round" && view == "main") caption.Text = "";
            ScrollTo(t);
        }

        private void ScrollTo(Tile t)
        {
            int bottom = 1040, top = 40;
            int y = t.Y + scrollY;
            int shift = 0;
            if (y + t.H > bottom) shift = bottom - (y + t.H);
            else if (y < top) shift = top - y;
            if (shift == 0) return;
            scrollY += shift;
            Animation a = new Animation(200);
            a.AnimateTo(body, "PositionY", (float)scrollY);
            a.Play();
        }

        /// <summary>The nearest tile in that direction, like the launcher's focus engine.</summary>
        private Tile Neighbour(int dx, int dy)
        {
            if (focused == null) return null;
            int cx = focused.X + focused.W / 2, cy = focused.Y + focused.H / 2;
            Tile best = null;
            double bestScore = double.MaxValue;
            foreach (Tile t in tiles)
            {
                if (t == focused) continue;
                int tx = t.X + t.W / 2, ty = t.Y + t.H / 2;
                int along = dx != 0 ? (tx - cx) * dx : (ty - cy) * dy;
                int across = dx != 0 ? Math.Abs(ty - cy) : Math.Abs(tx - cx);
                if (along <= 0) continue;
                // Must overlap on the other axis when going sideways
                if (dx != 0 && (t.Y + t.H <= focused.Y || t.Y >= focused.Y + focused.H)) continue;
                double score = along + across * 2;
                if (score < bestScore) { bestScore = score; best = t; }
            }
            return best;
        }

        public void Key(string name)
        {
            if (!IsOpen) return;
            int dx = name == "Left" ? -1 : name == "Right" ? 1 : 0;
            int dy = name == "Up" ? -1 : name == "Down" ? 1 : 0;
            if (dx != 0 && focused != null && focused.Adjust != null) { focused.Adjust(dx); return; }
            if (dx != 0 || dy != 0)
            {
                Tile next = Neighbour(dx, dy);
                if (next != null) Focus(next);
                return;
            }
            if (name == "Return" || name == "KP_Enter" || name == "Select")
            {
                if (focused != null && focused.Select != null) focused.Select();
                return;
            }
            if (name == "XF86Back" || name == "Escape" || name == "XF86Exit")
            {
                if (view == "main") Close();
                else { view = "main"; Render(mainFocus); }
            }
        }

        private void ShowSub(string name)
        {
            mainFocus = tiles.IndexOf(focused);
            view = name;
            Render(0);
            if (name == "audio") LoadAudio();
        }

        private async void LoadAudio()
        {
            try
            {
                ReadDevices();
                await ReadState();
                if (IsOpen && view == "audio")
                {
                    int current = 0;
                    for (int i = 0; i < devices.Count; i++) if (Same(devices[i].Address, audioAddress)) current = i + 1;
                    Render(current);
                }
            }
            catch (Exception ex) { Program.Note("audio: " + ex.Message); }
        }

        private static bool Same(string a, string b) { return string.Equals(a, b, StringComparison.OrdinalIgnoreCase); }

        // ---------- actions ----------
        private async void SleepNow()
        {
            Close();
            try { await Vetro.Exec("/usr/bin/input_keyevent XF86PowerOff"); }
            catch (Exception ex) { Program.Note("sleep: " + ex.Message); }
        }

        private void AdjustBacklight(int direction)
        {
            if (backlight < 0) return;
            backlight = Math.Max(0, Math.Min(50, backlight + direction));
            if (focused != null) DrawBacklight(focused);
            if (writeTimer == null)
            {
                writeTimer = new Timer(350);
                writeTimer.Tick += delegate { FlushBacklight(); return false; };
            }
            writeTimer.Stop();
            writeTimer.Start();
        }

        private async void FlushBacklight()
        {
            if (backlight < 0 || backlight == written || writing) return;
            writing = true;
            int value = backlight;
            try
            {
                // Type 1 saves the value; with 0 the screen forgets it within a second
                await Vetro.Exec(Avoc + "SetBacklight ii " + value + " 1 2>&1");
                written = value;
            }
            catch (Exception ex) { Program.Note("backlight: " + ex.Message); }
            writing = false;
            if (backlight != written) FlushBacklight();
        }

        private string TimerText()
        {
            if (sleepAt <= DateTime.UtcNow) return Text.T("timer|Off");
            return Math.Max(1, (int)Math.Round((sleepAt - DateTime.UtcNow).TotalMinutes)) + " min";
        }

        /// <summary>The screen runs the timer: an app in front stops the launcher, and this panel can close.</summary>
        private async void NextTimer()
        {
            int i = Array.IndexOf(Timers, sleepTimer);
            sleepTimer = Timers[(i + 1) % Timers.Length];
            sleepAt = sleepTimer > 0 ? DateTime.UtcNow.AddMinutes(sleepTimer) : DateTime.MinValue;
            Refresh();
            string command = "rm -f " + SleepFile;
            if (sleepTimer > 0)
            {
                long at = (long)(sleepAt - DateTime.UnixEpoch).TotalSeconds;
                command = "echo " + at + " > " + SleepFile + "; (sleep " + (sleepTimer * 60) + "; if [ \"$(cat " + SleepFile + " 2>/dev/null)\" = \"" + at + "\" ]; then rm -f " + SleepFile + "; /usr/bin/input_keyevent XF86PowerOff; fi) >/dev/null 2>&1 &";
            }
            try { await Vetro.Exec(command); }
            catch (Exception ex) { Program.Note("timer: " + ex.Message); }
        }

        private async void ToggleGame()
        {
            if (!gameAvailable) { Say(Text.T("Game Mode: switch to HDMI or USB-C first")); return; }
            bool want = !gameOn;
            Say(want ? Text.T("Turning on Game Mode…") : Text.T("Turning off Game Mode…"));
            try
            {
                string back = await Vetro.Exec(Avoc + "SetGameMode ii 1 " + (want ? 1 : 0) + " 2>&1; sleep 1; " + Avoc + "GetGameMode i 0 2>&1");
                string[] lines = back.Trim().Split('\n');
                string[] words = lines[lines.Length - 1].Trim().Split(' ');
                gameOn = words.Length >= 2 && words[1] == "1";
                Say(gameOn == want ? (gameOn ? Text.T("Game Mode on") : Text.T("Game Mode off")) : Text.T("The screen refused Game Mode for now"));
                await ReadState();
                if (IsOpen && view == "main") Refresh();
            }
            catch (Exception ex) { Program.Note("game: " + ex.Message); }
        }

        private string ModeName()
        {
            for (int i = 0; i < Modes.Length; i++) if (Modes[i][0] == pictureMode) return Text.T(ModeNames[i]);
            return pictureMode == 458769 ? Text.T("Game") : Text.T("Automatic");
        }

        private async void NextMode()
        {
            int i = 0;
            for (int k = 0; k < Modes.Length; k++) if (Modes[k][0] == pictureMode) i = k + 1;
            int next = Modes[i % Modes.Length][0];
            int oldBacklight = backlight;
            try
            {
                // Standard came with a backlight of 0: a mode in that state takes the current value
                string back = await Vetro.Exec(Avoc + "GetContrast i 0 2>/dev/null; " + Avoc + "SetPictureMode ii " + next + " 1 2>&1; " +
                                               Avoc + "GetBacklight i 0 2>/dev/null; " + Avoc + "GetContrast i 0 2>/dev/null; " + Avoc + "GetPictureMode i 0 2>/dev/null");
                string[] lines = back.Trim().Split('\n');
                int oldContrast = Word(lines, 0), nowBacklight = Word(lines, lines.Length - 3), nowContrast = Word(lines, lines.Length - 2);
                pictureMode = Word(lines, lines.Length - 1);
                if (nowBacklight == 0 && oldBacklight > 0) await Vetro.Exec(Avoc + "SetBacklight ii " + oldBacklight + " 1 2>&1");
                else if (nowBacklight >= 0) backlight = nowBacklight;
                written = backlight;
                if (nowContrast == 0 && oldContrast > 0) await Vetro.Exec(Avoc + "SetContrast yi " + oldContrast + " 1 2>&1");
                if (IsOpen && view == "main") Refresh();
            }
            catch (Exception ex) { Program.Note("mode: " + ex.Message); }
        }

        private static int Word(string[] lines, int index)
        {
            if (index < 0 || index >= lines.Length) return -1;
            string[] words = lines[index].Trim().Split(' ');
            int value;
            return words.Length >= 2 && int.TryParse(words[1], out value) ? value : -1;
        }

        private async void ToggleMute()
        {
            try { await Vetro.Exec("/usr/bin/input_keyevent XF86AudioMute"); }
            catch (Exception ex) { Program.Note("mute: " + ex.Message); }
        }

        private async void SpeakersToTv()
        {
            if (string.IsNullOrEmpty(audioAddress)) return;
            Say(Text.T("Switching to the screen's speakers…"));
            try
            {
                await Vetro.Exec(BtMgr + "disconnect_last_btspk_list 2>&1");
                await WaitSpeaker("", 6);
            }
            catch (Exception ex) { Program.Note("speakers: " + ex.Message); }
        }

        private async void Connect(Device dev)
        {
            if (Same(dev.Address, audioAddress)) { SpeakersToTv(); return; }
            Say(Text.T("Connecting to “{0}”…", dev.Name));
            try
            {
                await Vetro.Exec(BtMgr + "buds_switching_connect " + dev.Address + " 2>&1");
                bool ok = await WaitSpeaker(dev.Address, 10);
                Say(ok ? Text.T("Sound on “{0}”", dev.Name) : Text.T("“{0}” is not responding: open the case or turn on the headphones.", dev.Name));
            }
            catch (Exception ex) { Program.Note("connect: " + ex.Message); }
        }

        private async Task<bool> WaitSpeaker(string address, int tries)
        {
            for (int i = 0; i < tries; i++)
            {
                await ReadState();
                if (IsOpen && view == "audio") Refresh();
                if (Same(audioAddress, address)) return true;
                await Task.Delay(1500);
            }
            return false;
        }

        private async void SwitchSource(int type, string label)
        {
            Close();
            string icon = "/usr/apps/com.samsung.tv.theme-resource/shared/res/org.tizen.menu/Settings_Popup/device_icon/r_icon_device_s_hdmi" + (type - 12) + ".webp";
            try
            {
                await Vetro.Exec("/usr/bin/app_launcher -s org.tizen.tv-viewer change_source '" + type + "' sourceType '" + type + "' sourceName '" + label +
                                 "' sourceIcon '" + icon + "' __K_EX_LAUNCH_REQUESTOR 'user' 2>&1");
            }
            catch (Exception ex) { Program.Note("source: " + ex.Message); }
        }
    }
}
