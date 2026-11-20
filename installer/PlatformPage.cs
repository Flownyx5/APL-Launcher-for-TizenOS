using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using static APL.Setup.Strings;

namespace APL.Setup
{
    /// <summary>
    /// The first page: which TV (Samsung, LG, Android TV) and whether it is rooted. It says what root
    /// brings on that TV, what is missing without it, and how to install without a PC.
    /// </summary>
    internal sealed class PlatformPage : Page
    {
        internal const string Apps2Samsung = "https://github.com/Apps2Samsung/Apps2Samsung";
        internal const string HbcRepo = "https://raw.githubusercontent.com/Knikt/APL-Launcher/main/webos/repo/apps.json";
        internal const string RootOneLiner = "wget -qO- https://raw.githubusercontent.com/Knikt/APL-Launcher/main/webos/root/install.sh | sh";

        private readonly StackPanel options, list;
        private readonly CheckBox rootToggle;
        private readonly TextBlock rootTitle, rootText, listTitle, howText, phoneText, footerHint, continueText;
        private readonly Button continueButton;
        private readonly Dictionary<string, Button> rows = new Dictionary<string, Button>();
        private readonly Dictionary<string, FrameworkElement> checks = new Dictionary<string, FrameworkElement>();
        private string choice = "tizen";
        private bool rendering;

        internal PlatformPage(MainWindow main) : base(main, "platform", "PlatformPage.xaml")
        {
            options = F<StackPanel>("Options");
            list = F<StackPanel>("List");
            rootToggle = F<CheckBox>("RootToggle");
            rootTitle = F<TextBlock>("RootTitle");
            rootText = F<TextBlock>("RootText");
            listTitle = F<TextBlock>("ListTitle");
            howText = F<TextBlock>("HowText");
            phoneText = F<TextBlock>("PhoneText");
            footerHint = F<TextBlock>("FooterHint");
            continueText = F<TextBlock>("ContinueText");
            continueButton = F<Button>("ContinueButton");

            AddOption("tizen", "Accent", "Samsung", T("Tizen TVs and Smart Monitors"));
            AddOption("webos", "Red", "LG", T("webOS TVs: OLED, QNED, NanoCell…"));
            AddOption("android", "Green", "Android TV · Google TV", T("Sony, TCL, Philips, Nvidia Shield, Chromecast with Google TV…"));

            rootToggle.Checked += (s, e) => { if (!rendering) Render(); };
            rootToggle.Unchecked += (s, e) => { if (!rendering) Render(); };
            continueButton.Click += (s, e) => Continue();
            Select("tizen", true);
        }

        internal string Choice { get { return choice; } }
        internal bool Rooted { get { return choice == "android" || rootToggle.IsChecked == true; } }

        private void AddOption(string key, string color, string name, string detail)
        {
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.Children.Add(Ui.Tile("", color, 34));
            var texts = new StackPanel { Margin = new Thickness(14, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
            texts.Children.Add(new TextBlock { Text = name, FontSize = 15, FontWeight = FontWeights.SemiBold });
            texts.Children.Add(new TextBlock { Text = detail, FontSize = 12.5, Foreground = Ui.Brush("Text2"), Margin = new Thickness(0, 2, 0, 0), TextTrimming = TextTrimming.CharacterEllipsis });
            Grid.SetColumn(texts, 1);
            g.Children.Add(texts);
            var check = Ui.Badge(Status.Ok, 22);
            check.Margin = new Thickness(0, 0, 4, 0);
            Grid.SetColumn(check, 2);
            g.Children.Add(check);
            var row = new Button { Style = Ui.Res<Style>("Button.Row"), Content = g, Margin = new Thickness(0, 2, 0, 2), Padding = new Thickness(12, 10, 12, 10) };
            row.Click += (s, e) => Select(key, rootToggle.IsChecked == true);
            options.Children.Add(row);
            rows[key] = row;
            checks[key] = check;
        }

        /// <summary>Shows a choice (from the saved one, a click, or --shot).</summary>
        internal void Select(string platform, bool rooted)
        {
            choice = platform == "webos" || platform == "android" ? platform : "tizen";
            rendering = true;
            rootToggle.IsChecked = rooted;
            rendering = false;
            Render();
        }

        private void Render()
        {
            foreach (var kv in rows)
            {
                bool on = kv.Key == choice;
                kv.Value.Background = on ? Ui.Brush("NavSelected") : Brushes.Transparent;
                checks[kv.Key].Visibility = on ? Visibility.Visible : Visibility.Hidden;
            }
            bool android = choice == "android", rooted = Rooted;
            Ui.Show(rootToggle, !android);
            list.Children.Clear();

            if (android)
            {
                rootTitle.Text = T("No root needed");
                rootText.Text = T("APL Launcher runs as a real launcher app on Android TV and Google TV.");
            }
            else
            {
                rootTitle.Text = T("My TV is rooted");
                rootText.Text = choice == "tizen" ? T("Vetro is installed on the screen (it gives the root access).")
                                                  : T("Rooted (with WTFBro, for example), with the Homebrew Channel installed.");
            }

            string[] features = Features(choice);
            if (rooted)
            {
                listTitle.Text = android ? T("Included:") : T("With root, everything is included:");
                foreach (string f in features) list.Children.Add(MainWindow.Bullet(f, "Green"));
            }
            else
            {
                listTitle.Text = T("Without root, these are missing:");
                foreach (string f in features) list.Children.Add(MainWindow.Bullet(f, "Orange"));
            }

            switch (choice)
            {
                case "tizen":
                    howText.Text = rooted ? T("The Setup builds the launcher with your keys and installs it through Vetro. It needs Tizen Studio and your Samsung certificate on this PC.")
                                          : T("Without root, install APL Launcher with Apps2Samsung (the package apl-launcher-full of each release): the launcher works, without the parts above.");
                    phoneText.Text = T("Apps2Samsung installs the package from your phone too. With root, Vetro's own page can install it as well.");
                    break;
                case "webos":
                    howText.Text = rooted ? T("The Setup builds the package with your keys, sends it over SSH and turns the root features on. Root password: alpine, unless you changed it. Tested on an LG OLED G5 (webOS 26), Homebrew Channel 0.7.3.")
                                          : T("Without root, the Setup installs through LG's Developer Mode (a free LG developer account, the Developer Mode app on the TV). APL Launcher renews its 1000 hours by itself.");
                    phoneText.Text = rooted ? T("In the Homebrew Channel: Settings › Add repository, type {0}, then install APL Launcher. For the root features, from an SSH app on your phone (root, alpine): {1}", HbcRepo, RootOneLiner)
                                            : T("Without root, LG only lets a PC install apps (Developer Mode). Once rooted, the Homebrew Channel installs APL Launcher on its own.");
                    break;
                default:
                    howText.Text = T("The Setup installs the package with adb (USB or Network debugging, in the TV's Developer options) and turns on the remote buttons service: Home then opens APL Launcher.");
                    phoneText.Text = T("With the Downloader app on the TV: type the code {0}, install, then open APL Launcher: it asks for what Home needs.", "9890834");
                    break;
            }
            bool apps2Samsung = choice == "tizen" && !rooted;
            continueText.Text = apps2Samsung ? T("Open Apps2Samsung") : T("Continue");
            footerHint.Text = apps2Samsung ? T("The Setup's own install needs Vetro on Samsung.")
                            : T("Next: install on your {0}.", choice == "tizen" ? "Samsung" : choice == "webos" ? "LG" : "Android TV");
        }

        /// <summary>What root brings on each TV (shown as included, or as missing without root).</summary>
        internal static string[] Features(string platform)
        {
            switch (platform)
            {
                case "tizen":
                    return new[]
                    {
                        T("Home opens APL Launcher, and the screen starts on it"),
                        T("The Control Center over apps (APL Overlay)"),
                        T("Continue Watching from your apps (Hot Player, AquaPlay, Stremio…)"),
                        T("Optimize: Samsung's ads, tracking and unused apps removed"),
                        T("Closing the apps left open (Free Up Memory)")
                    };
                case "webos":
                    return new[]
                    {
                        T("Home opens APL Launcher, and the TV starts on it"),
                        T("The TV's picture settings inside the launcher"),
                        T("Closing the apps left open (Free Up Memory, App Switcher)"),
                        T("Guide opens the Control Center"),
                        T("Debloat: LG's ads, tracking and extra services stopped, updates blocked")
                    };
                default:
                    return new[]
                    {
                        T("The Home Screen, Search, profiles, Control Center and screen saver"),
                        T("Home opens APL Launcher (remote buttons service, turned on by the Setup)"),
                        T("Closing apps up to Android 13 (later versions keep it to Android)")
                    };
            }
        }

        private void Continue()
        {
            Main.SetPlatform(choice, Rooted);
            if (choice == "tizen" && !Rooted) { Ui.Open(Apps2Samsung); return; }
            Main.Navigate("install");
        }
    }
}
