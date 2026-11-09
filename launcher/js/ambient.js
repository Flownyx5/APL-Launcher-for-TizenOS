/* ============================================================
   ambient.js — a Home Screen that lives with the day.

   - Light: a soft tint over the Top Shelf follows the sun where the
     screen is (dawn pink, daylight neutral, golden hour, night blue).
     A static gradient: it costs nothing once drawn.
   - Weather: temperature and sky in the status pill, from Open-Meteo
     (free, no key). The place comes from the screen's IP address
     (geojs.io), kept 7 days; Paris if it can't be found.
   - Rain or snow: on arriving Home, drops or flakes fall over the
     Top Shelf for 40 seconds, then stop. Two layers drawn once and
     moved by the compositor (transform only): nothing is redrawn.
   Settings › Appearance › Living Home Screen turns each part off.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var LOC_KEY = "apl.loc", WX_KEY = "apl.wx";
    var LOC_TTL = 7 * 86400000, WX_TTL = 20 * 60000, FX_MS = 40000;
    var PARIS = { lat: 48.85, lon: 2.35, city: "Paris" };
    var tintEl = null, fxEl = null, wxEl = null, phase = "", wx = null, fxTimer = null;

    function load(k) { try { return JSON.parse(global.localStorage.getItem(k) || "null"); } catch (e) { return null; } }
    function save(k, v) { try { global.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function getJson(url) {
        return global.fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    }

    /* ---------- where the screen is ---------- */
    function place() {
        var c = load(LOC_KEY);
        if (c && Date.now() - c.t < LOC_TTL) return Promise.resolve(c);
        if (sys.PREVIEW) return Promise.resolve(PARIS);
        return getJson("https://get.geojs.io/v1/ip/geo.json").then(function (g) {
            var lat = parseFloat(g.latitude), lon = parseFloat(g.longitude);
            if (isNaN(lat) || isNaN(lon)) throw new Error("no place");
            var p = { lat: lat, lon: lon, city: g.city || "", t: Date.now() };
            save(LOC_KEY, p);
            return p;
        }).catch(function () { return c || PARIS; });
    }

    /* ---------- the sun (accurate to a few minutes: enough for a colour) ---------- */
    function sun(d, lat, lon) {
        var day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
        var decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + day) / 365);
        var x = -Math.tan(lat * Math.PI / 180) * Math.tan(decl);
        var half = x <= -1 ? 12 : x >= 1 ? 0 : Math.acos(x) * 12 / Math.PI;
        var noon = 12 - d.getTimezoneOffset() / 60 - lon / 15;
        return { rise: noon - half, set: noon + half };
    }
    function phaseNow(p) {
        var d = new Date(), s = sun(d, p.lat, p.lon), h = d.getHours() + d.getMinutes() / 60;
        if (h >= s.rise - 0.6 && h < s.rise + 0.9) return "dawn";
        if (h >= s.set - 1.2 && h < s.set + 0.7) return "golden";
        if (h >= s.rise + 0.9 && h < s.set - 1.2) return "day";
        return "night";
    }

    function applyTint(p) {
        if (!tintEl) return;
        var next = sys.pref("ambient") ? phaseNow(p) : "off";
        if (next === phase) return;
        phase = next;
        tintEl.className = "ambient ambient--" + next;
    }

    /* ---------- weather ---------- */
    /* WMO weather codes (Open-Meteo) -> icon and effect */
    function sky(code, isDay) {
        if (code === 0 || code === 1) return { icon: isDay ? "sun" : "moon", fx: "" };
        if (code === 2) return { icon: isDay ? "sunCloud" : "cloud", fx: "" };
        if (code === 3) return { icon: "cloud", fx: "" };
        if (code === 45 || code === 48) return { icon: "fog", fx: "" };
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { icon: "rain", fx: "rain" };
        if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "snow", fx: "snow" };
        if (code >= 95) return { icon: "storm", fx: "rain" };
        return { icon: "cloud", fx: "" };
    }

    function weather(p) {
        var c = load(WX_KEY);
        if (c && Date.now() - c.t < WX_TTL && Math.abs(c.lat - p.lat) < 0.01) return Promise.resolve(c);
        if (sys.PREVIEW) {
            var demo = { temp: 11, code: 61, day: 1, t: Date.now(), lat: p.lat };
            return Promise.resolve(demo);
        }
        return getJson("https://api.open-meteo.com/v1/forecast?latitude=" + p.lat.toFixed(3) + "&longitude=" + p.lon.toFixed(3) +
                       "&current=temperature_2m,weather_code,is_day&timezone=auto").then(function (j) {
            var cur = j.current || {};
            var w = { temp: Math.round(cur.temperature_2m), code: cur.weather_code, day: cur.is_day, t: Date.now(), lat: p.lat };
            save(WX_KEY, w);
            return w;
        }).catch(function () { return c; });
    }

    function paintWeather() {
        if (!wxEl) return;
        if (!sys.pref("weather") || !wx || isNaN(wx.temp)) { wxEl.style.display = "none"; return; }
        var k = sky(wx.code, wx.day !== 0);
        wxEl.style.display = "";
        wxEl.innerHTML = APL.icon(k.icon, 30, 2) + "<span>" + wx.temp + "°</span>";
    }

    /* ---------- rain and snow ---------- */
    function svg(body, size) {
        return "url(\"data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '">' + body + "</svg>") + "\")";
    }
    function drops(n, size, len, alpha, seed) {
        var out = "", r = seed;
        for (var i = 0; i < n; i++) {
            r = (r * 9301 + 49297) % 233280; var x = Math.round(r / 233280 * size);
            r = (r * 9301 + 49297) % 233280; var y = Math.round(r / 233280 * size);
            out += '<path d="M' + x + " " + y + "l-2 " + len + '"/>';
        }
        return '<g stroke="rgba(205,222,255,' + alpha + ')" stroke-width="1.7" stroke-linecap="round">' + out + "</g>";
    }
    function flakes(n, size, rad, alpha, seed) {
        var out = "", r = seed;
        for (var i = 0; i < n; i++) {
            r = (r * 9301 + 49297) % 233280; var x = Math.round(r / 233280 * size);
            r = (r * 9301 + 49297) % 233280; var y = Math.round(r / 233280 * size);
            r = (r * 9301 + 49297) % 233280; var s = (rad * (0.55 + r / 233280 * 0.9)).toFixed(1);
            out += '<circle cx="' + x + '" cy="' + y + '" r="' + s + '"/>';
        }
        return '<g fill="rgba(255,255,255,' + alpha + ')">' + out + "</g>";
    }
    function buildFx(kind) {
        fxEl.innerHTML = "";
        fxEl.setAttribute("data-kind", kind);
        var specs = kind === "snow"
            ? [{ size: 220, art: flakes(14, 220, 3, 0.75, 7), cls: "a" }, { size: 340, art: flakes(10, 340, 4.6, 0.55, 13), cls: "b" }]
            : [{ size: 180, art: drops(14, 180, 22, 0.32, 3), cls: "a" }, { size: 260, art: drops(10, 260, 30, 0.22, 11), cls: "b" }];
        specs.forEach(function (sp) {
            var l = document.createElement("div");
            l.className = "weatherfx__layer weatherfx__layer--" + sp.cls;
            l.style.backgroundImage = svg(sp.art, sp.size);
            l.style.height = (1080 + sp.size) + "px";
            l.style.top = (-sp.size) + "px";
            l.style.setProperty("--fall", sp.size + "px");
            fxEl.appendChild(l);
        });
    }
    function playFx() {
        if (!fxEl) return;
        clearTimeout(fxTimer);
        fxEl.classList.remove("is-on");
        var k = wx ? sky(wx.code, wx.day !== 0).fx : "";
        if (!k || !sys.pref("weatherFx") || !sys.pref("weather") || sys.pref("reduceMotion")) return;
        if (fxEl.getAttribute("data-kind") !== k) buildFx(k);
        void fxEl.offsetWidth;
        fxEl.classList.add("is-on");
        fxTimer = setTimeout(function () { fxEl.classList.remove("is-on"); }, document.documentElement.classList.contains("lite") ? 12000 : FX_MS);
    }

    /* ---------- start ---------- */
    var where = PARIS;
    function refresh(withFx) {
        place().then(function (p) {
            where = p;
            applyTint(p);
            if (!sys.pref("weather")) { wx = null; paintWeather(); return; }
            return weather(p).then(function (w) {
                var had = wx;
                wx = w;
                paintWeather();
                if (withFx || (!had && w)) playFx();
            });
        });
    }

    function start() {
        if (tintEl) return;
        var scrim = document.querySelector(".scrim");
        tintEl = document.createElement("div");
        tintEl.className = "ambient";
        fxEl = document.createElement("div");
        fxEl.className = "weatherfx";
        if (scrim && scrim.parentNode) {
            scrim.parentNode.insertBefore(fxEl, scrim.nextSibling);
            scrim.parentNode.insertBefore(tintEl, scrim.nextSibling);
        }
        var status = document.querySelector(".status");
        if (status) {
            wxEl = document.createElement("span");
            wxEl.className = "status__wx";
            wxEl.style.display = "none";
            status.insertBefore(wxEl, status.firstChild);
        }
        refresh(true);
        setInterval(function () { applyTint(where); }, 60000);
        setInterval(function () { if (!document.hidden) refresh(false); }, WX_TTL);
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) { clearTimeout(fxTimer); if (fxEl) fxEl.classList.remove("is-on"); return; }
            refresh(true);                     // back Home: the weather again, for a few seconds
        });
        ["ambient", "weather", "weatherFx"].forEach(function (k) {
            sys.onPref(k, function () { phase = ""; refresh(k !== "ambient"); });
        });
    }

    var prev = APL.onHomeReady;
    APL.onHomeReady = function () { if (prev) prev(); start(); };
    APL.ambient = {
        refresh: function () { refresh(true); },
        now: function () { return wx ? { temp: wx.temp, icon: sky(wx.code, wx.day !== 0).icon, city: where.city || "" } : null; },
        phase: function () { return phase; }
    };
})(window);
