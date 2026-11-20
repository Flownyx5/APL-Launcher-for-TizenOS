/* ============================================================
   search.js — Search, the Apple TV way.

   A field at the top, the matching apps below, updated at every letter.
   Typing is the screen's own keyboard (Samsung's, with its languages and
   accents): it opens on the field when Search opens, and again with OK on
   the field. Done or ▼ goes down to the apps, OK on an app opens it. The
   remote's digits and a keyboard (PC preview) type too. Opened with ▲ from
   the full screen Top Shelf (▲ from the dock, then ▲ again), or from the
   Control Center. A magnifier at the top left of the Home Screen, across
   from the status pill, shows it's up there; in full screen it reads
   "▲ Search". Apps only for now: those in folders too, and the hidden ones
   with Settings › Home Screen › Search Hidden Apps.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, K = APL.KEY;
    /* The screen's keyboard: Done and Cancel (Tizen IME), besides OK/Enter and Back/Esc. */
    var IME_DONE = 65376, IME_CANCEL = 65385, BACK = 10009, ESC = 27;
    var root, fieldEl, resultsEl, emptyEl, nav;
    var isOpen = false, found = [];

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    /* Lowercase, without accents: "é" finds "e", "Arte" finds "arte". */
    function norm(s) {
        s = String(s || "").toLowerCase();
        return s.normalize ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : s;
    }

    function candidates() {
        var hidden = APL.sys.pref("searchHidden") ? [] : APL.sys.pref("hiddenApps") || [];
        return ((APL.allApps && APL.allApps()) || []).filter(function (a) {
            return !a.folder && hidden.indexOf(a.id) === -1;
        });
    }
    /* The name's start first, then the start of a word in it, then anywhere. Nothing typed: the recent apps. */
    function match(q) {
        var all = candidates();
        if (!q) {
            var recent = APL.sys.pref("recentApps") || [];
            return recent.map(function (id) { return all.filter(function (a) { return a.id === id; })[0]; }).filter(Boolean);
        }
        var start = [], word = [], inside = [];
        all.forEach(function (a) {
            var n = norm(a.name), at = n.indexOf(q);
            if (at === 0) start.push(a);
            else if (at > 0 && (" " + n).indexOf(" " + q) !== -1) word.push(a);
            else if (at > 0) inside.push(a);
        });
        return start.concat(word, inside);
    }

    function buildDom() {
        root = el("section", "search");
        root.appendChild(el("div", "search__dim"));
        // A real field: focusing it opens the screen's keyboard (navigation.js leaves its keys alone)
        fieldEl = el("input", "search__field");
        fieldEl.type = "text";
        fieldEl.maxLength = 30;
        fieldEl.placeholder = APL.t("Search");
        fieldEl.setAttribute("autocomplete", "off");
        fieldEl.setAttribute("spellcheck", "false");
        resultsEl = el("div", "search__results");
        emptyEl = el("p", "search__empty");
        root.appendChild(fieldEl); root.appendChild(resultsEl); root.appendChild(emptyEl);
        document.body.appendChild(root);

        fieldEl.addEventListener("input", refresh);
        fieldEl.addEventListener("keydown", function (e) {
            var c = e.keyCode;
            if (c === K.ENTER || c === IME_DONE || (c === K.DOWN && found.length)) { e.preventDefault(); e.stopPropagation(); done(); }
            else if (c === IME_CANCEL || c === BACK || c === ESC) {
                e.preventDefault(); e.stopPropagation();
                if (fieldEl.value) done(); else close();
            }
        });
        // The keyboard closed some other way: back to the remote, on the field
        fieldEl.addEventListener("blur", function () { root.classList.remove("is-typing"); });

        nav = new APL.Nav({
            onSelect: function (i) {
                var t = nav.tiles[i];
                if (t === fieldEl) { type(); return; }
                if (t._app) { var app = t._app; close(); APL.openApp(app); }
            },
            onBack: close,
            onKey: function (code, e) {
                // The remote's digits and a keyboard (PC preview): straight into the field
                var c = code >= 48 && code <= 57 ? String(code - 48) : (e.key && e.key.length === 1 ? e.key : "");
                if (!c) return false;
                if (fieldEl.value.length < 30) fieldEl.value += c;
                refresh();
                type();
                return true;
            }
        });
    }

    /* The screen's keyboard, on the field. */
    function type() {
        nav.focus(0);
        root.classList.add("is-typing");
        fieldEl.focus();
        try { var n = fieldEl.value.length; fieldEl.setSelectionRange(n, n); } catch (e) {}
    }
    /* Keyboard away, the remote moves again: on the first app if there is one. */
    function done() {
        fieldEl.blur();
        root.classList.remove("is-typing");
        nav.focus(found.length ? 1 : 0);
    }

    /* The apps again; the focus stays where it is (on the field while typing). */
    function refresh() {
        var query = fieldEl.value;
        var q = norm(query).replace(/\s+/g, " ").replace(/^ /, "");
        found = match(q);
        resultsEl.innerHTML = "";
        var tiles = found.map(function (app) {
            var t = APL.makeTile(app, 1);
            t._app = app;
            resultsEl.appendChild(t);
            return t;
        });
        emptyEl.textContent = !q ? (found.length ? APL.t("Recently Used") : "") :
            found.length ? "" : APL.t("No apps found for “{q}”", { q: query.trim() });
        root.classList.toggle("has-recent", !q && found.length > 0);
        var at = nav.index > 0 && !root.classList.contains("is-typing") ? Math.min(nav.index, tiles.length) : 0;
        nav.setTiles([fieldEl].concat(tiles));
        nav.focus(at);
    }

    function open() {
        if (!root) buildDom();
        fieldEl.value = "";
        nav.setTiles([]);
        refresh();
        root.classList.add("is-open");
        document.body.classList.add("has-search");          // the Home Screen steps back (launcher.css)
        APL.pushNav(nav);
        isOpen = true;
        setTimeout(function () { if (isOpen) type(); }, 250); // once the fade-in has started
    }
    function close() {
        if (!isOpen) return;
        isOpen = false;
        fieldEl.blur();
        root.classList.remove("is-open", "is-typing");
        document.body.classList.remove("has-search");
        APL.popNav(nav);
    }

    /* The magnifier at the top left (launcher.css): "▲ Search" in full screen, where ▲ opens it (launcher.js). */
    function addHint() {
        var h = el("div", "search-hint");
        h.innerHTML = '<span class="search-hint__chevron"></span>' + APL.icon("search", 30, 2.4);
        h.appendChild(el("span", "search-hint__text", APL.t("Search")));
        document.body.appendChild(h);
    }
    if (document.body) addHint(); else document.addEventListener("DOMContentLoaded", addHint);

    APL.search = { open: open, close: close, isOpen: function () { return isOpen; } };
})(window);
