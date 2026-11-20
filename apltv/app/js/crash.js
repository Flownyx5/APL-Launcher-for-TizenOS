/* ============================================================
   crash.js: "Oops! APL TV stopped", after a stop without warning.

   At start-up (js/app.js), the previous session's black box (js/core.js TV.blackbox) says whether APL TV left the
   screen normally (Quit, a restart, the background, the TV's standby) or stopped while it was on screen. On Android
   the app also says why (MainActivity / Crash.java): the error itself, its page stopped by Android, or Android 11's
   own reason (memory, no answer…).

   Then a box offers to send the report to the developer: Send, Always Send, Show the Report, Don't Send
   (Settings › About › Crash Reports: Ask, Always, Never). The report goes to APL TV's relay (tools/crash-relay),
   which opens an issue in the developer's private GitHub repository: the app holds no GitHub key. The log never
   has passwords (TV.redact); the providers' addresses are cut out here too.
   ============================================================ */
(function (global) {
    "use strict";
    var TV = global.TV, T = TV.t;

    // The relay (tools/crash-relay/README.md). Development builds can point at a test one (localStorage apltv.crashRelay).
    var RELAY = "https://apl-tv-crash.apl-tv.workers.dev";
    function relay() {
        var o = "";
        try { if (TV.DEV) o = global.localStorage.getItem("apltv.crashRelay") || ""; } catch (e) {}
        return (o || RELAY).replace(/\/+$/, "");
    }

    /* Addresses of the services everyone uses stay readable; any other server (a provider's, a local address) is
       cut to *** */
    var KNOWN = /(^|\.)(github\.com|githubusercontent\.com|themoviedb\.org|tmdb\.org|imdb\.com|imdbws\.com|espn\.com|365scores\.com|iptv-epg\.org|epg\.pw|youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|stremio\.com|strem\.io|strem\.fun|wikipedia\.org|wikimedia\.org|wikidata\.org|lfp\.fr|ligue1\.com|ntfy\.sh|plex\.tv|opensubtitles\.org|127\.0\.0\.1|localhost)(:\d+)?$/i;
    function mask(s) {
        s = TV.redact(String(s)).replace(/(\b[a-z][a-z0-9+.-]*:\/\/)([^\/\s"'?#<>]+)/gi, function (all, scheme, host) { return KNOWN.test(host) ? all : scheme + "***"; });
        // a source's name is its server's address when you didn't name it ("refresh of xyz.example.com: …")
        privateWords().forEach(function (w) { s = s.split(w).join("***"); });
        return s;
    }
    var words = null;
    function privateWords() {
        if (words) return words;
        words = [];
        try {
            (TV.data && TV.data.sources ? TV.data.sources() : []).forEach(function (src) {
                [src.name, src.server, src.url, src.portal, src.user].forEach(function (v) {
                    v = String(v || "");
                    var host = /^[a-z][a-z0-9+.-]*:\/\/([^\/:?#]+)/i.exec(v);
                    if (host) words.push(host[1]);
                    if (v.length >= 5 && v !== "APL TV") words.push(v);
                });
            });
        } catch (e) {}
        words.sort(function (a, b) { return b.length - a.length; });      // the longest first: a full address before its host
        return words;
    }

    function android() {
        try { return TV.ANDROID && global.APLAndroid && global.APLAndroid.crashReport ? JSON.parse(global.APLAndroid.crashReport() || "{}") : null; } catch (e) { return null; }
    }
    function model() {
        try {
            if (TV.WEBOS) return JSON.parse((global.webOSSystem || global.PalmSystem || {}).deviceInfo || "{}").modelName || "";
            if (TV.TIZEN) { var p = global.webapis && global.webapis.productinfo; if (p) { try { return p.getRealModel(); } catch (e) { return p.getModel(); } } }
            if (TV.ANDROID && global.APLAndroid && global.APLAndroid.model) return global.APLAndroid.model() || "";
        } catch (e) {}
        return "";
    }
    function apk() { try { return TV.ANDROID && global.APLAndroid && global.APLAndroid.version ? global.APLAndroid.version() || "" : ""; } catch (e) { return ""; } }
    function platform() { return TV.ANDROID ? "android" : TV.WEBOS ? "webos" : TV.TIZEN ? "tizen" : "preview"; }
    function os() { return String(navigator.userAgent || "").replace(/\s+APLTV-Android$/, "").slice(0, 160); }

    /* What happened last time, or null when APL TV left normally */
    function last() {
        var p = TV.blackbox && TV.blackbox.prev, a = android() || {};
        var onScreen = !!(p && p.v === 1 && p.shown && !p.end);
        var java = a.crash || null, page = a.page || null, exit = a.exit || null;
        if (!onScreen && !java) return null;
        var kind = "closed", why = "", reason = "";
        if (java) {
            kind = "crash";
            reason = String(java.error || "");
            why = /OutOfMemoryError/.test(reason) ? "it ran out of memory" : "an error in the app";
        } else if (page) {
            kind = "page";
            why = page.crashed ? "its page crashed" : "the TV stopped it to free memory";
            reason = "The page's process " + (page.crashed ? "crashed" : "was stopped by Android") + " (the app opened a new page)";
        } else if (exit) {
            kind = /memory/i.test(exit.reason) ? "memory" : exit.reason === "crash" || exit.reason === "native crash" ? "crash" : "closed";
            why = kind === "memory" ? "the TV closed it to free memory" : exit.reason === "not responding" ? "it stopped answering" : kind === "crash" ? "an error in the app" : "";
            reason = "Android: " + exit.reason + (exit.desc ? " (" + exit.desc + ")" : "") + (exit.importance ? ", " + ({ 100: "on screen", 125: "foreground service", 200: "visible", 230: "perceptible", 300: "service", 400: "in the background" }[exit.importance] || "importance " + exit.importance) : "") + (exit.pss ? ", memory " + Math.round(exit.pss / 1024) + " MB" : "");
        }
        return {
            app: "APL TV", id: TV.uid() + Math.random().toString(36).slice(2, 6),
            version: (p && p.version) || TV.VERSION, installed: global.TV_UPDATE ? global.TV_UPDATE.installed : "", apk: apk(),
            platform: platform(), model: model(), os: os(), lang: TV.lang || "",
            kind: kind, why: why, reason: mask(reason).slice(0, 6000), memory: mask(a.memory || ""),
            upFor: p && p.started ? Math.round(((p.at || p.started) - p.started) / 1000) : 0,
            when: p && p.at ? new Date(p.at).toISOString() : java && java.at ? new Date(java.at).toISOString() : "",
            screen: p ? p.screen || "" : "", playing: p ? p.playing || "" : "",
            lines: (p && p.lines || []).map(mask),
            serviceLines: (java && java.service || a.service || []).map(mask)
        };
    }

    function done() { try { if (TV.ANDROID && global.APLAndroid && global.APLAndroid.crashDone) global.APLAndroid.crashDone(); } catch (e) {} }

    function send(r) {
        var url = relay();
        if (!url) return Promise.reject(new Error(T("no address to send to yet")));
        return TV.http(url + "/report", { method: "POST", body: JSON.stringify(r), headers: { "Content-Type": "text/plain" }, timeout: 20000 }).then(function (x) {
            if (x.status >= 200 && x.status < 300) return;
            var m = ""; try { m = JSON.parse(x.text).error || ""; } catch (e) {}
            throw new Error(m || (x.status ? "HTTP " + x.status : T("no network")));
        });
    }
    function sendNow(r, quiet) {
        return send(r).then(function () {
            TV.log((r.code ? "report " + r.code : "crash report " + r.id) + " sent");
            if (r.code) TV.alert({ title: T("Report sent. Thank you!"), message: T("Give this code with your issue on GitHub: {code}", { code: r.code }) });
            else TV.toast(quiet ? T("A report about the last stop was sent to the developer.") : T("Report sent. Thank you!"));
        }, function (e) {
            TV.log("crash report not sent: " + e.message);
            if (!quiet) TV.toast(T("The report couldn't be sent: {error}", { error: e.message }), true);
        });
    }

    /* The report as it will be sent: what the screen said, then the log's last lines */
    function showReport(r, then) {
        var pre = document.createElement("pre");
        pre.className = "alert__report";
        pre.textContent = [r.platform + " · " + (r.model || "?") + " · APL TV " + r.version + (r.apk ? " · " + r.apk : "") + (r.memory ? "\n" + r.memory : ""),
                           r.reason ? r.reason.split("\n").slice(0, 5).join("\n") : ""].filter(Boolean).join("\n\n") + "\n\n" + r.lines.slice(-9).join("\n");   // fits the box: the last lines are the ones that count
        var buttons = relay() ? [{ label: T("Send"), run: function () { sendNow(r); done(); then(); } }, { label: T("Don't Send"), run: function () { done(); then(); } }]
                              : [{ label: T("OK"), run: function () { done(); then(); } }];
        TV.alert({ title: T("The Report"), node: pre, buttons: buttons, onCancel: function () { done(); then(); } });
    }

    function ask(r, then) {
        var cause = r.why ? "\n" + T("Cause: {why}", { why: T(r.why) }) : "";
        if (!relay()) {
            TV.alert({ title: T("Oops! APL TV stopped"), message: T("APL TV stopped unexpectedly last time.") + cause,
                buttons: [{ label: T("OK"), run: function () { done(); then(); } }, { label: T("Show the Report"), run: function () { showReport(r, then); } }],
                onCancel: function () { done(); then(); } });
            return;
        }
        TV.alert({
            title: T("Oops! APL TV stopped"),
            message: T("APL TV stopped unexpectedly last time.") + cause + "\n\n" +
                     T("Send a report to the developer so it can be fixed? It holds the last lines of APL TV's log, your TV's model and the app's version. No passwords, no playlist addresses."),
            buttons: [
                { label: T("Send"), run: function () { sendNow(r); done(); then(); } },
                { label: T("Always Send"), run: function () { TV.setPref("crashReports", "always"); sendNow(r); done(); then(); } },
                { label: T("Show the Report"), run: function () { showReport(r, then); } },
                { label: T("Don't Send"), run: function () { done(); then(); } }
            ],
            onCancel: function () { done(); then(); }
        });
    }

    /* Settings › About › Send a Report: when something doesn't work (a phone page that doesn't open, a movie that doesn't
       play, subtitles without their language), what APL TV did just now goes to the developer, with a short code to
       give in a GitHub issue. The same relay and the same care as a crash report; nothing goes without the OK. */
    function now() {
        var code = Math.random().toString(36).slice(2, 8).toUpperCase(), mem = "", screen = "", playing = "";
        while (code.length < 6) code += "X";
        try { if (TV.ANDROID && global.APLAndroid && global.APLAndroid.memory) mem = String(global.APLAndroid.memory() || ""); } catch (e) {}
        try { screen = TV.shell && TV.shell.current ? String(TV.shell.current() || "") : ""; } catch (e) {}
        try { var c = TV.player && TV.player.current && TV.player.current(); playing = c ? (c.opts && c.opts.live ? "live" : "video") : ""; } catch (e) {}
        words = null;                                     // the playlists as they are now
        return {
            app: "APL TV", id: TV.uid() + code.toLowerCase(), code: code,
            version: TV.VERSION, installed: global.TV_UPDATE ? global.TV_UPDATE.installed : "", apk: apk(),
            platform: platform(), model: model(), os: os(), lang: TV.lang || "",
            kind: "report", why: "", reason: "Report sent from Settings, code " + code, memory: mask(mem),
            upFor: TV.blackbox ? Math.round((Date.now() - TV.blackbox.started) / 1000) : 0, when: new Date().toISOString(),
            screen: screen, playing: playing, lines: (TV.logs || []).slice(-200).map(mask), serviceLines: []
        };
    }
    function manual() {
        if (!relay()) { TV.toast(T("The report couldn't be sent: {error}", { error: T("no address to send to yet") }), true); return; }
        var r = now();
        TV.alert({
            title: T("Send a Report"),
            message: T("Something doesn't work? Send the developer what APL TV did just now: the last lines of its log, your TV's model and the app's version. No passwords, no playlist addresses.") + "\n\n" +
                     T("Send it right after the problem, then give this code with your issue on GitHub: {code}", { code: r.code }),
            buttons: [
                { label: T("Send"), run: function () { sendNow(r); } },
                { label: T("Show the Report"), run: function () { showReport(r, function () {}); } },
                { label: T("Cancel") }
            ]
        });
    }

    TV.crash = {
        manual: manual,
        /* At start-up, before anything else is offered (js/app.js): the box when the last session stopped on screen,
           then "then" (the resume offer…) */
        check: function (then) {
            then = then || function () {};
            var r = null;
            try { r = last(); } catch (e) { TV.log("crash check: " + e.message); }
            if (!r) { then(); return; }
            TV.log("the last session stopped on screen (" + r.kind + (r.why ? ", " + r.why : "") + ", " + Math.round(r.upFor / 60) + " min after its start)");
            var pref = TV.pref("crashReports") || "ask";
            if (pref === "never") { done(); then(); return; }
            if (pref === "always" && relay()) { sendNow(r, true); done(); then(); return; }
            setTimeout(function () { ask(r, then); }, 600);
        },
        relay: relay,
        mask: mask
    };
})(window);
