/* ============================================================
   preview.js — preview of the launcher on a PC or phone.

   Does NOTHING on a TV (window.tizen, or js/webos.js on LG). Elsewhere:
   - the 1920×1080 screen is scaled down to fit the window;
   - a Siri Remote–style remote is shown beside it (or below):
     arrows, OK (hold = app menu), Back, Home, ⏯, full screen;
   - by touch: tap a tile = OK, long press = app menu.
   Keyboard: arrows, Enter (hold = menu), Esc = Back,
   C = Control Center.
   ============================================================ */
(function (global) {
    "use strict";

    if (global.tizen || (global.APL && global.APL.platform)) return;   // a TV (Samsung, LG): no preview

    var APL = global.APL;
    var doc = document.documentElement;
    var remote, help, scale = 1;

    var CSS = [
        /* Window around the screen: follows the light / dark theme */
        ":root{--pv-bg:#e6e7ec;--pv-fg:#1c1d22;--pv-muted:#5c6070;--pv-body-a:#e2e3e8;--pv-body-b:#c3c5cc;",
        "--pv-edge:rgba(0,0,0,.14);--pv-pad:#1b1b1f;--pv-pad-fg:#ececf0;--pv-key:#1f1f23;--pv-key-fg:#f2f2f5;",
        "--pv-press:#3a3a41;--pv-bezel:#0b0b0d;--pv-shadow:rgba(20,22,30,.28)}",
        "@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--pv-bg:#0d0e12;--pv-fg:#ececf1;--pv-muted:#8a8e9d;",
        "--pv-body-a:#3b3c43;--pv-body-b:#232429;--pv-edge:rgba(255,255,255,.08);--pv-pad:#121215;--pv-pad-fg:#d9d9df;",
        "--pv-key:#121215;--pv-key-fg:#e6e6eb;--pv-press:#2c2c33;--pv-bezel:#000;--pv-shadow:rgba(0,0,0,.6);color-scheme:dark}}",
        ":root[data-theme=dark]{--pv-bg:#0d0e12;--pv-fg:#ececf1;--pv-muted:#8a8e9d;--pv-body-a:#3b3c43;--pv-body-b:#232429;",
        "--pv-edge:rgba(255,255,255,.08);--pv-pad:#121215;--pv-pad-fg:#d9d9df;--pv-key:#121215;--pv-key-fg:#e6e6eb;",
        "--pv-press:#2c2c33;--pv-bezel:#000;--pv-shadow:rgba(0,0,0,.6);color-scheme:dark}",
        "html.apl-preview{width:100%;height:100%;overflow:hidden;background:var(--pv-bg);cursor:auto;",
        "-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}",
        "html.apl-preview body{position:fixed;left:0;top:0;width:1920px;height:1080px;margin:0;overflow:hidden;",
        "transform-origin:0 0;background:#000;cursor:default}",
        "html.apl-preview body *{cursor:inherit}",
        /* Remote */
        ".pv-remote{position:fixed;z-index:10;display:flex;align-items:center;gap:14px;padding:16px 20px;box-sizing:border-box;",
        "border-radius:34px;background:linear-gradient(180deg,var(--pv-body-a),var(--pv-body-b));",
        "box-shadow:inset 0 0 0 1px var(--pv-edge),0 18px 40px var(--pv-shadow);touch-action:none;user-select:none;",
        "-webkit-user-select:none;font:500 12px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;color:var(--pv-fg)}",
        ".pv-remote.is-col{flex-direction:column;width:168px;padding:22px 18px 18px;border-radius:44px}",
        ".pv-remote.is-row{flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 32px)}",
        ".pv-pad{position:relative;width:128px;height:128px;flex:none;border-radius:50%;background:var(--pv-pad);",
        "box-shadow:inset 0 0 0 1px var(--pv-edge),inset 0 -6px 14px rgba(0,0,0,.35)}",
        ".pv-pad button{position:absolute;display:flex;align-items:center;justify-content:center;border:0;padding:0;margin:0;",
        "background:transparent;color:var(--pv-pad-fg);border-radius:50%;width:42px;height:42px}",
        ".pv-pad .up{left:43px;top:2px}.pv-pad .down{left:43px;bottom:2px}.pv-pad .left{left:2px;top:43px}.pv-pad .right{right:2px;top:43px}",
        ".pv-pad .ok{left:34px;top:34px;width:60px;height:60px;background:var(--pv-key);",
        "box-shadow:0 0 0 1px var(--pv-edge);font:600 13px/1 inherit;color:var(--pv-key-fg)}",
        ".pv-keys{display:grid;grid-template-columns:repeat(2,52px);gap:12px 18px;justify-items:center}",
        ".pv-remote.is-row .pv-keys{grid-template-columns:repeat(4,52px)}",
        ".pv-key{display:flex;flex-direction:column;align-items:center;gap:6px}",
        ".pv-key button{width:52px;height:52px;border-radius:50%;border:0;padding:0;display:flex;align-items:center;",
        "justify-content:center;background:var(--pv-key);color:var(--pv-key-fg);box-shadow:0 0 0 1px var(--pv-edge)}",
        ".pv-key span{color:var(--pv-muted);font-size:11px;white-space:nowrap}",
        ".pv-remote button.is-down{background:var(--pv-press);transform:scale(.94)}",
        ".pv-pad button.is-down:not(.ok){background:rgba(255,255,255,.1)}",
        ".pv-remote button:focus-visible{outline:2px solid #0a84ff;outline-offset:2px}",
        ".pv-help{color:var(--pv-muted);font-size:11.5px;line-height:1.45;text-align:center}",
        ".pv-remote.is-row .pv-help{flex-basis:100%}",
        ".pv-remote.is-col .pv-help{margin-top:4px}",
        ".pv-hide{display:none!important}",
        "@media (prefers-reduced-motion:reduce){.pv-remote button{transition:none}}"
    ].join("");

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }

    /* Simulates a remote key (the listeners read keyCode). */
    function sendKey(type, code) {
        var e;
        try { e = new KeyboardEvent(type, { bubbles: true, cancelable: true }); }
        catch (x) { e = document.createEvent("Event"); e.initEvent(type, true, true); }
        try { Object.defineProperty(e, "keyCode", { get: function () { return code; } }); } catch (x) {}
        document.dispatchEvent(e);
    }

    var SVG = function (d, s) {
        return '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    };
    var ICON = {
        up: SVG('<path d="M6 15l6-6 6 6"/>', 20), down: SVG('<path d="M6 9l6 6 6-6"/>', 20),
        left: SVG('<path d="M15 6l-6 6 6 6"/>', 20), right: SVG('<path d="M9 6l6 6-6 6"/>', 20),
        back: SVG('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
        home: SVG('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8.5 20.5h7"/>'),
        play: SVG('<path d="M4.5 6v12l7-6z" fill="currentColor"/><path d="M15 6v12M19.5 6v12"/>'),
        full: SVG('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')
    };

    /* Button that sends a key; held = repeat, like a real remote. */
    function bindKey(btn, code, opts) {
        opts = opts || {};
        var rep = null, wait = null, down = false;
        function stop() {
            if (!down) return;
            down = false;
            btn.classList.remove("is-down");
            clearTimeout(wait); clearInterval(rep);
            if (code) sendKey("keyup", code);
        }
        btn.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            if (down) return;
            down = true;
            btn.classList.add("is-down");
            try { btn.setPointerCapture(e.pointerId); } catch (x) {}
            if (opts.run) { opts.run(); return; }
            sendKey("keydown", code);
            if (opts.repeat) {
                wait = setTimeout(function () {
                    rep = setInterval(function () { sendKey("keydown", code); }, opts.every || 110);
                }, opts.after || 420);
            }
        });
        btn.addEventListener("pointerup", stop);
        btn.addEventListener("pointercancel", stop);
        btn.addEventListener("lostpointercapture", stop);
        // Keyboard on the button itself (accessibility)
        btn.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (opts.run) opts.run(); else { sendKey("keydown", code); sendKey("keyup", code); } }
        });
    }

    var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, RETURN: 10009, PLAY_PAUSE: 10252 };

    function homeButton() {
        // Home: closes whatever is open and goes back to the 1st app; already Home = Control Center.
        if (!(APL.goHome && APL.goHome()) && APL.controlCenter) APL.controlCenter.toggle();
    }

    function fullscreen() {
        var d = document;
        try {
            if (d.fullscreenElement) d.exitFullscreen();
            else if (doc.requestFullscreen) doc.requestFullscreen().catch(function () {});
        } catch (x) {}
    }

    function buildRemote() {
        remote = el("div", "pv-remote");
        remote.setAttribute("role", "group");
        remote.setAttribute("aria-label", APL.t("Remote"));

        var pad = el("div", "pv-pad");
        [["up", K.UP, APL.t("Up")], ["left", K.LEFT, APL.t("Left")], ["right", K.RIGHT, APL.t("Right")], ["down", K.DOWN, APL.t("Down")]].forEach(function (d) {
            var b = el("button", d[0], ICON[d[0]]);
            b.type = "button"; b.setAttribute("aria-label", d[2]);
            bindKey(b, d[1], { repeat: true });
            pad.appendChild(b);
        });
        var ok = el("button", "ok", "OK");
        ok.type = "button"; ok.setAttribute("aria-label", APL.t("OK (hold for the app menu)"));
        bindKey(ok, K.ENTER, { repeat: true, after: 300, every: 80 });
        pad.appendChild(ok);
        remote.appendChild(pad);

        var keys = el("div", "pv-keys");
        [["back", APL.t("Back"), K.RETURN, null], ["home", "Home", 0, homeButton],
         ["play", APL.t("Ctrl Center"), K.PLAY_PAUSE, null], ["full", APL.t("Full Screen"), 0, fullscreen]].forEach(function (k) {
            var wrap = el("div", "pv-key");
            var b = el("button", "", ICON[k[0]]);
            b.type = "button"; b.setAttribute("aria-label", k[1]);
            bindKey(b, k[2], { run: k[3] });
            wrap.appendChild(b);
            wrap.appendChild(el("span", "", k[1]));
            keys.appendChild(wrap);
        });
        remote.appendChild(keys);

        help = el("div", "pv-help",
            APL.t("Hold OK = app menu") + "<br>" + APL.t("Keyboard: arrows, Enter, Esc, C") + "<br>" + APL.t("Preview: apps don't open") +
            // The demo's Top Shelf (liveshelf.js, demoSource): Blender Studio's open movies
            (APL.live && !APL.live.keys().tmdb ? "<br>" + APL.t("Demo films: Blender Studio (CC BY), pictures from TMDB") : ""));
        remote.appendChild(help);

        // Outside the scaled-down screen: the remote sits next to <body>, not inside it.
        doc.appendChild(remote);
    }

    /* Screen scaled to the window, remote on the right or below (the bigger picture wins). */
    function fit() {
        var W = global.innerWidth, H = global.innerHeight, P = 16, G = 18;
        remote.style.transform = "";
        // Remote on the right (scaled down if the window is short, e.g. a phone in landscape)
        remote.className = "pv-remote is-col";
        help.classList.toggle("pv-hide", H < 620);
        var cw = remote.offsetWidth, ch = remote.offsetHeight;
        var rs = Math.min(1, (H - 2 * P) / ch);
        var sCol = Math.min((W - 2 * P - G - cw * rs) / 1920, (H - 2 * P) / 1080);
        var colHelp = !help.classList.contains("pv-hide");
        // ... or below
        remote.className = "pv-remote is-row";
        help.classList.toggle("pv-hide", W < 560);
        var rh = remote.offsetHeight, rw = remote.offsetWidth;
        var sRow = Math.min((W - 2 * P) / 1920, (H - 2 * P - G - rh) / 1080);
        var col = sCol > sRow;
        if (col) {
            remote.className = "pv-remote is-col";
            help.classList.toggle("pv-hide", !colHelp);
            remote.style.transformOrigin = "0 0";
            remote.style.transform = rs < 1 ? "scale(" + rs + ")" : "";
        }
        scale = Math.max(0.1, col ? sCol : sRow);

        var tvW = 1920 * scale, tvH = 1080 * scale, x, y;
        if (col) {
            x = Math.max(P, (W - tvW - G - cw * rs) / 2);
            y = Math.max(P, (H - tvH) / 2);
            remote.style.left = Math.round(x + tvW + G) + "px";
            remote.style.top = Math.round(Math.max(P, (H - ch * rs) / 2)) + "px";
        } else {
            x = (W - tvW) / 2;
            y = Math.max(P, (H - tvH - G - rh) / 2);
            remote.style.left = Math.round((W - rw) / 2) + "px";
            remote.style.top = Math.round(y + tvH + G) + "px";
        }
        document.body.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px) scale(" + scale + ")";
        // Screen corners and bezel at a constant size, whatever the scaling.
        document.body.style.borderRadius = Math.round(12 / scale) + "px";
        document.body.style.boxShadow = "0 0 0 " + Math.round(7 / scale) + "px var(--pv-bezel), 0 " +
            Math.round(24 / scale) + "px " + Math.round(70 / scale) + "px var(--pv-shadow)";
    }

    /* By touch: long press on a tile = app menu (like holding OK). */
    function touchLongPress() {
        var timer = null, fired = false, sx = 0, sy = 0, lastPointer = "mouse";
        document.addEventListener("pointerdown", function (e) {
            lastPointer = e.pointerType || "mouse";
            if (lastPointer === "mouse" || remote.contains(e.target)) return;
            fired = false; sx = e.clientX; sy = e.clientY;
            var target = e.target;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fired = true;
                var ev = document.createEvent("MouseEvent");
                ev.initEvent("contextmenu", true, true);
                target.dispatchEvent(ev);
            }, 600);
        }, true);
        function cancel() { clearTimeout(timer); }
        document.addEventListener("pointerup", cancel, true);
        document.addEventListener("pointercancel", cancel, true);
        document.addEventListener("pointermove", function (e) {
            if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 12) cancel();
        }, true);
        // The click that follows a long press must not open the app.
        document.addEventListener("click", function (e) {
            if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); }
        }, true);
        // The browser's own menu by touch: replaced by ours (right-click with the mouse: kept).
        document.addEventListener("contextmenu", function (e) {
            if (e.isTrusted && lastPointer !== "mouse") { e.preventDefault(); e.stopPropagation(); }
        }, true);
    }

    /* The launcher fixes the window at 1920 px (TV screen): on a phone the real width
       is used again, and the screen is scaled down by fit(). */
    (function () {
        var m = document.querySelector('meta[name="viewport"]');
        if (!m) { m = document.createElement("meta"); m.name = "viewport"; document.head.appendChild(m); }
        m.content = "width=device-width, initial-scale=1, viewport-fit=cover";
    })();

    function start() {
        var style = el("style");
        style.textContent = CSS;
        document.head.appendChild(style);
        doc.classList.add("apl-preview");
        buildRemote();
        fit();
        global.addEventListener("resize", fit);
        document.addEventListener("fullscreenchange", function () { setTimeout(fit, 60); });
        touchLongPress();
        APL.viewScale = function () { return scale; };
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})(window);
