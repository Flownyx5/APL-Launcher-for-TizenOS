/* ============================================================
   sources.js — choose a source (HDMI, USB-C…) the Apple TV way,
   without Samsung's own source screen.

   One tile per input of the screen, plus "AirPlay" (iPhone, iPad, Mac).
   OK switches straight to the input (asks Samsung's TV app, like its
   own Source tile does). Hold OK: choose the connected device
   (Switch 2, Steam Deck, PS5…) — its tile then takes that device's logo.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var root, row, titleEl, hintEl, nav, cards = [], isOpen = false, picking = null;
    var DEVICES = global.APL_DEVICES || [];
    function asset(p) { return p && global.APL_ASSET ? global.APL_ASSET(p) : p; }
    function deviceByKey(k) { for (var i = 0; i < DEVICES.length; i++) if (DEVICES[i].key === k) return DEVICES[i]; return null; }
    /* Name announced by the screen (if available) → known device */
    function guess(name) {
        var n = String(name || "").toLowerCase();
        if (!n) return null;
        for (var i = 0; i < DEVICES.length; i++) {
            var m = DEVICES[i].match || [];
            for (var j = 0; j < m.length; j++) { try { if (new RegExp(m[j], "i").test(n)) return DEVICES[i]; } catch (e) {} }
        }
        return null;
    }

    var LABEL = { HDMI: "HDMI", PC: "PC", DVI: "DVI", DP: "USB-C", USBC: "USB-C", AV: "AV", COMP: APL.t("Component"), SCART: APL.t("SCART") };

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }

    /* The screen's HDMI ports. Tizen 9 no longer lists the inputs (tvwindow.getAvailableSources is
       gone): they are read from the screen through Vetro. memory/sysman/hdmiN is 2 for a port the screen
       doesn't have, and db/Canalysis-service/hdmiN gives the device Samsung recognized on it. Kept for
       the next time; before the first reading, a guess from the model. */
    var PORTS_KEY = "sourcePorts", PIN_KEY = "pinnedSources";
    // Smart Monitors M7, M8, M9: one HDMI port and a USB-C input
    function isMonitor() { return /^LS\d\d[A-Z]M[789]/i.test(String(sys.product().model || "")); }
    function guessPorts() {
        return isMonitor() ? [{ type: "HDMI", number: 1 }, { type: "USBC", number: 1 }]
                           : [1, 2, 3, 4].map(function (n) { return { type: "HDMI", number: n }; });
    }
    function readPorts() {
        if (sys.PREVIEW) return Promise.resolve(null);
        var cmd = [1, 2, 3, 4].map(function (n) {
            return "vconftool get memory/sysman/hdmi" + n + "; vconftool get db/Canalysis-service/hdmi" + n + "/manufacturer_name; " +
                   "vconftool get db/Canalysis-service/hdmi" + n + "/model_name";
        }).join("; ");
        return sys.exec(cmd + " 2>/dev/null; true").then(function (r) {
            var out = String((r && r.output) || ""), ports = [];
            function text(key) { return ((new RegExp(key + ", value = ([^\\n]*) \\(String\\)").exec(out) || [])[1] || "").trim(); }
            for (var n = 1; n <= 4; n++) {
                var state = (new RegExp("memory/sysman/hdmi" + n + ", value = (\\d+)").exec(out) || [])[1];
                if (state === undefined || state === "2") continue;
                var hdmi = "db/Canalysis-service/hdmi" + n;
                ports.push({ type: "HDMI", number: n, label: (text(hdmi + "/manufacturer_name") + " " + text(hdmi + "/model_name")).trim() });
            }
            if (!ports.length) return null;
            if (isMonitor()) ports.push({ type: "USBC", number: 1 });
            return ports;
        }, function () { return null; });
    }
    /* Reads the ports again; resolves true when they changed. */
    function refreshPorts() {
        return readPorts().then(function (ports) {
            if (!ports || JSON.stringify(ports) === JSON.stringify(sys.pref(PORTS_KEY))) return false;
            sys.setPref(PORTS_KEY, ports);
            return true;
        });
    }

    /* The screen's inputs: the ones Tizen announces (before Tizen 9), otherwise the HDMI ports read above. */
    function inputs() {
        var list = [];
        try {
            var tw = global.tizen && global.tizen.tvwindow;
            if (tw && tw.getAvailableSources) {
                list = tw.getAvailableSources().filter(function (s) { return LABEL[s.type]; })
                    .map(function (s) { return { type: s.type, number: s.number || 1, label: s.name || s.label || "" }; });
            }
        } catch (e) {}
        if (!list.length) list = sys.pref(PORTS_KEY) || guessPorts();
        var hdmiCount = list.filter(function (s) { return s.type === "HDMI"; }).length;
        var chosen = sys.pref("sourceDevices") || {};
        return list.map(function (s) {
            var hdmi = s.type === "HDMI", id = s.type + s.number;
            var port = LABEL[s.type] + (hdmi && hdmiCount > 1 ? " " + s.number : "");
            var dev = chosen[id] === "none" ? null : (deviceByKey(chosen[id]) || guess(s.label));
            return {
                id: id, port: port, device: dev,
                name: dev ? APL.t(dev.name) : port,
                sub: dev ? port : hdmi ? APL.t("Hold OK to choose the device") : s.type === "USBC" || s.type === "DP" ? APL.t("Laptop, Mac, tablet") : "",
                icon: hdmi ? "hdmi" : s.type === "USBC" || s.type === "DP" ? "usbc" : "source",
                // Samsung number: HDMI 1 to 4 = 13 to 16; on the Smart Monitor M8, USB-C is no. 14 ("HDMI 2")
                sourceType: hdmi ? 12 + (s.number || 1) : s.type === "USBC" || s.type === "DP" ? 14 : -1
            };
        });
    }

    function extras() {
        return [
            { name: "AirPlay", sub: "iPhone, iPad, Mac", icon: "airplay",
              run: function () { if (APL.controlCenter && APL.controlCenter.openAirPlay) APL.controlCenter.openAirPlay(); } }
        ];
    }

    /* Switches to the input, straight from the app or through Vetro. */
    function switchTo(c) {
        if (sys.PREVIEW) { APL.toast(APL.t("Preview: on your TV, the screen would switch to {name}", { name: c.name })); return; }
        if (c.sourceType < 0) { APL.toast(APL.t("This input isn't supported on this screen")); return; }
        APL.toast(APL.t("Switching to {name}…", { name: c.name }), true);
        sys.switchSource(c.sourceType, c.port).catch(function (e) { APL.toast(e.message); });
    }

    function cardHtml(c) {
        var art = c.device
            ? '<span class="scard__art" style="background-image:url(\'' + asset(c.device.tile) + '\')"></span>'
            : '<span class="scard__art scard__art--glass"><span class="scard__ico">' + APL.icon(c.icon, 64, 1.7) + '</span></span>';
        return art + '<span class="scard__name"></span><span class="scard__sub"></span>';
    }

    function buildDom() {
        root = el("section", "sources");
        root.appendChild(el("div", "sources__dim"));
        titleEl = el("h1", "sources__title");
        root.appendChild(titleEl);
        row = el("div", "sources__row");
        root.appendChild(row);
        hintEl = el("p", "sources__hint");
        root.appendChild(hintEl);
        document.body.appendChild(root);
        nav = new APL.Nav({
            onSelect: function (i) {
                if (picking) { choose(i); return; }
                var c = cards[i];
                close();
                if (c.run) c.run(); else switchTo(c);
            },
            onLongPress: function (i) { if (!picking && cards[i] && cards[i].id) pick(cards[i]); },
            onBack: function () { if (picking) { picking = null; render(); } else close(); }
        });
    }

    function fill(list, focus) {
        row.innerHTML = "";
        var tiles = list.map(function (c) {
            var t = el("div", "scard" + (picking ? " scard--small" : ""), cardHtml(c));
            t.querySelector(".scard__name").textContent = c.name;
            t.querySelector(".scard__sub").textContent = c.sub || "";
            row.appendChild(t);
            return t;
        });
        row.classList.toggle("is-picking", !!picking);
        root.classList.toggle("is-picking", !!picking);
        nav.setTiles(tiles);
        nav.focus(Math.max(0, Math.min(focus || 0, tiles.length - 1)));
    }

    function render(focus) {
        cards = inputs().concat(extras());
        titleEl.textContent = "Sources";
        hintEl.textContent = APL.t("OK: switch to the input · Hold OK: choose the device, or add it to the Home Screen · Back: Home");
        fill(cards, focus);
    }

    /* Choose the device connected to an input (Switch 2, Steam Deck, PS5…), or pin the input to the Home Screen */
    function pinned() { return sys.pref(PIN_KEY) || []; }
    function pick(c) {
        picking = c;
        titleEl.textContent = APL.t("What's connected to {port}?", { port: c.port });
        hintEl.textContent = APL.t("OK to choose · Back to cancel");
        var onHome = pinned().indexOf(c.id) !== -1;
        cards = DEVICES.map(function (d) { return { device: d, name: APL.t(d.name), sub: "", key: d.key }; })
            .concat([{ device: null, icon: c.icon, name: APL.t("Nothing Specific"), sub: APL.t("Show “{port}”", { port: c.port }), key: "none" },
                     { device: null, icon: onHome ? "minus" : "plus", name: onHome ? APL.t("Remove from Home Screen") : APL.t("Add to Home Screen"),
                       sub: c.name, key: "pin" }]);
        var cur = (sys.pref("sourceDevices") || {})[c.id], at = 0;
        cards.forEach(function (x, i) { if (x.key === cur) at = i; });
        fill(cards, at);
    }
    function togglePin(c) {
        var list = pinned().filter(function (id) { return id !== c.id; }), adding = list.length === pinned().length;
        if (adding) list.push(c.id);
        sys.setPref(PIN_KEY, list);
        // Removed, then added again later: shown again even if it had been hidden
        sys.setPref("hiddenApps", sys.pref("hiddenApps").filter(function (id) { return id !== "apl.source." + c.id; }));
        if (APL.refreshHome) APL.refreshHome();
        APL.toast(adding ? APL.t("{name} is on the Home Screen: hold OK on it to move it.", { name: c.name })
                         : APL.t("{name} is no longer on the Home Screen.", { name: c.name }), true);
    }
    function choose(i) {
        if (cards[i] && cards[i].key === "pin") {
            var input = picking;
            picking = null;
            togglePin(input);
            render();
            cards.forEach(function (x, k) { if (x.id === input.id) nav.focus(k); });
            return;
        }
        var map = {}, prev = sys.pref("sourceDevices") || {};
        Object.keys(prev).forEach(function (k) { map[k] = prev[k]; });
        map[picking.id] = cards[i].key;
        sys.setPref("sourceDevices", map);
        var id = picking.id;
        if (pinned().indexOf(id) !== -1 && APL.refreshHome) APL.refreshHome();     // its tile takes the device's logo
        picking = null;
        render();
        cards.forEach(function (x, k) { if (x.id === id) nav.focus(k); });
        APL.toast(cards[i] && cards[i].name ? APL.t("Input updated") : "", true);
    }

    function open() {
        if (!root) buildDom();
        picking = null;
        render(0);
        root.classList.add("is-open");
        APL.pushNav(nav);
        isOpen = true;
        refreshPorts().then(function (changed) {
            if (changed && isOpen && !picking) render(nav.index);
            if (changed && pinned().length && APL.refreshHome) APL.refreshHome();
        });
    }

    /* Inputs pinned to the Home Screen (hold OK › Add to Home Screen): tiles like the apps. */
    function homeTiles() {
        var ids = pinned();
        if (!ids.length) return [];
        return inputs().filter(function (c) { return ids.indexOf(c.id) !== -1; }).map(function (c) {
            return { id: "apl.source." + c.id, name: c.name, virtual: true, accent: "#2c5cc5", eyebrow: "SOURCE",
                     tile: c.device ? asset(c.device.tile) : null,
                     tileHtml: c.device ? null : '<div class="vtile vtile--sources">' + APL.icon(c.icon, 92, 1.6) + '</div>',
                     shelfHtml: '<div class="brandcard__glyph vtile--sources">' + APL.icon(c.icon, 180, 1.3) + '</div>',
                     run: function () { switchTo(c); } };
        });
    }
    // Once after start-up: the ports and the devices Samsung recognized may have changed since last time
    setTimeout(function () {
        refreshPorts().then(function (changed) { if (changed && pinned().length && APL.refreshHome) APL.refreshHome(); });
    }, 20000);

    function close() {
        if (!isOpen) return;
        picking = null;
        root.classList.remove("is-open");
        APL.popNav(nav);
        isOpen = false;
    }

    APL.sources = { open: open, close: close, isOpen: function () { return isOpen; }, homeTiles: homeTiles };
})(window);
