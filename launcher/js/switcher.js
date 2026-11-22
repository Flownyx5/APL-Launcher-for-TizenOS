/* ============================================================
   switcher.js — App Switcher, as on Apple TV.

   Two quick presses on Home: the open apps as large cards.
   ◀ ▶ to choose, OK to return to it as it was, ▲ to close it.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var root, rowEl, nav, isOpen = false;

    function el(tag, cls) { var e = document.createElement(tag); e.className = cls; return e; }

    /* The Home Screen's open apps, most recent first. */
    function openApps() {
        return sys.runningApps().then(function (ids) {
            var recent = sys.pref("recentApps") || [];
            var P = APL.platform;
            var list = APL.allApps().filter(function (a) {
                return !a.virtual && ids.indexOf(a.id) !== -1 && !(P && P.notInSwitcher && P.notInSwitcher(a.id)) &&
                       !(APL.vault && APL.vault.hidden(a));          // hidden behind the secret code (vault.js)
            });
            function rank(a) { var i = recent.indexOf(a.id); return i === -1 ? 999 : i; }
            return list.sort(function (a, b) { return rank(a) - rank(b); });
        });
    }

    function card(app) {
        var c = el("div", "sw__card");
        c._app = app;
        var head = el("div", "sw__head");
        var name = el("span", "sw__name");
        // TizenBrew is only there to run TizenTube: that's the one we show
        var shown = app.id === "xvvl3S1bvH.TizenBrewStandalone" ? (APL.allApps().filter(function (a) { return a.id === "apl.tizentube"; })[0] || app) : app;
        name.textContent = shown.name;
        head.appendChild(name);
        var pic = el("div", "sw__pic");
        var art = shown.bg || shown.tile || shown.icon;
        pic.style.background = art ? "#111 center / cover no-repeat url('" + art + "')" : (app.accent || "#222");
        c.appendChild(head); c.appendChild(pic);
        // The app's small widgets: last channel, movie in progress…
        if (APL.widgets) {
            APL.widgets.cardsFor(app.id).then(function (cards) {
                if (!cards.length) return;
                var w = el("div", "sw__widgets");
                // Two small cards fit under an app here; the Home Screen's row takes up to six and slides
                cards.slice(0, 2).forEach(function (x) { w.appendChild(APL.widgets.cardEl(x)); });
                pic.appendChild(w);
            });
        }
        return c;
    }

    function buildDom() {
        root = el("section", "sw");
        rowEl = el("div", "sw__row");
        var hint = el("div", "sw__hint");
        hint.textContent = APL.t("OK: return to the app · ▲: close it · Back: Home");
        root.appendChild(rowEl); root.appendChild(hint);
        document.body.appendChild(root);
        nav = new APL.Nav({
            onFocus: function (i, t) {
                // The chosen card stays in the middle of the screen
                rowEl.style.transform = "translateX(" + (960 - t.offsetLeft - t.offsetWidth / 2) + "px)";
            },
            onSelect: function (i, t) { var a = t._app; close(); APL.openApp(a); },
            onBack: close,
            onKey: function (code) {
                if (code !== APL.KEY.UP) return false;
                var t = nav.current();
                if (t) closeApp(t);
                return true;
            }
        });
    }

    function closeApp(t) {
        var a = t._app, i = nav.tiles.indexOf(t);
        (sys.closeApps ? sys.closeApps([a.id]) : sys.exec("app_launcher -k " + a.id + " >/dev/null 2>&1; true")).catch(function () {});
        rowEl.removeChild(t);
        var rest = nav.tiles.filter(function (x) { return x !== t; });
        if (!rest.length) { close(); return; }
        nav.index = -1;
        nav.tiles = rest;
        nav.focus(Math.min(i, rest.length - 1));
    }

    function open() {
        return openApps().then(function (list) {
            if (!list.length) { APL.toast(APL.t("No open apps"), true); return; }
            if (!root) buildDom();
            rowEl.innerHTML = "";
            var cards = list.map(function (a) { var c = card(a); rowEl.appendChild(c); return c; });
            root.classList.add("is-open");
            isOpen = true;
            nav.setTiles(cards);
            nav.focus(0);
            APL.pushNav(nav);
        }, function () {});
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        root.classList.remove("is-open");
        APL.popNav(nav);
    }

    APL.switcher = { open: open, close: close, isOpen: function () { return isOpen; } };
})(window);
