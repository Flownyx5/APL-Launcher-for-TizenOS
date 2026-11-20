using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace APL.Setup
{
    /// <summary>
    /// Finds the folder that holds scripts\ and launcher\. Next to the exe (a clone of the repository:
    /// the scripts are used as they are), else the copy embedded in the exe, extracted once per version.
    /// </summary>
    internal static class Payload
    {
        internal static bool IsDev;

        internal static string FindRoot()
        {
            if (Program.RootOverride != null) { IsDev = true; return Program.RootOverride; }
            string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            foreach (string dir in new[] { exeDir, Path.GetDirectoryName(exeDir) })
            {
                if (dir != null && File.Exists(Path.Combine(dir, "scripts", "install.ps1"))) { IsDev = true; return dir; }
            }
            return Extract();
        }

        private static string Extract()
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                      "APL-Launcher", "setup", BuildInfo.Version);
            string marker = Path.Combine(dir, ".payload-complete");
            var asm = Assembly.GetExecutingAssembly();
            using (var res = asm.GetManifestResourceStream("payload.zip"))
            {
                if (res == null) throw new InvalidOperationException("The scripts are missing from this build.");
                // The marker holds the payload's hash: a rebuilt exe with the same version still refreshes the copy.
                string hash;
                using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(res)).Replace("-", "");
                if (File.Exists(marker) && File.ReadAllText(marker).Trim() == hash) return dir;

                Log.Info("extracting the scripts to " + dir);
                if (Directory.Exists(dir))
                {
                    // Keep dist\ (the last build) but replace everything that came from the payload.
                    foreach (string sub in new[] { "launcher", "scripts", "overlay", "webos" })
                    {
                        string p = Path.Combine(dir, sub);
                        if (Directory.Exists(p)) Directory.Delete(p, true);
                    }
                }
                Directory.CreateDirectory(dir);
                res.Position = 0;
                using (var zip = new ZipArchive(res, ZipArchiveMode.Read))
                {
                    foreach (var entry in zip.Entries)
                    {
                        string target = Path.GetFullPath(Path.Combine(dir, entry.FullName.Replace('/', '\\')));
                        if (!target.StartsWith(dir + "\\", StringComparison.OrdinalIgnoreCase)) continue;
                        if (string.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(target); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        entry.ExtractToFile(target, true);
                    }
                }
                File.WriteAllText(marker, hash);
            }
            return dir;
        }
    }
}
