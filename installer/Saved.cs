using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace APL.Setup
{
    internal sealed class Site
    {
        public string Name = "", Url = "";
    }

    internal sealed class SavedKeys
    {
        public string Tmdb = "", YouTube = "", Fanart = "";
        public List<Site> Sites = new List<Site>();
    }

    /// <summary>What the scripts saved in %APPDATA%\APL-Launcher, read to prefill the form. The app itself only
    /// writes the TV chosen on its first page (setup-platform.txt) and the LG Home choice (setup-lg-home.txt).</summary>
    internal static class Saved
    {
        private static readonly string Dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "APL-Launcher");

        /// <summary>setup-platform.txt: "webos rooted", "tizen", "android"…</summary>
        internal static bool Platform(out string platform, out bool rooted)
        {
            platform = "tizen"; rooted = true;
            try
            {
                string f = Path.Combine(Dir, "setup-platform.txt");
                if (!File.Exists(f)) return false;
                string[] w = File.ReadAllText(f).Trim().ToLowerInvariant().Split(' ');
                if (w[0] != "tizen" && w[0] != "webos" && w[0] != "android") return false;
                platform = w[0];
                rooted = w.Length > 1 && w[1] == "rooted";
                return true;
            }
            catch { return false; }
        }

        internal static void SavePlatform(string platform, bool rooted)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                File.WriteAllText(Path.Combine(Dir, "setup-platform.txt"), platform + (rooted ? " rooted" : ""));
            }
            catch (Exception ex) { Log.Error("setup-platform.txt", ex); }
        }

        /// <summary>setup-lg-home.txt: "lg" once an LG install was started with "Home opens APL Launcher" off. The
        /// next install keeps LG's Home the same way: the Setup never switches the TV's Home without being asked.</summary>
        internal static bool LgHomeIsApl()
        {
            try
            {
                string f = Path.Combine(Dir, "setup-lg-home.txt");
                return !File.Exists(f) || File.ReadAllText(f).Trim().ToLowerInvariant() != "lg";
            }
            catch { return true; }
        }

        internal static void SaveLgHome(bool apl)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                File.WriteAllText(Path.Combine(Dir, "setup-lg-home.txt"), apl ? "apl" : "lg");
            }
            catch (Exception ex) { Log.Error("setup-lg-home.txt", ex); }
        }

        internal static string TvIp()
        {
            try
            {
                string f = Path.Combine(Dir, "tv-ip.txt");
                return File.Exists(f) ? File.ReadAllText(f).Trim() : "";
            }
            catch { return ""; }
        }

        internal static SavedKeys Keys()
        {
            var k = new SavedKeys();
            try
            {
                string f = Path.Combine(Dir, "keys.local.js");
                if (!File.Exists(f)) return k;
                // window.APL_KEYS = { tmdb: "…", youtube: "…", fanart: "…", webApps: [{ name: "…", url: "…" }] };
                string js = File.ReadAllText(f, Encoding.UTF8);
                k.Tmdb = Field(js, "tmdb");
                k.YouTube = Field(js, "youtube");
                k.Fanart = Field(js, "fanart");
                var list = Regex.Match(js, @"webApps\s*:\s*\[(.*?)\]", RegexOptions.Singleline);
                if (list.Success)
                {
                    foreach (Match o in Regex.Matches(list.Groups[1].Value, @"\{(.*?)\}", RegexOptions.Singleline))
                    {
                        var s = new Site { Name = Field(o.Groups[1].Value, "name"), Url = Field(o.Groups[1].Value, "url") };
                        if (s.Name.Length > 0 || s.Url.Length > 0) k.Sites.Add(s);
                    }
                }
            }
            catch (Exception ex) { Log.Error("keys.local.js", ex); }
            return k;
        }

        // name: "value" or 'value', with the key itself possibly quoted
        private static string Field(string js, string name)
        {
            var m = Regex.Match(js, @"[""']?\b" + name + @"[""']?\s*:\s*(?:""((?:[^""\\]|\\.)*)""|'((?:[^'\\]|\\.)*)')",
                                RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (!m.Success) return "";
            string v = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value;
            return Regex.Replace(v, @"\\(u[0-9a-fA-F]{4}|.)", e =>
            {
                string x = e.Groups[1].Value;
                if (x.Length == 5) return ((char)Convert.ToInt32(x.Substring(1), 16)).ToString();
                return x == "n" ? "\n" : x == "t" ? "\t" : x;
            }).Trim();
        }
    }
}
