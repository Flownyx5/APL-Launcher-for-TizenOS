/* ============================================================
   settings.js — the Settings app, Apple TV–style split view:
   large icon on the left (+ description of the selected row),
   list on the right, selected row in white, values on the right.
   OK enters a submenu / changes a value; Back goes up a level.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var root, titleEl, cardEl, descEl, pathEl, listEl, wrapEl, nav;
    var levels = [];
    var listY = 0;
    var isOpen = false;

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }

    function buildDom() {
        root = el("section", "settings");
        root.appendChild(el("div", "settings__bg"));
        titleEl = el("h1", "settings__title");
        var hero = el("div", "settings__hero");
        cardEl = el("div", "settings__card");
        descEl = el("p", "settings__desc");
        pathEl = el("p", "settings__path");
        hero.appendChild(cardEl); hero.appendChild(descEl); hero.appendChild(pathEl);
        var wrap = wrapEl = el("div", "settings__listwrap");
        listEl = el("div", "settings__list");
        wrap.appendChild(listEl);
        root.appendChild(titleEl); root.appendChild(hero); root.appendChild(wrap);
        document.body.appendChild(root);

        nav = new APL.Nav({
            onFocus: onFocus,
            onSelect: onSelect,
            onBack: back,
            onKey: onKey
        });
    }

    function cur() { return levels[levels.length - 1]; }

    /* ---------- values shown on the right ---------- */
    function onOff(v) { return v ? APL.t("On") : APL.t("Off"); }

    /* Without Vetro on the screen (sys.noVetro), the screen's own settings and what closes apps can't work:
       their rows say so instead of "Unavailable" a minute later, or a switch that does nothing. */
    var VETRO_TYPES = { tv: true, tvmode: true, game: true, native: true, service: true };
    function needsVetro(item) { return !!item && sys.noVetro() && (VETRO_TYPES[item.type] || item.vetro === true); }

    function valueHtml(item) {
        switch (item.type) {
            case "info": return item.get();
            case "toggle": return onOff(sys.pref(item.key));
            case "choice":
                var v = sys.pref(item.key);
                for (var i = 0; i < item.options.length; i++) if (item.options[i][0] === v) return item.options[i][1];
                return String(v);
            case "volume":
                var vol = sys.audio.getVolume();
                return '<span class="srow__bar"><i style="width:' + vol + '%"></i></span>' + vol;
            case "mute": return onOff(sys.audio.isMute());
            case "hide": return (sys.pref("hiddenApps").indexOf(item.id) === -1) ? APL.t("Visible") : APL.t("Hidden");
            case "tvmode":
                return sys.tvItem("pictureMode").then(function (it) { return it ? sys.pictureModeName(it.value) : APL.t("Unavailable"); },
                                                      function () { return APL.t("Unavailable"); });
            case "game":
                return sys.game.get().then(function (g) { return onOff(g.on); }, function () { return APL.t("Unavailable"); });
            case "flag": return sys.pref("aerialHidden").indexOf(item.token) === -1 ? APL.t("Show") : APL.t("Hide");
            case "service": return APL.services.isCut(item.group) ? APL.t("Blocked") : APL.t("Active");
            case "native":
                return sys.native.get(item.id).then(function (n) { return nativeText(item, n); }, function () { return APL.t("Unavailable"); });
            case "check": return item.get() ? (item.onText || APL.t("On")) : (item.offText || APL.t("Off"));
            default: return item.value ? item.value() : "";
        }
    }

    /* Screen setting: a slider, or the list of its values. */
    function nativeText(item, n) {
        if (item.options) {
            for (var i = 0; i < item.options.length; i++) if (item.options[i][0] === n) return item.options[i][1];
            return String(n);
        }
        var d = sys.native.info(item.id);
        var pct = Math.round(100 * (n - d.min) / Math.max(1, d.max - d.min));
        return '<span class="srow__bar"><i style="width:' + pct + '%"></i></span>' + (item.format ? item.format(n) : n);
    }
    function nativeChoice(item, row) {
        var L = cur();
        sys.native.get(item.id).then(function (n) {
            // Two values: OK switches straight from one to the other
            if (item.options.length === 2) {
                var next = item.options[0][0] === n ? item.options[1] : item.options[0];
                // The other screen settings of the menu too: one switch can change another (Start on APL Launcher, Autorun)
                var slot = row.querySelector(".srow__value");
                if (slot) slot.textContent = "…";                         // the screen is being asked: shown at once
                sys.native.set(item.id, next[0]).then(function () { refreshNativeRows(row); },
                                                      function (e) { APL.toast(e.message); refreshNativeRows(row); });
                return;
            }
            var at = 0;
            var opts = item.options.map(function (o, k) {
                if (o[0] === n) at = k;
                return { type: "nativeoption", id: item.id, label: o[1], v: o[0], selected: o[0] === n, desc: item.desc };
            });
            levels.push({ node: { label: item.label, icon: L.node.icon, children: opts }, index: at });
            render("fwd");
        }, function (e) { APL.toast(e.message); });
    }
    /* Slider: the value shown changes right away, the write goes out after the last key press. */
    var nativeTimer = null;
    function nativeSlide(item, row, direction) {
        var d = sys.native.info(item.id), slot = row.querySelector(".srow__value");
        function step(steps) {
            item._value = Math.max(d.min, Math.min(d.max, item._value + steps * (d.step || 1)));
            slot.innerHTML = nativeText(item, item._value);
            clearTimeout(nativeTimer);
            nativeTimer = setTimeout(function () {
                sys.native.set(item.id, item._value).catch(function (e) {
                    APL.toast(e.message);
                    item._value = undefined;
                    fillValue(row);
                });
            }, 350);
        }
        if (item._value !== undefined) { step(direction); return; }
        // Value not read yet: key presses add up while waiting for the screen's answer
        item._steps = (item._steps || 0) + direction;
        if (item._reading) return;
        item._reading = true;
        sys.native.get(item.id).then(function (v) {
            var steps = item._steps;
            item._reading = false;
            item._steps = 0;
            item._value = v;
            step(steps);
        }, function (e) { item._reading = false; item._steps = 0; APL.toast(e.message); });
    }

    function accessory(item) {
        if (needsVetro(item)) return "";
        if (item.type === "menu" || item.type === "choice" || item.type === "tvmode" || (item.type === "native" && item.options && item.options.length > 2)) return APL.icon("chevron", 26, 2.4);
        if (item.type === "nativeoption" && item.selected) return APL.icon("check", 28, 2.6);
        if (item.type === "samsung") return APL.icon("external", 24, 2);
        if ((item.type === "option" || item.type === "tvoption") && item.selected) return APL.icon("check", 28, 2.6);
        return "";
    }

    function tvHtml(item, v) {
        if (v === null || v === undefined) return APL.t("Unavailable");
        var it = item._meta || { min: 0, max: 50 };
        var pct = Math.round(100 * (v - it.min) / Math.max(1, it.max - it.min));
        return '<span class="srow__bar"><i style="width:' + pct + '%"></i></span>' + v;
    }

    function fillValue(row) {
        var item = row._item;
        if (needsVetro(item)) { row.querySelector(".srow__value").textContent = APL.t("Needs Vetro"); return; }
        if (item.type === "tv") {
            var slot0 = row.querySelector(".srow__value");
            slot0.textContent = "…";
            sys.tvItem(item.id).then(function (it) {
                item._meta = it;
                slot0.innerHTML = tvHtml(item, it ? (it.target !== undefined ? it.target : it.value) : null);
            }, function () { slot0.textContent = APL.t("Unavailable"); });
            return;
        }
        var v = valueHtml(item);
        var slot = row.querySelector(".srow__value");
        if (v && typeof v.then === "function") {
            slot.textContent = "…";
            v.then(function (txt) { slot.innerHTML = txt; });
        } else {
            slot.innerHTML = v === undefined || v === null ? "" : v;
        }
    }

    function makeRow(item) {
        var row = el("div", "srow" + (item.type === "info" ? " srow--info" : ""));
        row._item = item;
        row.appendChild(el("span", "srow__label", ""));
        row.firstChild.textContent = item.label;
        row.appendChild(el("span", "srow__value"));
        row.appendChild(el("span", "srow__acc", accessory(item)));
        fillValue(row);
        return row;
    }

    function render(enterDir) {
        var L = cur(), node = L.node;
        titleEl.textContent = node.label;
        // Top level of Settings: Apple's large Settings icon, as on tvOS.
        if (levels.length === 1) {
            // Apple's real Settings icon (fallback: the drawn version)
            var src = global.APL_ASSET ? global.APL_ASSET("images/settings-icon.png") : "images/settings-icon.png";
            cardEl.innerHTML = '<img class="settings__appicon" alt="" src="' + src + '">';
            cardEl.firstChild.onerror = function () { cardEl.innerHTML = APL.settingsArt(430); };
        } else {
            cardEl.innerHTML = APL.icon(node.icon || "gear", 250, 1.3);
        }
        cardEl.classList.toggle("is-app", levels.length === 1);
        listEl.innerHTML = "";
        listY = 0;
        listEl.style.transform = "translateY(0)";
        // Section titles ("VIDEO", "AUDIO"…): shown, never selectable
        var rows = [];
        node.children.forEach(function (item) {
            if (item.type === "section") {
                var h = el("div", "srow__section");
                h.textContent = item.label;
                listEl.appendChild(h);
                return;
            }
            var r = makeRow(item);
            listEl.appendChild(r);
            rows.push(r);
        });
        // Entry animation on the container: the list keeps its own
        // transform for scrolling (otherwise the animation blocks it).
        if (enterDir) {
            wrapEl.classList.remove("is-enter-fwd", "is-enter-back");
            void wrapEl.offsetWidth;
            wrapEl.classList.add(enterDir === "back" ? "is-enter-back" : "is-enter-fwd");
        }
        var want = L.index || 0;        // setTiles refocuses the 1st row: keep the position we want
        nav.setTiles(rows);
        nav.focus(Math.min(want, rows.length - 1));
    }

    /* ---------- focus ---------- */
    function ensureVisible(row) {
        // Margins to stay out of the list's top / bottom fade zones.
        // Read once per row (a row never moves inside its list): reading it right after the focus
        // change made the screen work out the whole page's style and layout on every key
        if (!row._top) { row._top = row.offsetTop; row._h = row.offsetHeight; }
        var view = 880, top = row._top, h = row._h;
        if (top + listY < 30) listY = -top + 30;
        else if (top + h + listY > view - 80) listY = view - 80 - top - h;
        listEl.style.transform = "translateY(" + listY + "px)";
    }

    function onFocus(i, row) {
        cur().index = i;
        ensureVisible(row);
        var item = row._item;
        descEl.textContent = item.desc || (item.type === "menu" ? "" : "");
        pathEl.style.display = "none";
    }

    function refreshRow(row) { fillValue(row); row.querySelector(".srow__acc").innerHTML = accessory(row._item); }
    function refreshNativeRows(row) {
        var rows = row.parentNode ? row.parentNode.children : [row];
        for (var i = 0; i < rows.length; i++) if (rows[i]._item && rows[i]._item.type === "native") refreshRow(rows[i]);
    }

    function onSelect(i, row) {
        var item = row._item, L = cur();
        if (needsVetro(item)) { APL.toast(APL.t("This needs Vetro, which isn't on this screen.")); return; }
        switch (item.type) {
            case "menu":
                L.index = i;
                levels.push({ node: item, index: 0 });
                render("fwd");
                break;
            case "choice":
                L.index = i;
                var sel = sys.pref(item.key), selIndex = 0;
                var opts = item.options.map(function (o, k) {
                    if (o[0] === sel) selIndex = k;
                    return { type: "option", label: o[1], v: o[0], key: item.key, apply: item.apply, selected: o[0] === sel, desc: item.desc };
                });
                levels.push({ node: { label: item.label, icon: L.node.icon, children: opts }, index: selIndex });
                render("fwd");
                break;
            case "option":
                sys.setPref(item.key, item.v);
                if (item.apply) item.apply(item.v);
                back();
                break;
            case "toggle":
                sys.setPref(item.key, !sys.pref(item.key));
                refreshRow(row);
                break;
            case "flag":
                var off = sys.pref("aerialHidden").slice(), at = off.indexOf(item.token);
                if (at === -1) off.push(item.token); else off.splice(at, 1);
                sys.setPref("aerialHidden", off);
                refreshRow(row);
                break;
            case "mute":
                sys.audio.setMute(!sys.audio.isMute());
                refreshRow(row);
                break;
            case "hide":
                var hidden = sys.pref("hiddenApps").slice();
                var k = hidden.indexOf(item.id);
                if (k === -1) hidden.push(item.id); else hidden.splice(k, 1);
                sys.setPref("hiddenApps", hidden);
                refreshRow(row);
                if (APL.reloadApps) APL.reloadApps();
                break;
            case "samsung":
                sys.openSamsungSettings().catch(function (e) { APL.toast(e.message); });
                break;
            case "tvmode":
                L.index = i;
                sys.tvItem("pictureMode").then(function (it) {
                    var curMode = it ? it.value : null, at = 0;
                    var modes = sys.PICTURE_MODES.map(function (m, n) {
                        if (m[0] === curMode) at = n;
                        return { type: "tvoption", label: m[1], v: m[0], selected: m[0] === curMode, desc: item.desc };
                    });
                    levels.push({ node: { label: item.label, icon: L.node.icon, children: modes }, index: at });
                    render("fwd");
                }, function (e) { APL.toast(e.message); });
                break;
            case "tvoption":
                sys.setPictureMode(item.v).then(function () {
                    APL.toast(APL.t("Picture Mode: {mode}", { mode: item.label }), true);
                    back();
                }, function (e) { APL.toast(e.message); });
                break;
            case "game":
                sys.game.get().then(function (g) {
                    return sys.game.set(!g.on);
                }).then(function (g) {
                    APL.toast(g.pending ? APL.t("Game Mode requested: it will turn on as soon as you switch to HDMI or USB-C")
                                        : (g.on ? APL.t("Game Mode on") : APL.t("Game Mode off")), true);
                    refreshRow(row);
                }, function (e) { APL.toast(e.message); });
                break;
            case "native":
                L.index = i;
                if (item.options) nativeChoice(item, row);
                break;
            case "nativeoption":
                sys.native.set(item.id, item.v).then(function () { back(); }, function (e) { APL.toast(e.message); });
                break;
            case "service":
                APL.services.toggle(item.group).then(function () { refreshRow(row); });
                break;
            case "action":
                item.run();
                if (item.value) setTimeout(function () { if (row.parentNode) refreshRow(row); }, 400);
                break;
            case "check":
                item.set(!item.get());
                refreshRow(row);
                break;
            default: break;
        }
    }

    function onKey(code) {
        var row = nav.current();
        // A slider of the screen's settings without Vetro: ◀ ▶ do nothing (no request that can't be answered)
        if (row && (row._item.type === "native" || row._item.type === "tv") && needsVetro(row._item) &&
            (code === APL.KEY.LEFT || code === APL.KEY.RIGHT)) return true;
        if (row && row._item.type === "native" && !row._item.options && (code === APL.KEY.LEFT || code === APL.KEY.RIGHT)) {
            nativeSlide(row._item, row, code === APL.KEY.RIGHT ? 1 : -1);
            return true;
        }
        if (row && row._item.type === "tv" && (code === APL.KEY.LEFT || code === APL.KEY.RIGHT)) {
            var item = row._item;
            sys.tvAdjust(item.id, code === APL.KEY.RIGHT ? 1 : -1, function (nv) {
                row.querySelector(".srow__value").innerHTML = tvHtml(item, nv);
            }).catch(function (e) { APL.toast(e.message); });
            return true;
        }
        if (!row || row._item.type !== "volume") return false;
        if (code === APL.KEY.LEFT || code === APL.KEY.RIGHT) {
            sys.audio.setVolume(sys.audio.getVolume() + (code === APL.KEY.RIGHT ? 1 : -1));
            fillValue(row);
            return true;
        }
        return false;
    }

    function back() {
        if (levels.length > 1) { levels.pop(); render("back"); }
        else close();
    }

    /* ---------- open / close ---------- */
    /* sectionLabel: the English name of a top-level menu ("Connection"), translated or not. */
    function open(sectionLabel) {
        if (!root) buildDom();
        levels = [{ node: APL.settingsTree(), index: 0 }];
        if (sectionLabel) {
            var kids = levels[0].node.children;
            for (var i = 0; i < kids.length; i++) {
                if ((kids[i].label === sectionLabel || kids[i].label === APL.t(sectionLabel)) && kids[i].type === "menu") {
                    levels[0].index = i;
                    levels.push({ node: kids[i], index: 0 });
                    break;
                }
            }
        }
        render();
        // Performance mode: background = pre-blurred artwork of the selected app (no live blur).
        var bl = document.getElementById("bgBlur"), bgEl = root.firstChild;
        bgEl.style.background = (document.body.classList.contains("perf") && bl && bl.style.background)
            ? "linear-gradient(160deg, rgba(36,84,168,0.62), rgba(10,26,66,0.86)), " + bl.style.background
            : "";
        root.classList.add("is-open");
        document.body.classList.add("has-settings");
        APL.pushNav(nav);
        isOpen = true;
    }

    function close() {
        if (!root) return;
        root.classList.remove("is-open");
        document.body.classList.remove("has-settings");
        APL.popNav(nav);
        isOpen = false;
    }

    APL.settings = { open: open, close: close, isOpen: function () { return isOpen; } };
})(window);
