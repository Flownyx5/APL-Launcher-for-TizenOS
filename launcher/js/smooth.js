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
   All Effects, Light, Lightest. The Diagnostic shows the level and
   the measured times.
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
    document.addEventListener("keydown", function () {
        if (document.hidden) return;
        var t = global.performance && global.performance.now ? global.performance.now() : Date.now();
        raf(function () { raf(function () { sample((global.performance && global.performance.now ? global.performance.now() : Date.now()) - t); }); });
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
        state: function () { return { level: level(), choice: choice(), median: last.median, samples: samples.length, measured: measured }; }
    };
})(window);
