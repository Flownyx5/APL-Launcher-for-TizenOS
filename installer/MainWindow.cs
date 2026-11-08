using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using static APL.Setup.Strings;

namespace APL.Setup
{
    /// <summary>The window: sidebar, pages, the sheet used for confirmations, and what the pages share.</summary>
    internal sealed class MainWindow
    {
        internal static MainWindow Current;

        internal readonly Window Window;
        internal readonly Grid Root;
        internal readonly ScriptRunner Runner;
        /// <summary>True in --shot mode: nothing runs, nothing is asked on the network.</summary>
        internal readonly bool Offline;

        internal readonly InstallPage Install;
        internal readonly OptimizePage Optimize;
        internal readonly RestorePage Restore;
        internal readonly ToolsPage Tools;
        internal readonly AboutPage About;

        private readonly Dictionary<string, RadioButton> nav = new Dictionary<string, RadioButton>();
        private readonly Dictionary<string, Page> pages = new Dictionary<string, Page>();
        private readonly Grid sideMark;
        private readonly TextBlock sideTitle, sideText;
        private TaskCompletionSource<bool> sheetAnswer;
        private bool closingConfirmed;

        /// <summary>The screen chosen on the Install page and what Vetro said about it.</summary>
        internal string Ip = "";
        private VetroInfo vetro;
        /// <summary>Its port goes to the links and the scripts (Vetro.UsePort).</summary>
        internal VetroInfo Vetro
        {
            get { return vetro; }
            set { vetro = value; if (value != null) APL.Setup.Vetro.UsePort(value.Port); }
        }
        internal bool VetroChecked;
        internal string ScriptsError;
        internal string SideDetail;

        internal MainWindow(bool offline)
        {
            Current = this;
            Offline = offline;
            Window = (Window)Ui.LoadXaml("MainWindow.xaml");
            Window.Title = T("APL Launcher Setup");
            Root = Ui.Find<Grid>(Window, "Root");
            Ui.Translate(Root);
            Runner = new ScriptRunner(Window.Dispatcher);
            Runner.Changed += () =>
            {
                RefreshSide();
                RefreshActions();
                if (!Runner.Busy && Optimize != null) Optimize.OnScreenChanged();   // a read that waited for the PC check
            };

            var icon = Ui.AppIcon();
            Window.Icon = icon;
            Ui.Find<Image>(Window, "AppIcon").Source = icon;
            Ui.Find<TextBlock>(Window, "VersionText").Text = T("Version {0}", BuildInfo.Version);
            sideMark = Ui.Find<Grid>(Window, "SideMark");
            sideTitle = Ui.Find<TextBlock>(Window, "SideTitle");
            sideText = Ui.Find<TextBlock>(Window, "SideText");

            Install = new InstallPage(this);
            Optimize = new OptimizePage(this);
            Restore = new RestorePage(this);
            Tools = new ToolsPage(this);
            About = new AboutPage(this);
            var host = Ui.Find<Grid>(Window, "PageHost");
            foreach (var p in new Page[] { Install, Optimize, Restore, Tools, About })
            {
                pages[p.Key] = p;
                p.View.Visibility = Visibility.Collapsed;
                host.Children.Add(p.View);
                var rb = Ui.Find<RadioButton>(Window, "Nav" + char.ToUpperInvariant(p.Key[0]) + p.Key.Substring(1));
                nav[p.Key] = rb;
                string key = p.Key;
                rb.Checked += (s, e) => ShowPage(key);
            }
            ShowPage("install");

            Ui.InternalLink = Navigate;
            Ui.Find<Button>(Window, "SheetCancel").Click += (s, e) => CloseSheet(false);
            Ui.Find<Button>(Window, "SheetOk").Click += (s, e) => CloseSheet(true);
            Window.PreviewKeyDown += OnKey;
            Window.SourceInitialized += (s, e) => DarkTitleBar();
            Window.Closing += OnClosing;
            Window.Loaded += (s, e) => { if (!Offline) Start(); };
            if (!Offline) Install.Prefill();
            RefreshSide();
        }

        // ---------- start ----------

        private async void Start()
        {
            try
            {
                Runner.Root = await Task.Run(() => Payload.FindRoot());
                Log.Info("scripts in " + Runner.Root + (Payload.IsDev ? " (next to the app)" : ""));
            }
            catch (Exception ex)
            {
                Log.Error("payload", ex);
                ScriptsError = ex.Message;
            }
            Install.OnScriptsReady();
            RefreshActions();
        }

        // ---------- navigation ----------

        internal void Navigate(string key)
        {
            RadioButton rb;
            if (!nav.TryGetValue(key, out rb)) return;
            if (rb.IsChecked == true) ShowPage(key); else rb.IsChecked = true;
        }

        private string shown;

        private void ShowPage(string key)
        {
            if (shown == key) return;
            shown = key;
            foreach (var p in pages.Values)
            {
                bool on = p.Key == key;
                p.View.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
                if (!on) continue;
                // A short fade, like switching panes in System Settings.
                if (!Offline) p.View.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0.0, 1.0, TimeSpan.FromMilliseconds(160)));
                p.OnShown();
            }
        }

        internal string ShownPage { get { return shown; } }

        // ---------- shared state ----------

        internal bool ScreenReady { get { return Vetro != null && Vetro.AgentReady && Vetro.Ip == Ip; } }

        internal void OnScreenChanged()
        {
            RefreshSide();
            RefreshActions();
            if (Optimize != null) Optimize.OnScreenChanged();
        }

        internal void RefreshActions()
        {
            foreach (var p in pages.Values) p.UpdateActions();
        }

        internal void SetSideDetail(string text)
        {
            SideDetail = text;
            RefreshSide();
        }

        private void RefreshSide()
        {
            sideMark.Children.Clear();
            if (Runner.Busy)
            {
                sideMark.Children.Add(Ui.Spinner(16));
                sideTitle.Text = Runner.Running;
                sideText.Text = string.IsNullOrEmpty(SideDetail) ? T("Please wait…") : SideDetail;
                return;
            }
            SideDetail = null;
            sideTitle.Text = T("Screen");
            if (!Vetro_IsValidIp())
            {
                sideMark.Children.Add(Ui.Dot("Text3", 9));
                sideText.Text = T("Not chosen yet");
            }
            else if (!VetroChecked)
            {
                sideMark.Children.Add(Ui.Dot("Text3", 9));
                sideText.Text = Ip;
            }
            else
            {
                sideMark.Children.Add(Ui.Dot(ScreenReady ? "Green" : Vetro != null ? "Orange" : "Red", 9));
                sideText.Text = Ip + " · " + (ScreenReady ? T("Vetro ready") : Vetro != null ? T("Vetro starting") : T("No answer"));
            }
            sideMark.Children[0].SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Left);
            sideMark.Children[0].SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        }

        private bool Vetro_IsValidIp() { return APL.Setup.Vetro.IsIPv4(Ip); }

        // ---------- the sheet (custom confirmation dialog) ----------

        /// <summary>Asks a question over the window. Returns true for the main button.</summary>
        internal Task<bool> Ask(string title, string text, string ok, bool danger = false, string glyph = "",
                                string tileColor = "Accent", string cancel = "Cancel", IEnumerable<string> bullets = null)
        {
            if (sheetAnswer != null) sheetAnswer.TrySetResult(false);
            sheetAnswer = new TaskCompletionSource<bool>();
            var iconHost = Ui.Find<Grid>(Window, "SheetIcon");
            iconHost.Children.Clear();
            iconHost.Children.Add(Ui.Tile(glyph, tileColor, 40));
            Ui.Find<TextBlock>(Window, "SheetTitle").Text = title;
            var body = Ui.Find<StackPanel>(Window, "SheetBody");
            body.Children.Clear();
            var tb = Ui.Text(text, "Body");
            tb.Foreground = Ui.Brush("Text2");
            body.Children.Add(tb);
            if (bullets != null)
            {
                var list = new StackPanel { Margin = new Thickness(0, 10, 0, 0) };
                foreach (string b in bullets) list.Children.Add(Bullet(b));
                body.Children.Add(list);
            }
            var okBtn = Ui.Find<Button>(Window, "SheetOk");
            okBtn.Content = ok;
            okBtn.Style = Ui.Res<Style>(danger ? "Button.Danger" : "Button.Primary");
            var cancelBtn = Ui.Find<Button>(Window, "SheetCancel");
            cancelBtn.Content = T(cancel);
            Ui.Show(cancelBtn, cancel != null);
            var sheet = Ui.Find<Grid>(Window, "Sheet");
            sheet.Visibility = Visibility.Visible;
            if (Offline) return sheetAnswer.Task;
            sheet.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(140)));
            var card = Ui.Find<Border>(Window, "SheetCard");
            var scale = new ScaleTransform(0.96, 0.96);
            card.RenderTransformOrigin = new Point(0.5, 0.5);
            card.RenderTransform = scale;
            var grow = new DoubleAnimation(0.96, 1, TimeSpan.FromMilliseconds(180)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, grow);
            scale.BeginAnimation(ScaleTransform.ScaleYProperty, grow);
            okBtn.Dispatcher.BeginInvoke(new Action(() => (danger ? cancelBtn : okBtn).Focus()), System.Windows.Threading.DispatcherPriority.Input);
            return sheetAnswer.Task;
        }

        internal static FrameworkElement Bullet(string text, string color = "Text3")
        {
            var g = new Grid { Margin = new Thickness(0, 3, 0, 3) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            var dot = Ui.Dot(color, 5);
            dot.VerticalAlignment = VerticalAlignment.Top;
            dot.Margin = new Thickness(2, 8, 12, 0);
            g.Children.Add(dot);
            var tb = Ui.Text(text, "Body");
            Grid.SetColumn(tb, 1);
            g.Children.Add(tb);
            return g;
        }

        internal void HideSheet() { CloseSheet(false); }

        private void CloseSheet(bool answer)
        {
            Ui.Find<Grid>(Window, "Sheet").Visibility = Visibility.Collapsed;
            var t = sheetAnswer;
            sheetAnswer = null;
            if (t != null) t.TrySetResult(answer);
        }

        internal void ShowError(string message)
        {
            var _ = Ask(T("Something went wrong"), message + "\n\n" + T("Details are in {0}", Log.FilePath), T("OK"),
                        glyph: "", tileColor: "Red", cancel: null);
        }

        private void OnKey(object sender, KeyEventArgs e)
        {
            if (sheetAnswer == null) return;
            if (e.Key == Key.Escape) { CloseSheet(false); e.Handled = true; }
        }

        // ---------- window chrome ----------

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        private void DarkTitleBar()
        {
            try
            {
                IntPtr hwnd = new WindowInteropHelper(Window).Handle;
                int on = 1;
                DwmSetWindowAttribute(hwnd, 20, ref on, 4);           // immersive dark mode (Windows 10 20H1+)
                int caption = 0x00161312;                              // #121316 as COLORREF (0x00BBGGRR): blends with the window (Windows 11)
                DwmSetWindowAttribute(hwnd, 35, ref caption, 4);
            }
            catch (Exception ex) { Log.Error("title bar", ex); }
        }

        private async void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            if (closingConfirmed || !Runner.ChangesScreen || Offline) { if (Runner.Busy) Runner.StopAll(); return; }
            e.Cancel = true;
            bool quit = await Ask(T("Stop and quit?"), T("A task is still running ({0}). Quitting now stops it, and the screen may be left half set up.", Runner.TaskName),
                                  T("Quit"), danger: true, glyph: "", tileColor: "Orange", cancel: "Keep going");
            if (!quit) return;
            closingConfirmed = true;
            Runner.StopAll();
            Window.Close();
        }
    }

    /// <summary>A page of the window, loaded from its XAML file and translated.</summary>
    internal abstract class Page
    {
        protected readonly MainWindow Main;
        internal readonly FrameworkElement View;
        internal readonly string Key;

        protected Page(MainWindow main, string key, string xaml)
        {
            Main = main;
            Key = key;
            View = (FrameworkElement)Ui.LoadXaml(xaml);
            Ui.Translate(View);
        }

        protected T F<T>(string name) where T : class { return Ui.Find<T>(View, name); }
        internal virtual void OnShown() { }
        internal virtual void UpdateActions() { }

        /// <summary>Appends script output to a log box and follows it when it was at the bottom.</summary>
        /// <summary>Scrolls a result into view once it has been laid out (results often land below the fold).</summary>
        protected void Reveal(FrameworkElement e)
        {
            if (Main.Offline) return;
            e.Dispatcher.BeginInvoke(new Action(() => e.BringIntoView()), System.Windows.Threading.DispatcherPriority.Loaded);
        }

        protected static void AppendLog(TextBox box, string line)
        {
            bool atEnd = box.VerticalOffset + box.ViewportHeight >= box.ExtentHeight - 4;
            if (box.Text.Length > 300000) box.Text = box.Text.Substring(box.Text.Length - 200000);
            box.AppendText((box.Text.Length > 0 ? "\n" : "") + line);
            if (atEnd) box.ScrollToEnd();
        }
    }
}
