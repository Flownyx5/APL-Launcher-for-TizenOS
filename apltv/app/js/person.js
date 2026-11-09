/* ============================================================
   person.js: an actor's (or director's) page, Apple TV / Prime Video
   style. Photo, name, what they are known for, biography (TMDB, in your
   language), then the movies and the series of YOUR catalog they played
   in or directed, most popular first. OK on a title opens its page;
   Back comes back to the title you came from.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var root, inner, strips = [], zone = 0, isOpen = false, token = 0, cur = null, from = null;

    function initials(name) { return String(name || "").split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase(); }
    function photoInto(node, url, name) {
        node.textContent = initials(name);
        if (!url) return;
        var im = new Image();
        im.onload = function () { node.textContent = ""; node.style.backgroundImage = TV.cssUrl(url); };
        im.src = url;
    }

    function open(p, fromItem) {
        root = root || TV.$("person");
        cur = p; from = fromItem || null; strips = []; zone = 0;
        var my = ++token;
        isOpen = true;
        root.innerHTML = "";
        inner = el("div", "person__in");
        var head = el("div", "person__head"), photo = el("div", "person__photo"), txt = el("div", "person__txt");
        photoInto(photo, p.photo, p.name);
        txt.innerHTML = "<div class='person__name'>" + esc(p.name) + "</div><div class='person__meta'>" + esc(p.role ? T("“{role}” in {title}", { role: p.role, title: (fromItem && (fromItem.title || fromItem.name)) || "" }) : "") +
            "</div><div class='person__bio'></div>";
        head.appendChild(photo); head.appendChild(txt);
        inner.appendChild(head);
        var rows = el("div", "person__rows");
        rows.appendChild(el("div", "person__empty", "<div class='osd__spin' style='width:44px;height:44px;border-width:5px'></div>"));
        inner.appendChild(rows);
        root.appendChild(inner);
        root.classList.add("is-open");
        TV.pushNav(screen);
        TV.meta.person(p.id).then(function (info) {
            if (my !== token) return null;
            if (!info) { rows.innerHTML = "<div class='person__empty'>" + esc(T("No information on this person.")) + "</div>"; return null; }
            if (info.photo) photoInto(photo, info.photo, info.name);
            var meta = [];
            var f = info.gender === 1, m = info.gender === 2;
            if (info.dept) meta.push({ Acting: f ? T("Actress") : m ? T("Actor") : T("Actor, actress"), Directing: T("Director"), Writing: T("Writer"), Production: T("Producer") }[info.dept] || info.dept);
            if (info.birthday) {
                var age = Math.floor(((info.deathday ? new Date(info.deathday) : new Date()) - new Date(info.birthday)) / (365.25 * 86400000));
                meta.push(T(f ? "f|Born on {date}" : m ? "m|Born on {date}" : "Born on {date}", { date: new Date(info.birthday).toLocaleDateString(TV.locale, { day: "numeric", month: "long", year: "numeric" }) }) + (info.deathday ? "" : " (" + T("{n} years old", { n: age }) + ")"));
            }
            if (info.place) meta.push(info.place);
            txt.querySelector(".person__meta").textContent = meta.join("  ·  ");
            txt.querySelector(".person__bio").textContent = info.bio || "";
            var movies = info.credits.filter(function (c) { return c.kind === "movie"; }).sort(function (a, b) { return b.pop - a.pop; });
            var shows = info.credits.filter(function (c) { return c.kind === "tv"; }).sort(function (a, b) { return b.pop - a.pop; });
            return Promise.all([D.findTitles("movies", movies), D.findTitles("series", shows)]).then(function (r) {
                if (my !== token) return;
                r = r.map(function (l) { return l.filter(function (x) { return !D.isHidden(x); }); });
                rows.innerHTML = "";
                strips = [];
                function add(title, items) {
                    var grouped = groupSame(items);
                    if (!grouped.length) return;
                    var s = new TV.Strip({ title: title, sub: String(grouped.length), items: grouped, height: 440, make: function (it) {
                        var c = TV.card.poster(it);
                        var role = it._ref && it._ref.role;
                        if (role) { var sub = c.querySelector(".card__sub"); if (sub) sub.textContent = role; }
                        return c;
                    } });
                    strips.push(s); rows.appendChild(s.root);
                }
                add(T("Movies in your catalog"), r[0]);
                add(T("Series in your catalog"), r[1]);
                if (!strips.length) rows.appendChild(el("div", "person__empty", esc(T("None of {name}'s movies or series are in your catalog.", { name: info.name }))));
                zone = 0;
                paint();
            });
        });
    }
    /* The same title in several versions shows once */
    function groupSame(items) {
        var seen = {}, out = [];
        items.forEach(function (x) {
            var k = x._ref ? "ref:" + x._ref.t + ":" + x._ref.y : TV.smart.fold(x.title || x.name) + ":" + (x.year || "");
            if (seen[k]) { seen[k].versions = seen[k].versions || [seen[k]]; seen[k].versions.push(x); return; }
            seen[k] = x; x.versions = null; out.push(x);
        });
        return out;
    }

    function paint() {
        strips.forEach(function (s, i) { s.setActive(i === zone); });
        var s = strips[zone];
        inner.style.transform = s ? "translateY(" + (-Math.max(0, s.root.offsetTop - 430)) + "px)" : "translateY(0)";
    }
    function close() {
        token++;
        isOpen = false;
        root.classList.remove("is-open");
        TV.popNav(screen);
    }

    var screen = {
        key: function (code) {
            var K = TV.KEY;
            if (TV.isBack(code)) { close(); return; }
            var s = strips[zone];
            if (!s) return;
            if (code === K.LEFT || code === K.RIGHT) { if (!s.move(code === K.LEFT ? -1 : 1)) TV.sound.edge(); return; }
            if (code === K.UP) { if (zone > 0) { zone--; TV.sound.tick(); paint(); } else TV.sound.edge(); return; }
            if (code === K.DOWN) { if (zone < strips.length - 1) { zone++; TV.sound.tick(); paint(); } else TV.sound.edge(); }
        },
        ok: function () {
            var s = strips[zone], it = s && s.current();
            if (!it) return;
            close();
            TV.detail.open(it, { push: true });
        }
    };

    TV.person = { open: open, close: close, isOpen: function () { return isOpen; } };
})(window);
