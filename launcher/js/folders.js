/* ============================================================
   folders.js — app folders on the Home Screen, as on Apple TV.

   A folder is a tile with small icons of its apps. OK opens it over
   the Home Screen. Folders are kept per profile ("folders"
   preference); their place follows the Home Screen order.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var root, titleEl, gridEl, nav, current = null;

    function el(tag, cls) { var e = document.createElement(tag); e.className = cls; return e; }

    function all() { return sys.pref("folders") || []; }
    function save(list) { sys.setPref("folders", list); }
    function byId(id) { return all().filter(function (f) { return f.id === id; })[0] || null; }
    function holding(appId) { return all().filter(function (f) { return f.apps.indexOf(appId) !== -1; })[0] || null; }
    function members(f) {
        var apps = APL.allApps();
        return f.apps.map(function (id) { return apps.filter(function (a) { return a.id === id; })[0]; }).filter(Boolean);
    }

    /* The folder's tile: its first six apps in miniature. */
    function tileHtml(f) {
        var html = members(f).slice(0, 6).map(function (a) {
            var pic = (APL.tileOf ? APL.tileOf(a) : a.tile) || a.icon;
            return pic ? '<i style="background-image:url(\'' + pic + '\')"></i>' : '<i style="background-color:' + (a.accent || "#555") + '"></i>';
        }).join("");
        return '<div class="ftile">' + html + "</div>";
    }

    /* The folder seen as a Home Screen app. */
    function asApp(f) {
        return { id: "folder." + f.id, name: f.name, folder: f.id, virtual: true, accent: "#d9dbe3", eyebrow: APL.t("FOLDER"),
                 run: function () { open(f.id); } };
    }

    function create(firstApp) {
        var list = all(), n = list.length + 1;
        while (list.some(function (f) { return f.name === APL.t("Folder {n}", { n: n }); })) n++;
        var f = { id: "f" + Date.now(), name: APL.t("Folder {n}", { n: n }), apps: [firstApp] };
        save(list.concat([f]));
        return f;
    }
    function addTo(folderId, appId) {
        save(all().map(function (f) {
            if (f.id !== folderId) return f;
            return { id: f.id, name: f.name, apps: f.apps.filter(function (a) { return a !== appId; }).concat([appId]) };
        }));
    }
    function removeFrom(folderId, appId) {
        save(all().map(function (f) {
            return f.id !== folderId ? f : { id: f.id, name: f.name, apps: f.apps.filter(function (a) { return a !== appId; }) };
        }));
    }
    function destroy(folderId) { save(all().filter(function (f) { return f.id !== folderId; })); }
    function rename(folderId, name) {
        save(all().map(function (f) { return f.id !== folderId ? f : { id: f.id, name: name, apps: f.apps }; }));
    }

    /* ---------- open folder ---------- */
    function buildDom() {
        root = el("section", "folder");
        titleEl = el("h1", "folder__title");
        gridEl = el("div", "folder__grid");
        root.appendChild(titleEl); root.appendChild(gridEl);
        document.body.appendChild(root);
        nav = new APL.Nav({
            onSelect: function (i, t) { var a = t._app; close(); APL.openApp(a); },
            onBack: close,
            canHold: function () { return true; },
            onLongPress: function (i, t) {
                var a = t._app, folderId = current;
                APL.contextMenu.open(t.querySelector(".tile__card") || t, [
                    { label: APL.t("Remove from Folder"), icon: "grid", run: function () {
                        removeFrom(folderId, a.id);
                        APL.foldersChanged();
                        if (byId(folderId) && byId(folderId).apps.length) open(folderId); else close();
                    } }
                ]);
            }
        });
    }

    function open(id) {
        var f = byId(id);
        if (!f) return;
        if (!root) buildDom();
        current = id;
        titleEl.textContent = f.name;
        gridEl.innerHTML = "";
        var tiles = members(f).map(function (a) {
            var t = APL.makeTile(a, 1);
            t._app = a;
            gridEl.appendChild(t);
            return t;
        });
        root.classList.add("is-open");
        document.body.classList.add("has-folder");
        nav.setTiles(tiles);
        nav.focus(0);
        APL.pushNav(nav);
    }

    function close() {
        if (!current) return;
        current = null;
        root.classList.remove("is-open");
        document.body.classList.remove("has-folder");
        APL.popNav(nav);
    }

    /* Rename: a plain field in place of the title, the screen's keyboard opens on it. */
    function askName(id) {
        open(id);
        var f = byId(id), input = el("input", "folder__input");
        input.value = f.name;
        titleEl.textContent = "";
        titleEl.appendChild(input);
        var done = false;
        function finish(keep) {
            if (done) return;
            done = true;
            var name = input.value.trim();
            if (keep && name) { rename(id, name); APL.foldersChanged(); }
            titleEl.textContent = (byId(id) || f).name;
        }
        input.addEventListener("keydown", function (e) {
            if (e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); input.blur(); }
            else if (e.keyCode === 27 || e.keyCode === 10009) { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        input.addEventListener("blur", function () { setTimeout(function () { finish(true); }, 0); });
        setTimeout(function () { input.focus(); }, 50);
    }

    APL.folders = {
        all: all, byId: byId, holding: holding, tileHtml: tileHtml, asApp: asApp, create: create, addTo: addTo,
        removeFrom: removeFrom, destroy: destroy, open: open, close: close, askName: askName,
        isOpen: function () { return !!current; }
    };
})(window);
