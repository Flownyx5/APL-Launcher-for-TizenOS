/* ============================================================
   smooth.js — the screen stays fluid, measured on the screen itself.

   Each key press is timed until the frame that shows it (two
   animation frames later). Older screens (before 2022) start with
   the light effects (html.lite: no mask over the Settings list,
   short transitions without shadows, no drop shadows on big
   pictures). If the median of the last 24 presses is still above
   90 ms, one more step is taken (html.lite2: no transitions at all
   on tiles and rows, the Top Shelf changes at once, no shine), and
   that is remembered. Settings › Appearance › Smoothness: Automatic,
   All Effects, Light, Lightest. On the Home Screen the longest gap
   between frames in the second after each key counts too (a new
   full-screen picture can stall the frames after the first one).
   The Diagnostic shows the level and the measured times.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var KEY = "apl.smooth", SLOW_MS = 90, WINDOW = 24, BOOT_QUIET_MS = 25000;
    var html = document.documentElement, startedAt = Date.now(), shownAt = Date.now();
    var samples = [], last = { median: 0, n: 0 };

    function load() { try { return JSON.parse(global.localStorage.getItem(KEY) || "null") || { level: 0 }; } catch (e) { return { level: 0 }; } }
    function save(v) { try { global.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
    var measured = load();

    function choice() { var c = sys.pref("smoothness"); return c === "effects" || c === "light" || c === "lightest" ? c : "auto"; }
    function level() {
        var c = choice();
        if (c === "effects") return 0;
        if (c === "light") return 1;
        if (c === "lightest") return 2;
        return Math.max(APL.oldScreen ? 1 : 0, Math.min(2, measured.level || 0));
    }
    function apply() {
        var l = level();
        html.classList.toggle("lite", l >= 1);
        html.classList.toggle("lite2", l >= 2);
    }
    function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }

    function sample(ms) {
        // Start-up (the first list, the pictures) and a return from another app are not the menus
        if (Date.now() - startedAt < BOOT_QUIET_MS || Date.now() - shownAt < 4000) return;
        samples.push(ms);
        if (samples.length > WINDOW) samples.shift();
        if (samples.length < WINDOW) return;
        last = { median: Math.round(median(samples)), n: samples.length };
        if (choice() !== "auto" || last.median <= SLOW_MS || level() >= 2) return;
        measured = { level: level() + 1, median: last.median, at: Date.now() };
        save(measured);
        samples = [];
        apply();
        if (APL.toast) APL.toast(APL.t("Lighter effects for this screen, so it stays smooth (Settings › Appearance › Smoothness)."), true);
    }

    var raf = global.requestAnimationFrame || function (f) { return global.setTimeout(f, 16); };
    function now() { return global.performance && global.performance.now ? global.performance.now() : Date.now(); }

    /* The frame after a key can come at once while the next ones stall (a new full-screen picture being
       drawn): on the Home Screen the longest gap between frames in the second after each key is kept too.
       Median of the last 16 above 150 ms: one more step, as for the keys. */
    var HOME_WINDOW = 16, HOME_SLOW_MS = 150, homeGaps = [], homeLast = 0, win = null;
    function onHome() {
        var c = document.body ? document.body.className : "";
        return /(^| )mode-shelf( |$)/.test(c) && !/(^| )has-(cc|sources|search|settings|profiles|wdg)( |$)/.test(c) && !(APL.settings && APL.settings.isOpen && APL.settings.isOpen());
    }
    function homeSample(ms) {
        if (Date.now() - startedAt < BOOT_QUIET_MS || Date.now() - shownAt < 4000) return;
        homeGaps.push(ms);
        if (homeGaps.length > HOME_WINDOW) homeGaps.shift();
        if (homeGaps.length < HOME_WINDOW) return;
        homeLast = Math.round(median(homeGaps));
        if (choice() !== "auto" || homeLast <= HOME_SLOW_MS || level() >= 2) return;
        measured = { level: level() + 1, home: homeLast, at: Date.now() };
        save(measured);
        homeGaps = [];
        apply();
        if (APL.toast) APL.toast(APL.t("Lighter effects for this screen, so it stays smooth (Settings › Appearance › Smoothness)."), true);
    }
    function watchFrames(home) {
        var t = now();
        if (win) { win.until = t + 1000; win.home = win.home && home; return; }
        win = { until: t + 1000, last: t, worst: 0, home: home };
        raf(function step() {
            var w = win, x = now();
            if (!w) return;
            w.worst = Math.max(w.worst, x - w.last);
            w.last = x;
            if (x < w.until && !document.hidden) { raf(step); return; }
            win = null;
            if (w.home && !document.hidden) homeSample(w.worst);
        });
    }
    document.addEventListener("keydown", function () {
        if (document.hidden) return;
        var t = now();
        raf(function () { raf(function () { sample(now() - t); }); });
        watchFrames(onHome());
    }, true);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) shownAt = Date.now(); });

    apply();
    sys.onPref("smoothness", function () {
        if (choice() === "auto") { measured = { level: 0 }; save(measured); }   // Automatic again: measured afresh
        samples = [];
        apply();
    });

    APL.smooth = {
        level: level,
        state: function () { return { level: level(), choice: choice(), median: last.median, samples: samples.length, home: homeLast, homeSamples: homeGaps.length, measured: measured }; }
    };
})(window);
