/* ============================================================
   i18n.js: interface language (same system as APL Launcher).
   The app is written in English; js/lang-fr.js holds the French,
   keyed by the English text. TV.t("Live TV") -> "TV en direct".
   "context|Text" tells apart two meanings of one English word.
   The language follows the screen's, unless Settings picks one.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV = global.TV || {};
    var TABLES = { fr: global.TV_LANG_FR || {} };

    function saved() {
        try { return (JSON.parse(global.localStorage.getItem("apltv.prefs") || "null") || {}).language; } catch (e) { return null; }
    }
    function screenLanguage() {
        var l = String((global.navigator && (global.navigator.language || global.navigator.userLanguage)) || "en").toLowerCase();
        return l.indexOf("fr") === 0 ? "fr" : "en";
    }

    var choice = saved();
    var lang = choice === "en" || TABLES[choice] ? choice : screenLanguage();
    var table = TABLES[lang] || {};

    function t(text, vars) {
        var s = Object.prototype.hasOwnProperty.call(table, text) ? table[text] : String(text).replace(/^[a-z]+\|/, "");
        if (vars) {
            s = String(s).replace(/\{(\w+)\}/g, function (m, k) {
                return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
            });
        }
        return s;
    }

    TV.t = t;
    TV.lang = lang;
    TV.locale = lang === "fr" ? "fr-FR" : "en-US";
    try { document.documentElement.lang = lang; } catch (e) {}
})(window);
