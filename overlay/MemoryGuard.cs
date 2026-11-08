using System;
using Tizen.NUI;

namespace APL
{
    /// <summary>
    /// When memory runs short the screen's memory manager (resourced) closes background apps, and it counts the
    /// launcher in the background as any forgotten app (oom_score_adj 750 on the M8, its own home 289): with
    /// TizenTube in front the launcher was among the first to go, and leaving TizenTube then showed Samsung's home
    /// and a black screen for about 10 s while the launcher started again (Reddit). Writing oom_score_adj does
    /// nothing on these screens (the kernel keeps resourced's value), and resourced's lists are in the read-only
    /// /etc. resourced's own ProcExclude "exclude" leaves a process out of its low-memory killer: through Vetro
    /// (root), the launcher and this overlay get it, once per process (a restart gets it again, /tmp keeps which
    /// pids have it until the screen restarts). Checked every minute and just after each change of the app in front.
    /// </summary>
    internal sealed class MemoryGuard
    {
        private const uint EveryMs = 60000;
        private const uint AfterChangeMs = 3000;
        private static readonly string[] Ours = { "APLauncher.Home", "APLauncher.Overlay", "apl.launcher.overlay" };
        private const string Done = "/tmp/apl-memory-excluded";

        private Timer timer, soon;
        private bool busy;

        public void Start()
        {
            timer = new Timer(EveryMs);
            timer.Tick += delegate { Apply(); return true; };
            timer.Start();
            Apply();
        }

        /// <summary>Another app in front: the launcher may have started again since.</summary>
        public void FrontChanged()
        {
            if (soon == null)
            {
                soon = new Timer(AfterChangeMs);
                soon.Tick += delegate { Apply(); return false; };
            }
            soon.Stop();
            soon.Start();
        }

        private async void Apply()
        {
            if (busy) return;
            busy = true;
            try
            {
                // Prints "<app> <pid>" for each process it has just excluded, nothing when all were already
                string cmd = "S=$(app_launcher -S 2>/dev/null); touch " + Done + "; for a in " + string.Join(" ", Ours) + "; do " +
                    "p=$(echo \"$S\" | awk -v a=$a '$1==a {print $2}' | tr -d '()'); [ -n \"$p\" ] || continue; " +
                    "grep -q -x \"$a $p\" " + Done + " && continue; " +
                    "dbus-send --system --print-reply --dest=org.tizen.resourced /Org/Tizen/ResourceD/Process " +
                    "org.tizen.resourced.process.ProcExclude string:exclude int32:$p >/dev/null 2>&1 && echo \"$a $p\" >> " + Done +
                    " && echo \"$a $p\"; done; true";
                string done = (await Vetro.Exec(cmd)).Trim();
                if (done.Length > 0) Program.Note("memory: kept by the screen's memory manager: " + done.Replace("\n", ", "));
            }
            catch (Exception ex) { Program.Note("memory: " + ex.Message); }
            finally { busy = false; }
        }
    }
}
