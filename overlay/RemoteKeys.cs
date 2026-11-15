using System;
using System.Collections.Generic;

namespace APL
{
    internal enum Press { Undecided, Short, Long, Double }

    /// <summary>
    /// What the times on the remote say about a key. The IR receiver only reports a release 190 to
    /// 360 ms after a press, whatever the finger does, as measured on the M8:
    ///   brief    down, then up
    ///   double   down, up, down 2 to 74 ms later, up about 300 ms later, then nothing
    ///   held     the same start, but it goes on: repeats, or more release + press
    /// So a double press and a key held for a while only differ by what comes after the second release.
    /// </summary>
    internal static class RemoteKeys
    {
        public const int Home = 63, Pause = 244, TvPlus = 560, Prime = 221;     // evdev codes
        /// <summary>Multi View (XF86MultiView) on the remotes that have it, captured in Vetro by a user (#47).
        /// Not 28: that one is OK.</summary>
        public const int MultiView = 497;
        public const int LongPressMs = 450;
        public const int NextPressMs = 90;

        public static bool IsWatched(int code)
        {
            return code == Home || code == Pause || code == TvPlus || code == Prime || code == MultiView;
        }

        /// <summary>The latest press of a key this app handles, or -1.</summary>
        public static int Latest(List<Vetro.KeyEvent> events)
        {
            for (int i = events.Count - 1; i >= 0; i--)
            {
                if (events[i].Down && IsWatched(events[i].Code)) return i;
            }
            return -1;
        }

        /// <summary>Goes back to the press that started this burst: repeats and release + press are part of it.</summary>
        public static int BurstStart(List<Vetro.KeyEvent> events, int at)
        {
            int code = events[at].Code, start = at;
            for (int i = at - 1; i >= 0; i--)
            {
                if (events[i].Code != code) continue;
                if (events[i].Down)
                {
                    start = i;
                    continue;
                }
                bool next = (events[start].Time - events[i].Time).TotalMilliseconds < NextPressMs;
                if (!next && !events[start].Repeat) break;
            }
            return start;
        }

        /// <summary>
        /// A key whose first event since the input helper started is not a press was already down when
        /// the helper took the remote. -1 if there is none, or if the first events are gone (Vetro keeps
        /// 30). A blocked key never reached the screen, and a release would press it for real.
        /// </summary>
        public static int StuckKey(List<Vetro.KeyEvent> events, DateTime after)
        {
            if (events.Count == 0 || events[0].Sequence != 1 || events[0].Time <= after) return -1;
            HashSet<int> seen = new HashSet<int>();
            foreach (Vetro.KeyEvent e in events)
            {
                if (seen.Add(e.Code) && !e.Blocked && (!e.Down || e.Repeat)) return e.Code;
            }
            return -1;
        }

        /// <summary>Undecided until the times on the remote settle it, however late this app hears about them.</summary>
        public static Press Decide(List<Vetro.KeyEvent> events, DateTime start, DateTime now)
        {
            int presses = 0;
            Vetro.KeyEvent last = new Vetro.KeyEvent();
            bool any = false;
            foreach (Vetro.KeyEvent e in events)
            {
                if (e.Code != Home || e.Time < start) continue;
                if (e.Repeat) return Press.Long;
                if (e.Down) presses++;
                last = e;
                any = true;
            }
            if (!any) return Press.Short;
            if (presses >= 3) return Press.Long;
            if (last.Down)
            {
                return presses == 1 && (now - start).TotalMilliseconds > LongPressMs ? Press.Long : Press.Undecided;
            }
            if ((now - last.Time).TotalMilliseconds <= NextPressMs) return Press.Undecided;
            if (presses >= 2) return Press.Double;
            return (last.Time - start).TotalMilliseconds > LongPressMs ? Press.Long : Press.Short;
        }
    }
}
