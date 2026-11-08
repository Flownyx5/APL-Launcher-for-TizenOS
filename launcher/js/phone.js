/* ============================================================
   phone.js — the phone as a remote.

   The bridge (bridge/service.js) serves a remote page on the screen's
   network address, port 8092. Here: the panel that shows its QR code,
   the address and a 4-digit pairing code, and the switch.
   - The QR code carries a secret token: scanning it is enough.
   - Typed by hand, the address asks for the pairing code shown here
     (valid 10 minutes while this panel is open).
   - Text typed on the phone lands in the launcher's search.
   "New Secret" makes a new token: phones paired before must scan again.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var PORT = 8092;
    var root, qrEl, urlEl, codeEl, stateEl, nav, btns = [], isOpen = false, code = "";

    function el(tag, cls, html) { var e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; }

    function random(n, chars) {
        var out = "", a = new Uint8Array(n);
        try { global.crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); }
        for (var k = 0; k < n; k++) out += chars.charAt(a[k] % chars.length);
        return out;
    }
    function token() {
        var t = sys.pref("phoneToken");
        if (!/^[A-Za-z0-9]{20,64}$/.test(t || "")) {
            t = random(24, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789");
            sys.setPref("phoneToken", t);
        }
        return t;
    }
    /* The QR code as SVG, from qr.js (APL.qr.matrix): sharp at any size, 4 modules of quiet zone. */
    function qrSvg(text, px) {
        var m = APL.qr.matrix(text), n = m.length + 8, d = "";
        for (var y = 0; y < m.length; y++) for (var x = 0; x < m.length; x++) if (m[y][x]) d += "M" + (x + 4) + " " + (y + 4) + "h1v1h-1z";
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + n + " " + n +
               '" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    }

    function address() {
        var ip = sys.network().ip;
        return /^\d+\.\d+\.\d+\.\d+$/.test(ip || "") ? "http://" + ip + ":" + PORT : "";
    }

    /* Tells the bridge: server on (with the token, and the pairing code while the panel is open) or off. */
    function push(withCode) {
        var on = !!sys.pref("phoneRemote");
        var cfg = { on: on, token: on ? token() : "" };
        if (on && withCode) cfg.code = code;
        return sys.bridgeSend([{ key: "remote", value: JSON.stringify(cfg) }]);
    }

    function paint() {
        var on = !!sys.pref("phoneRemote"), base = address();
        root.classList.toggle("is-off", !on);
        if (!on) {
            qrEl.innerHTML = '<div class="phone__offglyph">' + APL.icon("phone", 140, 1.4) + "</div>";
            urlEl.textContent = "";
            codeEl.textContent = "";
            stateEl.textContent = APL.t("The phone remote is off.");
        } else if (!base) {
            qrEl.innerHTML = "";
            stateEl.textContent = APL.t("The screen is not connected to the network.");
        } else {
            try { qrEl.innerHTML = qrSvg(base + "/?t=" + token(), 400); } catch (e) { qrEl.innerHTML = ""; }
            urlEl.textContent = base.replace(/^http:\/\//, "");
            codeEl.textContent = code;
            stateEl.textContent = sys.PREVIEW ? APL.t("Preview: on your TV, the phone remote answers at this address.") : "";
        }
        btns[1].textContent = on ? APL.t("Turn Off") : APL.t("Turn On");
        btns[2].style.display = on ? "" : "none";
        var keep = Math.min(Math.max(nav.index, 0), on ? 2 : 1);
        nav.setTiles(on ? btns.slice() : btns.slice(0, 2));
        nav.focus(keep);
    }

    function buildDom() {
        root = el("section", "phone");
        var card = el("div", "phone__card");
        qrEl = el("div", "phone__qr");
        var side = el("div", "phone__side");
        side.appendChild(el("h2", "phone__title", APL.t("Phone Remote")));
        side.appendChild(el("p", "phone__steps", APL.t("Connect your phone to the same Wi-Fi as the screen, then scan this code with its camera. Swipe to move, tap to open.")));
        var alt = el("p", "phone__alt");
        alt.innerHTML = APL.t("Or open") + ' <b class="phone__url"></b> ' + APL.t("and type the code") + ' <b class="phone__code"></b>';
        side.appendChild(alt);
        stateEl = el("p", "phone__state");
        side.appendChild(stateEl);
        var box = el("div", "phone__btns");
        btns = [el("div", "phone__btn", APL.t("Done")), el("div", "phone__btn"), el("div", "phone__btn", APL.t("New Secret"))];
        btns.forEach(function (b) { box.appendChild(b); });
        side.appendChild(box);
        card.appendChild(qrEl); card.appendChild(side);
        root.appendChild(card);
        document.body.appendChild(root);
        urlEl = alt.querySelector(".phone__url");
        codeEl = alt.querySelector(".phone__code");
        nav = new APL.Nav({
            onSelect: function (i) {
                if (i === 0) { close(); return; }
                if (i === 1) {
                    var on = !sys.pref("phoneRemote");
                    sys.setPref("phoneRemote", on);
                    push(true).catch(function () { if (!sys.PREVIEW) APL.toast(APL.t("Vetro is not responding")); });
                    APL.toast(on ? APL.t("Phone remote on") : APL.t("Phone remote off"), true);
                    paint();
                    return;
                }
                sys.setPref("phoneToken", "");
                token();
                code = random(4, "0123456789");
                push(true).catch(function () {});
                APL.toast(APL.t("New secret: phones must scan the code again"), true);
                paint();
            },
            onBack: close
        });
    }

    function open() {
        if (APL.kids && APL.kids.active()) { APL.toast(APL.t("Not available in Kids Mode")); return; }
        if (APL.controlCenter && APL.controlCenter.isOpen()) APL.controlCenter.close();
        if (!root) buildDom();
        // Opening the panel is asking for the remote: it turns on
        if (!sys.pref("phoneRemote")) sys.setPref("phoneRemote", true);
        code = random(4, "0123456789");
        push(true).catch(function () { if (!sys.PREVIEW) APL.toast(APL.t("Vetro is not responding")); });
        paint();
        root.classList.add("is-open");
        isOpen = true;
        APL.pushNav(nav);
        nav.focus(0);
    }
    function close() {
        if (!isOpen) return;
        isOpen = false;
        root.classList.remove("is-open");
        APL.popNav(nav);
        code = "";
        if (sys.pref("phoneRemote")) push(false).catch(function () {});   // the pairing code stops working
    }

    /* At start-up: the server comes back if it was on; text from the phone goes to the search. */
    var prev = APL.onHomeReady;
    APL.onHomeReady = function () {
        if (prev) prev();
        sys.onBridgeEvent(function (event, body) {
            if (event === "text" && APL.search && body) APL.search.type(body);
        });
        if (sys.pref("phoneRemote")) setTimeout(function () { push(false).catch(function () {}); }, 6000);
    };

    APL.phone = {
        open: open, close: close, isOpen: function () { return isOpen; },
        /* Diagnostic (diag.js): the server on for a moment, whatever the setting, then back as set. */
        serverOn: function () { return sys.bridgeSend([{ key: "remote", value: JSON.stringify({ on: true, token: token() }) }]); },
        serverSync: function () { return push(false).catch(function () {}); }
    };
})(window);
