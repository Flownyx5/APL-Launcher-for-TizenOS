using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace APL
{
    /// <summary>
    /// When the remote's microphone button is held, for the glow. Grabbing the key needs a platform
    /// privilege this app cannot have (the screen refused it), and Alexa must keep getting it anyway.
    /// Vetro keeps the real remote to itself and forwards its keys to "vetro-forwarded-remote", where
    /// the button shows as key 216. A small root script, started once through Vetro, reads that
    /// device and keeps a file in /tmp while the button is down: this class only watches the name.
    /// The other keys pass through its loop and leave no trace.
    /// </summary>
    internal static class MicButton
    {
        private const string Folder = "/tmp", Flag = "apl-mic-down";
        private const string Script = "/tmp/apl-mic.sh", PidFile = "/tmp/apl-mic.pid";

        // 32-bit kernel: an event is 16 bytes, the time then type 1 (key), code 216 and the value
        private const string Reader =
            "echo $$ > " + PidFile + "\n" +
            "mine() { [ \"$(cat " + PidFile + " 2>/dev/null)\" = \"$$\" ]; }\n" +
            "while mine; do\n" +
            "  node=$(grep -A5 'Name=\"vetro-forwarded-remote\"' /proc/bus/input/devices | grep -o 'event[0-9]*' | head -1)\n" +
            "  if [ -z \"$node\" ] || [ ! -r /dev/input/$node ]; then sleep 2; continue; fi\n" +
            "  exec 3< /dev/input/$node\n" +
            "  while mine; do\n" +
            "    e=$(dd bs=16 count=1 <&3 2>/dev/null | od -An -v -tx1 | tr -d ' \\n')\n" +
            "    [ ${#e} -eq 32 ] || break\n" +
            "    case \"$e\" in\n" +
            "      ????????????????0100d80001000000) touch " + Folder + "/" + Flag + " ;;\n" +
            "      ????????????????0100d80000000000) rm -f " + Folder + "/" + Flag + " ;;\n" +
            "    esac\n" +
            "  done\n" +
            "  exec 3<&-\n" +
            "  rm -f " + Folder + "/" + Flag + "\n" +
            "  sleep 1\n" +
            "done; exit 0\n";

        private static FileSystemWatcher watcher;

        /// <summary>onChange runs on the main thread: true when the button goes down, false when it comes up.</summary>
        public static void Watch(Action<bool> onChange)
        {
            SynchronizationContext main = SynchronizationContext.Current;
            try
            {
                watcher = new FileSystemWatcher(Folder, Flag);
                watcher.NotifyFilter = NotifyFilters.FileName;
                watcher.Created += delegate { main.Post(delegate { onChange(true); }, null); };
                watcher.Deleted += delegate { main.Post(delegate { onChange(false); }, null); };
                watcher.EnableRaisingEvents = true;
            }
            catch (Exception ex) { Program.Note("mic: " + ex.Message); }
            StartReader();
        }

        /// <summary>
        /// Started once: a newer script takes the pid file, and the old one stops at its next key.
        /// The screen refuses to run a script file that Samsung did not sign ("the file is NOT
        /// signed"), but not a command: the script goes to sh -c, the way Vetro runs its own.
        /// After a full start this app can be up a minute before Vetro (the launcher shows a second after
        /// power-on and opens it): tried again every 15 s until Vetro runs it, for 5 minutes at most.
        /// </summary>
        private static async void StartReader()
        {
            string code = Convert.ToBase64String(Encoding.UTF8.GetBytes(Reader));
            string run = Script + ".run";
            for (int tries = 1; tries <= 20; tries++)
            {
                try
                {
                    string answer = await Vetro.ExecWhenReady("{ echo " + code + " | base64 -d > " + Script + "; " +
                                     "[ \"$(md5sum < " + Script + ")\" = \"$(md5sum 2>/dev/null < " + run + ")\" ] && kill -0 $(cat " + PidFile + " 2>/dev/null) 2>/dev/null || " +
                                     "{ cp " + Script + " " + run + "; (sh -c \"$(cat " + run + ")\" >/dev/null 2>&1 &); }; } 2>&1");
                    if (answer.Trim().Length > 0) Program.Note("mic reader: " + answer.Trim());
                    if (tries > 1) Program.Note("mic reader: started, try " + tries);
                    return;
                }
                catch (Exception ex) { if (tries == 1) Program.Note("mic reader: " + ex.Message + ", trying again until Vetro answers"); }
                await Task.Delay(15000);
            }
            Program.Note("mic reader: Vetro never answered");
        }
    }
}
