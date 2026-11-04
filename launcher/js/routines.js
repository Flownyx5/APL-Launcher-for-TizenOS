/* ============================================================
   routines.js — "Good Night" and Kids Mode.

   Good Night (Control Center, or Settings › Routines), one press:
     sleep timer (30 min by default), backlight lowered, Do Not
     Disturb, screen saver "Clock on black". Pressed again before
     the end: everything goes back as it was. The next morning
     (the launcher starting again after the timer), it goes back too.

   Kids Mode (per profile, Settings › Routines › Kids Mode):
     the Home Screen shows only the apps chosen for that profile,
     and Settings, the other profiles, the "hold OK" menu, the search
     and the phone remote ask for the 4-digit PIN. It is a fence for
     young children, not a lock: the screen's own Parental Controls
     (Samsung Settings) are the real protection.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;

    /* ---------- PIN pad ---------- */
    var pinRoot, pinTitle, pinDots, pinNav, pinSpec = null, entered = "";

    function el(tag, cls, html) { var e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; }
    /* A hash so the PIN isn't stored as is (FNV-1a): enough for a fence, not a safe. */
    function hash(pin) {
        var h = 0x811c9dc5, s = "apl-kids:" + pin;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul ? Math.imul(h, 0x01000193) : (h * 0x01000193) | 0; }
        return (h >>> 0).toString(16);
    }

    function buildPin() {
        pinRoot = el("section", "pin");
        var box = el("div", "pin__box");
        pinTitle = el("h2", "pin__title");
        pinDots = el("div", "pin__dots", "<i></i><i></i><i></i><i></i>");
        var pad = el("div", "pin__pad");
        var keys = [];
        "123456789 0<".split("").forEach(function (c) {
            var k = el("div", "pin__key" + (c === " " ? " is-blank" : ""));
            if (c === "<") k.innerHTML = APL.icon("backspace", 40, 2);
            else k.textContent = c === " " ? "" : c;
            k._c = c;
            pad.appendChild(k);
            if (c !== " ") keys.push(k);
        });
        box.appendChild(pinTitle); box.appendChild(pinDots); box.appendChild(pad);
        pinRoot.appendChild(box);
        document.body.appendChild(pinRoot);
        pinNav = new APL.Nav({
            onSelect: function (i, k) { press(k._c); },
            onBack: function () { var s = pinSpec; closePin(); if (s && s.cancel) s.cancel(); },
            onKey: function (code, e) {
                if (code >= 48 && code <= 57) { press(String(code - 48)); return true; }   // the remote's numbers
                if (code === 8 && entered) { press("<"); return true; }
                return false;
            }
        });
        pinNav.setTiles(keys);
    }
    function paintDots() {
        var d = pinDots.children;
        for (var i = 0; i < 4; i++) d[i].classList.toggle("is-on", i < entered.length);
    }
    function press(c) {
        if (c === "<") { entered = entered.slice(0, -1); paintDots(); return; }
        if (entered.length >= 4) return;
        entered += c;
        paintDots();
        if (entered.length < 4) return;
        var pin = entered, spec = pinSpec;
        setTimeout(function () {
            if (spec !== pinSpec) return;
            if (spec.check(pin)) { closePin(); spec.done(pin); return; }
            pinDots.classList.remove("is-wrong"); void pinDots.offsetWidth; pinDots.classList.add("is-wrong");
            entered = ""; paintDots();
        }, 160);
    }
    /* spec: { title, check(pin) -> bool, done(pin), cancel() } */
    function askPin(spec) {
        if (!pinRoot) buildPin();
        pinSpec = spec;
        entered = "";
        pinTitle.textContent = spec.title;
        paintDots();
        pinDots.classList.remove("is-wrong");
        pinRoot.classList.add("is-open");
        APL.pushNav(pinNav);
        pinNav.focus(4);                       // "5", in the middle
    }
    function closePin() {
        if (!pinSpec) return;
        pinSpec = null;
        pinRoot.classList.remove("is-open");
        APL.popNav(pinNav);
    }

    /* The PIN asked before a protected action (nothing asked outside Kids Mode). */
    function guard(run) {
        if (!kidsActive()) { run(); return; }
        askPin({ title: APL.t("Enter the parent PIN"), check: function (p) { return hash(p) === sys.pref("kidsPin"); }, done: run });
    }
    /* A new PIN, typed twice. */
    function newPin(done) {
        askPin({ title: APL.t("Choose a 4-digit parent PIN"), check: function () { return true; }, done: function (first) {
            askPin({ title: APL.t("Type it again"), check: function (p) { return p === first; }, done: function () {
                sys.setPref("kidsPin", hash(first));
                APL.toast(APL.t("PIN saved"), true);
                if (done) done();
            } });
        } });
    }

    /* ---------- Kids Mode ---------- */
    var KID_DEFAULT = /^(youtubekids|disneyplus)$/;
    function kidsActive() { return !!sys.pref("kidsMode"); }
    function allowedIds() {
        var list = sys.pref("kidsApps") || [];
        if (list.length) return list;
        return ((APL.allApps && APL.allApps()) || []).filter(function (a) { return a.key && KID_DEFAULT.test(a.key); }).map(function (a) { return a.id; });
    }
    function allowed(app) { return allowedIds().indexOf(app.id) !== -1; }

    function setKids(on) {
        function apply() {
            sys.setPref("kidsMode", on);
            if (APL.reloadApps) APL.reloadApps();
            APL.toast(on ? APL.t("Kids Mode on for {name}", { name: sys.profiles.current().name })
                         : APL.t("Kids Mode off for {name}", { name: sys.profiles.current().name }));
            if (APL.settings && APL.settings.isOpen()) APL.settings.close();
        }
        if (on && !sys.pref("kidsPin")) { newPin(apply); return; }
        apply();                               // turning it off: Settings were already behind the PIN
    }
    function toggleApp(id) {
        var list = allowedIds().slice(), at = list.indexOf(id);
        if (at === -1) list.push(id); else list.splice(at, 1);
        sys.setPref("kidsApps", list);
        if (APL.reloadApps) APL.reloadApps();
    }

    /* Settings, the other profiles: behind the PIN in Kids Mode */
    function wrap() {
        if (APL.settings && !APL.settings._kids) {
            var openSettings = APL.settings.open;
            APL.settings.open = function (section) { guard(function () { openSettings(section); }); };
            APL.settings._kids = true;
        }
        var P = sys.profiles;
        if (!P._kids) {
            var switchTo = P.switchTo;
            P.switchTo = function (id) {
                if (!kidsActive()) { switchTo(id); return; }
                guard(function () { switchTo(id); });
            };
            P._kids = true;
        }
    }

    /* ---------- Good Night ---------- */
    function nightState() { return sys.pref("nightState"); }
    function nightOn() { var s = nightState(); return !!(s && s.until > Date.now()); }

    function setBacklight(target) {
        return sys.tvItem("backlight").then(function (it) {
            if (!it || !it.writable) throw new Error(APL.t("Brightness unavailable right now"));
            var now = it.target !== undefined ? it.target : it.value;
            return sys.tvAdjust("backlight", target - now).then(function () { return now; });
        });
    }

    function nightFx() {
        if (sys.pref("reduceMotion")) return;
        var fx = el("div", "nightfx", '<div class="nightfx__moon">' + APL.icon("moon", 160, 1.4) + '</div><div class="nightfx__txt"></div>');
        fx.lastChild.textContent = APL.t("Good night");
        document.body.appendChild(fx);
        void fx.offsetWidth;
        fx.classList.add("is-on");
        setTimeout(function () { fx.classList.remove("is-on"); }, 2200);
        setTimeout(function () { if (fx.parentNode) fx.parentNode.removeChild(fx); }, 3200);
    }

    function goodNight() {
        if (nightOn()) { morning(true); return; }
        var minutes = sys.pref("nightMinutes") || 30;
        var state = { at: Date.now(), until: Date.now() + minutes * 60000, dnd: sys.pref("dnd"), style: sys.pref("screensaverStyle"), backlight: null };
        sys.setPref("nightState", state);
        sys.armSleepTimer(minutes);
        sys.setPref("dnd", true);
        sys.setPref("screensaverStyle", "dark");
        nightFx();
        setBacklight(sys.pref("nightBacklight")).then(function (prev) {
            state.backlight = prev;
            sys.setPref("nightState", state);
        }, function () {});
        if (APL.controlCenter && APL.controlCenter.isOpen()) APL.controlCenter.close();
        setTimeout(function () { APL.toast(APL.t("Good night: sleep in {n} min, brightness lowered. Press again to cancel.", { n: minutes })); }, 1400);
    }

    /* Everything back as before (cancelled, or the next start-up after the night) */
    function morning(cancelled) {
        var s = nightState();
        if (!s) return;
        sys.setPref("nightState", null);
        sys.setPref("dnd", !!s.dnd);
        if (s.style) sys.setPref("screensaverStyle", s.style);
        if (s.backlight !== null && s.backlight !== undefined) setBacklight(s.backlight).catch(function () {});
        if (cancelled) {
            sys.armSleepTimer(0);
            APL.toast(APL.t("Good Night cancelled"), true);
        }
    }

    var prev = APL.onHomeReady;
    APL.onHomeReady = function () {
        if (prev) prev();
        wrap();
        var s = nightState();
        if (s && s.until < Date.now()) morning(false);
    };

    APL.kids = {
        active: kidsActive, allowed: allowed, allowedIds: allowedIds, set: setKids, toggleApp: toggleApp,
        changePin: function () { guard(function () { newPin(); }); }, guard: guard
    };
    APL.routines = { goodNight: goodNight, nightOn: nightOn };
})(window);
