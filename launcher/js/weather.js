/* ============================================================
   weather.js — the weather next to the clock.

   Settings › Appearance › Weather (asked on Reddit, "with the choice of
   the place"): a city typed with the screen's keyboard, found by
   Open-Meteo's geocoding, then its temperature and sky in the clock pill.
   Open-Meteo needs no key and no account; the answer is kept for half an
   hour, and asked again when the launcher comes back to the front. Nothing
   is asked while the weather is off.

   APL.weather.pickCity()   the city picker (from Settings)
   APL.weather.refresh()    draw again, after a change in Settings
   APL.weather.place()      the chosen city, or null
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var GEO = "https://geocoding-api.open-meteo.com/v1/search", API = "https://api.open-meteo.com/v1/forecast";
    var EVERY = 30 * 60000, STORE = "apl.weather";
    var IME_DONE = 65376, IME_CANCEL = 65385, BACK = 10009, ESC = 27, ENTER = 13;
    var pill = null, timer = null, started = false;

    function place() {
        var p = sys.pref("weatherPlace");
        return p && typeof p.lat === "number" && typeof p.lon === "number" ? p : null;
    }
    function keyOf(p) { return p.lat.toFixed(2) + "," + p.lon.toFixed(2); }
    /* °F where the city is in the United States (Open-Meteo gives the country), °C elsewhere */
    function unit(p) { return p.cc === "US" ? "fahrenheit" : "celsius"; }

    function read() { try { return JSON.parse(global.localStorage.getItem(STORE) || "null"); } catch (e) { return null; } }
    function save(w) { try { global.localStorage.setItem(STORE, JSON.stringify(w)); } catch (e) {} }

    /* WMO weather codes, as Open-Meteo gives them */
    function iconFor(code, day) {
        if (code === 0) return day ? "sun" : "moon";
        if (code === 1 || code === 2) return day ? "cloudSun" : "cloud";
        if (code === 3) return "cloud";
        if (code === 45 || code === 48) return "fog";
        if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
        if (code >= 95) return "storm";
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
        return "cloud";
    }

    function paint(w) {
        if (!pill) {
            var clock = document.getElementById("clock");
            if (!clock) return;
            pill = document.createElement("span");
            pill.className = "status__weather";
            clock.parentNode.insertBefore(pill, clock);
        }
        var p = place();
        if (!w || !sys.pref("weather") || !p || w.key !== keyOf(p) || typeof w.temp !== "number") {
            pill.style.display = "none";
            return;
        }
        pill.style.display = "";
        pill.innerHTML = APL.icon(iconFor(w.code, w.day), 26, 1.8) + "<span>" + Math.round(w.temp) + "°</span>";
    }

    function getJson(url) {
        return global.fetch(url).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        });
    }

    function load(force) {
        var p = place();
        if (!sys.pref("weather") || !p) { paint(null); return; }
        var kept = read();
        if (kept && kept.key === keyOf(p)) paint(kept);
        if (!force && kept && kept.key === keyOf(p) && Date.now() - kept.at < EVERY) return;
        if (!global.fetch) return;
        getJson(API + "?latitude=" + p.lat + "&longitude=" + p.lon + "&current=temperature_2m,weather_code,is_day" +
                "&temperature_unit=" + unit(p) + "&timezone=auto").then(function (j) {
            var c = j && j.current || {};
            var w = { key: keyOf(p), at: Date.now(), temp: c.temperature_2m, code: c.weather_code, day: c.is_day !== 0 };
            save(w);
            paint(w);
        }, function () {});
    }

    function start() {
        if (started) return;
        started = true;
        load(false);
        timer = global.setInterval(function () { if (!document.hidden) load(false); }, EVERY);
        document.addEventListener("visibilitychange", function () { if (!document.hidden) load(false); });
        // Settings › Appearance › Weather › Show the Weather: on or off at once
        if (sys.onPref) sys.onPref("weather", function () { load(true); });
    }

    /* ---------- the city picker ---------- */
    var root = null, field = null, list = null, note = null, nav = null, found = [], open = false;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function build() {
        root = el("section", "wpick");
        var box = el("div", "wpick__box");
        box.appendChild(el("h2", "wpick__title", APL.t("Weather")));
        field = el("input", "wpick__field");
        field.type = "text";
        field.maxLength = 40;
        field.placeholder = APL.t("City");
        field.setAttribute("autocomplete", "off");
        field.setAttribute("spellcheck", "false");
        note = el("p", "wpick__note", APL.t("Type a city with the keyboard, then pick it in the list."));
        list = el("div", "wpick__list");
        box.appendChild(field);
        box.appendChild(note);
        box.appendChild(list);
        root.appendChild(box);
        document.body.appendChild(root);

        field.addEventListener("keydown", function (e) {
            var c = e.keyCode;
            // Not ▼: on the screen's keyboard the arrows move between its keys (seen on the M8)
            if (c === ENTER || c === IME_DONE) { e.preventDefault(); e.stopPropagation(); typed(); }
            else if (c === IME_CANCEL || c === BACK || c === ESC) { e.preventDefault(); e.stopPropagation(); field.blur(); nav.focus(0); }
        });

        nav = new APL.Nav({
            onSelect: function (i) {
                if (i === 0) { type(); return; }
                choose(found[i - 1]);
            },
            onBack: close,
            onKey: function (code, e) {
                // A PC keyboard in the preview: straight into the field
                var ch = e && e.key && e.key.length === 1 ? e.key : "";
                if (!ch) return false;
                if (field.value.length < 40) field.value += ch;
                type();
                return true;
            }
        });
    }

    function type() {
        nav.focus(0);
        field.focus();
        try { var n = field.value.length; field.setSelectionRange(n, n); } catch (e) {}
    }

    function typed() {
        field.blur();
        var q = field.value.replace(/^\s+|\s+$/g, "");
        if (q.length < 2) { nav.focus(0); return; }
        note.textContent = APL.t("Searching…");
        getJson(GEO + "?name=" + encodeURIComponent(q) + "&count=6&language=" + encodeURIComponent(APL.lang || "en") + "&format=json").then(function (j) {
            showFound((j && j.results) || []);
        }, function (e) {
            showFound([]);
            note.textContent = APL.t("No answer from the weather service: {error}", { error: e.message });
        });
    }

    function showFound(results) {
        found = results.filter(function (r) { return r && typeof r.latitude === "number"; }).map(function (r) {
            return { name: String(r.name), region: [r.admin1, r.country].filter(Boolean).join(", "),
                     cc: String(r.country_code || "").toUpperCase(), lat: r.latitude, lon: r.longitude };
        });
        list.innerHTML = "";
        var tiles = [field];
        found.forEach(function (f) {
            var row = el("div", "wpick__row");
            row.appendChild(el("span", "wpick__name", f.name));
            row.appendChild(el("span", "wpick__region", f.region));
            list.appendChild(row);
            tiles.push(row);
        });
        note.textContent = found.length ? APL.t("Pick the city:") : APL.t("No city found with that name.");
        nav.setTiles(tiles);
        nav.focus(found.length ? 1 : 0);
    }

    function choose(f) {
        if (!f) return;
        sys.setPref("weatherPlace", { name: f.name, region: f.region, cc: f.cc, lat: f.lat, lon: f.lon });
        sys.setPref("weather", true);
        close();
        start();
        load(true);
        APL.toast(APL.t("Weather for {city}", { city: f.name }), true);
        if (APL.settings && APL.settings.refresh) APL.settings.refresh();
    }

    function pickCity() {
        if (open) return;
        if (!root) build();
        open = true;
        found = [];
        list.innerHTML = "";
        var p = place();
        field.value = p ? p.name : "";
        note.textContent = APL.t("Type a city with the keyboard, then pick it in the list.");
        root.classList.add("is-open");
        nav.setTiles([field]);
        APL.pushNav(nav);
        type();
    }

    function close() {
        if (!open) return;
        open = false;
        field.blur();
        root.classList.remove("is-open");
        APL.popNav(nav);
    }

    APL.weather = {
        pickCity: pickCity,
        place: place,
        refresh: function () { start(); load(true); }
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window);
