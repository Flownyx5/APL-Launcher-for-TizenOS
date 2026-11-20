/* ============================================================
   profiles.js — the household's profiles, as on Apple TV.

   Below the time, at the top right: one circle per person (their color,
   their initial), a check mark on the active profile, "+" to add
   someone. Each profile keeps its own Home Screen layout, hidden apps,
   preferences and recent apps (shown here).
   OK: switch profile. Hold OK: avatar, name, color, delete.
   Avatars: your own Memoji (the installer takes them from "Pictures\APL
   Launcher avatars" on the PC), Apple's Memoji (downloaded by
   the installer from wimell/tapback-memojis), then 3D animals in the style
   of Animoji (Microsoft's Fluent Emoji, MIT license — images/avatars/).
   Memoji stay in the screen's package, never in this repository.
   Opens from Control Center (avatar) or Settings.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys, P = sys.profiles;
    var root, grid, recentTitle, recentRow, nav, isOpen = false;
    // Your Memoji, then Apple's Memoji (local files added by the installer),
    // then the 3D animals. Without Memoji (no network during install): 3D faces.
    var CUSTOM = global.APL_CUSTOM_AVATARS || [];
    var MEMOJI = global.APL_MEMOJI || [];
    var PEOPLE = ["baby-light", "boy-light", "child-medium-dark", "girl-dark", "girl-medium", "man-bald-medium-dark", "man-beard-medium-light", "man-blonde-hair-medium-light", "man-curly-hair-dark", "man-light", "man-medium-light", "man-red-hair-medium-light", "man-white-hair-light", "old-man-medium", "old-woman-medium-light", "person-beard-medium", "person-dark", "woman-blonde-hair-light", "woman-curly-hair-medium-dark", "woman-dark", "woman-medium", "woman-red-hair-light", "woman-white-hair-medium", "woman-with-headscarf-medium"];
    var ANIMALS = ["cat-face", "dog-face", "fox", "panda", "koala", "lion", "tiger-face", "monkey-face", "unicorn", "bear", "hamster", "frog", "alien", "robot", "ghost", "rabbit-face"];
    var AVATARS = CUSTOM.concat(MEMOJI.length ? MEMOJI : PEOPLE, ANIMALS);
    function asset(p) { return global.APL_ASSET ? global.APL_ASSET(p) : p; }
    /* An avatar's image: personal Memoji stay on the screen (never on GitHub) */
    function avatarSrc(k) {
        return k.indexOf("/") > -1 ? "images/avatars/" + k : asset("images/avatars/" + k + ".png");
    }
    /* Pastel color behind an avatar, as on Apple TV */
    function pastel(hex) {
        var h = String(hex || "#0a84ff").replace("#", ""), out = "#";
        for (var i = 0; i < 3; i++) {
            var v = parseInt(h.substr(i * 2, 2), 16);
            out += ("0" + Math.round(v + (255 - v) * 0.55).toString(16)).slice(-2);
        }
        return out;
    }

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }
    function initial(name) { return (String(name || "").trim().charAt(0) || "?").toUpperCase(); }

    /* A profile's badge: its color and its initial */
    function paint(node, p) {
        if (p.avatar) {
            node.style.background = pastel(p.color);
            node.innerHTML = '<img class="pavatar' + (p.avatar.indexOf("/") > -1 ? ' pavatar--memoji' : '') + '" alt="" src="' + avatarSrc(p.avatar) + '">';
            return;
        }
        node.style.background = "radial-gradient(circle at 35% 28%, rgba(255,255,255,0.45), rgba(255,255,255,0) 55%), " + p.color;
        node.textContent = initial(p.name);
    }
    function paintStatus() {
        var a = document.querySelector(".status__avatar");
        if (a) { a.classList.add("is-profile"); paint(a, P.current()); }
        // A single profile: nothing to tell apart, the time stays alone (profiles are still in Control Center)
        var s = document.querySelector(".status");
        if (s) s.classList.toggle("is-alone", P.list().length < 2);
    }

    function buildDom() {
        root = el("section", "profiles");
        root.appendChild(el("div", "profiles__dim"));
        var panel = el("div", "profiles__panel");
        grid = el("div", "profiles__grid");
        recentTitle = el("div", "profiles__section");
        recentRow = el("div", "profiles__recents");
        panel.appendChild(grid); panel.appendChild(recentTitle); panel.appendChild(recentRow);
        root.appendChild(panel);
        document.body.appendChild(root);
        nav = new APL.Nav({
            onSelect: function (i, t) { if (t._run) t._run(); },
            onLongPress: function (i, t) { if (t._profile) menu(t._profile, t); },
            onBack: close
        });
    }

    function render(focusId) {
        grid.innerHTML = ""; recentRow.innerHTML = "";
        var tiles = [], cur = P.current(), focus = 0;
        P.list().forEach(function (p) {
            var t = el("div", "pitem" + (p.id === cur.id ? " is-current" : ""));
            var av = el("span", "pitem__avatar");
            paint(av, p);
            t.appendChild(av);
            if (p.id === cur.id) t.appendChild(el("span", "pitem__check", APL.icon("check", 22, 3)));
            var name = el("span", "pitem__name");
            name.textContent = p.name;
            t.appendChild(name);
            t._profile = p;
            t._run = function () { choose(p); };
            if (p.id === (focusId || cur.id)) focus = tiles.length;
            grid.appendChild(t); tiles.push(t);
        });
        var add = el("div", "pitem pitem--add", '<span class="pitem__avatar">' + APL.icon("plus", 52, 2.2) + '</span><span class="pitem__name">' + APL.t("Add") + '</span>');
        add._run = addProfile;
        grid.appendChild(add); tiles.push(add);

        // The profile's history: its latest apps
        var all = APL.allApps ? APL.allApps() : [], byId = {};
        all.forEach(function (a) { byId[a.id] = a; });
        var recent = (sys.pref("recentApps") || []).map(function (id) { return byId[id]; }).filter(Boolean).slice(0, 6);
        recentTitle.textContent = recent.length ? APL.t("Recently Opened · {name}", { name: cur.name }) : "";
        recent.forEach(function (a) {
            var t = el("div", "precent");
            var art = el("span", "precent__art");
            var pic = APL.tileOf ? APL.tileOf(a) : a.tile;
            if (pic) art.style.background = "#111 center / cover no-repeat url('" + pic + "')";
            else if (a.icon) art.innerHTML = '<img alt="" src="' + a.icon + '">';
            else art.textContent = initial(a.name);
            t.appendChild(art);
            t._run = function () { close(); if (APL.launchById) APL.launchById(a.id); };
            recentRow.appendChild(t); tiles.push(t);
        });
        nav.setTiles(tiles);
        nav.focus(focus);
    }

    function choose(p) {
        if (p.id !== P.current().id) {
            P.switchTo(p.id);
            APL.toast(APL.t("Hello, {name}!", { name: p.name }), true);
        }
        close();
    }

    function addProfile() {
        var p = P.add();
        render(p.id);
        rename(p, function () { chooseAvatar(p); });
    }

    /* Choose an avatar: your Memoji, Apple's, then 3D animals */
    function chooseAvatar(p) {
        var box = el("div", "apicker", '<h2 class="apicker__title">' + APL.t("Choose Your Avatar") + '</h2><div class="apicker__scroll"><div class="apicker__grid"></div></div>');
        var g = box.querySelector(".apicker__grid"), tiles = [], at = 0;
        AVATARS.forEach(function (k, i) {
            var t = el("div", "apicker__item");
            t.style.background = pastel(P.colors[i % P.colors.length]);
            t.innerHTML = '<img alt="" src="' + avatarSrc(k) + '">';
            if (k.indexOf("/") > -1) t.classList.add("is-custom");
            t._key = k; t._color = P.colors[i % P.colors.length];
            if (k === p.avatar) at = i;
            g.appendChild(t); tiles.push(t);
        });
        document.body.appendChild(box);
        // The grid scrolls to keep the chosen row on screen (3rd row at the lowest)
        var ROW = 158;
        var pick = new APL.Nav({
            onFocus: function (i, t) {
                g.style.transform = "translateY(" + (-Math.max(0, Math.round(t.offsetTop / ROW) - 2) * ROW) + "px)";
            },
            onSelect: function (i, t) {
                P.update(p.id, { avatar: t._key, color: t._color });
                done();
            },
            onBack: done
        });
        function done() {
            APL.popNav(pick);
            if (box.parentNode) box.parentNode.removeChild(box);
            if (isOpen) render(p.id);
            paintStatus();
        }
        pick.setTiles(tiles);
        pick.focus(at);
        APL.pushNav(pick);
    }

    /* Rename: text field (the screen's keyboard opens) */
    function rename(p, then) {
        var box = el("div", "pprompt", '<div class="pprompt__box"><h2 class="pprompt__title">' + APL.t("Profile Name") + '</h2>' +
            '<input class="pprompt__input" type="text" maxlength="20"><p class="pprompt__hint">' + APL.t("OK to confirm · Back to cancel") + '</p></div>');
        document.body.appendChild(box);
        var input = box.querySelector("input"), done = false;
        input.value = p.name;
        function finish(ok) {
            if (done) return;
            done = true;
            var v = input.value.trim();
            if (ok && v) P.update(p.id, { name: v });
            box.parentNode.removeChild(box);
            if (isOpen) render(p.id);
            paintStatus();
            if (then) then();
        }
        input.addEventListener("keydown", function (e) {
            if (e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); finish(true); }
            else if (e.keyCode === 27 || e.keyCode === 10009) { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        input.addEventListener("blur", function () { setTimeout(function () { finish(true); }, 0); });
        setTimeout(function () { input.focus(); try { input.select(); } catch (e) {} }, 50);
    }

    function menu(p, t) {
        var items = [
            { label: APL.t("Choose Avatar"), icon: "person", run: function () { chooseAvatar(p); } },
            { label: APL.t("Rename"), icon: "sliders", run: function () { rename(p); } },
            { label: APL.t("Change Color"), icon: "sparkle", run: function () {
                var c = P.colors, k = (c.indexOf(p.color) + 1) % c.length;
                P.update(p.id, { color: c[k] }); render(p.id); paintStatus();
            } }
        ];
        if (P.list().length > 1) items.push({ label: APL.t("Delete Profile"), icon: "trash", destructive: true, run: function () {
            APL.alert({
                title: APL.t("Delete “{name}”?", { name: p.name }),
                message: APL.t("Its Home Screen layout, preferences and history will be erased."),
                buttons: [{ label: APL.t("Delete"), destructive: true, run: function () { P.remove(p.id); render(); paintStatus(); } },
                          { label: APL.t("Cancel") }],
                focus: 1
            });
        } });
        APL.contextMenu.open(t.querySelector(".pitem__avatar") || t, items);
    }

    function open() {
        if (!root) buildDom();
        render();
        root.classList.add("is-open");
        document.body.classList.add("has-profiles");
        APL.pushNav(nav);
        isOpen = true;
    }
    function close() {
        if (!isOpen) return;
        root.classList.remove("is-open");
        document.body.classList.remove("has-profiles");
        APL.popNav(nav);
        isOpen = false;
    }

    P.onChange(paintStatus);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintStatus);
    else paintStatus();

    APL.profilesUI = { open: open, close: close, isOpen: function () { return isOpen; }, paint: paint, chooseAvatar: chooseAvatar };
})(window);
