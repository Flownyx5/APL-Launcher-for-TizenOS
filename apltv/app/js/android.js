/* ============================================================
   android.js: APL TV on Android TV, Google TV and Fire TV.
   The Android app (android/, MainActivity.java) shows this same page in a
   WebView over its video player (ExoPlayer, Player.java) and gives it
   window.APLAndroid. This file:
   - presents that player with the calls of Samsung's AVPlay
     (webapis.avplay), so player.js works the same everywhere;
   - receives the remote's keys (Samsung's key codes, sent by Android).
   Does nothing on Samsung, LG or the PC preview.
   ============================================================ */
(function (global) {
    "use strict";

    var B = global.APLAndroid;
    if (!B) return;

    /* ---------- the remote: Android sends each key here ---------- */
    global.__aplKey = function (type, code, repeat) {
        var e;
        try { e = new KeyboardEvent(type, { bubbles: true, cancelable: true, repeat: !!repeat }); }
        catch (x) { e = document.createEvent("Event"); e.initEvent(type, true, true); }
        try {
            Object.defineProperty(e, "keyCode", { get: function () { return code; } });
            Object.defineProperty(e, "which", { get: function () { return code; } });
        } catch (x) {}
        (document.activeElement || document.body).dispatchEvent(e);
    };

    /* ---------- the player, as AVPlay ---------- */
    var listener = {}, state = "NONE", onPrepared = null, onPrepareFail = null, seekCbs = {}, seekId = 0;
    function call(name, a, b) { var f = listener && listener[name]; if (f) { try { f(a, b); } catch (e) { if (global.TV && TV.log) TV.log("player event " + name + ": " + e.message); } } }

    global.__aplEvent = function (name, a) {
        switch (name) {
            case "prepared":
                state = state === "PLAYING" ? "PLAYING" : "READY";
                if (onPrepared) { var ok = onPrepared; onPrepared = onPrepareFail = null; ok(); }
                break;
            case "buffering": call(a ? "onbufferingstart" : "onbufferingcomplete"); break;
            case "time": call("oncurrentplaytime", a); break;
            case "ended": call("onstreamcompleted"); break;
            case "error":
                if (onPrepared) { var ko = onPrepareFail; onPrepared = onPrepareFail = null; if (ko) ko({ name: a }); }
                else call("onerror", a);
                break;
            case "subtitle": call("onsubtitlechange", 0, a); break;
            case "info":
                // every track of the video and whether this device can play it (for the log), and a word
                // when none of its sounds can be played here (DTS, TrueHD… on many Android boxes)
                call("onevent", "TRACKS", a && a.tracks);
                if (a && a.noAudio && global.TV && TV.toast) TV.toast(TV.t("This device cannot play the sound of this video ({format}). Try another version if there is one.", { format: a.noAudio }), true);
                break;
            // the sound goes on, the picture stays still (Player.java): js/live.js takes a lower quality
            case "videostall": if (global.TV && TV.player && TV.player.onVideoStall) TV.player.onVideoStall(a); break;
            case "seeked": var cb = seekCbs[a]; delete seekCbs[a]; if (cb) { clearTimeout(cb.t); if (cb.ok) cb.ok(); } break;
        }
    };

    var avplay = {
        open: function (url) { state = "IDLE"; onPrepared = onPrepareFail = null; B.open(String(url)); },
        setListener: function (l) { listener = l || {}; },
        prepareAsync: function (ok, fail) { onPrepared = ok || function () {}; onPrepareFail = fail || null; B.prepare(); },
        play: function () { state = "PLAYING"; B.play(); },
        pause: function () { state = "PAUSED"; B.pause(); },
        stop: function () { state = "IDLE"; B.stop(); },
        close: function () { state = "NONE"; listener = {}; onPrepared = onPrepareFail = null; B.close(); },
        getState: function () { return state; },
        getDuration: function () { return B.duration(); },
        seekTo: function (ms, ok, fail) {
            var id = ++seekId;
            // Android says when the seek is done; a moment later at the latest, it counts as done
            seekCbs[id] = { ok: ok, t: setTimeout(function () { var c = seekCbs[id]; delete seekCbs[id]; if (c && c.ok) c.ok(); }, 2500) };
            B.seek(Math.max(0, ms), id);
        },
        setDisplayRect: function (x, y, w, h) { B.rect(x, y, w, h); },
        setDisplayMethod: function (m) { B.method(String(m)); },
        getTotalTrackInfo: function () { try { return JSON.parse(B.tracks() || "[]"); } catch (e) { return []; } },
        getCurrentStreamInfo: function () { try { return JSON.parse(B.current() || "[]"); } catch (e) { return []; } },
        setSelectTrack: function (type, index) { B.select(String(type), index | 0); },
        setSilentSubtitle: function (off) { B.subtitles(!off); },
        setStreamingProperty: function (key, value) { B.property(String(key), String(value)); },
        setBufferingParam: function () {},
        setTimeoutForBuffering: function () {},
        setSubtitlePosition: function () {},
        suspend: function () { B.suspend(); },
        restore: function () { B.restore(); }
    };
    global.webapis = global.webapis || {};
    global.webapis.avplay = avplay;
})(window);
