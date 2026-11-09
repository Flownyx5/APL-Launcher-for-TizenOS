/* ============================================================
   live.js: Live TV, in the style of the Apple TV app's live channels.
   The channel you are on plays FULL SCREEN behind the interface. Its
   programme is written in large at the top left (logo, title, time left,
   what comes next, plot). At the bottom, on clear glass: the categories
   (Favorites, Recent, All, then yours, your language first) and the
   channel cards, with what comes next on the channel below them.
   - ◀ ▶ channels, ▲ categories. Staying on a channel switches the picture
     behind to it; OK: full screen (the same stream, nothing restarts).
   - OK held: favorites, multiview, quality. Number keys: a channel number.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var FULL = [0, 0, 1920, 1080];
    var root, hero, wait, chipStrip, cardsBox, nextBox, hint, cards, chipEls = [], cats = [], catIndex = 0, chipScroll = 0;
    var zone = "cards", playing = null, visible = false, built = false, previewTimer = null, chipTimer = null;

    function build() {
        root = TV.$("v-live");
        root.innerHTML = "";
        root.appendChild(el("div", "lv__scrim"));
        wait = el("div", "lv__wait is-hidden", "<div class='osd__spin'></div>");
        root.appendChild(wait);
        hero = el("div", "lv__hero");
        root.appendChild(hero);
        var chips = el("div", "lv__chips");
        chipStrip = el("div", "lv__chipstrip");
        chips.appendChild(chipStrip);
        root.appendChild(chips);
        cardsBox = el("div", "lv__cards");
        var inner = el("div", "lv__cardin");
        cardsBox.appendChild(inner);
        root.appendChild(cardsBox);
        nextBox = el("div", "lv__next");
        root.appendChild(nextBox);
        hint = el("div", "lv__hint", esc(T("OK: full screen · Hold OK: favorites, multiview")));
        root.appendChild(hint);
        cards = new TV.HList({ clip: cardsBox, inner: inner, step: 336, viewW: 1728, render: renderCard, onFocus: onCardFocus,
            onWindow: function (a, b) { for (var i = a; i < b; i++) { var c = cards.items[i]; if (c) TV.prefetchLogo(c.logo); } } });
        built = true;
    }

    /* ---------- categories ---------- */
    function categories() {
        var cat = D.catalog(), adult = TV.pref("showAdult");
        var list = [
            { id: "fav", name: T("Favorites"), count: D.favIds().length },
            { id: "recent", name: T("Recent"), count: (TV.load("recent", []) || []).length },
            { id: "all", name: T("All Channels"), count: 0 }
        ];
        D.chanGroups().forEach(function (g) { list.push({ id: "grp:" + g.id, name: g.name, count: g.ids.length, mine: true }); });   // your own groups
        (cat ? cat.live.cats : []).forEach(function (c) { if ((adult || !c.adult) && !c.off) { list.push(c); list[2].count += c.count; } });
        // first: every category in a list (a big account has hundreds: too many to scroll through here)
        list.unshift({ id: "pick", name: T("Categories"), count: 0 });
        return list;
    }
    /* Every category of your channels in a vertical list, by country or region when there are many.
       Used by Live TV (its first chip) and by the Guide. top: entries first (Favorites…); onPick(category) */
    function pickCategory(currentId, onPick, top) {
        var cat = D.catalog(), adult = TV.pref("showAdult"), S = TV.smart;
        var all = (cat ? cat.live.cats : []).filter(function (c) { return (adult || !c.adult) && !c.off; });
        function item(c) {
            return { label: (c.tag ? c.tag + " · " : "") + c.name + (c.count ? "  ·  " + c.count : ""), check: c.id === currentId, focus: c.id === currentId,
                     run: function () { onPick(c); } };
        }
        top = top || [];
        if (all.length <= 40) { TV.menu(T("Category"), top.concat(all).map(item)); return; }
        var groups = [], by = {}, curGroup = null;
        all.forEach(function (c) {
            var g = c.grp || "";
            if (!by[g]) { by[g] = { id: g, name: g && S && S.groupName ? S.groupName(g) : T("Other Categories"), cats: [] }; groups.push(by[g]); }
            by[g].cats.push(c);
            if (c.id === currentId) curGroup = g;
        });
        var other = by[""];
        if (other) { groups.splice(groups.indexOf(other), 1); groups.push(other); }    // the categories of no country last
        TV.menu(T("Category"), top.map(item).concat(groups.map(function (g) {
            return { label: g.name + "  ·  " + g.cats.length, check: g.id === curGroup, focus: g.id === curGroup && top.every(function (t) { return t.id !== currentId; }),
                     run: function () { TV.menu(g.name, g.cats.map(item)); } };
        })));
    }
    function buildChips() {
        chipStrip.innerHTML = "";
        chipEls = cats.map(function (c) {
            var icon = c.id === "fav" ? TV.icon("star", 22) + "&nbsp;&nbsp;" : c.id === "pick" ? TV.icon("list", 22) + "&nbsp;&nbsp;" : c.mine ? TV.icon("tv", 22) + "&nbsp;&nbsp;" : "";
            var e = el("div", "chip", icon + (c.tag ? "<span class='lrow__flag'>" + esc(c.tag) + "</span>" : "") + esc(c.name) + (c.count ? "<span class='chip__n'>" + c.count + "</span>" : ""));
            chipStrip.appendChild(e);
            return e;
        });
    }
    function paintChips() {
        var focusOn = zone === "chips" && TV.shell.focusOn() === "view";
        chipEls.forEach(function (e, i) {
            e.classList.toggle("is-focused", focusOn && i === catIndex);
            e.classList.toggle("is-current", i === catIndex);
        });
        var c = chipEls[catIndex];
        if (c) TV.lift(c);
        if (c) {
            var x = c.offsetLeft, w = c.offsetWidth;
            if (x - chipScroll + w > 1650) chipScroll = x + w - 1650;
            if (x - chipScroll < 0) chipScroll = Math.max(0, x - 30);
            chipStrip.style.transform = "translateX(" + (-chipScroll) + "px)";
        }
    }
    function loadCategory(keepId) {
        var c = cats[catIndex];
        if (!c || c.id === "pick") return;
        TV.setPref("liveCat", c.id);
        var items = D.channelsIn(c.id), idx = 0;
        var want = keepId || (playing && playing.id);
        if (want) for (var i = 0; i < items.length; i++) if (items[i].id === want || (items[i].variants && items[i].variants.some(function (v) { return v.id === want; }))) { idx = i; break; }
        cards.set(items, idx);
        cards.setActive(zone === "cards" && TV.shell.focusOn() === "view");
        var old = cardsBox.querySelector(".lv__empty");
        if (old) old.parentNode.removeChild(old);
        if (!items.length) cardsBox.appendChild(el("div", "lv__empty", esc(c.id === "fav" ? T("No favorites yet: hold OK on a channel to add it.") : T("No channels here."))));
        TV.epg.ensure(items.slice(Math.max(0, idx - 3), idx + 8));
        showInfo(cards.current());
        infoFor = cards.current();          // so the header follows when the guide arrives after (view.refresh)
        schedulePreview(cards.current());
    }

    /* ---------- channel cards ---------- */
    function renderCard(ch) {
        if (TV.mark) TV.mark("card");
        var c = el("div", "lcard" + (playing && playing.id === ch.id ? " is-playing" : "")), art = el("div", "lcard__art"), logo = el("div", "lcard__logo");
        TV.logoBox(logo, ch);
        art.appendChild(el("span", "lcard__num", String(ch.num)));
        if (ch.q && ch.q !== "SD") art.appendChild(el("span", "lcard__q", esc(ch.q)));
        art.appendChild(logo);
        var n = TV.epg.now(ch), cur = n && n.cur;
        var b = el("div", "lcard__bar"); b.innerHTML = "<i style='width:" + Math.round(TV.epg.progress(cur) * 100) + "%'></i>";
        if (!cur) b.style.display = "none";
        art.appendChild(b);
        if (D.isFav(ch.id)) art.appendChild(el("div", "lcard__fav", TV.icon("star", 22)));
        c.appendChild(art);
        c.appendChild(el("div", "lcard__t", esc(ch.name)));
        var p = el("div", "lcard__p", cur ? esc(cur[2]) : "&nbsp;");
        c.appendChild(p);
        c._pt = cur ? cur[2] : "";
        // New guide data or a minute later: only the programme line and its bar change, the card stays
        c._update = function () {
            var n2 = TV.epg.now(ch), cur2 = n2 && n2.cur, t = cur2 ? cur2[2] : "";
            if (t !== c._pt) { c._pt = t; p.innerHTML = t ? esc(t) : "&nbsp;"; }
            b.style.display = cur2 ? "" : "none";
            if (cur2) b.firstChild.style.width = Math.round(TV.epg.progress(cur2) * 100) + "%";
        };
        return c;
    }
    var infoTimer = null, infoFor = null, refreshJob = null;
    function onCardFocus(i, ch) {
        TV.uncalm(infoTimer);
        if (infoFor !== ch) { hero.classList.add("is-out"); nextBox.classList.add("is-out"); }
        infoTimer = TV.calm(function () {
            showInfo(ch);
            infoFor = ch;
            hero.classList.remove("is-out"); nextBox.classList.remove("is-out");
            TV.epg.ensure(cards.items.slice(Math.max(0, i - 3), i + 8));
        }, 260);
        schedulePreview(ch);
    }

    /* ---------- the programme, at the top left ---------- */
    function showInfo(ch) {
        if (TV.mark) TV.mark("info");
        if (!ch) { hero.innerHTML = ""; nextBox.innerHTML = ""; return; }
        var n = TV.epg.now(ch), cur = n && n.cur, now = Date.now();
        var logo = el("div", "lv__logo");
        TV.logoBox(logo, ch);
        hero.innerHTML = "";
        var brand = el("div", "lv__brand");
        brand.appendChild(logo);
        brand.appendChild(el("span", "badge badge--live", esc(T("LIVE"))));
        brand.appendChild(el("span", "badge", String(ch.num)));
        if (D.isFav(ch.id)) brand.appendChild(el("span", "", "<span style='color:#ffd60a;display:flex'>" + TV.icon("star", 28) + "</span>"));
        hero.appendChild(brand);
        hero.appendChild(el("div", "lv__title", esc(cur ? cur[2] : ch.name)));
        if (cur) hero.appendChild(el("div", "lv__meta", "<span>" + TV.hhmm(cur[0]) + " – " + TV.hhmm(cur[1]) + "</span><div class='bar'><i style='width:" + Math.round(TV.epg.progress(cur) * 100) + "%'></i></div><span>" +
            esc(T("{n} min left", { n: Math.max(1, Math.round((cur[1] - now) / 60000)) })) + "</span>"));
        else hero.appendChild(el("div", "lv__meta", "<span>" + esc(ch.name) + "</span>"));
        if (cur && cur[3]) hero.appendChild(el("div", "lv__desc", esc(cur[3])));
        // What comes next on this channel
        nextBox.innerHTML = "";
        TV.epg.range(ch, now, now + 8 * 3600000).filter(function (p) { return p[0] > now; }).slice(0, 4).forEach(function (p) {
            nextBox.appendChild(el("div", "lv__nextitem", "<b>" + TV.hhmm(p[0]) + "</b><span>" + esc(p[2]) + "</span>"));
        });
    }

    /* ---------- the picture behind ---------- */
    function schedulePreview(ch) {
        clearTimeout(previewTimer);
        if (!ch || !visible || !TV.pref("autoPreview") || (playing && playing.id === ch.id)) return;
        previewTimer = setTimeout(function () { if (visible) playChannel(ch, FULL); }, 800);
    }
    function markPlaying() {
        if (!cards) return;
        for (var k in cards.cards) { var it = cards.items[k]; cards.cards[k].classList.toggle("is-playing", !!(playing && it && it.id === playing.id)); }
    }
    function playChannel(ch, rect) {
        if (!built) build();
        playing = ch;
        markPlaying();
        wait.classList.remove("is-hidden");
        D.pushRecent(ch.id);
        TV.setPref("lastChannel", ch.id);
        TV.player.play(D.streamUrl(ch), {
            live: true, rect: rect || FULL, uhd: ch.q === "4K",
            onBuffering: function (b) { if (TV.osd.isOpen()) TV.osd.buffering(b); else wait.classList.toggle("is-hidden", !b); },
            onPlaying: function () { wait.classList.add("is-hidden"); if (TV.osd.isOpen()) TV.osd.buffering(false); },
            // the picture moves: no spinner left, in Live TV or full screen
            onTime: function () { if (!wait.classList.contains("is-hidden")) wait.classList.add("is-hidden"); if (TV.osd.isOpen()) TV.osd.buffering(false); },
            onReconnect: function () { if (TV.osd.isOpen()) TV.osd.buffering(true); else wait.classList.remove("is-hidden"); },
            onError: function (e) {
                TV.log("channel " + ch.name + " failed: " + e);
                wait.classList.add("is-hidden");
                if (TV.osd.isOpen()) TV.osd.error(T("This channel is not available right now."), String(e));
                else TV.toast(T("This channel is not available right now."));
            }
        });
    }

    function fullScreen(ch, ctx) {
        if (!built) build();
        // the same channel opened again after it was stopped (from Home, the Guide…): it starts again
        if (!playing || playing.id !== ch.id || TV.player.state() === "NONE") playChannel(ch, FULL);
        else TV.player.setRect(FULL);
        if (!ctx) ctx = visible && cards.items.length ? cards.items : (D.isFav(ch.id) ? D.favChannels() : D.channelsIn(ch.cat));
        TV.osd.live(ch, ctx, function onClose(last) {
            // Back from full screen: the interface comes back over the same picture
            if (last) { playing = last; select(last.id); markPlaying(); }
            if (!visible) { TV.player.stop(); playing = null; }
        }, function onZap(c) { playing = c; });
    }
    function select(id) {
        for (var i = 0; i < cards.items.length; i++) if (cards.items[i].id === id) { cards.focus(i, true); showInfo(cards.items[i]); return; }
    }

    /* ---------- menus ---------- */
    function channelMenu(ch) {
        var fav = D.isFav(ch.id), inFav = cats[catIndex] && cats[catIndex].id === "fav";
        var items = [
            { label: fav ? T("Remove from Favorites") : T("Add to Favorites"), icon: fav ? "starLine" : "star", run: function () {
                var on = D.toggleFav(ch.id);
                TV.toast(on ? T("“{name}” added to Favorites", { name: ch.name }) : T("“{name}” removed from Favorites", { name: ch.name }));
                cats = categories(); buildChips(); paintChips();
                if (inFav) loadCategory(); else { cards.refresh(); showInfo(cards.current()); }
            } },
            { label: T("Watch in Multiview"), icon: "grid", run: function () { TV.multiview.open([ch]); } },
            { label: T("Full Screen"), icon: "tv", run: function () { fullScreen(ch); } }
        ];
        items.splice(1, 0, { label: T("Add to a Group"), icon: "plus", run: function () { groupMenu(ch); } },
                              { label: T("TV Guide for This Channel"), icon: "list", run: function () { guideMenu(ch); } });
        if (inFav && fav) {
            items.push({ label: T("Move Up"), icon: "chevron", run: function () { if (D.moveFav(ch.id, -1)) loadCategory(ch.id); } });
            items.push({ label: T("Move Down"), icon: "chevron", run: function () { if (D.moveFav(ch.id, 1)) loadCategory(ch.id); } });
        }
        var curCat = cats[catIndex];
        if (curCat && curCat.mine) {
            var gid = curCat.id.replace(/^grp:/, "");
            items.push({ label: T("Remove from “{group}”", { group: curCat.name }), icon: "trash", run: function () { D.toggleChanGroup(gid, ch.id); afterGroups(); } });
            items.push({ label: T("Move Up"), icon: "chevron", run: function () { if (D.moveInChanGroup(gid, ch.id, -1)) loadCategory(ch.id); } });
            items.push({ label: T("Move Down"), icon: "chevron", run: function () { if (D.moveInChanGroup(gid, ch.id, 1)) loadCategory(ch.id); } });
        }
        if (ch.variants && ch.variants.length > 1) items.push({ label: T("Quality"), icon: "quality", run: function () {
            TV.menu(T("Quality"), ch.variants.map(function (v) {
                return { label: (v.q || T("Standard")) + "  ·  " + (v.raw || v.name), check: playing && playing.id === v.id, run: function () { fullScreen(v); } };
            }));
        } });
        TV.menu(ch.num + "  " + ch.name, items);
    }
    /* The channel's TV guide: automatic, a channel of the provider's guide, or another channel's programmes */
    function guideMenu(ch) {
        var cur = TV.epg.chosen(ch), S = TV.smart;
        function done(msg) { TV.toast(msg); if (cards) { cards.refresh(); showInfo(cards.current()); } }
        var items = [{ label: T("Automatic"), check: !cur, run: function () { TV.epg.setChannelGuide(ch, null); done(T("TV guide: automatic")); } }];
        if (TV.epg.hasGuideList()) items.push({ label: T("Find It in the Guide"), icon: "search", check: !!(cur && cur.id), run: function () {
            TV.prompt({ title: T("Find It in the Guide"), value: ch.name, onDone: function (q) {
                var found = TV.epg.guideSearch(q);
                if (!found.length) { TV.toast(T("Nothing in the guide for “{q}”", { q: q })); return; }
                TV.menu(T("TV Guide for This Channel"), found.map(function (g) {
                    return { label: g.name + (g.name !== g.id ? "  ·  " + g.id : ""), check: !!(cur && cur.id === g.id), run: function () {
                        TV.epg.setChannelGuide(ch, { src: g.src, id: g.id });
                        TV.toast(T("Updating the TV guide…"));
                        TV.epg.loadAll(true).then(function () { done(T("TV guide updated")); });
                    } };
                }));
            } });
        } });
        items.push({ label: T("Same as Another Channel"), icon: "tv", check: !!(cur && cur.ch), run: function () {
            // channels with programmes whose name looks like this one (the HD version of a 4K channel…)
            var me = S.fold(ch.name).replace(/\b(uhd|fhd|hd|sd|4k|hevc|backup|raw)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim(), first = me.split(" ")[0] || me, list = [];
            (D.catalog() ? D.catalog().live.chans : []).forEach(function (c) {
                if (c.id === ch.id || list.length >= 200 || !TV.epg.has(c)) return;
                var f = S.fold(c.name);
                if (first && f.indexOf(first) >= 0) list.push(c);
            });
            list.sort(function (a, b) { return Math.abs(a.name.length - ch.name.length) - Math.abs(b.name.length - ch.name.length); });
            if (!list.length) { TV.toast(T("No channel with a guide has a name like this one.")); return; }
            TV.menu(T("Same as Another Channel"), list.slice(0, 40).map(function (c) {
                var p = TV.epg.now(c);
                return { label: c.name + (p && p.cur ? "  ·  " + p.cur[2] : ""), check: !!(cur && cur.ch === c.id), run: function () { TV.epg.setChannelGuide(ch, { ch: c.id }); done(T("TV guide: the one of {name}", { name: c.name })); } };
            }));
        } });
        TV.menu(T("TV Guide for This Channel"), items);
    }
    /* Your groups: add the channel to one, or to a new one */
    function groupMenu(ch) {
        var items = D.chanGroups().map(function (g) {
            var on = g.ids.indexOf(ch.id) >= 0;
            return { label: g.name, check: on, run: function () {
                var now = D.toggleChanGroup(g.id, ch.id);
                TV.toast(now ? T("“{name}” added to {group}", { name: ch.name, group: g.name }) : T("“{name}” removed from {group}", { name: ch.name, group: g.name }));
                afterGroups(ch.id);
            } };
        });
        items.push({ label: T("New Group"), icon: "plus", run: function () {
            TV.prompt({ title: T("New Group"), placeholder: T("Sport, Kids, News…"), onDone: function (v) {
                var id = D.addChanGroup(v);
                D.toggleChanGroup(id, ch.id);
                TV.toast(T("“{name}” added to {group}", { name: ch.name, group: v }));
                afterGroups(ch.id);
            } });
        } });
        TV.menu(T("Add to a Group"), items);
    }
    function groupChipMenu(c) {
        var gid = c.id.replace(/^grp:/, "");
        TV.menu(c.name, [
            { label: T("Rename"), icon: "keyboard", run: function () { TV.prompt({ title: T("Rename"), value: c.name, onDone: function (v) { D.renameChanGroup(gid, v); afterGroups(); } }); } },
            { label: T("Delete the Group"), icon: "trash", danger: true, run: function () {
                TV.alert({ title: T("Delete “{group}”?", { group: c.name }), message: T("Its channels stay in their categories."), buttons: [
                    { label: T("Cancel") }, { label: T("Delete"), danger: true, run: function () { D.deleteChanGroup(gid); afterGroups(); } }] });
            } }
        ]);
    }
    function afterGroups(keepId) {
        var cur = cats[catIndex] && cats[catIndex].id;
        cats = categories();
        var found = -1;
        for (var i = 0; i < cats.length; i++) if (cats[i].id === cur) { found = i; break; }
        if (found < 0) { catIndex = Math.min(catIndex, cats.length - 1); buildChips(); paintChips(); loadCategory(); return; }
        catIndex = found; buildChips(); paintChips();
        if (String(cur).indexOf("grp:") === 0) loadCategory(keepId); else { cards.refresh(); showInfo(cards.current()); }
    }
    function findNumber(n) {
        var cat = D.catalog();
        if (!cat) return null;
        for (var i = 0; i < cat.live.chans.length; i++) if (cat.live.chans[i].num === n) return cat.live.chans[i];
        return null;
    }

    /* ---------- the screen ---------- */
    var view = {
        show: function () {
            if (!built) build();
            visible = true;
            document.body.classList.add("in-live");
            cats = categories();
            buildChips();
            var want = TV.pref("liveCat");
            if (want === "fav" && !D.favIds().length) want = null;
            catIndex = D.favIds().length ? 1 : Math.min(4, cats.length - 1);   // after Categories: Favorites, or your first category
            for (var i = 0; i < cats.length; i++) if (cats[i].id === want) { catIndex = i; break; }
            zone = "cards";
            paintChips();
            loadCategory(TV.pref("lastChannel"));
            this.blur();
        },
        hide: function () {
            visible = false;
            clearTimeout(previewTimer);
            document.body.classList.remove("in-live");
            if (!TV.osd.isOpen() && !TV.multiview.isOpen()) { TV.player.stop(); playing = null; }
        },
        enter: function () { zone = cards.items.length ? "cards" : "chips"; cards.setActive(zone === "cards"); paintChips(); schedulePreview(cards.current()); },
        blur: function () { cards.setActive(false); paintChips(); },
        key: function (code) {
            var K = TV.KEY, d = TV.digit(code);
            if (d >= 0) { TV.osd.number(d, function (num) { var ch = findNumber(num); if (ch) { select(ch.id); fullScreen(ch); } else TV.toast(T("No channel {n}", { n: num })); }); return true; }
            if (code === K.CH_UP || code === K.CH_DOWN) { zone = "cards"; cards.setActive(true); paintChips(); if (!cards.move(code === K.CH_UP ? -1 : 1)) TV.sound.edge(); return true; }
            if (zone === "chips") {
                if (code === K.LEFT || code === K.RIGHT) {
                    var n = catIndex + (code === K.LEFT ? -1 : 1);
                    if (n < 0 || n >= cats.length) { TV.sound.edge(); return true; }
                    catIndex = n; TV.sound.tick(); paintChips();
                    clearTimeout(chipTimer);
                    chipTimer = setTimeout(function () { loadCategory(); }, 380);
                    return true;
                }
                if (code === K.DOWN) { if (cards.items.length) { zone = "cards"; cards.setActive(true); paintChips(); TV.sound.tick(); } else TV.sound.edge(); return true; }
                if (code === K.UP) return false;
                return true;
            }
            switch (code) {
                case K.LEFT: if (!cards.move(-1)) TV.sound.edge(); return true;
                case K.RIGHT: if (!cards.move(1)) TV.sound.edge(); return true;
                case K.UP: zone = "chips"; cards.setActive(false); paintChips(); TV.sound.tick(); return true;
                case K.DOWN: TV.sound.edge(); return true;
                case K.PLAY: case K.PLAYPAUSE: if (cards.current()) fullScreen(cards.current()); return true;
            }
            return false;
        },
        ok: function () {
            if (zone === "chips" && cats[catIndex] && cats[catIndex].id === "pick") {
                var cur = TV.pref("liveCat");
                pickCategory(cur, function (c) {
                    for (var i = 0; i < cats.length; i++) if (cats[i].id === c.id) { catIndex = i; break; }
                    loadCategory();
                    zone = cards.items.length ? "cards" : "chips"; cards.setActive(zone === "cards"); paintChips();
                }, cats.filter(function (x) { return x.id === "fav" || x.id === "recent" || x.id === "all" || x.mine; }));
                return;
            }
            if (zone === "chips") { clearTimeout(chipTimer); loadCategory(); if (cards.items.length) { zone = "cards"; cards.setActive(true); paintChips(); } return; }
            var ch = cards.current();
            if (ch) fullScreen(ch);
        },
        canHold: function () { return zone === "cards" ? !!cards.current() : zone === "chips" && !!(cats[catIndex] && (cats[catIndex].kind || cats[catIndex].mine)); },
        longOk: function () {
            if (zone === "chips" && cats[catIndex] && cats[catIndex].mine) { groupChipMenu(cats[catIndex]); return; }
            if (zone === "chips") {                 // OK held on a category: hide it, or its whole country
                TV.categoryMenu(cats[catIndex], function () {
                    cats = categories(); catIndex = Math.min(catIndex, cats.length - 1); buildChips(); paintChips(); loadCategory();
                });
                return;
            }
            var ch = cards.current(); if (ch) channelMenu(ch);
        },
        refresh: function () {
            if (!visible || TV.osd.isOpen() || TV.multiview.isOpen() || !cards) return;
            TV.uncalm(refreshJob);
            refreshJob = TV.calm(function () {
                if (!visible || TV.osd.isOpen() || TV.multiview.isOpen()) return;
                if (TV.mark) TV.mark("refresh");
                for (var k in cards.cards) if (cards.cards[k]._update) cards.cards[k]._update();
                if (infoFor === cards.current()) showInfo(cards.current());
            }, 500);
        },
        backHandled: function () { if (zone === "chips") { zone = "cards"; cards.setActive(true); paintChips(); return true; } return false; },
        playChannel: function (ch) { fullScreen(ch); }
    };

    TV.epg.onUpdate(function () { view.refresh(); });
    setInterval(function () { view.refresh(); }, 60000);
    TV.views = TV.views || {};
    TV.views.live = view;
    TV.live = { play: function (ch, ctx) { fullScreen(ch, ctx); }, findNumber: findNumber, playChannel: function (ch, rect) { playChannel(ch, rect); }, pickCategory: pickCategory, guideMenu: guideMenu };
})(window);
