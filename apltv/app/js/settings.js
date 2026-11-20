/* ============================================================
   settings.js: Settings, in APL Launcher's split view (a large icon and
   what the row does on the left, pill rows on the right).
   - Playlists: yours (channels, movies, series counted, Xtream end date),
     add one from your phone (QR code) or with the remote, rename, guide
     address, refresh, delete.
   - Playback, Display, TV guide, About.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var root, heroIcon, heroDesc, listWrap, listEl, nav, pages = [], visible = false, pollTimer = null;

    function build() {
        root = TV.$("v-settings");
        root.innerHTML = "";
        var hero = el("div", "sheet__hero");
        heroIcon = el("div", "sheet__icon");
        heroDesc = el("div", "sheet__desc");
        hero.appendChild(heroIcon); hero.appendChild(heroDesc);
        listWrap = el("div", "sheet__listwrap");
        listEl = el("div", "sheet__list");
        listWrap.appendChild(listEl);
        root.appendChild(hero); root.appendChild(listWrap);
    }

    /* ---------- pages ---------- */
    function fmtCount(src) {
        if (src.type === "stremio" && !src.error) return T("{n} addons", { n: (src.addons || []).length });
        if (src.error) return T("Error");
        var c = src.counts;
        if (!c) return T("Not loaded");
        var bits = [];
        if (c.live) bits.push(c.live === 1 ? T("1 channel") : T("{n} channels", { n: c.live.toLocaleString(TV.locale) }));
        if (c.movies) bits.push(c.movies === 1 ? T("1 movie") : T("{n} movies", { n: c.movies.toLocaleString(TV.locale) }));
        if (c.series) bits.push(c.series === 1 ? T("1 series") : T("{n} series", { n: c.series.toLocaleString(TV.locale) }));
        return bits.join(" · ") || T("Empty");
    }
    function toggleRow(label, key, desc, after) {
        return { label: label, value: TV.pref(key) ? T("On") : T("Off"), desc: desc, run: function () { TV.setPref(key, !TV.pref(key)); if (after) after(); redraw(); } };
    }
    function typeLabel(s) {
        return s.type === "xtream" ? T("Xtream account") : s.type === "stalker" ? T("Stalker Portal (MAG)") : s.type === "plex" ? T("Plex server") :
               s.type === "stremio" ? T("Stremio account") : s.type === "free" ? T("Free of rights, from Wikidata") :
               s.type === "jellyfin" ? (s.kind === "emby" ? T("Emby server") : T("Jellyfin server")) : T("M3U playlist");
    }
    function ownLibrary(s) { return s.type === "jellyfin" || s.type === "plex" || s.type === "stremio" || s.type === "free"; }
    function typeIcon(s) { return s.type === "m3u" ? "list" : ownLibrary(s) ? "film" : "link"; }
    function mainPage() {
        var rows = [{ section: T("Playlists") }];
        D.sources().forEach(function (s) {
            rows.push({ label: s.name, value: fmtCount(s), acc: "chevron", icon: typeIcon(s),
                desc: typeLabel(s) + (s.error ? "\n" + s.error : "") + (s.at ? "\n" + T("Updated {d}", { d: new Date(s.at).toLocaleString(TV.locale) }) : ""),
                run: function () { push(sourcePage(s.id)); } });
        });
        if (D.sources().length) rows.push({ label: T("Edit on Your Phone"), acc: "chevron", icon: "phone", desc: T("Hide and order your categories, make your groups of channels, order your favorites, rename or hide channels on your phone, then send it all to the TV."),
            run: function () { push(editPhonePage()); } });
        rows.push({ label: T("Add a Playlist"), acc: "chevron", icon: "plus", desc: T("Your M3U playlist, your Xtream account, a Stalker portal, or your own media server (Jellyfin, Emby, Plex)."), run: function () { push(addPage()); } });
        rows.push({ section: T("Playback") });
        rows.push(toggleRow(T("Automatic Preview"), "autoPreview", T("In Live TV, staying on a channel plays it behind the list. Off: a channel only plays when you press OK.")));
        rows.push(toggleRow(T("Sort the Categories"), "tidyCats", T("Your screen's language first, adult ones last. Off: the order of your playlist."), function () { D.rebuild(); }));
        rows.push(toggleRow(T("Tidy the Names"), "tidyNames", T("Country and quality tags (FR|, FHD, 4K…) taken out of the names. Off: the names of your playlist."), function () { D.rebuild(); }));
        rows.push(toggleRow(T("Group HD, FHD and 4K"), "mergeQuality", T("One line per channel, the best quality first. Hold OK on it to choose another."), function () { D.rebuild(); }));
        rows.push({ label: T("Channel Order"), value: TV.pref("chanOrder") === "az" ? T("A to Z") : T("Playlist Order"),
            desc: T("In Live TV, the TV Guide and your favorites. A to Z: by name. Playlist order: as your provider ordered them (and you, for your favorites and groups)."),
            run: function () { TV.setPref("chanOrder", TV.pref("chanOrder") === "az" ? "list" : "az"); D.rebuild(); redraw(); } });
        rows.push({ label: T("Audio Language"), value: langLabel(TV.pref("audioLang")), acc: "chevron", desc: T("The language movies and series start in, when the video has it."),
            run: function () { choose(T("Audio Language"), "audioLang", [["auto", T("Screen Language")], ["orig", T("Original Version")]].concat(langChoices())); } });
        rows.push({ label: T("Second Audio Language"), value: langLabel(TV.pref("audioLang2")), acc: "chevron", desc: T("Used when the first language is not in the video."),
            run: function () { choose(T("Second Audio Language"), "audioLang2", [["none", T("None")], ["orig", T("Original Version")]].concat(langChoices())); } });
        rows.push({ label: T("Subtitles"), value: langLabel(TV.pref("subLang"), true), acc: "chevron", desc: T("Automatic: subtitles in your language only when the sound is in another language."),
            run: function () { choose(T("Subtitles"), "subLang", [["auto", T("Automatic")], ["off", T("Off")]].concat(langChoices())); } });
        rows.push({ label: T("Second Subtitle Language"), value: langLabel(TV.pref("subLang2"), true), acc: "chevron", desc: T("Used when the first subtitle language is not in the video."),
            run: function () { choose(T("Second Subtitle Language"), "subLang2", [["off", T("None")]].concat(langChoices())); } });
        rows.push({ label: T("Subtitle Style"), acc: "chevron", icon: "cc", desc: T("Size, colour, background and position of the subtitles."), run: function () { push(subStylePage()); } });
        rows.push(toggleRow(T("Pick Up Where You Left Off"), "resumePrompt", T("When APL TV opens, it offers the movie or episode you were watching at the minute you stopped, or the last channel.")));
        rows.push(toggleRow(T("Autoplay Next Episode"), "autoNext", T("Off: near the end of an episode, the next one is only offered (with the series' picture, never a spoiler).")));
        rows.push(toggleRow(T("Pause Live TV (Timeshift)"), "timeshift", T("Pause a channel and go back in it (◀ ▶ 10 s): APL TV keeps it from the moment you pause, up to an hour. Play/Pause or the first button of the bar pauses, Stop goes back to live.")));
        rows.push({ label: T("Live Stream Format"), value: TV.pref("liveFormat") === "m3u8" ? "HLS (m3u8)" : "MPEG-TS", desc: T("For Xtream accounts. Try HLS if channels stutter or do not start."),
            // your choice: APL TV no longer changes it by itself (a frozen picture, HLS refused; js/live.js)
            run: function () { TV.setPref("liveFormat", TV.pref("liveFormat") === "m3u8" ? "ts" : "m3u8"); TV.setPref("liveFormatMine", 1); redraw(); } });
        rows.push({ label: T("Picture Size"), value: { fit: T("Fit to Screen"), fill: T("Fill the Screen"), auto: T("Original Shape") }[TV.pref("pictureMode")] || T("Fit to Screen"), acc: "chevron", icon: "aspect",
            desc: T("How movies, series and channels fill the screen. Also in the player, third button at the top right."),
            run: function () { choose(T("Picture Size"), "pictureMode", [["fit", T("Fit to Screen")], ["fill", T("Fill the Screen")], ["auto", T("Original Shape")]]); } });
        // Android's player can shift the sound against the picture (Samsung's and LG's can't: their own sound settings do it)
        if (TV.ANDROID && global.APLAndroid && global.APLAndroid.audioDelay) rows.push({ label: T("Sound Delay (AV Sync)"), value: delayLabel(+TV.pref("audioDelay") || 0), acc: "chevron",
            desc: T("When the sound and the picture don't match: later if you hear the words before the lips move, earlier if after. Applies at once, even while watching."),
            run: function () { choose(T("Sound Delay (AV Sync)"), "audioDelay", delaySteps().map(function (n) { return [n, delayLabel(n)]; })); } });
        rows.push({ section: T("Display") });
        // js/core.js TV.SMALL: Automatic follows the memory of the device; a change restarts APL TV
        var LIGHT = [["auto", T("Automatic")], ["on", T("On")], ["off", T("Off")]], ram = TV.RAM_MB ? (TV.RAM_MB / 1024).toFixed(1).replace(".", TV.lang === "en" ? "." : ",") + " " + T("GB") : "";
        if (TV.ANDROID) rows.push({ label: T("Light Mode"), acc: "chevron",
            value: TV.pref("lightMode") === "on" ? T("On") : TV.pref("lightMode") === "off" ? T("Off") : T("Automatic") + " · " + (TV.LOW_RAM ? T("On") : T("Off")),
            desc: T("For a TV or a stick with little memory, or one that lags: Home with 2 catalogs, smaller covers, the playlist refreshed only when nothing plays, the TV guide and the animations off. Automatic: on with 1 GB of memory, off with 2 GB or more.") +
                  (ram ? " " + T("This screen: {ram}.", { ram: ram }) : "") + " " + T("APL TV restarts to apply it."),
            run: function () {
                var was = TV.pref("lightMode");
                choose(T("Light Mode"), "lightMode", LIGHT, function () { if (TV.pref("lightMode") !== was) setTimeout(function () { global.location.reload(); }, 300); });
            } });
        rows.push(toggleRow(T("Sports Tab"), "sportsTab", T("The Sports tab in the top bar. Off: it goes away, and Sports loads nothing at all."), function () { TV.shell.retab(); }));
        rows.push({ label: T("Adult Content"), value: TV.pref("showAdult") ? T("Shown") : T("Hidden"), desc: T("Categories and channels for adults are hidden everywhere."),
            run: function () {
                if (TV.pref("showAdult")) { TV.setPref("showAdult", false); D.rebuild(); redraw(); return; }
                TV.alert({ title: T("Show adult content?"), message: T("Adult categories will appear in Live TV, Movies, Series and search."), buttons: [
                    { label: T("Cancel") }, { label: T("Show"), run: function () { TV.setPref("showAdult", true); D.rebuild(); redraw(); } }] });
            } });
        rows.push({ label: T("Age Ratings"), value: TV.pref("ageRegion") && TV.pref("ageRegion") !== "auto" ? countryName(TV.pref("ageRegion")) : T("Automatic") + " (" + countryName(TV.meta.ageCountry()) + ")", acc: "chevron",
            desc: T("Each country has its own ratings (France: -12, -16; United States: PG-13, R…). Automatic: the screen's country."),
            run: function () { choose(T("Age Ratings"), "ageRegion", [["auto", T("Automatic")]].concat(TV.meta.ageCountries.map(function (c) { return [c, countryName(c)]; }))); } });
        rows.push({ label: T("Countries and Categories"), value: D.offCats() ? T("{n} hidden", { n: D.offCats() }) : T("All Shown"), acc: "chevron", icon: "eyeOff",
            desc: T("Hide the countries and categories of your playlists you never watch: their channels, movies and series disappear everywhere."), run: function () { push(countriesPage()); } });
        rows.push({ label: T("Hidden Themes"), value: String(D.themesOn().length), acc: "chevron", icon: "eyeOff",
            desc: T("Choose themes you never want to see: the movies and series TMDB tags with them disappear everywhere."), run: function () { push(themesPage()); } });
        rows.push({ label: T("Hidden Titles"), value: String(D.hiddenList().length), acc: "chevron", icon: "eyeOff", desc: T("Movies and series you chose to hide. OK to see them and bring one back."),
            run: function () { push(hiddenPage()); } });
        rows.push({ label: T("Hidden Channels"), value: String(D.hiddenChanList().length), acc: "chevron", icon: "eyeOff", desc: T("Channels you chose to hide. OK to see them and bring one back."),
            run: function () { push(hiddenChansPage()); } });
        rows.push(toggleRow(T("Interface Sounds"), "sounds", T("The sounds of APL Launcher when you move and press OK.")));
        rows.push(toggleRow(T("Animations"), "motion", T("Off: everything appears at once."), applyMotion));
        if (TV.saver) {
            var scr = TV.saver.screen(), sp = TV.pref("screenSaver");
            rows.push({ label: T("Screen Protection (OLED)"), acc: "chevron",
                value: sp === "on" ? T("On") : sp === "off" ? T("Off") : T("Automatic") + " (" + (scr.oled ? T("On") : T("Off")) + ")",
                desc: T("Against burn-in on OLED screens: the interface moves a few pixels every 2 minutes, and after 5 minutes without the remote while nothing plays, pictures from your catalog move slowly with the time. Automatic: on for screens recognised as OLED.") + "\n" +
                      (scr.oled ? T("This screen: OLED ({model})", { model: scr.model }) : T("This screen: not recognised as OLED ({model})", { model: scr.model || "?" })),
                run: function () { choose(T("Screen Protection (OLED)"), "screenSaver", [["auto", T("Automatic")], ["on", T("On")], ["off", T("Off")]]); } });
        }
        rows.push({ label: T("Time Format"), value: TV.pref("timeFormat") === "12" ? "12 h" : "24 h", run: function () { TV.setPref("timeFormat", TV.pref("timeFormat") === "12" ? "24" : "12"); redraw(); } });
        // A list rather than OK going round the languages: each change restarts APL TV
        var LANGUAGES = [["auto", T("Automatic")], ["en", "English"], ["fr", "Français"], ["es", "Español"], ["it", "Italiano"], ["pl", "Polski"]];
        rows.push({ label: T("Language"), acc: "chevron", value: { auto: T("Automatic"), en: "English", fr: "Français", es: "Español", it: "Italiano", pl: "Polski" }[TV.pref("language")] || T("Automatic"), desc: T("APL TV restarts in the new language."),
            run: function () {
                var was = TV.pref("language");
                choose(T("Language"), "language", LANGUAGES, function () {
                    if (TV.pref("language") !== was) setTimeout(function () { global.location.reload(); }, 300);
                });
            } });
        rows.push({ section: T("TV Guide") });
        rows.push(toggleRow(T("TV Guide"), "tvGuide", T("Off: no programmes are downloaded or shown. Lighter on a slow TV, where a large guide keeps the processor busy for minutes."),
            function () { if (TV.pref("tvGuide")) TV.epg.loadAll(true); else TV.epg.clear(); if (TV.SMALL && TV.shell && TV.shell.retab) TV.shell.retab(); }));
        if (TV.pref("tvGuide")) rows.push({ label: T("Update the TV Guide"), icon: "refresh", desc: T("Downloads the programmes of the next 24 hours again."), run: function () {
            TV.toast(T("Updating the TV guide…"));
            TV.epg.loadAll(true).then(function () { TV.toast(T("TV guide updated")); });
        } });
        if (TV.pref("tvGuide")) rows.push({ label: T("Your Guides"), value: (TV.pref("myGuides") || []).length ? String((TV.pref("myGuides") || []).length) : T("None"), acc: "chevron", icon: "plus",
            desc: T("Add the address of an XMLTV guide (.xml or .xml.gz): its programmes fill the channels your provider's guide misses. Matched by channel name."), run: function () { push(guidesPage()); } });
        rows.push({ section: T("Movie and Series Information") });
        var src = TV.meta.keySource();
        rows.push({ label: T("TMDB Key"), value: src === "setup" ? T("From APL Launcher Setup") : (src ? "••••••••" : T("Not set")), acc: src === "setup" ? undefined : "chevron",
            desc: T("Plots, pictures, ratings, genres and More Like This come from TMDB. Get a free key at themoviedb.org › Settings › API, then type it here."),
            run: function (row) {
                if (src === "setup") return;
                // typed with the remote here, or on the phone (the key alone: the playlist fields stay empty)
                TV.menu(T("TMDB Key"), [{ label: T("With the Remote"), icon: "keyboard", run: function () { remote(row); } },
                                        { label: T("From Your Phone"), icon: "phone", run: function () { push(phonePage()); } }]);
            } });
        function remote(row) {
                edit(row, { value: TV.load("tmdbKey", ""), onDone: function (v) {
                    v = String(v || "").replace(/\s+/g, "");
                    if (!v) { TV.save("tmdbKey", ""); TV.meta.setKey(""); redraw(); return; }
                    TV.meta.testKey(v).then(function (ok) {
                        if (!ok) { TV.toast(T("TMDB did not accept this key.")); redraw(); return; }
                        TV.save("tmdbKey", v); TV.meta.setKey(v);
                        TV.toast(T("TMDB key saved"));
                        redraw();
                    });
                } });
        }
        rows.push({ section: T("Voice") });
        var code = TV.voice ? TV.voice.relayCode() : "";
        rows.push({ label: T("Alexa Skill"), value: code ? T("On") : T("Off"), acc: "chevron",
            desc: code ? T("Say: “Alexa, ask APL TV to search Dragon Ball”. The code to put in your APL TV skill:") + "\n" + code
                       : T("With your own APL TV skill for Alexa (see the README): “Alexa, ask APL TV to search Dragon Ball”. Pause, play and next episode work without it."),
            run: function () {
                var items = [{ label: code ? T("New Code") : T("Turn On"), run: function () { TV.voice.newRelayCode(); redraw(); } }];
                if (code) items.push({ label: T("Turn Off"), danger: true, run: function () { TV.voice.setRelayCode(""); redraw(); } });
                TV.menu(T("Alexa Skill"), items);
            } });
        rows.push({ section: T("Updates") });
        rows.push(toggleRow(T("Automatic Updates"), "autoUpdate", T("APL TV checks GitHub every 6 hours and updates itself, then restarts when nothing is playing. Your playlists and settings stay.")));
        rows.push({ label: T("Check for Updates"), icon: "refresh", run: function () { if (TV.updater) TV.updater.check(true); } });
        if (TV.updater && TV.updater.fromBundle()) rows.push({ label: T("Back to the Installed Version"), value: TV.updater.installed(), acc: "chevron",
            desc: TV.TIZEN ? T("Runs the version installed with APL Launcher Setup again, until the next update.") : T("Runs the installed version again, until the next update."), run: function () { TV.updater.reset(); } });
        rows.push({ section: T("About") });
        rows.push({ label: T("Refresh All Playlists"), icon: "refresh", run: function () { refreshAll(); } });
        // js/crash.js: after a stop without warning, a report for the developer
        var CRASH = [["ask", T("Ask")], ["always", T("Always Send")], ["never", T("Never")]];
        rows.push({ label: T("Crash Reports"), acc: "chevron", value: { ask: T("Ask"), always: T("Always Send"), never: T("Never") }[TV.pref("crashReports")] || T("Ask"),
            desc: T("When APL TV stopped unexpectedly, the next start offers to send a report to the developer: the last lines of APL TV's log, your TV's model and the app's version. Never a password or a playlist address."),
            run: function () { choose(T("Crash Reports"), "crashReports", CRASH); } });
        if (TV.crash) rows.push({ label: T("Send a Report"), acc: "chevron",
            desc: T("Something doesn't work? Right after the problem, send the developer what APL TV did: the last lines of its log, your TV's model and the app's version, with a code to give on GitHub."),
            run: function () { TV.crash.manual(); } });
        if (TV.DONATE) rows.push({ label: T("Support APL TV"), acc: "chevron", icon: "star",
            desc: T("APL TV is free and made by one person. If you like it, you can buy me a coffee on Ko-fi: OK shows a code to scan with your phone."),
            run: function () {
                var qr = el("div", "alert__qr");
                qr.appendChild(TV.qr.canvas(TV.DONATE, 360));
                qr.appendChild(el("div", "alert__qrurl", esc(TV.DONATE.replace(/^https?:\/\//, ""))));
                TV.alert({ title: T("Support APL TV"), message: T("Scan the code with your phone's camera. Thank you!"), node: qr });
            } });
        rows.push({ label: "APL TV", value: T("Version {v}", { v: TV.VERSION }) + (TV.ANDROID ? " · " + T("Package {v}", { v: apkVersion() || T("older than 1.0.15") }) : ""),
                    desc: T("Created by Knikt (Gero Corp.)") + "\n" + T("A player for your own playlists. APL TV comes with no channels.") });
        rows.push({ label: T("Credits"), desc: T("Film and series data and pictures: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.") + "\n" + T("IMDb ratings: Stremio's Cinemeta. Subtitles: OpenSubtitles. TV guides: your provider, epg.pw and iptv-epg.org.") + "\n" +
            T("Sports: scores, match photos and broadcasters by ESPN, other sports by 365Scores, Ligue 1 and Ligue 2 channels by the LFP, stadium photos from Wikipedia (Wikimedia Commons, free licences), video summaries on YouTube from the official channels.") });
        return { title: T("Settings"), icon: "gear", desc: T("Your playlists and how APL TV works."), rows: rows };
    }

    /* ---------- languages, subtitles, hidden titles ---------- */
    function countryName(c) {
        var n = { FR: "France", BE: "Belgique / België", CH: "Suisse / Schweiz", CA: "Canada", US: "United States", GB: "United Kingdom", DE: "Deutschland", ES: "España", IT: "Italia", NL: "Nederland", PT: "Portugal", BR: "Brasil" };
        return n[c] || c;
    }
    function langChoices() { return TV.langs.list.map(function (c) { return [c, TV.langs.name(c)]; }); }
    function langLabel(v, subs) {
        if (v === "auto") return subs ? T("Automatic") : T("Screen Language");
        if (v === "orig") return T("Original Version");
        if (v === "off" || v === "none") return subs ? T("Off") : T("None");
        return TV.langs.name(v);
    }
    function choose(title, key, list, after) {
        TV.menu(title, list.map(function (o) {
            // opened on the value in use (the sound delay's list has 41 steps: "None" is in its middle)
            return { label: o[1], check: TV.pref(key) === o[0], focus: TV.pref(key) === o[0], run: function () { TV.setPref(key, o[0]); if (after) after(); redraw(); } };
        }));
    }
    function subStylePage() {
        var O = TV.subtitles.options;
        function row(label, key, list) {
            var v = ""; list.forEach(function (o) { if (o[0] === TV.pref(key)) v = T(o[1]); });
            return { label: label, value: v, acc: "chevron", run: function () { choose(label, key, list.map(function (o) { return [o[0], T(o[1])]; }), TV.subtitles.apply); } };
        }
        return { title: T("Subtitle Style"), icon: "cc", desc: T("What subtitles look like in movies and series."), preview: subPreview, rebuild: subStylePage, rows: [
            row(T("Size"), "subSize", O.size), row(T("Colour"), "subColor", O.color), row(T("Background"), "subBg", O.bg), row(T("Position"), "subPos", O.pos)
        ] };
    }
    function subPreview() {
        return "<div class='subprev subSize-" + TV.pref("subSize") + " subColor-" + TV.pref("subColor") + " subBg-" + TV.pref("subBg") + " subPos-" + TV.pref("subPos") + "'>" +
            "<div class='osd__subs'><span>" + esc(T("This is how subtitles look.")) + "</span></div></div>";
    }
    function themesPage() {
        var on = D.themesOn();
        var rows = TV.meta.themes().map(function (t) {
            var hid = on.indexOf(t.id) >= 0;
            return { label: t.name, value: hid ? T("Theme Hidden") : T("Visible"), desc: T("Titles TMDB tags with this theme disappear from Home, the grids, search and More Like This. A title that is not tagged can still appear: hide it with OK held."),
                run: function () {
                    var l = D.themesOn().slice(), i = l.indexOf(t.id);
                    if (i >= 0) l.splice(i, 1); else l.push(t.id);
                    TV.setPref("hiddenThemes", l);
                    TV.toast(i >= 0 ? T("“{name}” shown again", { name: t.name }) : T("“{name}” hidden", { name: t.name }));
                    D.buildThemes();
                    replaceTop(themesPage());
                } };
        });
        return { title: T("Hidden Themes"), icon: "eyeOff", desc: T("Themes you hide disappear from APL TV."), rows: rows, rebuild: themesPage };
    }
    /* Your own XMLTV guides (#26): an address typed with the remote; OK on one removes it */
    function guidesPage() {
        var list = TV.pref("myGuides") || [];
        var rows = list.map(function (u) {
            return { label: u.split("/")[2] || u, desc: u, run: function () {
                TV.alert({ title: T("Remove this guide?"), message: u, buttons: [{ label: T("Cancel") }, { label: T("Remove"), run: function () {
                    TV.setPref("myGuides", (TV.pref("myGuides") || []).filter(function (x) { return x !== u; }));
                    TV.epg.loadAll(true);
                    replaceTop(guidesPage());
                } }] });
            } };
        });
        rows.push({ label: T("Add a Guide"), acc: "chevron", icon: "plus", desc: T("The address of an XMLTV guide, .xml or .xml.gz, for example from epgshare01.online."), run: function () {
            TV.editText({ value: "https://", url: true, onDone: function (t) {
                t = String(t || "").trim();
                if (!/^https?:\/\/\S+\.\S+/i.test(t)) { TV.toast(T("The address must start with http:// or https://")); return; }
                var l = (TV.pref("myGuides") || []).slice();
                if (l.indexOf(t) < 0) l.push(t);
                TV.setPref("myGuides", l);
                TV.toast(T("Guide added: its programmes arrive in a moment"));
                TV.epg.loadAll(true);
                replaceTop(guidesPage());
            } });
        } });
        rows.push(toggleRow(T("Your Guides First"), "myGuidesFirst", T("On: a channel your guide has shows its programmes instead of your provider's. Off: your guides only fill the channels without programmes."),
            function () { TV.epg.loadAll(true); }));
        return { title: T("Your Guides"), desc: T("XMLTV guides you add, for the channels your provider's guide misses."), rows: rows, rebuild: guidesPage };
    }
    /* Countries and Categories: the countries and regions of your playlists, most channels and titles first */
    function countriesPage() {
        var rows = D.offGroups().map(function (g) {
            var all = g.off === g.cats.length;
            return { label: g.name + (g.id && g.name !== g.id ? " (" + g.id + ")" : ""), acc: "chevron",
                value: all ? T("Hidden") : g.off ? T("{n} of {m} hidden", { n: g.off, m: g.cats.length }) : T("Visible"),
                desc: g.id ? T("{n} categories. OK: hide the whole country, or only some of its categories.", { n: g.cats.length }) : T("{n} categories without a country in their name. OK: choose the ones to hide.", { n: g.cats.length }),
                run: function () { push(groupPage(g.id)); } };
        });
        if (!rows.length) rows.push({ label: T("No playlist yet"), desc: T("Add one in Settings.") });
        return { title: T("Countries and Categories"), icon: "eyeOff", desc: T("What you hide here disappears from Live TV, the guide, Movies, Series, Home and search. Your favorite channels stay."), rows: rows, rebuild: countriesPage };
    }
    function groupPage(id) {
        var g = D.offGroups().filter(function (x) { return x.id === id; })[0];
        if (!g) return countriesPage();
        var whole = (TV.pref("hiddenGroups") || []).indexOf(id) >= 0, rows = [], last = "";
        var KIND = { live: T("Live TV"), movie: T("Movies"), series: T("Series") };
        if (id) rows.push({ label: whole ? T("Show Everything from {name}", { name: g.name }) : T("Hide Everything from {name}", { name: g.name }), action: true,
            desc: whole ? T("All its categories come back.") : T("All its categories disappear, and the ones it adds later too."),
            run: function () {
                D.setGroupOff(id, !whole);
                TV.toast(whole ? T("“{name}” shown again", { name: g.name }) : T("“{name}” is hidden", { name: g.name }));
                replaceTop(groupPage(id));
            } });
        g.cats.forEach(function (c) {
            if (c.kind !== last) { last = c.kind; rows.push({ section: KIND[c.kind] || "" }); }
            rows.push({ label: (c.tag ? c.tag + " · " : "") + c.name, value: c.off ? T("Hidden") : T("Visible"),
                desc: (c.kind === "live" ? T("{n} channels.", { n: c.count }) : c.kind === "movie" ? T("{n} movies.", { n: c.count }) : T("{n} series.", { n: c.count })) + " " + T("OK: hide or show this category."),
                run: function () { D.setCatOff(c, !c.off); replaceTop(groupPage(id)); } });
        });
        return { title: g.name, icon: "eyeOff", desc: T("Hidden categories disappear from APL TV. Your favorite channels stay."), rows: rows, rebuild: function () { return groupPage(id); } };
    }
    function hiddenChansPage() {
        var rows = D.hiddenChanList().map(function (h) {
            return { label: h.t, value: new Date(h.at).toLocaleDateString(TV.locale), desc: T("OK: show this channel again."),
                run: function () { D.unhideChan(h.key); TV.toast(T("“{name}” is back", { name: h.t })); replaceTop(hiddenChansPage()); } };
        });
        if (!rows.length) rows.push({ label: T("No hidden channels"), desc: T("Hold OK on a channel, then choose Hide This Channel.") });
        return { title: T("Hidden Channels"), icon: "eyeOff", desc: T("Hidden channels leave your lists, the guide, Home and search. Your favorites and groups keep them. OK on one brings it back."), rows: rows, rebuild: hiddenChansPage };
    }
    function hiddenPage() {
        var rows = D.hiddenList().map(function (h) {
            return { label: h.t, value: h.kind === "series" ? T("Series") : T("Movie"), desc: T("OK: show this title again."),
                run: function () { D.unhide(h.key); TV.toast(T("“{name}” is back", { name: h.t })); replaceTop(hiddenPage()); } };
        });
        if (!rows.length) rows.push({ label: T("No hidden titles"), desc: T("Hold OK on a movie or a series, then choose Hide This Title.") });
        return { title: T("Hidden Titles"), icon: "eyeOff", desc: T("Hidden titles appear nowhere in APL TV. OK on one brings it back."), rows: rows, rebuild: hiddenPage };
    }

    function sourcePage(id) {
        var s = D.sources().filter(function (x) { return x.id === id; })[0];
        if (!s) return mainPage();
        var rows = [];
        rows.push({ label: T("Name"), value: s.name, acc: "chevron", run: function (row) {
            edit(row, { value: s.name, onDone: function (v) { if (v) { D.updateSource(id, { name: v }); D.rebuild(); } redraw(); } });
        } });
        if (s.type === "xtream") {
            rows.push({ label: T("Server"), value: s.server });
            rows.push({ label: T("Username"), value: s.user });
            rows.push({ label: T("Password"), value: "••••••••", secret: true });
            if (s.account) {
                if (s.account.exp) rows.push({ label: T("Subscription Ends"), value: new Date(s.account.exp).toLocaleDateString(TV.locale) });
                if (s.account.max) rows.push({ label: T("Screens at Once"), value: String(s.account.max) });
            }
        } else if (s.type === "stalker") {
            rows.push({ label: T("Portal Address"), value: String(s.portal || "").replace(/^(https?:\/\/[^\/]+).*$/, "$1/…") });
            rows.push({ label: T("MAC Address"), value: s.mac || "" });
            // a MAG box's serial number and device IDs, for the portals that check them (issue #19)
            [["sn", T("Serial Number")], ["id1", T("Device ID 1")], ["id2", T("Device ID 2")]].forEach(function (k) {
                rows.push({ label: k[1], value: s[k[0]] || T("Not set"), acc: "chevron", desc: T("Only if your provider asks for it: the serial number and device IDs of the MAG box it registered."), run: function (row) {
                    edit(row, { value: s[k[0]] || "", onDone: function (v) {
                        var ch = {}; ch[k[0]] = String(v || "").trim(); s[k[0]] = ch[k[0]];
                        D.updateSource(id, ch);
                        loadWithProgress(s, function () { replaceTop(sourcePage(id)); });
                    } });
                } });
            });
        } else if (s.type === "jellyfin") {
            rows.push({ label: T("Server"), value: s.server });
            rows.push({ label: T("Username"), value: s.user });
            // changed on the server: typed again here, then signed in once with it (js/media.js stops trying by
            // itself after a refusal). Nothing typed (Back closes the keyboard and keeps the text, js/ui.js): a
            // password already set stays as it is, and no sign-in is sent. The page is built again after, so the
            // row and the source's state show what is now true
            rows.push({ label: T("Password"), value: s.pass ? "••••••••" : T("None"), secret: true, acc: "chevron", run: function (row) {
                edit(row, { value: "", secret: true, onCancel: function () { redraw(); }, onDone: function (v) {
                    if (!v && s.pass) { redraw(); return; }
                    s.pass = v; s.refused = false;
                    D.updateSource(id, { pass: v, refused: false });
                    loadWithProgress(s, function () { replaceTop(sourcePage(id)); });
                } });
            } });
        } else if (s.type === "plex") {
            rows.push({ label: T("Server"), value: s.name });
            rows.push({ label: T("Link the Screen Again"), icon: "link", acc: "chevron", desc: T("If Plex asks for it, or after you changed your Plex password."), run: function () { push(plexPage(s.id)); } });
        } else if (s.type === "stremio") {
            rows.push({ label: T("Account"), value: s.email || "Stremio" });
            rows.push({ label: T("How It Works"), icon: "info", acc: "chevron", desc: T("Stremio in APL TV, step by step: addons, their settings, versions, torrents."), run: function () { push(stremioGuidePage(id)); } });
            rows.push({ label: T("Your Addons"), value: String((s.addons || []).length), acc: "chevron", desc: T("See, set up, order or remove the addons of your Stremio account, without Stremio's app."), run: function () { push(addonsPage(id)); } });
            rows.push({ label: T("Add an Addon"), icon: "plus", acc: "chevron", desc: T("From Stremio's catalog in a press, or its link pasted from your phone."), run: function () { push(addAddonPage(id)); } });
            // torrents play only through a Stremio streaming server (Stremio's app on a computer of your network)
            // Samsung: the torrents play through Stremio's app (its engine), which APL TV opens in the background
            if (TV.TIZEN) rows.push(TV.stremio.stremioInstalled()
                ? { label: T("Torrent Engine"), value: T("Stremio on this TV"), desc: T("APL TV opens Stremio in the background when a torrent plays: nothing to do.") }
                : { label: T("Torrent Engine"), value: T("Not Installed"), desc: T("Install the Stremio app from the Samsung store: APL TV plays the torrents with its engine, and opens it in the background when needed.") });
            rows.push({ label: T("Streaming Server"), value: s.server || T("None"), acc: "chevron",
                desc: T("For the torrents: the address of Stremio's app on a computer of your network, like 192.168.1.20:11470. Direct links play without it."),
                run: function (row) { edit(row, { value: s.server || "", url: true, onDone: function (v) { v = String(v || "").trim(); s.server = v; D.updateSource(id, { server: v }); redraw(); } }); } });
            rows.push({ label: T("Link the Screen Again"), icon: "link", acc: "chevron", desc: T("If Stremio asks for it, or to use another Stremio account."), run: function () { push(stremioPage(s.id)); } });
        } else if (s.type === "free") {
            rows.push({ label: T("Where They Come From"), value: "Wikidata", desc: T("Every movie marked public domain on Wikidata (in the United States for most of them) whose video is on the Internet Archive or Wikimedia Commons. Rights differ from one country to another: check yours before showing a movie in public.") });
        } else rows.push({ label: T("Address"), value: s.url.replace(/^(https?:\/\/[^\/]+).*$/, "$1/…") });
        if (!ownLibrary(s)) rows.push({ label: T("TV Guide Address"), value: s.epg ? s.epg.replace(/^(https?:\/\/[^\/]+).*$/, "$1/…") : (s.type === "xtream" ? T("From the server") : T("From the playlist")), acc: "chevron",
            desc: T("An XMLTV address (.xml or .xml.gz), if your provider gives you one."),
            run: function (row) { edit(row, { value: s.epg || "", url: true, onDone: function (v) { D.updateSource(id, { epg: v }); D.rebuild(); TV.epg.loadAll(true); redraw(); } }); } });
        rows.push({ label: fmtCount(s), desc: s.error || "" });
        rows.push({ label: T("Refresh Now"), icon: "refresh", run: function () {
            // asked for here: a Jellyfin or Emby server that refused the password gets one more try (even when the
            // refusal came in the background after this page was drawn)
            if (s.type === "jellyfin" || s.type === "stremio") { s.refused = false; D.updateSource(id, { refused: false }); }
            loadWithProgress(s, function () { redraw(); });
        } });
        rows.push({ label: T("Delete This Playlist"), danger: true, run: function () {
            TV.alert({ title: T("Delete “{name}”?", { name: s.name }), message: T("Its channels, favorites and guide will be removed from APL TV."), buttons: [
                { label: T("Cancel") }, { label: T("Delete"), danger: true, run: function () { D.removeSource(id); pop(); } }] });
        } });
        return { title: s.name, icon: typeIcon(s), desc: typeLabel(s), rows: rows };
    }

    function addPage() {
        return { title: T("Add a Playlist"), icon: "plus", desc: T("Scan the code with your phone to type or paste your playlist there, or use the remote."), rows: [
            { label: T("From Your Phone"), icon: "phone", acc: "chevron", desc: T("Recommended: scan a QR code, then type or paste your playlist on your phone."), run: function () { push(phonePage()); } },
            { label: T("With the Remote"), icon: "keyboard", acc: "chevron", desc: T("Type the address or your Xtream details with the screen's keyboard."), run: function () { push(formPage({ type: "xtream" })); } },
            { label: T("Your Media Server"), icon: "film", acc: "chevron", desc: T("Jellyfin, Emby, Plex or Stremio: the movies and series of your own server or account."), run: function () { push(mediaPage()); } },
            { label: T("Public Domain Movies"), icon: "film", acc: "chevron", desc: T("Hundreds of movies, shorts and cartoons free of rights, from the Internet Archive and Wikimedia Commons. One press."), run: addFree }
        ] };
    }
    /* The Public Domain Movies: nothing to type. Already there: its page. */
    function addFree() {
        var had = D.sources().filter(function (x) { return x.type === "free"; })[0];
        if (had) { push(sourcePage(had.id)); return; }
        addAndLoad({ type: "free" });
    }
    function mediaPage() {
        return { title: T("Your Media Server"), icon: "film", desc: T("Your own movies and series, from the server where you keep them. They play straight from it."), rows: [
            { label: "Jellyfin / Emby", icon: "film", acc: "chevron", desc: T("The server's address, your user name and your password."), run: function () { push(formPage({ type: "jellyfin" })); } },
            { label: "Plex", icon: "film", acc: "chevron", desc: T("A code appears on the screen: type it on plex.tv/link with your phone or computer."), run: function () { push(plexPage()); } },
            { label: "Stremio", icon: "film", acc: "chevron", desc: T("A code appears on the screen: type it on link.stremio.com. The catalogs and streams of your Stremio addons."), run: function () { push(stremioPage()); } }
        ] };
    }

    /* ---------- edit on the phone: a QR code, the phone's page (service.js), its changes applied here ---------- */
    var editTimer = null;
    function editPhonePage() { return { title: T("Edit on Your Phone"), custom: drawEditPhone, onLeave: stopEditPhone, rows: [] }; }
    function stopEditPhone() { if (editTimer) { clearInterval(editTimer); editTimer = null; TV.helper.editClose(); } }
    function drawEditPhone() {
        root.innerHTML = "";
        var qr = el("div", "qr");
        var box = el("div", "qr__box", "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;color:#888;font-size:24px'>" + esc(T("Starting…")) + "</div>");
        var url = el("div", "qr__url"), pin = el("div", "qr__pin"), state = el("div", "qr__state");
        qr.appendChild(box); qr.appendChild(url); qr.appendChild(pin); qr.appendChild(state);
        var steps = el("div", "steps");
        steps.innerHTML =
            "<div class='step'><b>1</b><span>" + esc(T("Connect your phone to the same Wi-Fi as the screen.")) + "</span></div>" +
            "<div class='step'><b>2</b><span>" + esc(T("Open the camera and point it at the code. Tap the link that appears.")) + "</span></div>" +
            "<div class='step'><b>3</b><span>" + esc(T("Hide or move categories, make your groups, order your favorites, then tap Send to the TV. You can send as many times as you like.")) + "</span></div>";
        var back = el("div", "btn", esc(T("Done")));
        steps.appendChild(back);
        root.appendChild(qr); root.appendChild(steps);
        nav = new TV.Nav({ onSelect: function () { stopEditPhone(); pop(); } });
        nav.setTiles([back]);
        if (TV.shell.focusOn() !== "view") nav.blur();
        if (editTimer) { clearInterval(editTimer); editTimer = null; }
        TV.helper.editStart(D.editData()).then(function (s) {
            var link = s.urls && s.urls[0];
            if (!link) throw new Error(T("The screen is not on a network."));
            box.innerHTML = "";
            box.appendChild(TV.qr.canvas(link, 400));
            url.textContent = link.replace(/\?.*$/, "");
            pin.textContent = T("Code: {code}", { code: s.token });
            state.innerHTML = "<i></i>" + esc(T("Waiting for your phone…"));
            var busy = false;
            editTimer = setInterval(function () {
                if (busy) return;
                busy = true;
                TV.helper.editPending(s.token).then(function (r) {
                    busy = false;
                    if (r.expired) { stopEditPhone(); drawEditPhone(); return; }
                    if (!r.data) return;
                    if (D.applyPhoneEdit(r.data)) {
                        state.innerHTML = "<i></i>" + esc(T("Your changes are on the TV ({time})", { time: TV.hhmm(new Date()) }));
                        TV.toast(T("Your changes from the phone are on the TV"));
                    }
                }, function () { busy = false; });
            }, 1500);
        }).catch(function (e) {
            box.innerHTML = "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;text-align:center;color:#555;font-size:24px;padding:20px'>" +
                esc(e.old ? (TV.ANDROID ? T("Editing on the phone needs the new app package (.apk), installed once: the app updates itself, but not its package ({v}). With Downloader, code {code}.", { v: apkVersion() || T("older than 1.0.11"), code: "9141513" }) : T("Editing on the phone needs the new install once (APL Launcher Setup or the new package).")) :
                    T("The phone page could not start ({e}). Use the remote instead.", { e: e.message })) + "</div>";
        });
    }

    // AV Sync: a second each way, every 50 ms (issue #5: "up to 1000 each way, in 50 increments")
    function delaySteps() { var out = []; for (var n = -1000; n <= 1000; n += 50) out.push(n); return out; }
    function delayLabel(n) { return !n ? T("None") : (n > 0 ? "+" : "\u2212") + Math.abs(n) + " ms \u00B7 " + (n > 0 ? T("sound later") : T("sound earlier")); }
    // Android: the sound's delay given to the player at the start and at each change
    (function () {
        var A = global.APLAndroid;
        if (!TV.ANDROID || !A || !A.audioDelay) return;
        try { A.audioDelay(+TV.pref("audioDelay") || 0); } catch (e) {}
        TV.onPref(function (k, v) { if (k === "audioDelay") { try { A.audioDelay(+v || 0); } catch (e) {} } });
    })();
    // Android: the version of the package (.apk), which the automatic updates don't change; "" for a package before 1.0.15
    function apkVersion() { try { var A = global.APLAndroid; return A && A.version ? String(A.version() || "") : ""; } catch (e) { return ""; } }

    /* ---------- Plex: a code on the screen, typed on plex.tv/link ---------- */
    var plexTimer = null;
    function plexPage(againId) {
        return { title: "Plex", custom: function () { drawPlex(againId); }, onLeave: stopPlex, rows: [] };
    }
    function stopPlex() { clearInterval(plexTimer); plexTimer = null; }
    function drawPlex(againId) {
        root.innerHTML = "";
        var qr = el("div", "qr");
        var box = el("div", "qr__box", "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;color:#888;font-size:24px'>" + esc(T("Starting…")) + "</div>");
        var url = el("div", "qr__url"), pin = el("div", "qr__pin qr__pin--big"), state = el("div", "qr__state");
        qr.appendChild(box); qr.appendChild(url); qr.appendChild(pin); qr.appendChild(state);
        var steps = el("div", "steps");
        steps.innerHTML =
            "<div class='step'><b>1</b><span>" + esc(T("On your phone or computer, go to plex.tv/link (or scan the code) and sign in to Plex.")) + "</span></div>" +
            "<div class='step'><b>2</b><span>" + esc(T("Type the code shown here.")) + "</span></div>" +
            "<div class='step'><b>3</b><span>" + esc(T("APL TV finds your Plex server and loads its movies and series.")) + "</span></div>";
        var back = el("div", "btn", esc(T("Cancel")));
        steps.appendChild(back);
        root.appendChild(qr); root.appendChild(steps);
        nav = new TV.Nav({ onSelect: function () { stopPlex(); pop(); } });
        nav.setTiles([back]);
        if (TV.shell.focusOn() !== "view") nav.blur();
        stopPlex();
        TV.media.plex.pin().then(function (p) {
            box.innerHTML = "";
            box.appendChild(TV.qr.canvas("https://plex.tv/link", 400));
            url.textContent = "plex.tv/link";
            pin.textContent = p.code;
            state.innerHTML = "<i></i>" + esc(T("Waiting for the code…"));
            var t0 = Date.now(), busy = false;
            plexTimer = setInterval(function () {
                if (busy) return;
                if (Date.now() - t0 > 14 * 60000) { stopPlex(); drawPlex(againId); return; }       // a code lasts 15 minutes
                busy = true;
                TV.media.plex.check(p).then(function (token) {
                    busy = false;
                    if (!token || !plexTimer) return;
                    stopPlex();
                    state.innerHTML = "<i></i>" + esc(T("Linked! Finding your server…"));
                    return TV.media.plex.servers(token).then(function (list) { plexChosen(list, token, againId, state); });
                }).catch(function (e) { busy = false; TV.log("plex: " + e.message); });
            }, 2000);
        }).catch(function (e) {
            box.innerHTML = "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;text-align:center;color:#555;font-size:24px;padding:20px'>" +
                esc(T("Plex does not answer right now ({e}).", { e: e.message })) + "</div>";
        });
    }
    function plexChosen(list, token, againId, state) {
        if (!list.length) { state.textContent = T("No Plex server on this account. Is Plex Media Server installed and signed in?"); return; }
        function use(sv) {
            var src = { type: "plex", name: sv.name, token: sv.token, uris: sv.uris, serverId: sv.id, plexToken: token, base: "" };
            if (againId) {
                D.updateSource(againId, { token: sv.token, uris: sv.uris, serverId: sv.id, plexToken: token, base: "" });
                var s = D.sources().filter(function (x) { return x.id === againId; })[0];
                pages = [mainPage()];
                loadWithProgress(s, function () { pages = [mainPage(), sourcePage(againId)]; redraw(); });
                return;
            }
            addAndLoad(src);
        }
        if (list.length === 1) { use(list[0]); return; }
        // several servers (yours, a friend's): you choose
        TV.menu(T("Which Plex Server?"), list.map(function (sv) { return { label: sv.name, icon: "film", run: function () { use(sv); } }; }));
    }

    /* ---------- Stremio: a code on the screen, typed on link.stremio.com ---------- */
    var stremioTimer = null;
    function stremioPage(againId) {
        return { title: "Stremio", custom: function () { drawStremio(againId); }, onLeave: stopStremio, rows: [] };
    }
    function stopStremio() { clearInterval(stremioTimer); stremioTimer = null; }
    function drawStremio(againId) {
        root.innerHTML = "";
        var qr = el("div", "qr");
        var box = el("div", "qr__box", "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;color:#888;font-size:24px'>" + esc(T("Starting…")) + "</div>");
        var url = el("div", "qr__url"), pin = el("div", "qr__pin qr__pin--big"), state = el("div", "qr__state");
        qr.appendChild(box); qr.appendChild(url); qr.appendChild(pin); qr.appendChild(state);
        var steps = el("div", "steps");
        steps.innerHTML =
            "<div class='step'><b>1</b><span>" + esc(T("On your phone or computer, scan the code or go to link.stremio.com, and sign in to Stremio.")) + "</span></div>" +
            "<div class='step'><b>2</b><span>" + esc(T("Type the code shown here, if it asks for it.")) + "</span></div>" +
            "<div class='step'><b>3</b><span>" + esc(T("APL TV loads the catalogs of your Stremio addons. A title plays from the streams they find.")) + "</span></div>" +
            (TV.TIZEN && !TV.stremio.stremioInstalled() ? "<div class='step'><b>4</b><span>" + esc(T("For the torrents, install the Stremio app from the Samsung store too: APL TV opens it in the background when needed.")) + "</span></div>" : "");
        var back = el("div", "btn", esc(T("Cancel")));
        steps.appendChild(back);
        root.appendChild(qr); root.appendChild(steps);
        nav = new TV.Nav({ onSelect: function () { stopStremio(); pop(); } });
        nav.setTiles([back]);
        if (TV.shell.focusOn() !== "view") nav.blur();
        stopStremio();
        TV.stremio.link.create().then(function (p) {
            box.innerHTML = "";
            box.appendChild(TV.qr.canvas(p.link, 400));
            url.textContent = "link.stremio.com";
            pin.textContent = p.code;
            state.innerHTML = "<i></i>" + esc(T("Waiting for the code…"));
            var t0 = Date.now(), busy = false;
            stremioTimer = setInterval(function () {
                if (busy) return;
                if (Date.now() - t0 > 9 * 60000) { stopStremio(); drawStremio(againId); return; }       // a fresh code before this one runs out
                busy = true;
                TV.stremio.link.read(p.code).then(function (key) {
                    busy = false;
                    if (!key || !stremioTimer) return;
                    stopStremio();
                    state.innerHTML = "<i></i>" + esc(T("Linked! Loading your addons…"));
                    return TV.stremio.user(key).then(function (u) {
                        var patch = { authKey: key, email: u.email || "", refused: false };
                        if (againId) {
                            D.updateSource(againId, patch);
                            var s = D.sources().filter(function (x) { return x.id === againId; })[0];
                            pages = [mainPage()];
                            loadWithProgress(s, function () { pages = [mainPage(), sourcePage(againId)]; redraw(); });
                            return;
                        }
                        patch.type = "stremio"; patch.name = "Stremio";
                        addAndLoad(patch);
                    });
                }).catch(function (e) { busy = false; TV.log("stremio link: " + e.message); });
            }, 2500);
        }).catch(function (e) {
            box.innerHTML = "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;text-align:center;color:#555;font-size:24px;padding:20px'>" +
                esc(e.message) + "</div>";
        });
    }


    /* ---------- Stremio: your addons, managed here ---------- */
    function stremioSrc(id) { return D.sources().filter(function (x) { return x.id === id; })[0] || D.sources().filter(function (x) { return x.type === "stremio"; })[0]; }
    /* After a change of addons: the streams follow at once, the catalogs are loaded again in the background */
    function addonsChanged(s, msg) {
        if (msg) TV.toast(msg, true);
        D.loadSource(s, function () {}).then(function () { D.rebuild(); }, function (e) { TV.log("stremio reload: " + e.message); });
    }
    function addonFromPhone(id, url, state) {
        var s = stremioSrc(id);
        if (!s) { state.textContent = T("Link your Stremio account first: Add a Playlist › Your Media Server › Stremio."); return; }
        state.innerHTML = "<i></i>" + esc(T("Adding the addon…"));
        TV.stremio.install(s, url).then(function (r) {
            addonsChanged(s, r.replaced ? T("“{name}” is set up", { name: r.name }) : T("“{name}” is added to your Stremio account", { name: r.name }));
            pages = [mainPage(), sourcePage(s.id), addonsPage(s.id)];
            redraw(0);
        }, function (e) { state.textContent = e.message; });
    }
    function stremioGuidePage(id) {
        return { title: T("Stremio in APL TV"), custom: function () { drawGuide(id); }, rows: [] };
    }
    function drawGuide(id) {
        root.innerHTML = "";
        var steps = el("div", "steps steps--wide");
        [T("Addons do everything in Stremio: some give catalogs (what you see), others streams (what plays), others subtitles. APL TV uses the ones of your account, and Stremio's own app is not needed."),
         T("Add an addon from Stremio's catalog in a press, or paste its link from your phone (Add an Addon)."),
         T("Some addons ask for settings (languages, quality, your debrid service): APL TV shows a code that opens their settings page on your phone, then you paste the link it gives you."),
         T("The streams your addons find for a title are its versions: Play takes the best one in your language, Versions on its page lets you choose another."),
         T("Torrents play through the Stremio app's own engine: install Stremio on this TV, APL TV opens it in the background when one plays (a debrid service set in an addon works too)."),
         T("The order of your addons is the order of their streams: move up the ones you trust most.")
        ].forEach(function (t, i) { steps.appendChild(el("div", "step", "<b>" + (i + 1) + "</b><span>" + esc(t) + "</span>")); });
        var row = el("div", "steps__btns"), a = el("div", "btn", esc(T("Your Addons"))), b = el("div", "btn", esc(T("Add an Addon")));
        row.appendChild(a); row.appendChild(b); steps.appendChild(row);
        root.appendChild(steps);
        nav = new TV.Nav({ onSelect: function (i) { replaceTop(i === 0 ? addonsPage(id) : addAddonPage(id)); } });
        nav.setTiles([a, b]);
        if (TV.shell.focusOn() !== "view") nav.blur();
    }
    function addonsPage(id) {
        var s = stremioSrc(id), rows = [];
        if (!s) return mainPage();
        (s.addons || []).forEach(function (a, i) {
            rows.push({ label: a.m.name || a.url, value: TV.stremio.kinds(a.m).join(" · "), acc: "chevron", desc: a.m.description || "", run: function () { addonMenu(s, a, i); } });
        });
        rows.push({ label: T("Add an Addon"), icon: "plus", acc: "chevron", run: function () { push(addAddonPage(s.id)); } });
        return { title: T("Your Addons"), icon: "list", desc: T("The order is the order of their streams. OK on an addon: set it up, move it or remove it."), rows: rows };
    }
    function addonMenu(s, a, i) {
        var n = (s.addons || []).length, items = [];
        function act(p, msg) { p.then(function () { addonsChanged(s, msg); replaceTop(addonsPage(s.id)); }, function (e) { TV.toast(e.message, true); }); }
        if (a.m.configurable) items.push({ label: T("Set Up on Your Phone"), icon: "phone", run: function () { push(configurePage(s.id, a.url, a.m.name)); } });
        if (i > 0) items.push({ label: T("Move Up"), icon: "sort", run: function () { act(TV.stremio.move(s, a.url, -1)); } });
        if (i < n - 1) items.push({ label: T("Move Down"), icon: "sort", run: function () { act(TV.stremio.move(s, a.url, 1)); } });
        if (!a.locked) items.push({ label: T("Remove from Stremio"), icon: "trash", danger: true, run: function () {
            TV.alert({ title: T("Remove “{name}”?", { name: a.m.name }), message: T("It leaves your Stremio account, on every device. You can add it again later."), buttons: [
                { label: T("Cancel") }, { label: T("Remove"), danger: true, run: function () { act(TV.stremio.remove(s, a.url), T("“{name}” is removed", { name: a.m.name })); } }] });
        } });
        if (!items.length) { TV.toast(T("Stremio keeps this addon: it cannot be removed.")); return; }
        TV.menu(a.m.name, items);
    }
    /* Stremio's catalog of addons: the official ones, then the community's by what they give */
    function addAddonPage(id) {
        var s = stremioSrc(id), page = { title: T("Add an Addon"), icon: "plus", desc: T("Stremio's catalog, as its app shows it. An addon that needs settings opens them on your phone first."), rows: [
            { label: T("Paste a Link from Your Phone"), icon: "phone", acc: "chevron", desc: T("An addon's install link, or the address of its manifest (…/manifest.json)."), run: function () { push(phonePage(s && s.id)); } },
            { label: T("Loading…") }] };
        if (!s) return mainPage();
        TV.stremio.catalog().then(function (list) {
            if (pages[pages.length - 1] !== page) return;
            var mine = {}, rows = page.rows.slice(0, 1);
            (s.addons || []).forEach(function (a) { mine[a.url] = 1; });
            function add(a) {
                var need = a.m.behaviorHints && a.m.behaviorHints.configurationRequired;
                rows.push({ label: a.m.name, value: mine[a.url] ? T("Added") : TV.stremio.kinds(a.m).join(" · "), acc: "chevron", desc: String(a.m.description || "").slice(0, 200),
                    run: function () {
                        if (need || (mine[a.url] && TV.stremio.configurable(a.m))) { push(configurePage(s.id, a.url, a.m.name)); return; }
                        if (mine[a.url]) { TV.toast(T("“{name}” is already in your addons", { name: a.m.name })); return; }
                        TV.stremio.install(s, a.url + "/manifest.json").then(function (r) {
                            addonsChanged(s, T("“{name}” is added to your Stremio account", { name: r.name }));
                            replaceTop(addAddonPage(s.id));
                        }, function (e) { TV.toast(e.message, true); });
                    } });
            }
            var groups = [[T("Official"), list.filter(function (a) { return a.official; })],
                          [T("Catalogs"), list.filter(function (a) { return !a.official && /catalog/.test(JSON.stringify(a.m.resources || [])); })],
                          [T("Streams"), list.filter(function (a) { return !a.official && !/catalog/.test(JSON.stringify(a.m.resources || [])) && /stream/.test(JSON.stringify(a.m.resources || [])); })],
                          [T("Subtitles"), list.filter(function (a) { return !a.official && !/catalog|stream/.test(JSON.stringify(a.m.resources || [])) && /subtitles/.test(JSON.stringify(a.m.resources || [])); })]];
            groups.forEach(function (g) { if (!g[1].length) return; rows.push({ section: g[0] }); g[1].forEach(add); });
            page.rows = rows;
            replaceTop(page);
        }, function (e) {
            if (pages[pages.length - 1] !== page) return;
            page.rows = page.rows.slice(0, 1).concat([{ label: e.message }]);
            replaceTop(page);
        });
        return page;
    }
    /* An addon's settings page, opened on the phone; the link it gives is then pasted back here */
    function configurePage(id, url, name) {
        return { title: name, custom: function () { drawConfigure(id, url, name); }, rows: [] };
    }
    function drawConfigure(id, url, name) {
        root.innerHTML = "";
        var link = TV.stremio.configureUrl(url);
        var qr = el("div", "qr"), box = el("div", "qr__box"), u = el("div", "qr__url", esc(link.replace(/^https?:\/\//, "").replace(/^(.{40}).+$/, "$1…")));
        box.appendChild(TV.qr.canvas(link, 400));
        qr.appendChild(box); qr.appendChild(u);
        var steps = el("div", "steps");
        steps.innerHTML =
            "<div class='step'><b>1</b><span>" + esc(T("Scan the code with your phone: the settings page of “{name}” opens.", { name: name })) + "</span></div>" +
            "<div class='step'><b>2</b><span>" + esc(T("Choose your settings, then copy the addon's link it gives you (Copy Link, or hold Install).")) + "</span></div>" +
            "<div class='step'><b>3</b><span>" + esc(T("Then paste it here: Paste the Link, below.")) + "</span></div>";
        var go = el("div", "btn", esc(T("Paste the Link")));
        steps.appendChild(go);
        root.appendChild(qr); root.appendChild(steps);
        nav = new TV.Nav({ onSelect: function () { replaceTop(phonePage(id)); } });
        nav.setTiles([go]);
        if (TV.shell.focusOn() !== "view") nav.blur();
    }

    /* ---------- typing with the remote ---------- */
    function formPage(f) {
        var rows = [];
        rows.push({ label: T("Type"), value: f.type === "xtream" ? "Xtream" : f.type === "stalker" ? T("Stalker Portal (MAG)") : f.type === "jellyfin" ? "Jellyfin / Emby" : "M3U", acc: "chevron",
            desc: T("Xtream: server, username and password. M3U: one address. Stalker: the portal's address and a MAC address. Jellyfin and Emby: your server's address, user name and password."),
            run: function () { f.type = { xtream: "m3u", m3u: "stalker", stalker: "jellyfin", jellyfin: "xtream" }[f.type] || "xtream"; replaceTop(formPage(f)); } });
        function field(label, key, opts) {
            opts = opts || {};
            var shown = f[key] ? (opts.secret ? new Array(Math.min(f[key].length, 12) + 1).join("•") : f[key]) : T("Not set");
            rows.push({ label: label, value: shown, acc: "chevron", desc: opts.desc, run: function (row) {
                edit(row, { value: f[key] || "", secret: opts.secret, url: opts.url, onDone: function (v) { f[key] = v; replaceTop(formPage(f)); } });
            } });
        }
        if (f.type === "xtream") {
            field(T("Server"), "server", { url: true, desc: T("For example http://example.com:8080") });
            field(T("Username"), "user");
            field(T("Password"), "pass", { secret: true });
        } else if (f.type === "stalker") {
            field(T("Portal Address"), "portal", { url: true, desc: T("For example http://example.com:8080/c/") });
            field(T("MAC Address"), "mac", { desc: T("The one your provider registered, like 00:1A:79:12:34:56.") });
            var dev = T("Only if your provider asks for it: the serial number and device IDs of the MAG box it registered.");
            field(T("Serial Number (optional)"), "sn", { desc: dev });
            field(T("Device ID 1 (optional)"), "id1", { desc: dev });
            field(T("Device ID 2 (optional)"), "id2", { desc: dev });
        } else if (f.type === "jellyfin") {
            field(T("Server"), "server", { url: true, desc: T("Your server's address, for example http://192.168.1.20:8096") });
            field(T("Username"), "user");
            field(T("Password"), "pass", { secret: true, desc: T("Leave it empty if this user has none.") });
        } else field(T("Playlist Address"), "url", { url: true, desc: T("The address of your M3U playlist (http://…).") });
        field(T("Name (optional)"), "name");
        if (f.type !== "jellyfin") field(T("TV Guide Address (optional)"), "epg", { url: true, desc: T("An XMLTV address (.xml or .xml.gz), if your provider gives you one.") });
        rows.push({ label: T("Add"), action: true, run: function () { submit(f); } });
        return { title: T("With the Remote"), icon: "keyboard", desc: T("OK on a line opens the keyboard. Done to keep the text."), rows: rows, keep: true };
    }
    function submit(f) {
        var src = { type: f.type, name: f.name || "", epg: f.epg || "" };
        if (f.type === "xtream") {
            var fromUrl = D.xtreamFromUrl(f.server);
            if (fromUrl) { src.server = fromUrl.server; src.user = fromUrl.user; src.pass = fromUrl.pass; }
            else { src.server = f.server; src.user = f.user; src.pass = f.pass; }
            if (!src.server || !src.user || !src.pass) { TV.toast(T("Fill in the server, the username and the password.")); return; }
        } else if (f.type === "stalker") {
            src.portal = f.portal || ""; src.mac = f.mac || "";
            ["sn", "id1", "id2"].forEach(function (k) { if (String(f[k] || "").trim()) src[k] = String(f[k]).trim(); });
            if (!src.portal || !TV.stalker || !TV.stalker.normMac(src.mac)) { TV.toast(T("Fill in the portal's address and a MAC address like 00:1A:79:12:34:56.")); return; }
        } else if (f.type === "jellyfin") {
            src.server = f.server || ""; src.user = f.user || ""; src.pass = f.pass || ""; delete src.epg;
            if (!src.server || !src.user) { TV.toast(T("Fill in the server's address and your user name.")); return; }
        } else {
            src.url = f.url;
            if (!/^https?:\/\//i.test(src.url || "")) { TV.toast(T("The address must start with http:// or https://")); return; }
        }
        addAndLoad(src);
    }
    function addAndLoad(src) {
        var added = D.addSource(src);
        loadWithProgress(added, function (ok) {
            if (!ok) { pages = [mainPage(), sourcePage(added.id)]; redraw(); return; }
            pages = [mainPage()];
            redraw();
            TV.toast(D.stillComing(added.id) ? T("“{name}” is ready. Its other movies and series keep coming in the background.", { name: added.name }) : T("“{name}” is ready", { name: added.name }), true);
            TV.epg.loadAll(true);
            TV.shell.go("home");
        });
    }

    /* ---------- from the phone (QR code) ---------- */
    /* addonFor: a Stremio source's id, to paste an addon's link (in the phone page's M3U field) instead of a playlist */
    function phonePage(addonFor) {
        return { title: addonFor ? T("Paste an Addon's Link") : T("From Your Phone"), custom: function () { drawPhone(addonFor); }, onLeave: stopPhone, rows: [] };
    }
    /* A TMDB key from the phone: checked with TMDB, then kept like one typed in Settings (not over APL Launcher Setup's) */
    function takeTmdbKey(v) {
        v = String(v || "").replace(/\s+/g, "");
        if (!v || TV.meta.keySource() === "setup") return;
        TV.meta.testKey(v).then(function (ok) {
            if (!ok) { TV.toast(T("TMDB did not accept this key.")); return; }
            TV.save("tmdbKey", v); TV.meta.setKey(v);
            TV.toast(T("TMDB key saved"));
        });
    }
    function drawPhone(addonFor) {
        root.innerHTML = "";
        var qr = el("div", "qr");
        var box = el("div", "qr__box", "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;color:#888;font-size:24px'>" + esc(T("Starting…")) + "</div>");
        var url = el("div", "qr__url"), pin = el("div", "qr__pin"), state = el("div", "qr__state");
        qr.appendChild(box); qr.appendChild(url); qr.appendChild(pin); qr.appendChild(state);
        var steps = el("div", "steps");
        steps.innerHTML =
            "<div class='step'><b>1</b><span>" + esc(T("Connect your phone to the same Wi-Fi as the screen.")) + "</span></div>" +
            "<div class='step'><b>2</b><span>" + esc(T("Open the camera and point it at the code. Tap the link that appears.")) + "</span></div>" +
            "<div class='step'><b>3</b><span>" + esc(addonFor ? T("Choose M3U, paste the addon's link in the address field, then tap Send to the screen.")
                : T("Type or paste your Xtream details, your M3U link, or your Jellyfin, Emby or Plex server, then tap Send to the screen.")) + "</span></div>";
        var back = el("div", "btn", esc(addonFor ? T("Back") : T("Use the Remote Instead")));
        steps.appendChild(back);
        root.appendChild(qr); root.appendChild(steps);
        nav = new TV.Nav({ onSelect: function () { stopPhone(); if (addonFor) pop(); else replaceTop(formPage({ type: "xtream" })); } });
        nav.setTiles([back]);
        if (TV.shell.focusOn() !== "view") nav.blur();
        TV.helper.session().then(function (s) {
            var link = s.urls && s.urls[0];
            if (!link) throw new Error(T("The screen is not on a network."));
            box.innerHTML = "";
            box.appendChild(TV.qr.canvas(link, 400));
            url.textContent = link.replace(/\?.*$/, "");
            pin.textContent = T("Code: {code}", { code: s.token });
            state.innerHTML = "<i></i>" + esc(T("Waiting for your phone…"));
            clearInterval(pollTimer);
            pollTimer = setInterval(function () {
                TV.helper.pending(s.token).then(function (r) {
                    if (r.expired) { stopPhone(); drawPhone(); return; }
                    if (!r.items || !r.items.length) return;
                    stopPhone();
                    var it = r.items[r.items.length - 1];
                    // the TMDB key typed on the phone, with the playlist or alone
                    if (it.tmdb) takeTmdbKey(it.tmdb);
                    if (it.type === "key") { state.innerHTML = "<i></i>" + esc(T("Received! Loading…")); setTimeout(function () { pop(); }, 1200); return; }
                    // Plex from the phone: its code on the screen, to type on plex.tv/link
                    if (it.type === "plex") { replaceTop(plexPage()); return; }
                    if (it.type === "jellyfin") { delete it.epg; if (!it.user && !it.server) return; }
                    // a Stremio addon's link (asked for, or pasted as a playlist): added to your Stremio account
                    if (it.type === "m3u" && TV.stremio && (addonFor || TV.stremio.isAddonUrl(it.url))) { addonFromPhone(addonFor, it.url, state); return; }
                    state.innerHTML = "<i></i>" + esc(T("Received! Loading…"));
                    if (it.type === "xtream") {
                        var x = D.xtreamFromUrl(it.server);
                        if (x) { it.server = x.server; it.user = x.user; it.pass = x.pass; }
                    }
                    addAndLoad(it);
                }).catch(function () {});
            }, 1500);
        }).catch(function (e) {
            box.innerHTML = "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;text-align:center;color:#555;font-size:24px;padding:20px'>" +
                esc(T("The phone page could not start ({e}). Use the remote instead.", { e: e.message })) + "</div>";
        });
    }
    function stopPhone() { clearInterval(pollTimer); pollTimer = null; TV.helper.close(); }

    /* ---------- loading, with progress ---------- */
    function loadWithProgress(src, done) {
        var rootA = TV.$("alert");
        rootA.innerHTML = "";
        var box = el("div", "alert__box");
        box.innerHTML = "<div class='osd__spin' style='margin:0 auto 40px'></div><h2 class='alert__title'>" + esc(src.name) + "</h2><p class='alert__msg'></p>";
        rootA.appendChild(box);
        rootA.classList.add("is-open");
        var blocker = { key: function () {} };
        TV.pushNav(blocker);
        var msg = box.querySelector(".alert__msg");
        D.loadSource(src, function (m) { msg.textContent = m; }, true).then(function () {
            rootA.classList.remove("is-open"); TV.popNav(blocker);
            D.rebuild();
            done(true);
        }, function (e) {
            rootA.classList.remove("is-open"); TV.popNav(blocker);
            TV.alert({ title: T("Could not load “{name}”", { name: src.name }), message: e.message + "\n\n" + T("Check the address and your details, then try again.") });
            done(false);
        });
    }
    function refreshAll() {
        var list = D.sources();
        if (!list.length) return;
        var i = 0;
        (function next() {
            if (i >= list.length) { TV.epg.loadAll(true); redraw(); return; }
            loadWithProgress(list[i++], next);
        })();
    }

    /* ---------- drawing ---------- */
    function edit(row, o) {
        var r = row._el;
        r.classList.add("is-editing");
        var v = r.querySelector(".srow__value");
        TV.editText({ value: o.value, secret: o.secret, url: o.url,
            onInput: function (t) { if (v) v.textContent = o.secret ? new Array(Math.min(t.length, 12) + 1).join("•") : t; },
            onDone: function (t) { r.classList.remove("is-editing"); o.onDone(t); },
            onCancel: function () { r.classList.remove("is-editing"); if (o.onCancel) o.onCancel(); } });
    }
    function push(p) { var cur = pages[pages.length - 1]; if (cur && cur.onLeave) cur.onLeave(); pages.push(p); redraw(0); }
    function pop() {
        var cur = pages.pop(); if (cur && cur.onLeave) cur.onLeave();
        if (!pages.length) pages = [mainPage()];
        // pages below are rebuilt (counts, names may have changed)
        pages = pages.map(function (pg) { return pg.rebuild ? pg.rebuild() : pg; });
        pages[0] = mainPage();
        redraw(pages[pages.length - 1]._index || 0);
    }
    function replaceTop(p) { var idx = nav ? nav.index : 0; pages[pages.length - 1] = p; redraw(idx); }
    function redraw(index) {
        if (!root) build();
        var p = pages[pages.length - 1];
        if (p.title === T("Settings")) { p = pages[pages.length - 1] = mainPage(); }
        else if (p.rebuild && !p.custom) { var idx0 = p._index; p = pages[pages.length - 1] = p.rebuild(); p._index = idx0; }
        if (p.custom) { p.custom(); return; }
        if (!heroIcon.parentNode || !listWrap.parentNode) build();
        var keep = typeof index === "number" ? index : (nav ? nav.index : 0);
        heroIcon.innerHTML = p.preview ? p.preview() : TV.icon(p.icon || "gear", 190);
        listEl.innerHTML = "";
        var tiles = [], rows = [];
        p.rows.forEach(function (r) {
            if (r.section) { listEl.appendChild(el("div", "srow__section", esc(r.section))); return; }
            var e = el("div", "srow" + (r.danger ? " srow--danger" : "") + (r.action ? " srow--action" : ""));
            e.innerHTML = "<span class='srow__label'>" + (r.icon ? TV.icon(r.icon, 28) : "") + "<span>" + esc(r.label) + "</span></span>" +
                (r.value !== undefined ? "<span class='srow__value" + (r.secret ? " is-secret" : "") + "'>" + esc(r.value) + "</span>" : "") +
                (r.acc === "chevron" ? "<span class='srow__acc'>" + TV.icon("chevron", 24) + "</span>" : "");
            r._el = e;
            listEl.appendChild(e);
            tiles.push(e); rows.push(r);
        });
        nav = new TV.Nav({
            onFocus: function (i, t) {
                var r = rows[i];
                heroDesc.textContent = (r && r.desc) || p.desc || "";
                p._index = i;
                var y = t.offsetTop - 300;
                listEl.style.transform = "translateY(" + (-Math.max(0, y)) + "px)";
            },
            onSelect: function (i) { var r = rows[i]; if (r.run) r.run(r); }
        });
        nav.setTiles(tiles, Math.min(keep, tiles.length - 1));
        if (TV.shell.focusOn() !== "view" || !visible) nav.blur();
        if (!tiles.length) heroDesc.textContent = p.desc || "";
    }
    function applyMotion() { document.body.classList.toggle("reduce-motion", !TV.pref("motion")); }
    applyMotion();

    var view = {
        show: function () {
            if (!root) build();
            visible = true;
            TV.bg("", "dark");
            if (!pages.length) pages = [mainPage()];
            redraw();
        },
        hide: function () { visible = false; var p = pages[pages.length - 1]; if (p && p.onLeave) p.onLeave(); if (p && p.custom) pages.pop(); TV.$("bg").classList.remove("is-dark"); },
        enter: function () { if (nav) nav.refocus(); },
        blur: function () { if (nav) nav.blur(); },
        key: function (code) {
            if (!nav) return false;
            var K = TV.KEY;
            if (code === K.UP && nav.neighbour("up") === -1) return false;
            if (code === K.LEFT || code === K.RIGHT) { TV.sound.edge(); return true; }
            nav.key(code);
            return true;
        },
        ok: function () { if (nav) nav.ok(); },
        backHandled: function () { if (pages.length > 1) { pop(); return true; } return false; },
        openPage: function (name) {
            pages = [mainPage(), addPage()];
            if (name === "phone") pages.push(phonePage());
            if (name === "remote") pages.push(formPage({ type: "xtream" }));
            if (name === "media" || name === "plex" || name === "jellyfin" || name === "stremio") pages.push(mediaPage());
            if (name === "plex") pages.push(plexPage());
            if (name === "stremio") pages.push(stremioPage());
            if (name === "jellyfin") pages.push(formPage({ type: "jellyfin" }));
        }
    };

    /* ---------- the first start: how APL TV shows your playlist ----------
       Asked once (also for those who update). The three choices are also in Settings > Playback. Leaving the
       page (Back) or "Keep My Playlist As It Is": everything off, the playlist exactly as the provider made it. */
    TV.playlistSetup = function (done) {
        var opts = [
            { key: "tidyCats", label: T("Sort the Categories"), desc: T("Your screen's language first, adult ones last."), on: true },
            { key: "tidyNames", label: T("Tidy the Names"), desc: T("Country and quality tags (FR|, FHD, 4K…) taken out."), on: true },
            { key: "mergeQuality", label: T("Group HD, FHD and 4K"), desc: T("One card per channel, the best quality first."), on: true }
        ];
        var root = TV.$("alert");
        root.innerHTML = "";
        var box = el("div", "alert__box setup");
        box.appendChild(el("h2", "alert__title", esc(T("How should APL TV show your playlist?"))));
        box.appendChild(el("p", "alert__msg", esc(T("APL TV can tidy your playlist for you, or keep it exactly as your provider made it. You can change this later in Settings."))));
        var list = el("div", "setup__list"), tiles = [];
        opts.forEach(function (o) {
            var r = el("div", "setup__row");
            function paint() { r.innerHTML = "<span class='setup__txt'><b>" + esc(o.label) + "</b><small>" + esc(o.desc) + "</small></span><em>" + esc(o.on ? T("Yes") : T("No")) + "</em>"; }
            paint();
            r._toggle = function () { o.on = !o.on; paint(); TV.sound.tick(); };
            list.appendChild(r); tiles.push(r);
        });
        box.appendChild(list);
        var btns = el("div", "alert__buttons"), ok = el("div", "alert__btn", esc(T("Continue"))), keep = el("div", "alert__btn", esc(T("Keep My Playlist As It Is")));
        btns.appendChild(ok); btns.appendChild(keep);
        box.appendChild(btns);
        tiles.push(ok, keep);
        root.appendChild(box);
        root.classList.add("is-open");
        var nav;
        function finish(apply) {
            root.classList.remove("is-open");
            TV.popNav(nav);
            opts.forEach(function (o) { TV.setPref(o.key, apply ? o.on : false); });
            TV.setPref("setupDone", 1);
            TV.log("playlist setup: " + opts.map(function (o) { return o.key + "=" + (apply ? o.on : false); }).join(" "));
            D.rebuild();
            if (done) done();
        }
        nav = new TV.Nav({ onSelect: function (i) { if (i < opts.length) { tiles[i]._toggle(); return; } finish(i === opts.length); }, onBack: function () { finish(false); } });
        TV.pushNav(nav);
        nav.setTiles(tiles, opts.length);                   // on Continue
    };

    TV.views = TV.views || {};
    TV.views.settings = view;
    TV.setup = {
        phone: function () { view.openPage("phone"); TV.shell.go("settings", true); },
        remote: function () { view.openPage("remote"); TV.shell.go("settings", true); },
        media: function (which) { view.openPage(which || "media"); TV.shell.go("settings", true); }
    };
})(window);
