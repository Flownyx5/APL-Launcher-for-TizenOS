/* ============================================================
   diag.js — a start-up that doesn't finish is said on screen.

   Loaded first. It notes the script errors, and if the Home Screen
   hasn't appeared after 20 s on screen (APL_BOOT_OK, set by
   launcher.js), it shows them with the version and the screen,
   instead of leaving a black screen nobody can explain. Back closes it.
   ============================================================ */
(function (global) {
    "use strict";

    var errors = [];
    function note(text) { if (errors.length < 8) errors.push(String(text).slice(0, 220)); }
    global.addEventListener("error", function (e) {
        var where = e.filename ? " (" + String(e.filename).split("/").pop() + ":" + e.lineno + ")" : "";
        note((e.message || "error") + where);
    });
    global.addEventListener("unhandledrejection", function (e) {
        var r = e.reason;
        note("promise: " + (r && r.message ? r.message : r));
    });

    function t(text, vars) { return global.APL && global.APL.t ? global.APL.t(text, vars) : text.replace(/\{(\w+)\}/g, function (m, k) { return vars && k in vars ? vars[k] : m; }); }
    function screen() {
        try {
            var p = global.webapis && global.webapis.productinfo;
            return p ? (p.getRealModel ? p.getRealModel() : p.getModel()) + ", " + p.getFirmware() : "";
        } catch (e) { return ""; }
    }

    // Only the time on screen counts: started in the background (at power-on), the launcher is frozen
    var shownFor = 0, watch = setInterval(function () {
        if (global.APL_BOOT_OK) { clearInterval(watch); return; }
        if (document.hidden || !document.body || ++shownFor < 20) return;
        clearInterval(watch);
        show();
    }, 1000);

    function show() {
        var version = (global.APL_UPDATE && global.APL_UPDATE.running) || (global.APL_BUILD && global.APL_BUILD.version) || "?";
        var box = document.createElement("div");
        box.style.cssText = "position:fixed;left:120px;right:120px;top:120px;z-index:2147483647;padding:40px 48px;border-radius:28px;" +
            "background:#1c1c1e;color:#fff;font:28px/1.45 sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.6)";
        var title = document.createElement("div");
        title.style.cssText = "font-size:40px;font-weight:700;margin-bottom:18px";
        title.textContent = t("APL Launcher couldn't start");
        var body = document.createElement("div");
        body.textContent = t("Please send a photo of this screen in a GitHub issue, so it can be fixed.");
        var details = document.createElement("pre");
        details.style.cssText = "margin:24px 0 0;white-space:pre-wrap;font:22px/1.4 monospace;color:#c7c7cc";
        details.textContent = "APL Launcher " + version + (screen() ? " · " + screen() : "") + "\n" +
            (errors.length ? errors.join("\n") : t("No error was reported: the list of apps never came back."));
        box.appendChild(title);
        box.appendChild(body);
        box.appendChild(details);
        document.body.appendChild(box);
        document.addEventListener("keydown", function close(e) {
            if (e.keyCode === 10009 || e.keyCode === 27) { box.remove(); document.removeEventListener("keydown", close); }
        });
    }
})(window);
