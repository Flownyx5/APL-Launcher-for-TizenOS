/* ============================================================
   sports.js: Sports, Apple Sports style.
   The matches of the day (yesterday's, tomorrow's), league by league:
   football, rugby, basketball, American football, ice hockey. Scores,
   minute, logos and team colours from ESPN's public scoreboards
   (site.api.espn.com: no key, the data of espn.com). Live matches first.
   OK on a match: its page, with the channels of YOUR lists that show it.
   They are found in your provider's TV guide (both teams named in a
   programme at the match's time) or in a channel's own name (event
   channels: "PSG vs OM 21:00"). Grouped by the channel's language (its
   country tag: FR|, UK:, ES -, AL…): yours first, Versions for the others.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data, S = TV.smart;
    var API = "https://site.api.espn.com/apis/site/v2/sports/";
    var US = /^en-us/i.test(String((global.navigator && global.navigator.language) || ""));

    /* The leagues, in the order of the page, grouped by country or region (the choice of favourites shows the groups).
       [ESPN's name, the name shown, kind: i national teams, w women, f friendlies, the group] */
    var SPORTS = [
        { id: "soccer", label: US ? "Soccer" : "Football", leagues: [
            ["uefa.champions", "Champions League", "", "European Cups"], ["uefa.europa", "Europa League", "", "European Cups"],
            ["uefa.europa.conf", "Conference League", "", "European Cups"], ["uefa.super_cup", "UEFA Super Cup", "", "European Cups"],
            ["fifa.cwc", "Club World Cup", "", "European Cups"], ["fifa.intercontinental_cup", "Intercontinental Cup", "", "European Cups"],
            ["fifa.world", "World Cup", "i", "National Teams"], ["uefa.euro", "Euro", "i", "National Teams"], ["uefa.nations", "Nations League", "i", "National Teams"],
            ["fifa.worldq.uefa", "World Cup Qualifying", "i", "National Teams"], ["uefa.euroq", "Euro Qualifying", "i", "National Teams"],
            ["fifa.worldq.caf", "World Cup Qualifying (Africa)", "i", "National Teams"], ["fifa.worldq.conmebol", "World Cup Qualifying (South America)", "i", "National Teams"],
            ["fifa.worldq.concacaf", "World Cup Qualifying (North America)", "i", "National Teams"], ["fifa.worldq.afc", "World Cup Qualifying (Asia)", "i", "National Teams"],
            ["caf.nations", "Africa Cup of Nations", "i", "National Teams"], ["conmebol.america", "Copa América", "i", "National Teams"],
            ["concacaf.gold", "Gold Cup", "i", "National Teams"], ["afc.asian.cup", "Asian Cup", "i", "National Teams"],
            ["fifa.friendly", "International Friendlies", "if", "National Teams"],
            ["fra.1", "Ligue 1", "", "France"], ["fra.2", "Ligue 2", "", "France"], ["fra.coupe_de_france", "Coupe de France", "", "France"],
            ["fra.super_cup", "Trophée des Champions", "", "France"],
            ["eng.1", "Premier League", "", "England"], ["eng.2", "Championship", "", "England"], ["eng.3", "League One", "", "England"],
            ["eng.fa", "FA Cup", "", "England"], ["eng.league_cup", "Carabao Cup", "", "England"], ["eng.charity", "Community Shield", "", "England"],
            ["esp.1", "LaLiga", "", "Spain"], ["esp.2", "LaLiga 2", "", "Spain"], ["esp.copa_del_rey", "Copa del Rey", "", "Spain"], ["esp.super_cup", "Supercopa de España", "", "Spain"],
            ["ita.1", "Serie A", "", "Italy"], ["ita.2", "Serie B", "", "Italy"], ["ita.coppa_italia", "Coppa Italia", "", "Italy"], ["ita.super_cup", "Supercoppa Italiana", "", "Italy"],
            ["ger.1", "Bundesliga", "", "Germany"], ["ger.2", "2. Bundesliga", "", "Germany"], ["ger.dfb_pokal", "DFB-Pokal", "", "Germany"], ["ger.super_cup", "DFL-Supercup", "", "Germany"],
            ["por.1", "Liga Portugal", "", "Portugal"], ["por.taca.portugal", "Taça de Portugal", "", "Portugal"],
            ["ned.1", "Eredivisie", "", "Netherlands"], ["ned.cup", "KNVB Beker", "", "Netherlands"],
            ["bel.1", "Belgian Pro League", "", "Rest of Europe"], ["tur.1", "Süper Lig", "", "Rest of Europe"], ["sco.1", "Scottish Premiership", "", "Rest of Europe"],
            ["gre.1", "Greek Super League", "", "Rest of Europe"], ["sui.1", "Swiss Super League", "", "Rest of Europe"], ["aut.1", "Austrian Bundesliga", "", "Rest of Europe"],
            ["s365:153", "Ekstraklasa", "", "Rest of Europe"], ["s365:157", "Puchar Polski", "", "Rest of Europe"],   // not at ESPN: 365Scores, like the "s365:" leagues below
            ["den.1", "Danish Superliga", "", "Rest of Europe"], ["nor.1", "Eliteserien", "", "Rest of Europe"], ["swe.1", "Allsvenskan", "", "Rest of Europe"],
            ["rus.1", "Russian Premier League", "", "Rest of Europe"],
            ["usa.1", "MLS", "", "Americas"], ["mex.1", "Liga MX", "", "Americas"], ["bra.1", "Brasileirão", "", "Americas"], ["arg.1", "Liga Profesional (Argentina)", "", "Americas"],
            ["conmebol.libertadores", "Copa Libertadores", "", "Americas"], ["conmebol.sudamericana", "Copa Sudamericana", "", "Americas"],
            ["concacaf.champions", "Concacaf Champions Cup", "", "Americas"],
            ["ksa.1", "Saudi Pro League", "", "Asia, Africa, Oceania"], ["jpn.1", "J1 League", "", "Asia, Africa, Oceania"], ["aus.1", "A-League", "", "Asia, Africa, Oceania"],
            ["afc.champions", "AFC Champions League", "", "Asia, Africa, Oceania"], ["caf.champions", "CAF Champions League", "", "Asia, Africa, Oceania"],
            ["club.friendly", "Club Friendlies", "f", "Friendlies"],
            ["uefa.wchampions", "Women's Champions League", "w", "Women"], ["fifa.wwc", "Women's World Cup", "wi", "Women"], ["uefa.weuro", "Women's Euro", "wi", "Women"],
            ["fifa.friendly.w", "Women's International Friendlies", "wif", "Women"], ["fra.w.1", "Première Ligue", "w", "Women"], ["eng.w.1", "Women's Super League", "w", "Women"],
            ["esp.w.1", "Liga F", "w", "Women"], ["usa.nwsl", "NWSL", "w", "Women"]
        ] },
        // Rugby: one request a day for every competition ("all"), each match placed in its league (a new one comes last)
        { id: "rugby", label: "Rugby", all: true, leagues: [
            ["17567", "Nations Championship", "i"], ["289234", "Test Matches", "i"], ["180659", "Six Nations", "i"], ["164205", "Rugby World Cup", "i"],
            ["244293", "Rugby Championship", "i"], ["270559", "Top 14"], ["271937", "Champions Cup"], ["272073", "Challenge Cup"], ["267979", "Premiership Rugby"],
            ["270557", "United Rugby Championship"], ["242041", "Super Rugby"], ["289237", "Women's Rugby World Cup", "wi"]
        ] },
        // "s365:…": the competitions ESPN doesn't have, from 365Scores (Europe's basketball, handball, volleyball, hockey)
        { id: "basketball", label: "Basketball", leagues: [["nba", "NBA"], ["s365:569", "EuroLeague"], ["s365:329", "EuroCup"], ["s365:38", "Betclic Élite"],
            ["s365:5835", "Pro B"], ["s365:14", "Liga ACB"], ["s365:19", "Lega Basket"], ["s365:27", "BBL"], ["s365:392", "PGE Basket Liga"],
            ["s365:6391", "Basketball Champions League"], ["wnba", "WNBA", "w"]] },
        { id: "handball", label: "Handball", leagues: [["s365:6182", "Liqui Moly Starligue"], ["s365:542", "EHF Champions League"], ["s365:536", "Liga Asobal"],
            ["s365:6334", "EHF Euro", "i"], ["s365:644", "World Championship", "i"], ["s365:531", "International Matches", "i"]] },
        { id: "volleyball", label: "Volleyball", leagues: [["s365:5712", "Ligue A"], ["s365:5723", "SuperLega"], ["s365:5772", "Tauron Liga"], ["s365:5706", "CEV Champions League"],
            ["s365:5715", "Ligue A Women", "w"], ["s365:8093", "Tauron Liga Women", "w"]] },
        // college football: ESPN's FBS games (about 60 on a Saturday of the season)
        { id: "football", label: US ? "Football" : "American Football", leagues: [["nfl", "NFL"], ["college-football", "College Football"]] },
        { id: "hockey", label: "Hockey", leagues: [["nhl", "NHL"], ["s365:636", "KHL"], ["s365:373", "SHL"], ["s365:370", "Liiga"], ["s365:379", "DEL"],
            ["s365:381", "National League"], ["s365:6180", "Champions Hockey League"]] }
    ];
    function kind(lg, k) { return String(lg[2] || "").indexOf(k) >= 0; }
    function sportOf(id) { for (var i = 0; i < SPORTS.length; i++) if (SPORTS[i].id === id) return SPORTS[i]; return null; }

    /* ---------- your favourites (FotMob style, chosen the first time Sports opens) ----------
       pref sportsFav: { sports: [ids], types: { men, women, friendly }, leagues: ["soccer/fra.1"…], teams: [{ s, l, id, n, logo, nat }] }
       or { skipped: 1 }: every league but the women's ones and the clubs' friendlies, as before. */
    var testFav = null, testCC = "";                                          // development tests only, never saved
    function fav() { if (testFav) return testFav; var f = TV.pref("sportsFav"); return f && typeof f === "object" ? f : null; }
    function chosen() { var f = fav(); return f && !f.skipped && f.leagues ? f : null; }
    function follows(sp, lg) {
        var f = chosen();
        if (!f) return !kind(lg, "w") && !kind(lg, "x") && lg[0] !== "club.friendly";
        if (f.sports.indexOf(sp.id) < 0 || f.leagues.indexOf(sp.id + "/" + lg[0]) < 0) return false;
        if (kind(lg, "w") ? !f.types.women : !f.types.men) return false;
        return !kind(lg, "f") || !!f.types.friendly;
    }
    function favTeam(t, sport) {
        var f = chosen();
        if (!f || !t) return false;
        for (var i = 0; i < f.teams.length; i++) if (f.teams[i].s === sport && String(f.teams[i].id) === String(t.id)) return true;
        return false;
    }
    // twinFav: ESPN's matches that stand for a 365Scores club's (Lech Poznan in the Europa League), ESPN naming the club its own way
    var twinFav = {};
    function isFavMatch(m) { return !!twinFav[m.id] || favTeam(m.home, m.sport) || favTeam(m.away, m.sport); }
    var AWAY_FIRST = { basketball: 1, football: 1, hockey: 1 };       // American sports write the visitors first

    /* ---------- the scores ---------- */
    var cache = {}, pending = {}, store = {}, logos = TV.load("sportsLogos", {}) || {};
    /* The French leagues' current logos (2024; public domain on Wikimedia Commons, drawn white for the dark screen):
       ESPN still has the old ones. In the code itself, so an automatic update brings them too. */
    var LOGO_NOW = {
        "soccer/fra.1": "data:image/png;base64,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",
        "soccer/fra.2": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKkAAADICAYAAACTfcHQAAAVtUlEQVR42u2deZBc1XXGf2dmpNG+IIQkVoFAIBAgxCaQxCabxRjHZRsTMPtix3ZsCoc4jh3HJIUdAsROgo0JJSc2OJS32NgERLCIQBKS0L4ggXZAC1qRRuuMRjMnf9yrQlKm3za3h36vz1c1VVPV3fe9fvfre889y3cEQ4dAVXsApwHnASOAIUA/oCtQ7/86+786oBao8X8H0Ars93/NwD6gEdgL7ALWAkuA2cAbwCoRac37sxOjT9nJ2Q/4BPAZ4Czg6MOIVw7sBt4FpgHPAhNFpNFmw3A4Obuo6k2qOktVW/XDwz5VfVFVr1PVOpsZwwGCDlLVJ1R1t1YOGlT1EVU90mbICDpMVf9XKxcTVHWwzVT1EnSoqk7TysfzqjrQZqw6t/iJmh+MV9X6PDzbGqNXEIJ2Bv4WGJej274ZuM5IWj24CbgrZ/dcD9zrXWRG0oKvoscDXwc65fD2LwCuMJIWm6A1wBeBYTn9Cp2Bj1e6/9RI2j4M87ZdnnEBcKSRtLi4ETg259/hBGCwkbSYW/0A4NMF+CpdgZOMpMXE5bhMpiJggJG0eKtoHXB1Tk/0baGXkbR4GITLCy0Kao2kxcOplW7HpUSzkbR4uMAfOIqCnZV8c5YEm94e7QRcEnDIhcDSFAtGK9ATuAzoEugeNhtJi4UTgDMDjdUKPIgr8UhD0suAiwORdC/wtpG0WDifcC6btcB0EWlOuZqPDHgiXwEsM5u0OFu9+BUs1Gl4HvBe2topfw+hsADYZiQtDvoDFwYcb4qItKT8zDG4kuhQ5sZ0EdlvJC0OTvZ/IbAdmJnhc2d5oobANmA+lqpXKFwE9A001jJ/qk+LsQHNjZXAW0bS4tijtcDogEPOBbakvIfugc2N+ZVujxpJ09uC5wW0BSdnkMAZhot2BfndAVNFRI2kxcFIXMw+BLb4lTQtzgX6BLqH9zPeg5G0gl1PYwnnV54PrMoQ6Rod0B5dBKw2khYHfXFO/FCYltaBj3N/nRPwHmbiok1GUorjejot0Fi7gNfIVk8Vyv21F5iRB3vUSJrOFgxVrLYaeJNs7q9QCSXr/XaPkbQ49uglhNNynQtszGCPjgn4td7A6ZcaSQuCowjnelKyhSEHA8MDfqfpIrLPSEqhXE+DCReGnJHxHo4KdA+NwPQ8TYCRNB6jCed6epOUaXFeJeViwhX9rcLp6htJC2KP9gRGEdb1lNbtcwRh3V+zcI58I2lBcBLhdJ6ayeZ6OpFw7q9W4LW8dSQxkhLregqliPw22dw+5xMu82pTXkKhRtLkrqcxAZ/RAmBdRvdXKCwFlhtJi4MjcKXLBHT7NJFe/mZkSHtURHYYSYuDMwkXhtzhG3+lxQjguED30AJMzeNEGEmJdD3VB8yAzxIKvZBwodB15KBUxEia3BbshkvNC7nVN2Rwf10U8B7m4EqojaQUJwv/FAK6fTJ87jjgjMA/lBYjaXGwFvhnwsjPrCOb22ckrlkugcKxr+d1MoykbUBE9orIY8BtOAEH2plxtDZjal5NwPTApUbSYpJ1Ak5y/Jf+dEzGUOiulPZob8KqlMzEOfKNpAUl6mrgC8ADpJdI3EO2rKdhhJM6V/9DUZvN6jj1f1JVF6fo37lYVftnuM59AXuIblTVoXl+7raSpltVnwWuByYk/MgcEdmcoU9pSAGIRVS4tKORNDxRlwCfA76LK6qL2mYnZ7jEsYQTJAMnALHPZq5KZXdU9RZVXVVim92kqiMyjHutqjYG2up3q+rVeX/WtpJmX1FbRORp4DPARNp2PWURX7iYsOHYxUZSI+tcXH/RH3JoF49ZuMSStPboRYEFct+zWTIcvP3frarrVbVZVa/LMMbpqro54Mn+80V4tqaZH3D7B8ar6grgHr/dkyEL/wjCifS+bjNjKKkj6qs8U1WFquqTAVfRyara1VZSQ6lVdTfZ9PjP+ZArU+3gZCCuFeQpAQUgXivKgzGSUlGtIHsHGusdciRIZiTNhw1bQ1g9/vk45TwjqYGQlQAjA2vh7zOSGkLiHMJl4e8gZ4JkRtJ8YAxhRdHeNJIaQtqjvQkrSDZdRPYYSQ1UqB5/MzClaA/ISPrhYwThBHIL5XoyklYOxgach/nAGiOpIaQ92g8nL0nAUGiTkdQQEsMrQBTNSGqgo3ozLSNnWvhG0srf6rsQNhQ6VUR2GkkNhzQAU9XBqnq+qmapSTqecHr8+ylQ1hOWT9ouYh7p7cixfqs+B5f9fmOG4c7GlS8TyPU030ha3dr5ZwMfB64BTufQnvOzMyYXjyJcVehCcqo9aiRtv5DupTghiGtou/Zoe5ZtVlV7EE6QrBWYKCKNNmvVRdArVPXXqrojpo5ovqoelWH8s1V1W6BaptWqemKR58NW0kPJMwy416+ePRJ8ZIaIbMq41fcJdNu/8Mp/RtKi18wDNwHfJl2d0eSM1wrleloD/NxmsPgEHaiqT2TQX1qvqidnuN6xqroo0Fb/HZvBKtjeVfV/MhJkgnfIp73mlQls3SRYqKrHVMM81VUxQS8A/o1sMosKTMl4oh4F9Gzn7TcB/yAi64ykxSXoSOAnOMc8GZM5ZmS4budArcmfAX5re2FxCXqaqs5p51Y7N6PraYi3ZduDOUV3OVHNsXtV7Qs8SvvLh2eRrcdTe1uTbwX+uugup6olqRdg+EvgYwHq2l/N2M1jNCAZr7sX+BsRecn2w+KS9BpVbQhwqt6Q0fXUV1VnZLzmflV9wPtYDUXd5lX11UC+yReypOap6oUZBXJbVPXRLO4u2+7zhRtxAgwESi5uyihI1o/0eaKPAN+u5gSSuipYRQcAdwT6QTaQQT1ZVetw+adp7NFdwEPAo0UsrjMcSpA7/JYZAnM96dPewyBVXZbiOu+q6k02e1Ww3Xvn+acDfs/ZZGskOxwYnPC9E4EbROQZo2d1bPfDCRPhOeB6eiWj62ks0CnmPetxYdrHRGSbUbN6SDqWcN08NvmVNO1q3pXoXqF7gOeA74vITKNkFZHUu2zGtMN5fjjmkq2R7BDgDNqOHk0CngQmich+o2P1raQDgbMCjvdaRvXkc3FKzuBcSsuBF4H/AuYWpUOIkTS7PTo40FgNZJCw8aHYk72Z8Brwiif7ZqOeAVX9bsDGXXNVdWAWkqrq8ara32bEVtLDyVEfMMIEMBPYSPqmY63Au0YzzE9a4rAyLHA3DzW6GEkJ3LgrlOtpIxmy8A1G0riS4VFAbcCe8bZlG0mDoj9hu3lMKVLjLiNpZeAUwqkn76RgjbuMpJWBUUCvQGMtp6DqyUbS4jSSnUO2rCeDkbQkjiVcI9lWXMFdq9HESErgRrKDAo21GVe6bDCSBlVkHku4KNo8YLVRxEgaEn0I63qaKiLNRhEjKRXaSLawjbuMpB8uziNcI9mVwFtGDyNpaHs0pOtpNhmyngxG0igchUsqCYEW4I/mesLySQPjbOCEQGM1AyN9B+VK+xELsBv4fTVVlBaFpGOAzoHG6gJ8o4K/6zzgWdvu82WP9iC6ZLhomCIi242k+cJJtF0yXES0AK/awSmf9ujAKpmvdbgkbCNpznAJ4bLwKx2zKXCj20KS1GvgV4s9qsD0apSBzPtKeibp2izmGdup0lBt3kl6Mc5lVA1YRZWGamty3o9+bBXN1TQRed9Imi8cD5xeRfboVLDYfd4wkg/U6oqOtbh6KyNpzjCaePXkomB+Nbqeck1SVe2D6+ZRNVt9NXcgyetKehpwapXMUaa2PEZSKiLrqRvV43p6w0iaPy38K6pojmaKyFYs6TlXOBKXmLwIp0Ff9EXkeaocQv5W0k5Azzzee1ab1DqTGAwGg8FgMBgMBoPBYDAYDAaDwWDAIk50mLJeP6Av0BUXUhSf6taM01B6X0R22LR3eEVvX6A7H4ThW4G9wDY/Jy2RJFXVOyNerwUWisjr7bzR7sBHcXH31oicyeUZxh4KjAMuxQnp9sXpQtUcNHaLfyhbgDeBycAkEVmb8lpD/HUOkP/wH/x+4OWk46rqKTjdAI1oLvGiiGwoIS90LS5EHEoB8KW0zyTiOY3DJaYP9fNef5A+ggL7PElX+vl4SUSWlRowDj8IcNPHquqiiGu0xvxY2nwQqvqIqq7L2B58qar+VZo236p6c8yYe1T1YynGuyNmvP2qenmJzw5W1bUaFl9p5zyf6Ofk3QzXXqOqD6rqoCypehqw5UzUa5riYYwDfgPcDxyd8X6GAg8BP1PVU1NkyRPqeyQcrz2vp8UobzZlIehHDpqT48jW3uhbwNOqelre80mvBX4GjAg05DWeqNUiMkFMi6GBGebkKuApwvTQGgeMV9UTc0lSb+s8Qvgq0QuBB1S1vspJegwpy3L8LvQI4fpn4W3Zb6lqXa5I6m/4L4BhZbrE9cAnq5ykvUgh6+7btt+PkzsKjc8BV+ZtJR2RgURp7MNOwO2q2rPKiXpRih3lLOBTZbqPLsBtqtq1Lkc+0E8l2FK24sotZgIbvOup3hvyVwKXxdTqj8a12plEcSpNG1IuRgf8mhsSvPdPgCMSHO5WAGtwbsBaXGO4IcS3NBoLnFGXo23oIzHveRv4CvBCW51DVHU88E3gaxF6pj09UYtC0qeAJ1OQ9ICvd3tCGfgxMW/bDXwP+KUnfbO/RndcWfoDOP95KQwAxuSFpMNiJMdbgX8Ukf8u+fRFtqvq3wPnEl1teraqiohoAUi6XkTeKGNH7JNiTK0nReR7bbzWBExT1fv8zndCRCHi6JocuUai6uzXAxNilwmRXcR37ji+QHKS5VTAHhiz1b+P85tGzcdi4nsADMsLSYfHvL4IpyefBAv8LznKJuuBgQQN3roTLbK2IuF8ROHompyUMJ8Y87aVKcp+twI7I17vUUXCvO1BT6J1GzbhGgnHYVPM6z1qcnJoGhDznndTjLcXaIywbed7g98QjbjmbrtwSSRJ5iMKnfJwcOrt/6IM9E0pxttf4uGtBh4Hnq5WReXAaE7op9YiyOz0jDk0NSdxmRz2UFoPa5jwDPAjEVli3EqM5cA7AXq6xh3uWvKw3XeP2VqagD0pxzzg0H8R+KyIfNkImg4iMhHnzH+qxPNPyq246FZTHkjaNSZKtD/CxozyBnwJuF5E/miUy0zUBcA9wGdxrqSWwxYCSRjhisLOupyQtC5mu09D0k3AHSKyxWgWhKj7gOdVdRouKeSruN5a3fy8xR2e4nJPN+RhJa2P2Tpa0khAikiTEbQsZN0mIj8ErgOe8B6S+hj3Yj3xGVTL63KioVoTExJtMZp0SOZ+ErIuVdUv4erN9iXIohoZc8idnQeSdkqwkrYaH9tEN1XtnbBieI/fukMQVf3pPy4/+E6gf0zgZXpdAeLPaiQtibuAq2N+5IKLDN1Lx7Ypvx64JeZwNQeYX1cAfYBWI2lJDCJZWccyXLk3HRTqvhxXBNk9Zl5/ISI76gogYKERD+NoXI5pmtr0WlxI78ci8naVkHk28F4HEnQ8LtssClOA3+W1sUMaol4EfCPDeLuB3+MSqasBs9pKFC8DQa/ChZ5PinnrNuBhEWmgAK3ESxLUl5xk7ZrXFFBvoNKx16+k5SbonwI/TUDQVuBfcNFAikJSIhJTzjWzNBar407i7a1PU9W7gR+RrKb/WeD7B6/sRSbpYMpX/lwkLMS5espB0M7e3PpX4gv2wIVWvyYiO/PebCzpweoc4vNQi642+A4u17Ym4ntOKEefKFXthit8vJ/4JJIDP5Y/F5F3KEBHPFLURe0ucaoXXGy5yDsJwH/gqjXrYuzvcnTRfhiXfJJ0Nb+zVNFgXY5P7gebLDUlJug5/n/ItMXbRj8grDRMJaJZRJp9Ek5H+UD7AY8Ctyf8yBLgHhGZQ46TnpMo1Ukbobl5EQ+yP67OaZCJJAdfQR8Dbkz4kbmeoHPJeWZ+HElrMmzbtRalKosN+mAKgs4C7haRhRSglfj+GJLWZvgeFkoNS9AanJjcFxN+ZDJwWxKC5mUlbY4hVC3ZRBC0WvoJdACu9qf4JIvFJODzIrKCFP3UKx2NMfmitcSX17ZFwBrjVpBV9DicplOvBG9/Abg9DUHzspI2xmTedyKZHy7N6mvpf8lxC06JMA7P+xV0fdoL5GE12RPjQqkjveJIpwR1U83Gv/iGHd7VFGcavQT8WRaC5oWku2IK7TqTXrupS4Iy6b1Gw1h8FFd0F4V5uEhS5tY7eSDpzhjCdMaJspJScKI+JlVvj3EwVqPrqpi37QC+maU/V95I2oDLLyRGbJWUasZRJsL2EqJmZqdyiPRjnNrhc8DE9l4oLyvpewk0RdPgOKKle9aVIOm+GE+DUF5N0ErC0UTLie/zqtv7C09S33dyZczbhiZtRuCToc+MIdPyEpWTexJ4GnpVEUl7x+xGK0JcKC++wjhJ7TNSrKZ9gFFEl0gviFjVG2NIej4VXBdPWBHdzjFemYaOImklCC/MjxG+HYArkU2Cq3BpfKWwxZ9IS9nHu2LGv0FVL02wog/HCX6VE+Wcuz4Jwtm7CKQOEoexqvp3KTtY7AP+U0RWBnogK3A5h6Mj3vNVVd0A/Mpr47cl6XIJLjpSH5P4sIrSBWJbie7INwj4iao+jgsBbuQDn2svXLXAVbhQYrMnUrns2FN9H9Y049f6H+rsmOYW3WLG6Q88pKo72rljN9YlbGl4YcqB1wK/DmiX7lTV54GLIxzHA3AaRLeq6jxgsydBDc7lNBzXx6l3zMrzbISxvwVXQXpWzC0PAf7Jr/6bcS60Gr/6DPD/zwL+AHynjKvd7cCtGXbXfxeRu2ifZGNv4OYA32FhXRnruN8OPOYfgC8QLdraCdeP/tKM11iMi46U+rE0quoc4BMk98f2LGGL/hgXNCh3aDrLKjazgnJVJ5Xr4DRVRPYGPuUvxpXEUsa81SdEZE3M+ybG2MdJ8DrwqwrNndjuV3kqJG9jek2ZwpjTy3TTT5Rx7N/gVIuT7BIvt+M6TcDjIrK7Qr0rS3EFfJWAjcCScjykZQlcRllX0w3AlyNO31nxW+A+T5wkorEP4xqcZcHLOHWUSsWcBBG+jsIqYE05SDpDRHaktI1qk9o4vnbpVpzCRXtVRnbgCvLSppDNAL6VYdvf61fRnQnturjnUlsGk2d2Qsmdmg7yjzfUBfzVHGieOrHEl2/wpGgt8XpTihX1DVW9AafVfjsugtQrRUb+WlwJw3gReSWj/uZPVbUR+Lr3HHRK8NHfHXYwa/I2oJZ4ns2UFqJt9XPXLZAkkOCk2men0MtqKFNAQvy4M0RERVWvCDhwCzDvgNDUYT7KEZ5Ipergl2TJN1TVo4ALgHE4J/1gXOpe7UGkbPKuoKXANE/QRSFEY1X1BFyb8kuB03GJF139dRtxbqt3cFGsn4vIW4ep/g2LIGmrf57b27huF5yMUJeAJN0DzBWRpgTf+2T/rMtFUgUWiMjW/wO//DR1377wMwAAAABJRU5ErkJggg=="
    };
    for (var lk in LOGO_NOW) logos[lk] = LOGO_NOW[lk];
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    // ESPN's days are New York's: the one a time falls in
    function espnDay(t) { var d = new Date(t - 5 * 3600000); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()); }
    function dayStart(offset) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.getTime(); }
    // What is shown: today, tomorrow, or what comes next (the two weeks after)
    function span() { if (dayOff === "next") return [dayStart(2), dayStart(16)]; if (dayOff === "past") return [dayStart(-7), dayStart(0)]; var f = dayStart(dayOff); return [f, dayStart(dayOff + 1)]; }
    function espnDaysIn(from, to) {
        var out = [], seen = {};
        for (var t = from - 3600000; t < to + 3600000; t += 6 * 3600000) { var d = espnDay(t); if (!seen[d]) { seen[d] = 1; out.push(d); } }
        return out;
    }

    var slots = 0, waiting = [];
    function limited(fn) {
        return new Promise(function (resolve, reject) {
            waiting.push(function () {
                slots++;
                fn().then(function (v) { slots--; pump(); resolve(v); }, function (e) { slots--; pump(); reject(e); });
            });
            pump();
        });
    }
    function pump() { while (slots < 6 && waiting.length) waiting.shift()(); }

    function team(x) {
        var t = x.team || {};
        var sc = x.score && typeof x.score === "object" ? x.score.displayValue : x.score;        // a team's schedule: { value, displayValue }
        return { id: t.id, name: t.displayName || t.name || "", short: t.shortDisplayName || t.displayName || t.name || "", nick: t.name || "", loc: t.location || "",
                 logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || "", color: t.color || "", alt: t.alternateColor || "",
                 score: sc === undefined || sc === null ? "" : String(sc), winner: !!x.winner };
    }
    /* "all": the league of a match, from its link (".../league/17567"); one ESPN has not been seen before keeps its name */
    function leagueOf(e, sp) {
        var href = (e.links && e.links[0] && e.links[0].href) || "", m = /\/league\/(\d+)/.exec(href), id = m ? m[1] : "";
        for (var i = 0; i < sp.leagues.length; i++) if (sp.leagues[i][0] === id) return sp.leagues[i];
        var slug = (e.season && e.season.slug) || "", name = slug.replace(/-/g, " ").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) || sp.label;
        var lg = [id || slug || "other", name];
        sp.leagues.push(lg);
        return lg;
    }
    function readEvent(e, sp, lg) {
        if (!lg) lg = leagueOf(e, sp);
        var c = e.competitions && e.competitions[0];
        if (!c || !c.competitors || c.competitors.length !== 2) return null;
        var home = c.competitors[0].homeAway === "away" ? c.competitors[1] : c.competitors[0], away = home === c.competitors[0] ? c.competitors[1] : c.competitors[0];
        if (leftOut(home.team) || leftOut(away.team)) return null;
        var st = e.status || c.status || {}, ty = st.type || {}, bc = [];
        (c.broadcasts || []).forEach(function (b) { (b.names || []).forEach(function (n) { if (n && bc.indexOf(n) < 0) bc.push(n); }); });
        var start = Date.parse(e.date);
        if (!start) return null;
        return { id: sp.id + ":" + e.id, sport: sp.id, lkey: sp.id + "/" + lg[0], league: lg, start: start, state: ty.state || "pre", status: ty.name || "",
                 clock: st.displayClock || "", period: st.period || 0, home: team(home), away: team(away), venue: (c.venue && c.venue.fullName) || "", city: (c.venue && c.venue.address && c.venue.address.city) || "",
                 bc: bc.slice(0, 4), note: (c.notes && c.notes[0] && c.notes[0].headline) || "" };
    }
    /* ---------- 365Scores: what ESPN doesn't have ----------
       webws.365scores.com (its site's own API, no key): a competition's games over a span in one request, the
       standings for the clubs, a club's fixtures. Logos from its image server. */
    var S365 = "https://webws.365scores.com/web/", TZ = "";
    try { TZ = global.Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    function is365(lg) { return !!lg && String(lg[0]).indexOf("s365:") === 0; }
    function q365() { return "appTypeId=5&langId=1&userCountryId=5" + (TZ ? "&timezoneName=" + encodeURIComponent(TZ) : ""); }
    function img365(kind, id, ver) { return "https://imagecache.365scores.com/image/upload/f_png,w_160,h_160,c_limit,q_auto:eco,dpr_1,d_" + kind + ":default1.png/v" + (ver || 1) + "/" + kind + "/" + id; }
    function dmy(t) { var d = new Date(t); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); }
    function team365(c) {
        var col = function (x) { x = String(x || "").replace("#", ""); return /^7f97ab$/i.test(x) ? "" : x; };
        return { id: "365-" + c.id, name: c.name || "", short: c.name || "", nick: c.name || "", loc: "", logo: img365("Competitors", c.id, c.imageVersion),
                 color: col(c.color), alt: col(c.awayColor), score: c.score >= 0 ? String(c.score) : "", winner: !!c.isWinner };
    }
    /* 365Scores' numbers of the competitions ESPN has: a 365Scores club's European matches (the Ekstraklasa's) go in
       the app's own competition (its name, the rights where you live), and ESPN's own match takes their place (espnTwin) */
    var ESPN_OF_365 = { 572: "uefa.champions", 573: "uefa.europa", 7685: "uefa.europa.conf", 472: "uefa.super_cup", 321: "club.friendly" };
    function league365(sp, compId, name) {
        for (var i = 0; i < sp.leagues.length; i++) if (sp.leagues[i][0] === "s365:" + compId) return sp.leagues[i];
        if (sp.id === "soccer" && ESPN_OF_365[compId]) return leagueBySlug(sp, ESPN_OF_365[compId], name);
        return leagueBySlug(sp, "s365:" + compId, name);
    }
    function read365(g, sp, lg) {
        var h = g.homeCompetitor, a = g.awayCompetitor, start = Date.parse(g.startTime);
        if (!h || !a || !start || leftOut(h) || leftOut(a)) return null;
        lg = lg || league365(sp, g.competitionId, g.competitionDisplayName);
        var st = g.statusGroup === 4 ? "post" : g.statusGroup === 3 ? "in" : "pre", txt = String(g.statusText || "");
        return { id: sp.id + ":365-" + g.id, sport: sp.id, lkey: sp.id + "/" + lg[0], league: lg, start: start, state: st, src: "365",
                 status: /postpon/i.test(txt) ? "STATUS_POSTPONED" : /cancel|abandon/i.test(txt) ? "STATUS_CANCELED" : "", live: g.shortStatusText || txt,
                 clock: g.gameTimeDisplay || "", period: 0, home: team365(h), away: team365(a), venue: "", bc: [], note: g.roundName && g.roundName !== "Round" ? g.roundName : "" };
    }
    /* A competition's games from one day to another (one request for the whole span) */
    function range365(sp, lg, from, to) {
        var k = sp.id + "/" + lg[0] + "/" + from + "/" + to, c = cache[k];
        if (c && Date.now() - c.at < (hot(c.list) ? 25000 : 10 * 60000)) return Promise.resolve(c.list);
        if (pending[k]) return pending[k];
        pending[k] = limited(function () {
            return TV.fetchJSON(S365 + "games/?" + q365() + "&competitions=" + lg[0].slice(5) + "&startDate=" + dmy(from) + "&endDate=" + dmy(to - 1), { timeout: 15000 });
        }).then(function (j) {
            var list = ((j && j.games) || []).map(function (g) { return read365(g, sp, lg); }).filter(Boolean);
            cache[k] = { at: Date.now(), list: list };
            delete pending[k];
            if (!logos[sp.id + "/" + lg[0]]) { logos[sp.id + "/" + lg[0]] = img365("Competitions", lg[0].slice(5), 1); TV.save("sportsLogos", logos); }
            return list;
        }, function (e) {
            delete pending[k];
            TV.log("sports: 365 " + lg[0] + ": " + e.message);
            if (c) return c.list;
            throw e;
        });
        return pending[k];
    }

    /* One league, one ESPN day. Kept: 30 min for a day without matches, 10 min, 30 s around a match in play */
    function hot(list) {
        var now = Date.now();
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m.state === "in" || (m.state === "pre" && m.start - now < 20 * 60000 && now - m.start < 3 * 3600000)) return true;
        }
        return false;
    }
    function league(sp, lg, day) {
        var path = lg ? lg[0] : "all", k = sp.id + "/" + path + "/" + day, c = cache[k];
        if (c && Date.now() - c.at < (!c.list.length ? 30 * 60000 : hot(c.list) ? 25000 : 10 * 60000)) return Promise.resolve(c.list);
        if (pending[k]) return pending[k];
        pending[k] = limited(function () {
            return TV.fetchJSON(API + sp.id + "/" + path + "/scoreboard?dates=" + day, { timeout: 15000 });
        }).then(function (j) {
            var list = ((j && j.events) || []).map(function (e) { return readEvent(e, sp, lg); }).filter(Boolean);
            cache[k] = { at: Date.now(), list: list };
            delete pending[k];
            // the logo drawn for a dark background, when ESPN has one
            var l0 = j && j.leagues && j.leagues[0], ls = (l0 && l0.logos) || [], href = "";
            ls.forEach(function (x) { if (!href || (x.rel && x.rel.indexOf("dark") >= 0)) href = x.href || href; });
            if (lg && href && !LOGO_NOW[sp.id + "/" + lg[0]] && logos[sp.id + "/" + lg[0]] !== href) { logos[sp.id + "/" + lg[0]] = href; TV.save("sportsLogos", logos); logoLearned(sp.id + "/" + lg[0], href); }
            return list;
        }, function (e) {
            delete pending[k];
            TV.log("sports: " + sp.id + "/" + path + " " + day + ": " + e.message);
            if (c) return c.list;
            throw e;
        });
        return pending[k];
    }
    /* One league, one month: ESPN gives a whole month in one answer (limit=500), where what comes next asked every
       day of every league one by one (up to 14 requests a competition, the screen waited for all of them) */
    function month(sp, lg, ym) {
        var k = sp.id + "/" + lg[0] + "/m" + ym, c = cache[k];
        if (c && Date.now() - c.at < (hot(c.list) ? 25000 : 10 * 60000)) return Promise.resolve(c.list);
        if (pending[k]) return pending[k];
        pending[k] = limited(function () {
            return TV.fetchJSON(API + sp.id + "/" + lg[0] + "/scoreboard?dates=" + ym + "&limit=500", { timeout: 20000 });
        }).then(function (j) {
            var list = ((j && j.events) || []).map(function (e) { return readEvent(e, sp, lg); }).filter(Boolean);
            cache[k] = { at: Date.now(), list: list };
            delete pending[k];
            return list;
        }, function (e) {
            delete pending[k];
            TV.log("sports: " + sp.id + "/" + lg[0] + " " + ym + ": " + e.message);
            if (c) return c.list;
            throw e;
        });
        return pending[k];
    }
    function monthsIn(days) { var out = []; days.forEach(function (d) { var ym = d.slice(0, 6); if (out.indexOf(ym) < 0) out.push(ym); }); return out; }
    /* The same match keeps the same object: cards and the match page hold it */
    function keep(m) {
        var o = store[m.id];
        if (!o) { store[m.id] = m; return m; }
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) o[k] = m[k];
        return o;
    }
    // A team's schedule says where a match is played: the same object stays, a fresher scoreboard is not overwritten
    function keepSoft(m) { return store[m.id] || keep(m); }
    function byTime(a, b) { return a.start - b.start || (a.home.name < b.home.name ? -1 : 1); }
    function isLive(m) { return m.state === "in"; }
    // still "to come" six hours after its start, neither postponed nor cancelled: ESPN never updated it
    function stale(m) { return m.state === "pre" && m.start < Date.now() - 6 * 3600000 && !/POSTPONED|CANCEL|DELAY|SUSPEND/.test(m.status || ""); }
    // A competition's place in the page's order (sports, then leagues as listed)
    function leagueRank(m) {
        for (var i = 0, n = 0; i < SPORTS.length; i++) {
            if (SPORTS[i].id !== m.sport) { n += SPORTS[i].leagues.length; continue; }
            var j = SPORTS[i].leagues.indexOf(m.league);
            return n + (j < 0 ? SPORTS[i].leagues.length : j);
        }
        return 9999;
    }
    function activeKey(m) { var sp = sportOf(m.sport); return !!sp && follows(sp, m.league); }
    /* A competition met in a team's schedule (PSG in the Champions League when only Ligue 1 is followed) */
    function leagueBySlug(sp, slug, name) {
        for (var i = 0; i < sp.leagues.length; i++) if (sp.leagues[i][0] === slug) return sp.leagues[i];
        var lg = [slug, name || slug, "x"];
        sp.leagues.push(lg);
        return lg;
    }

    /* ---------- your teams: today's match, or the next one wherever it is played ---------- */
    var scheds = {};
    function scheduleUrl(t, past) {
        var sp = sportOf(t.s);
        if (String(t.id).indexOf("365-") === 0) return S365 + "games/" + (past ? "results" : "fixtures") + "/?" + q365() + "&competitors=" + String(t.id).slice(4);
        if (!sp || sp.all || !t.l) return "";                               // rugby: ESPN gives no team schedule
        return API + t.s + "/" + (t.s === "soccer" ? "all" : t.l.split("/")[1]) + "/teams/" + t.id + "/schedule" + (t.s === "soccer" && !past ? "?fixture=true" : "");
    }
    // past: the season's results (football's schedule gives the fixtures to come only)
    function schedule(t, past) {
        past = !!past && (t.s === "soccer" || String(t.id).indexOf("365-") === 0);
        var url = scheduleUrl(t, past), k = t.s + ":" + t.id + (past ? ":past" : ""), c = scheds[k];
        if (!url) return Promise.resolve([]);
        if (c && c.p) return c.p;
        if (c && Date.now() - c.at < 3 * 3600000) return Promise.resolve(c.list);
        var sp = sportOf(t.s), home = leagueBySlug(sp, t.l.split("/")[1], "");
        var p = limited(function () { return TV.fetchJSON(url, { timeout: 15000 }); }).then(function (j) {
            if (j && j.games) return (scheds[k] = { at: Date.now(), list: j.games.map(function (g) { return read365(g, sp, null); }).filter(Boolean) }).list;
            var list = ((j && j.events) || []).map(function (e) {
                return readEvent(e, sp, e.league && e.league.slug ? leagueBySlug(sp, e.league.slug, e.league.name || e.league.abbreviation) : home);
            }).filter(Boolean);
            scheds[k] = { at: Date.now(), list: list };
            return list;
        }, function (e) {
            TV.log("sports: schedule of " + t.n + ": " + e.message);
            scheds[k] = { at: c ? c.at : 0, list: c ? c.list : [] };
            return scheds[k].list;
        });
        scheds[k] = { at: c ? c.at : 0, list: c ? c.list : [], p: p };
        return p;
    }
    // Your teams' matches in what is shown, wherever they are played (a calendar shows its days only)
    function myTeams(from, to, past) {
        var f = chosen();
        if (!f || !f.teams.length) return Promise.resolve([]);
        return Promise.all(f.teams.map(function (t) { return schedule(t, past); })).then(function (lists) {
            var out = [], seen = {};
            lists.forEach(function (list) {
                list.forEach(function (m) { if (m.start >= from && m.start < to && !seen[m.id]) { seen[m.id] = 1; out.push(m); } });
            });
            return out;
        });
    }
    /* A league's calendar (the days it plays, ESPN's "day" list), kept 12 h: what comes next asks only those days */
    var cals = {};
    function calendar(sp, lg) {
        var k = sp.id + "/" + lg[0], c = cals[k];
        if (is365(lg)) return Promise.resolve({ at: Date.now(), days: null });
        if (c && Date.now() - c.at < 12 * 3600000) return Promise.resolve(c);
        return limited(function () { return TV.fetchJSON(API + sp.id + "/" + lg[0] + "/scoreboard", { timeout: 15000 }); }).then(function (j) {
            var l0 = j && j.leagues && j.leagues[0], cal = (l0 && l0.calendar) || [], days = null;
            if (l0 && l0.calendarType === "day" && cal.length && typeof cal[0] === "string") {
                days = {};
                cal.forEach(function (s) { days[String(s).slice(0, 10).replace(/-/g, "")] = 1; });
            }
            return (cals[k] = { at: Date.now(), days: days });
        }, function () { return { at: 0, days: null }; });
    }
    /* Your teams' schedules, both ways (what comes, what was played), read once: they say where your teams play */
    function warmSchedules() {
        var f = chosen();
        if (!f || !f.teams.length) return Promise.resolve();
        return Promise.all(f.teams.map(function (t) { return Promise.all([schedule(t), schedule(t, true)]).then(null, function () { return null; }); }));
    }
    // The competitions where your teams play (PSG: Ligue 1, the Champions League, the Coupe de France; France: the Nations League, the qualifiers, friendlies)
    function teamLeagues() {
        var f = chosen(), seen = {}, out = [];
        if (!f) return out;
        f.teams.forEach(function (t) {
            var sp = sportOf(t.s);
            if (!sp || sp.all) return;
            [scheds[t.s + ":" + t.id], scheds[t.s + ":" + t.id + ":past"]].forEach(function (c) {
                ((c && c.list) || []).forEach(function (m) {
                    if (!m.league || seen[m.lkey] || Date.now() - m.start > 400 * 86400000) return;
                    seen[m.lkey] = 1;
                    out.push({ sp: sp, lg: m.league });
                });
            });
        });
        return out;
    }
    function hasTeams(sportId) { var f = chosen(); return !!f && f.teams.some(function (t) { return t.s === sportId; }); }

    /* ---------- how a match is going ---------- */
    function period(m) {
        var p = m.period || 1;
        if (m.sport === "hockey") return p > 3 ? T("OT") : T("P{n}", { n: p });
        if (m.sport === "basketball" || m.sport === "football") return p > 4 ? T("OT") : T("Q{n}", { n: p });
        return String(p);
    }
    /* 365Scores' short words are English ("P3", "Q2", "HT", "1st"): said as ESPN's are, the period in your language,
       the minute for football and handball */
    function live365(m) {
        var s = String(m.live || ""), c = String(m.clock || ""), p;
        if (/^(HT|Halftime)$/i.test(s)) return T("Half-time");
        if (/^(SO|Shootout|Pens?|Penalties)$/i.test(s)) return T("Penalties");
        if (m.sport === "soccer" || m.sport === "handball") return /^\d+(\.\d+)?$/.test(c) ? Math.ceil(parseFloat(c)) + "'" : c || T("Live");
        if ((p = /^P(\d)$/.exec(s))) s = T("P{n}", { n: p[1] });
        else if ((p = /^Q(\d)$/.exec(s))) s = T("Q{n}", { n: p[1] });
        else if (/^OT\d*$/i.test(s)) s = T("OT");
        else if (m.sport === "volleyball" && (p = /^S(\d)$/.exec(s))) s = T("Set {n}", { n: p[1] });
        return c ? s + " · " + c : s || T("Live");
    }
    function statusOf(m) {
        var n = m.status;
        if (/POSTPONED/.test(n)) return { text: T("Postponed"), done: m.state === "post" };
        if (/CANCEL|ABANDON/.test(n)) return { text: T("Cancelled"), done: true };
        if (m.state === "pre") return { text: TV.hhmm(m.start) };
        if (m.src === "365") return m.state === "in" ? { text: live365(m), live: true } : { text: T("Final"), done: true };
        if (m.state === "in") {
            if (/HALFTIME/.test(n)) return { text: T("Half-time"), live: true };
            if (/SHOOTOUT/.test(n)) return { text: T("Penalties"), live: true };
            if (m.sport === "soccer" || m.sport === "rugby") return { text: m.clock || T("Live"), live: true };
            if (/END_PERIOD/.test(n)) return { text: T("End of {p}", { p: period(m) }), live: true };
            return { text: period(m) + (m.clock && !/^0(:00|\.0)?$/.test(m.clock) ? " · " + m.clock : ""), live: true };
        }
        if (/PEN/.test(n)) return { text: T("Final on penalties"), done: true };
        if (/AET|OVERTIME|_OT/.test(n)) return { text: T("Final after extra time"), done: true };
        return { text: T("Final"), done: true };
    }

    /* ---------- where to watch: the channels of your lists ----------
       Names are compared folded (lower case, no accents, words). A team is found by its names (ESPN's full and short
       ones, its city), the usual short forms of the big clubs, and for national teams the country's name in the
       languages of your channels (the screen's own list of countries, when it has one). Both teams must be named. */
    var STOP = { fc: 1, cf: 1, afc: 1, sc: 1, ac: 1, as: 1, ss: 1, ssc: 1, rc: 1, rcd: 1, ogc: 1, sv: 1, vfb: 1, vfl: 1, tsg: 1, bsc: 1, fk: 1, sk: 1,
                 cd: 1, ud: 1, sd: 1, ca: 1, club: 1, de: 1, del: 1, la: 1, le: 1, the: 1, "1": 1, "04": 1, "05": 1, "1899": 1, "1909": 1 };
    // Too common alone to name a team
    var GENERIC = { united: 1, city: 1, real: 1, athletic: 1, atletico: 1, sporting: 1, racing: 1, olympique: 1, stade: 1, union: 1, dynamo: 1, town: 1, county: 1,
                    rovers: 1, wanderers: 1, albion: 1, saint: 1, st: 1, red: 1, royal: 1, club: 1, sport: 1, football: 1, new: 1, san: 1, santa: 1, los: 1, nord: 1, sud: 1 };
    var CLUBS = {
        "paris saint germain": "psg|paris sg|paris st germain|paris saint germain", "marseille": "om|olympique de marseille|marsylia|olympique marsylia", "lyon": "ol|olympique lyonnais",
        "lille": "losc|lille osc", "saint etienne": "asse|st etienne", "lens": "rc lens", "monaco": "as monaco", "stade rennais": "rennes|stade rennais",
        "nice": "ogc nice|nicea|ogc nicea", "strasbourg": "rc strasbourg|racing strasbourg", "nantes": "fc nantes", "toulouse": "tfc", "brest": "stade brestois",
        "barcelona": "barca|barcelone|fc barcelone|fc barcelona", "real madrid": "real madrid|real madryt", "atletico madrid": "atletico de madrid|atletico madrid|atleti|atletico madryt",
        "bayern munich": "bayern|bayern munchen|bayern munich|fc bayern|bayern monachium", "borussia dortmund": "dortmund|bvb", "bayer leverkusen": "leverkusen",
        "rb leipzig": "leipzig|rb lipsk|lipsk", "internazionale": "inter|inter milan|inter milano|internazionale|inter mediolan", "ac milan": "milan|ac milan", "juventus": "juve|juventus",
        "napoli": "naples|napoli", "as roma": "roma|as rome", "lazio": "lazio rome|lazio rzym", "tottenham hotspur": "tottenham|spurs", "philadelphia 76ers": "sixers|76ers", "nottingham forest": "nottingham|nottm forest|forest",
        "manchester united": "man united|man utd|manchester united|manchester utd", "manchester city": "man city|manchester city",
        "sporting cp": "sporting portugal|sporting lisbonne|sporting lisbon|sporting cp|sporting lizbona", "fc porto": "porto", "psv eindhoven": "psv", "ajax": "ajax amsterdam",
        "galatasaray": "galatasaray", "fenerbahce": "fenerbahce", "olympiacos": "olympiakos|olympiakos pireus", "celtic": "celtic glasgow", "rangers": "glasgow rangers",
        "como": "come|como 1907", "sevilla": "seville|fc seville", "valencia": "valence", "athletic club": "bilbao|athletic bilbao", "genoa": "genes",
        "fc copenhagen": "copenhague|kopenhaga|fc kopenhaga", "club brugge": "bruges|fc bruges", "red star belgrade": "etoile rouge|etoile rouge de belgrade|crvena zvezda|crvena zvezda belgrad", "union st gilloise": "union saint gilloise|usg",
        "real betis": "betis|betis seville", "eintracht frankfurt": "francfort|eintracht francfort",
        // as Polish broadcasters write them (CANAL+ SPORT, Polsat Sport, TVP Sport); "koln" as the Bundesliga writes it
        "levski sofia": "lewski sofia|lewski", "slavia prague": "slavia praga", "sparta prague": "sparta praga", "dinamo zagreb": "dinamo zagrzeb",
        "shakhtar donetsk": "szachtar donieck|szachtar", "aek athens": "aek ateny", "fc cologne": "koln|fc koln|fc kolonia|kolonia", "werder bremen": "werder brema",
        "lech poznan": "lech"
    };
    // Rugby's national teams by their names
    var RUGBY = { "new zealand": "all blacks", "south africa": "springboks|boks", "australia": "wallabies", "argentina": "los pumas|pumas", "france": "xv de france",
        // the Top 14's clubs as their own channel and the league's write them ("Stade Rochelais - Aviron Bayonnais")
        "la rochelle": "stade rochelais|rochelais", "bayonne": "aviron bayonnais|bayonnais", "toulouse": "stade toulousain|toulousain", "stade toulousain": "toulousain",
        "clermont auvergne": "asm clermont|asm|clermont", "racing 92": "racing", "stade francais": "stade francais paris", "toulon": "rc toulon|rct",
        "castres olympique": "castres", "montpellier herault": "montpellier|mhr", "montpellier": "mhr", "lyon": "lou rugby|lou", "section paloise": "pau",
        "perpignan": "usap", "union bordeaux begles": "ubb|bordeaux begles", "bordeaux begles": "ubb|union bordeaux begles", "vannes": "rc vannes", "brive": "ca brive", "oyonnax": "oyonnax rugby" };
    // The UK's nations, not countries for the screen
    var NATIONS = {
        england: { fr: "Angleterre", es: "Inglaterra", it: "Inghilterra", pt: "Inglaterra", sq: "Anglia", nl: "Engeland", tr: "İngiltere", de: "England", ro: "Anglia", pl: "Anglia" },
        scotland: { fr: "Écosse", es: "Escocia", it: "Scozia", pt: "Escócia", sq: "Skocia", nl: "Schotland", tr: "İskoçya", de: "Schottland", ro: "Scoția", pl: "Szkocja" },
        wales: { fr: "Pays de Galles", es: "Gales", it: "Galles", pt: "País de Gales", sq: "Uellsi", nl: "Wales", tr: "Galler", de: "Wales", ro: "Țara Galilor", pl: "Walia" },
        "northern ireland": { fr: "Irlande du Nord", es: "Irlanda del Norte", it: "Irlanda del Nord", pt: "Irlanda do Norte", sq: "Irlanda e Veriut", nl: "Noord-Ierland", tr: "Kuzey İrlanda", de: "Nordirland", pl: "Irlandia Północna" },
        // the screen's list says "Palestinian Territories": the team is Palestine
        palestine: { en: "Palestine", fr: "Palestine", es: "Palestina", it: "Palestina", pt: "Palestina", sq: "Palestina", nl: "Palestina", tr: "Filistin", de: "Palästina", ar: "فلسطين", ro: "Palestina", pl: "Palestyna" }
    };
    /* Left out everywhere in Sports, his choice: Israel's national teams, its league and its clubs */
    var LEFT_OUT = /^(israel|maccabi |hapoel |beitar |bnei sakhnin|ihud bnei|ironi |m s ashdod|ms ashdod|f c ashdod|fc ashdod|sektzia|bnei yehuda|bnei reineh)/;
    function leftOut(t) { return !!t && LEFT_OUT.test(S.fold(t.name || t.displayName || "")); }
    // Screens without a list of countries (older Samsung): the French names at least
    var FR_NATIONS = { germany: "allemagne", spain: "espagne", italy: "italie", netherlands: "pays bas", belgium: "belgique", switzerland: "suisse", croatia: "croatie",
        denmark: "danemark", sweden: "suede", norway: "norvege", poland: "pologne", austria: "autriche", ireland: "irlande", "republic of ireland": "irlande", greece: "grece",
        turkiye: "turquie", turkey: "turquie", czechia: "tchequie|republique tcheque", hungary: "hongrie", romania: "roumanie", serbia: "serbie", russia: "russie",
        albania: "albanie", finland: "finlande", iceland: "islande", slovakia: "slovaquie", slovenia: "slovenie", "bosnia herzegovina": "bosnie herzegovine|bosnie",
        "north macedonia": "macedoine du nord", cyprus: "chypre", georgia: "georgie", armenia: "armenie", bulgaria: "bulgarie", lithuania: "lituanie", latvia: "lettonie",
        estonia: "estonie", brazil: "bresil", argentina: "argentine", colombia: "colombie", chile: "chili", peru: "perou", mexico: "mexique", "united states": "etats unis",
        usa: "etats unis", morocco: "maroc", algeria: "algerie", tunisia: "tunisie", egypt: "egypte", cameroon: "cameroun", "ivory coast": "cote d ivoire",
        "south africa": "afrique du sud", japan: "japon", "south korea": "coree du sud", "korea republic": "coree du sud", australia: "australie",
        "new zealand": "nouvelle zelande", "saudi arabia": "arabie saoudite", fiji: "fidji", namibia: "namibie", china: "chine", uruguay: "uruguay", portugal: "portugal",
        palestine: "palestine" };
    var ISO_FIX = { turkiye: "TR", czechia: "CZ", "czech republic": "CZ", "republic of ireland": "IE", "korea republic": "KR", "south korea": "KR", "korea dpr": "KP",
        usa: "US", "united states": "US", "ivory coast": "CI", "cote d ivoire": "CI", "bosnia herzegovina": "BA", "bosnia and herzegovina": "BA", "north macedonia": "MK",
        "dr congo": "CD", "congo dr": "CD", "cape verde": "CV", "cabo verde": "CV", "china pr": "CN", "chinese taipei": "TW", curacao: "CW", kosovo: "XK", gambia: "GM",
        "the gambia": "GM", eswatini: "SZ", palestine: "PS", syria: "SY", vietnam: "VN", russia: "RU", iran: "IR", bolivia: "BO", venezuela: "VE", tanzania: "TZ", moldova: "MD" };

    var regionNames = {}, isoOf = null;
    function names(lang) {
        if (!(lang in regionNames)) { try { regionNames[lang] = new global.Intl.DisplayNames([lang], { type: "region" }); } catch (e) { regionNames[lang] = null; } }
        return regionNames[lang];
    }
    function isoMap() {
        if (isoOf) return isoOf;
        isoOf = {};
        var en = names("en"), a, b, code, n;
        if (en) for (a = 0; a < 26; a++) for (b = 0; b < 26; b++) {
            code = String.fromCharCode(65 + a, 65 + b); n = "";
            try { n = en.of(code); } catch (e) {}
            if (n && n !== code) isoOf[S.fold(n)] = code;
        }
        for (var k in ISO_FIX) isoOf[k] = ISO_FIX[k];
        return isoOf;
    }
    /* A team's name on the screen: national teams in the screen's language ("Tchéquie", not "Czechia") */
    function shown(t, long) {
        var key = S.fold(t.name), iso = isoMap()[key], d = iso && names(TV.lang);
        if (NATIONS[key] && NATIONS[key][TV.lang]) return NATIONS[key][TV.lang];
        if (d && TV.lang !== "en") { try { var n = d.of(iso); if (n && n !== iso) return n; } catch (e) {} }
        return long ? t.name : (t.short || t.name);
    }
    var langsCache = null;
    function langsOfLists() {
        if (langsCache) return langsCache;
        var seen = { en: 1 }, out = ["en"], cat = D.catalog();
        seen[TV.lang] = 1; if (out.indexOf(TV.lang) < 0) out.push(TV.lang);
        (cat ? cat.live.cats : []).forEach(function (c) { var l = c.lang; if (l && l.length === 2 && !seen[l]) { seen[l] = 1; out.push(l); } });
        langsCache = out;
        return out;
    }
    function strip(s) { return S.fold(s).split(" ").filter(function (w) { return w && !STOP[w]; }).join(" "); }
    var aliasMemo = {};
    function aliases(t, sport) {
        var mk = sport + "|" + (t.name || "") + "|" + (t.short || "") + "|" + (t.loc || "");
        if (aliasMemo[mk]) return aliasMemo[mk];
        return (aliasMemo[mk] = aliasesOf(t, sport));
    }
    function aliasesOf(t, sport) {
        var out = [], key = S.fold(t.name);
        function add(s) { s = S.fold(s); if (s && s.length >= 2 && !GENERIC[s] && out.indexOf(s) < 0) out.push(s); }
        [t.name, t.short, t.loc].forEach(function (s) { add(s); add(strip(s)); });
        if (t.nick && t.nick !== t.loc && sport !== "soccer") add(t.nick);        // "Raptors", "Giants"
        // a club from 365Scores comes with its full name only ("Rakow Czestochowa"): its first word too, as titles write it ("Raków - Pogoń",
        // "ŚLEPSK MALOW SUWAŁKI" for Slepsk Suwalki)
        if ((sport === "soccer" || sport === "volleyball") && String(t.id).indexOf("365-") === 0) { var first = strip(t.name).split(" ")[0]; if (first.length >= 4) add(first); }
        var more = CLUBS[key] || CLUBS[S.fold(t.short)];
        if (more) more.split("|").forEach(add);
        if (sport === "rugby" && RUGBY[key]) RUGBY[key].split("|").forEach(add);
        var langs = langsOfLists(), iso = isoMap()[key];
        if (iso) langs.forEach(function (l) { var d = names(l); if (d) { try { add(d.of(iso)); } catch (e) {} } });
        if (NATIONS[key]) langs.forEach(function (l) { if (NATIONS[key][l]) add(NATIONS[key][l]); });
        if (!names("en") && FR_NATIONS[key]) FR_NATIONS[key].split("|").forEach(add);
        return out.filter(function (s) { return s.length >= 3 || (more && more.split("|").indexOf(s) >= 0); });
    }

    var foldMemo = {}, foldCount = 0;
    function folded(s) {
        var f = foldMemo[s];
        if (f === undefined) {
            if (++foldCount > 30000) { foldMemo = {}; foldCount = 0; }
            f = foldMemo[s] = " " + S.fold(s) + " ";
        }
        return f;
    }
    // Not the match itself
    var NOT_LIVE = / (resume|resumen|highlights|replay|rediffusion|rediff|differe|temps forts|best of|extended|debrief|apres match|post match|repeticion|sintesi|zusammenfassung|classic|classico del passato|skroty?|retransmisja|powtorka) /;
    var SPORTY = / (foot|football|soccer|futbol|futebol|calcio|fussball|rugby|basket|basketball|nba|nfl|nhl|hockey|ligue|liga|league|premier|serie|bundesliga|champions|coupe|cup|copa|coppa|pokal|match|live|direct|en vivo|ao vivo|diretta|top 14|six nations|test match) /;

    /* Every alias, by its first word: a text only needs its own words looked up */
    function aliasInto(idx, m) {
        [[m.home, 1], [m.away, 2]].forEach(function (p) {
            aliases(p[0], m.sport).forEach(function (a) {
                var w = "w:" + a.split(" ")[0];
                (idx[w] = idx[w] || []).push({ a: " " + a + " ", m: m, side: p[1] });
            });
        });
    }
    function hits(f, idx) {
        var ws = f.split(" "), found = null, seen = {};
        for (var i = 0; i < ws.length; i++) {
            var w = ws[i];
            if (!w || seen[w]) continue;
            seen[w] = 1;
            var l = idx["w:" + w];
            if (!l) continue;
            for (var j = 0; j < l.length; j++) {
                var x = l[j];
                if (f.indexOf(x.a) < 0) continue;
                found = found || {};
                var r = found[x.m.id] || (found[x.m.id] = { m: x.m, side: 0 });
                r.side |= x.side;
            }
        }
        return found;
    }

    function visibleChan(ch) {
        var ct = D.catOf(ch);
        return !!ct && !ct.off && (!ct.adult || TV.pref("showAdult"));
    }
    function langOf(ch) {
        var t = S.channel(ch.raw || ch.name);
        if (t.lang) return t.lang;
        var ct = D.catOf(ch);
        return (ct && ct.lang) || "";
    }

    /* ---------- who shows it, weeks ahead: the broadcaster ----------
       France, Ligue 1 and Ligue 2: the league's own site's API (ma-api.ligue1.fr, no key) gives each game week's
       matches with their French broadcasters ("Ligue 1+ 2", "beIN SPORTS MAX 7"), about a month ahead. The United
       States: ESPN's. The name is then looked for in your lists (Live TV), with or without a TV guide. */
    var LFP = "https://ma-api.ligue1.fr/championship-matches/championship/", LFP_CHAMP = { "soccer/fra.1": 1, "soccer/fra.2": 4 };
    var lfpWeeks = {}, lfpAt = TV.load("sportsLfpAt", {}) || {};           // a game week's first kickoff, per league and season
    function lfpSeason(t) { var d = new Date(t); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; }
    function lfpName(side) { var c = side && side.clubIdentity; return (c && (c.displayName || c.shortName)) || ""; }
    function lfpWeek(c, season, gw) {
        var k = c + "/" + season + "/" + gw;
        if (!lfpWeeks[k]) lfpWeeks[k] = limited(function () { return TV.fetchJSON(LFP + c + "/game-week/" + gw + "?season=" + season, { timeout: 12000 }); }).then(function (j) {
            var list = ((j && j.matches) || []).map(function (x) {
                var b = (x.broadcasters && x.broadcasters.local) || [];
                return { t: Date.parse(x.date), h: lfpName(x.home), a: lfpName(x.away), tv: b.map(function (y) { return (y.name && (y.name["fr-FR"] || y.name["en-GB"])) || y.code || ""; }).filter(Boolean) };
            }).filter(function (x) { return x.t; });
            if (list.length) {
                var at = lfpAt[c + "/" + season] = lfpAt[c + "/" + season] || {};
                at[gw] = Math.min.apply(null, list.map(function (x) { return x.t; }));
                TV.save("sportsLfpAt", lfpAt);
            }
            return list;
        }, function (e) { delete lfpWeeks[k]; TV.log("sports: LFP " + k + ": " + e.message); return []; });
        return lfpWeeks[k];
    }
    // The game week of a kickoff: guessed from the weeks already seen (or the season's start), put right in a request or two
    function lfpFind(c, t, gw, tries) {
        var season = lfpSeason(t), W = 7 * 86400000;
        if (!gw) {
            var at = lfpAt[c + "/" + season] || {}, near = 0, best = Infinity;
            for (var g in at) { var dd = Math.abs(at[g] - t); if (dd < best) { best = dd; near = +g; } }
            gw = near ? near + Math.round((t - at[near]) / W) : Math.round((t - Date.UTC(season, 7, 15)) / W) - 2;
            gw = Math.max(1, Math.min(38, gw));
        }
        return lfpWeek(c, season, gw).then(function (list) {
            if (!list.length) return [];
            var ts = list.map(function (x) { return x.t; }), lo = Math.min.apply(null, ts), hi = Math.max.apply(null, ts);
            if (t >= lo - 12 * 3600000 && t <= hi + 12 * 3600000) return list;
            if (tries >= 4) return [];
            var step = Math.round((t - lo) / W) || (t < lo ? -1 : 1), next = Math.max(1, Math.min(38, gw + step));
            return next === gw ? [] : lfpFind(c, t, next, tries + 1);
        });
    }
    function sameClub(name, t) {
        var a = strip(name).split(" "), b = (" " + strip(t.name + " " + (t.short || "") + " " + (t.loc || "")) + " ");
        return a.some(function (w) { return w.length >= 3 && !GENERIC[w] && b.indexOf(" " + w + " ") >= 0; });
    }
    /* ---------- Canada: the NHL's own schedule ----------
       ESPN's scoreboard names only the US networks of an NHL game. api-web.nhle.com (the NHL's site API, no key)
       gives each game's broadcasters per country: national ones first, then the home and away teams' regional ones.
       Seven days in one request, from the date asked. */
    var NHL = "https://api-web.nhle.com/v1/schedule/", nhlWeeks = [];
    var NHL_CA = { SN: "Sportsnet", SN1: "Sportsnet One", "SN+": "Sportsnet+", SN360: "Sportsnet 360", SNE: "Sportsnet East", SNO: "Sportsnet Ontario",
                   SNP: "Sportsnet Pacific", SNW: "Sportsnet West", TVAS: "TVA Sports", TVAS2: "TVA Sports 2", TSN: "TSN", TSN1: "TSN1", TSN2: "TSN2",
                   TSN3: "TSN3", TSN4: "TSN4", TSN5: "TSN5", RDS: "RDS", RDS2: "RDS 2", CBC: "CBC", CITY: "Citytv", Prime: "Prime Video" };
    function nhlDay(t) { return new Date(t - 10 * 3600000).toISOString().slice(0, 10); }    // the game's date in the east (a 19:00 game is 00:00 UTC)
    function nhlWeek(day) {
        for (var i = 0; i < nhlWeeks.length; i++) if (day >= nhlWeeks[i].from && day <= nhlWeeks[i].to) return nhlWeeks[i].p;
        var w = { from: day, to: nhlDay(Date.parse(day + "T10:00:00Z") + 6 * 86400000) };
        w.p = limited(function () { return TV.fetchJSON(NHL + day, { timeout: 12000 }); }).then(function (j) {
            var out = [];
            ((j && j.gameWeek) || []).forEach(function (d) {
                (d.games || []).forEach(function (g) {
                    var tv = (g.tvBroadcasts || []).filter(function (b) { return b.countryCode === "CA"; }).sort(function (a, b) {
                        return (a.market === "N" ? 0 : 1) - (b.market === "N" ? 0 : 1) || (a.sequenceNumber || 0) - (b.sequenceNumber || 0);
                    }).map(function (b) { var n = String(b.network || "").trim(); return NHL_CA[n] || n; });
                    function side(x) { return x ? ((x.placeName && x.placeName["default"]) || "") + " " + ((x.commonName && x.commonName["default"]) || "") : ""; }
                    out.push({ t: Date.parse(g.startTimeUTC), h: side(g.homeTeam), a: side(g.awayTeam), tv: tv.filter(function (n, k) { return n && tv.indexOf(n) === k; }) });
                });
            });
            return out.filter(function (x) { return x.t; });
        }, function (e) { nhlWeeks.splice(nhlWeeks.indexOf(w), 1); TV.log("sports: NHL schedule " + day + ": " + e.message); return []; });
        nhlWeeks.push(w);
        return w.p;
    }

    // The official broadcasters of a match where you live
    function tvOf(m) { var cc = rights().cc; return (m.tv && m.tvCc === cc ? m.tv : null) || (cc === "US" ? m.bc : []) || []; }   // another region in Settings: not the last one's
    var tvSoon = TV.debounce(function () { refreshShown(); findSoon(300); }, 500);
    function officialTv(list) {
        var cc = rights().cc;
        function take(m, l) {
            var hit = l.filter(function (x) { return Math.abs(x.t - m.start) < 15 * 60000 && (sameClub(x.h, m.home) || sameClub(x.a, m.away)); })[0];
            if (hit && hit.tv.length) { m.tv = hit.tv.slice(0, 4); m.tvCc = cc; tvSoon(); }
        }
        list.forEach(function (m) {
            if (m.tvAsked === cc) return;
            if ((cc === "FR" || cc === "MC") && LFP_CHAMP[m.lkey] && m.state === "pre") {
                m.tvAsked = cc;
                lfpFind(LFP_CHAMP[m.lkey], m.start, 0, 0).then(function (l) { take(m, l); });
            } else if (cc === "CA" && m.lkey === "hockey/nhl" && m.state !== "post") {
                m.tvAsked = cc;
                nhlWeek(nhlDay(m.start)).then(function (l) { take(m, l); });
            }
        });
    }
    // A channel's name for the comparison: no quality, no spaces ("LIGUE1+ 2 FHD" = "Ligue 1+ 2")
    var QUALITY = / (uhd|fhd|hd|sd|4k|8k|hevc|h265|h264|50fps|60fps|1080p|720p|raw|vip|backup|direct|live|tv)(?= |$)/g;
    function tvKey(name) { return (" " + S.fold(name || "") + " ").replace(QUALITY, " ").replace(/ /g, ""); }

    /* Who has the rights where you live (2026-27), for the matches no guide reaches yet: the network and its
       channels in your lists. A name ending in * stands for all its channels (beIN SPORTS 1, 2, 3, MAX 4…). The
       exact channel comes from the LFP (Ligue 1, Ligue 2), then from the TV guide the day before. */
    var TV_UCL = "uefa.champions uefa.europa uefa.europa.conf uefa.super_cup";
    var TV_RIGHTS = {
        FR: [["CANAL+", "CANAL+ FOOT|CANAL+ SPORT*|CANAL+|CANAL+ PREMIER LEAGUE", TV_UCL + " eng.1 eng.league_cup rugby/270559"], ["DAZN", "DAZN*", "esp.1 ita.1"],
             ["beIN SPORTS", "BEIN SPORTS*", "ger.1 ger.dfb_pokal eng.fa fra.2 ita.coppa_italia esp.copa_del_rey basketball/nba handball/s365:6182 handball/s365:542"],
             ["Ligue 1+", "LIGUE 1+*|LIGUE1+*", "fra.1"], ["France Télévisions", "FRANCE 2|FRANCE 3|FRANCE 4", "fra.coupe_de_france rugby/180659 rugby/271937 rugby/272073"],
             ["TF1", "TF1", "rugby/17567 rugby/289234"]],
        GB: [["Sky Sports", "SKY SPORTS*", "eng.1 eng.2 eng.league_cup sco.1 ger.1"], ["TNT Sports", "TNT SPORTS*", TV_UCL + " ita.1 rugby/267979"],
             ["BBC", "BBC ONE|BBC TWO|BBC THREE", "eng.fa rugby/180659"], ["Premier Sports", "PREMIER SPORTS*", "esp.1"]],
        ES: [["Movistar Plus+", "M+*|MOVISTAR*", TV_UCL + " esp.1 esp.copa_del_rey ger.1"], ["DAZN", "DAZN*", "esp.1 eng.1 ita.1"]],
        IT: [["Sky Sport", "SKY SPORT*", TV_UCL + " eng.1 ger.1 ita.1"], ["DAZN", "DAZN*", "ita.1 esp.1"]],
        DE: [["DAZN", "DAZN*", TV_UCL + " esp.1 ita.1 fra.1"], ["Sky Sport", "SKY SPORT*", "ger.1 ger.2 eng.1"]],
        US: [["NBC / Peacock", "NBC*|USA NETWORK|PEACOCK*", "eng.1"], ["CBS / Paramount+", "CBS*|PARAMOUNT*", TV_UCL + " ita.1"], ["ESPN", "ESPN*", "esp.1 ger.1"]],
        // Canada: the NHL's national networks (each game's own come from the NHL, see nhlWeek)
        CA: [["Sportsnet / TVA Sports", "SPORTSNET*|TVA SPORTS*", "hockey/nhl"]],
        // Poland: the rights confirmed for 2026-27 (satkurier.pl's list, October 2026)
        PL: [["CANAL+", "CANAL+ SPORT*|CANAL+ PREMIUM|CANAL+ EXTRA*", "uefa.champions eng.1 esp.1 s365:153"], ["Eleven Sports", "ELEVEN SPORTS*", "ger.1 ger.2 ita.1 fra.1"],
             ["Polsat Sport", "POLSAT SPORT*", "uefa.europa uefa.europa.conf ned.1 sco.1 ita.coppa_italia ksa.1 conmebol.libertadores conmebol.sudamericana volleyball/s365:5772 volleyball/s365:8093"],
             ["TVP", "TVP SPORT|TVP 1|TVP 2", "eng.fa eng.league_cup eng.2 eng.3 por.taca.portugal s365:157"]]
    };
    var TV_NATIONAL = { FR: [["TF1", "TF1|M6", "france"], ["L'Équipe / beIN SPORTS", "L'EQUIPE|BEIN SPORTS*", ""]], PL: [["TVP", "TVP 1|TVP SPORT|TVP 2", "poland"]] };
    var NATIONAL_LEAGUES = " uefa.nations fifa.worldq.uefa uefa.euroq fifa.friendly fifa.world uefa.euro ";
    function tvRights(m) {
        var cc = rights().cc, slug = m.lkey.indexOf("soccer/") === 0 ? m.lkey.slice(7) : m.lkey, list = TV_RIGHTS[cc === "MC" ? "FR" : cc] || [], i, r;
        if (NATIONAL_LEAGUES.indexOf(" " + slug + " ") >= 0 && TV_NATIONAL[cc]) {
            for (i = 0; i < TV_NATIONAL[cc].length; i++) {
                r = TV_NATIONAL[cc][i];
                if (!r[2] || S.fold(m.home.name) === r[2] || S.fold(m.away.name) === r[2]) return { net: r[0], pats: r[1].split("|") };
            }
        }
        for (i = 0; i < list.length; i++) if ((" " + list[i][2] + " ").indexOf(" " + slug + " ") >= 0) return { net: list[i][0], pats: list[i][1].split("|") };
        return null;
    }
    function tvPat(p) { var star = p.slice(-1) === "*"; return { key: tvKey(star ? p.slice(0, -1) : p), star: star }; }
    var HOW = { guide: 3, tv: 3, name: 2, rights: 1 };

    var where = {}, findTimer = null, findTok = 0, finding = false;
    function findSoon(ms) { clearTimeout(findTimer); findTimer = setTimeout(findAll, ms || 300); }
    function guideEnd() { return Date.now() + 25 * 3600000; }         // the guide is read up to 26 h ahead (epg.js)
    /* The channels for every match still to come or in play, in small steps (the remote keeps answering) */
    var namedMemo = null, findDone = false;
    function findAll() {
        var cat = D.catalog(), tok = ++findTok;
        var seenIds = {}, pool = matches.concat(mine, sheet.open && sheet.m ? [sheet.m] : []).filter(function (m) { if (seenIds[m.id]) return false; seenIds[m.id] = 1; return true; });
        var ms = pool.filter(function (m) {
            return m.state !== "post" && !/CANCEL|POSTPONED|ABANDON/.test(m.status) && (m.start < guideEnd() || ((tvOf(m).length || tvRights(m)) && m.start < Date.now() + 17 * 86400000)) && Date.now() - m.start < 5 * 3600000;
        });
        if (!cat || !ms.length) { ms.forEach(function (m) { where[m.id] = { langs: {}, order: [], n: 0 }; }); refreshShown(); return; }
        finding = true;
        var idx = {}, found = {}, chans = cat.live.chans.filter(visibleChan), now = Date.now();
        ms.forEach(function (m) { found[m.id] = []; });
        var from = Infinity, to = 0;
        ms.forEach(function (m) { if (m.start < guideEnd()) { from = Math.min(from, m.start - 50 * 60000); to = Math.max(to, m.start + 3 * 3600000); } });
        // 0. the official broadcaster, by its name in your lists (weeks ahead, guide or not); in your language
        // the channels by their broadcaster's name: read once per playlist (21 000 names took a moment each time)
        if (!namedMemo || namedMemo.cat !== cat || namedMemo.n !== chans.length) {
            var nm = {};
            chans.forEach(function (ch) { var k = tvKey(ch.cname || ch.name); if (k) (nm[k] = nm[k] || []).push(ch); });
            namedMemo = { cat: cat, n: chans.length, named: nm };
        }
        var named = namedMemo.named;
        var keys = Object.keys(named), nets = {}, want = rights().cc === "US" ? "en" : TV.lang;
        function sliced(list, fn, done) {
            var k = 0;
            (function run() {
                if (tok !== findTok) return;
                var t0 = Date.now();
                for (; k < list.length && Date.now() - t0 < 10; k++) fn(list[k]);
                if (k < list.length) setTimeout(run, 0); else done();
            })();
        }
        function index(m) { aliasInto(idx, m); }
        function broadcaster(m) {
            var ok = function (ch) { var l = langOf(ch); return !l || l === want; };
            tvOf(m).forEach(function (n) { (named[tvKey(n)] || []).forEach(function (ch) { if (ok(ch)) found[m.id].push({ ch: ch, how: "tv" }); }); });
            // the network that has the competition where you live: its channels, until the guide says which one
            var r = tvRights(m);
            if (!r) return;
            nets[m.id] = r.net;
            r.pats.map(tvPat).forEach(function (p) {
                (p.star ? keys.filter(function (k) { return k.indexOf(p.key) === 0; }) : named[p.key] ? [p.key] : []).forEach(function (k) {
                    named[k].forEach(function (ch) { if (ok(ch)) found[m.id].push({ ch: ch, how: "rights" }); });
                });
            });
        }
        // 1. the providers' event channels, named after the match
        var i = 0;
        function byName() {
            if (tok !== findTok) return;
            var t0 = Date.now();
            for (; i < chans.length && Date.now() - t0 < 12; i++) {
                var ch = chans[i], h = hits(folded(ch.raw || ch.name), idx);
                if (!h) continue;
                for (var id in h) if (h[id].side === 3 && Math.abs(h[id].m.start - now) < 18 * 3600000) found[id].push({ ch: ch, how: "name" });
            }
            if (i < chans.length) { setTimeout(byName, 0); return; }
            guide();
        }
        // 2. the TV guide: a programme naming both teams, on the air at the match's start
        function guide() {
            var test = function (s, e) { return e > from && s < to && e - s < 8 * 3600000; }, groups = [], g = 0;
            // the guide read in slices (all of it at once: up to 2 s on the M8 with a big playlist)
            if (TV.epg.scanSlices) TV.epg.scanSlices(chans, test, function (gs) { if (tok !== findTok) return; groups = gs; step(); });
            else { groups = TV.epg.scan ? TV.epg.scan(chans, test) : []; step(); }
            function step() {
                if (tok !== findTok) return;
                var t0 = Date.now();
                for (; g < groups.length && Date.now() - t0 < 12; g++) {
                    var gr = groups[g];
                    for (var p = 0; p < gr.progs.length; p++) {
                        var pr = gr.progs[p], ft = folded(pr[2]), h = hits(ft, idx);
                        if (NOT_LIVE.test(ft)) continue;
                        if (pr[3] && (!h || !full(h)) && (h || SPORTY.test(ft))) {
                            var both = hits(ft + folded(String(pr[3]).slice(0, 240)), idx);
                            if (both) h = both;
                        }
                        if (!h) continue;
                        for (var id in h) {
                            var m = h[id].m;
                            if (h[id].side !== 3 || !(pr[0] < m.start + 60 * 60000 && pr[1] > m.start + 5 * 60000)) continue;
                            for (var c = 0; c < gr.chans.length; c++) found[id].push({ ch: gr.chans[c], how: "guide", prog: pr });
                        }
                    }
                }
                if (g < groups.length) { setTimeout(step, 0); return; }
                finish();
            }
        }
        function full(h) { for (var id in h) if (h[id].side === 3) return true; return false; }
        function finish() {
            finding = false; findDone = true;
            ms.forEach(function (m) {
                var l = found[m.id], sure = l.some(function (x) { return x.how === "guide" || x.how === "tv"; });
                where[m.id] = arrange(sure ? l.filter(function (x) { return x.how !== "rights"; }) : l);
                where[m.id].net = nets[m.id] || "";
                where[m.id].guess = !sure && l.some(function (x) { return x.how === "rights"; });
            });
            TV.log("sports: channels found for " + ms.filter(function (m) { return where[m.id].n; }).length + " of " + ms.length + " matches");
            refreshShown();
        }
        sliced(ms, index, function () { sliced(ms, broadcaster, byName); });
    }
    /* One line per channel (its best quality), grouped by language, yours first */
    function arrange(list) {
        var byKey = {}, langs = {}, order = [], n = 0, now = Date.now();
        list.forEach(function (x) {
            var k = x.ch.key || x.ch.id, o = byKey[k];
            if (!o || HOW[x.how] > HOW[o.how] || (HOW[x.how] === HOW[o.how] && S.qualityRank(x.ch.q) > S.qualityRank(o.ch.q))) byKey[k] = x;
        });
        Object.keys(byKey).forEach(function (k) {
            var x = byKey[k], l = langOf(x.ch);
            if (!langs[l]) { langs[l] = []; order.push(l); }
            langs[l].push(x); n++;
        });
        order.forEach(function (l) {
            langs[l].sort(function (a, b) {
                var ao = a.prog && a.prog[0] <= now && a.prog[1] > now ? 1 : 0, bo = b.prog && b.prog[0] <= now && b.prog[1] > now ? 1 : 0;
                return bo - ao || HOW[b.how] - HOW[a.how] || S.qualityRank(b.ch.q) - S.qualityRank(a.ch.q) || (a.ch.num || 0) - (b.ch.num || 0);
            });
        });
        order.sort(function (a, b) { return (b === TV.lang) - (a === TV.lang) || (b === "en") - (a === "en") || langs[b].length - langs[a].length; });
        return { langs: langs, order: order, n: n };
    }
    var LANGS = { fr: "French", en: "English", es: "Spanish", pt: "Portuguese", it: "Italian", de: "German", nl: "Dutch", sq: "Albanian", ar: "Arabic", tr: "Turkish",
                  pl: "Polish", ro: "Romanian", el: "Greek", ru: "Russian", sr: "Serbo-Croatian", hi: "Hindi", ur: "Urdu", fa: "Persian", sv: "Swedish", no: "Norwegian",
                  da: "Danish", fi: "Finnish", zh: "Chinese", ja: "Japanese", ko: "Korean", ku: "Kurdish", af: "Africa", multi: "Multi-Language" };
    function langName(l) { return LANGS[l] ? T(LANGS[l]) : l ? l.toUpperCase() : T("Other"); }

    /* ---------- pictures and colours ---------- */
    function logo(u, w) {
        var m = /^https?:\/\/a\.espncdn\.com(\/i\/[^?#]+\.png)$/i.exec(u || "");
        return m ? "https://a.espncdn.com/combiner/i?img=" + m[1] + "&w=" + w + "&h=" + w : (u || "");
    }
    /* Dark logos on the dark screen (Tottenham's navy, Juventus' black): ESPN's own version drawn for a dark
       background when it has one (white), else a soft light halo behind. Each logo is looked at once (a 24 px copy,
       its lit pixels), the answer kept: "ok", "halo" or the dark-screen version's address. */
    var HALO = "radial-gradient(circle closest-side, rgba(255,255,255,0.95) 0, rgba(255,255,255,0.78) 58%, rgba(255,255,255,0.18) 86%, rgba(255,255,255,0) 100%)";
    var look = TV.load("sportsLogoLook2", {}) || {}, looking = {}, lookQueue = [], lookTimer = null;
    if (Object.keys(look).length > 4000) look = {};
    // each crest's own colour (its lit pixels' average): a crest the colour of its half gets another (colours())
    var tints = TV.load("sportsLogoTint", {}) || {}, tintTimer = null;
    if (Object.keys(tints).length > 4000) tints = {};
    function logoKey(u) { var m = /\/i\/[^?#&]+\.png/i.exec(u || ""); return m ? m[0] : String(u || ""); }
    function crestBg(u, w) {
        if (!u) return "none";
        var k = logoKey(u), a = look[k];
        if (a === undefined || !tints[k]) lookAt(u, k);
        if (a && a !== "ok" && a !== "halo") return TV.cssUrl(logo(a, w));
        return TV.cssUrl(logo(u, w)) + (a === "halo" ? ", " + HALO : "");
    }
    function lookAt(u, k) {
        if (looking[k] || !global.Image || !/^https?:/.test(u)) return;
        looking[k] = 1;
        lookQueue.push([u, k]);
        if (lookQueue.length === 1) setTimeout(lookNext, 300);
    }
    function lookNext() {
        var job = lookQueue[0];
        if (!job) return;
        function done(ans) {
            lookQueue.shift();
            if (ans) {
                look[job[1]] = ans;
                clearTimeout(lookTimer); lookTimer = setTimeout(function () { TV.save("sportsLogoLook2", look); }, 3000);
                if (ans !== "ok") repaintLogo(job[1], ans);
            }
            if (lookQueue.length) setTimeout(lookNext, 40);
        }
        darkness(logo(job[0], 64), function (d, tint) {
            if (tint && !tints[job[1]]) {
                tints[job[1]] = tint;
                // the tiles and the banner drawn again once the colours are known (only the tiles that change)
                clearTimeout(tintTimer);
                tintTimer = setTimeout(function () { TV.save("sportsLogoTint", tints); refreshShown(); if (strips[0] && strips[0].isHero) strips[0].draw(); }, 1200);
            }
            if (look[job[1]] !== undefined) { done(null); return; }        // only its colour was missing
            if (d === null) { done(null); return; }                         // unreadable: tried again next time the app starts
            if (!d) { done("ok"); return; }
            if (!/^https?:\/\/a\.espncdn\.com\/i\/.+\/500\/[^\/]+\.png$/i.test(job[0])) { done("halo"); return; }
            var alt = job[0].replace("/500/", "/500-dark/");
            darkness(logo(alt, 64), function (d2) { done(d2 === false ? alt : "halo"); });
        });
    }
    /* true: mostly too dark for the screen, false: fine, null: could not be read. A pixel is too dark when it stands
       out less than 1.8 times from the near-black background (navy, black, dark brown); a red or a green stands out */
    function darkness(src, cb) {
        var im = new global.Image(), fin = false, t = setTimeout(function () { end(null); }, 8000);
        function end(v, tint) { if (fin) return; fin = true; clearTimeout(t); cb(v, tint || null); }
        im.crossOrigin = "anonymous";
        im.onload = function () {
            try {
                var c = document.createElement("canvas"); c.width = c.height = 24;
                var x = c.getContext("2d"); x.drawImage(im, 0, 0, 24, 24);
                var px = x.getImageData(0, 0, 24, 24).data, n = 0, dark = 0, sr = 0, sg = 0, sb = 0;
                for (var i = 0; i < px.length; i += 4) {
                    if (px[i + 3] < 128) continue;
                    sr += px[i]; sg += px[i + 1]; sb += px[i + 2];
                    var l = 0.2126 * Math.pow(px[i] / 255, 2.2) + 0.7152 * Math.pow(px[i + 1] / 255, 2.2) + 0.0722 * Math.pow(px[i + 2] / 255, 2.2);
                    n++; if ((l + 0.05) / 0.054 < 1.8) dark++;
                }
                end(n < 20 ? false : dark / n > 0.55, n >= 20 ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : null);
            } catch (e) { end(null); }
        };
        im.onerror = function () { end(null); };
        im.src = src;
    }
    // the logos already on the screen, changed at once
    function repaintLogo(k, ans) {
        var els;
        try { els = document.querySelectorAll("[style*='" + k.replace(/[^A-Za-z0-9/._:?=&,-]/g, "") + "']"); } catch (e) { return; }
        for (var i = 0; i < els.length; i++) {
            var st = els[i].style.backgroundImage;
            if (!st || st.indexOf("gradient") >= 0) continue;
            els[i].style.backgroundImage = ans === "halo" ? st + ", " + HALO : st.split("/500/").join("/500-dark/");
        }
    }
    function rgba(hex, a) {
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
        if (!m) return "rgba(70,76,92," + a + ")";
        var n = parseInt(m[1], 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
        if (r + g + b < 60) { r += 50; g += 50; b += 50; }                 // black: a little grey, or nothing shows
        return "rgba(" + r + "," + g + "," + b + "," + a + ")";
    }
    function awayFirst(m) { return !!AWAY_FIRST[m.sport] && m.src !== "365"; }
    function sides(m) { return awayFirst(m) ? [m.away, m.home] : [m.home, m.away]; }

    /* ---------- the match cards ---------- */
    // A team that lost (a draw dims nobody)
    function result(t, m, st) { return st.done && (m.home.winner || m.away.winner) ? (t.winner ? " is-win" : " is-lose") : ""; }
    /* A match on another day than the one shown (a team's next match): its day with its time */
    function dayLabel(t) {
        var d0 = dayStart(0);
        if (t >= d0 && t < d0 + 86400000) return T("Today");
        if (t >= d0 + 86400000 && t < d0 + 2 * 86400000) return T("Tomorrow");
        if (t >= d0 - 86400000 && t < d0) return T("Yesterday");
        try { return new Date(t).toLocaleDateString(TV.locale, { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return TV.dayName(new Date(t)); }
    }
    // Far ahead, the TV guide may not reach the match yet: nothing said rather than "not in your lists"
    function farAhead(m) { return m.start > Date.now() + 20 * 3600000; }
    /* A team's colour as a solid background under its crest: never so light the white crests vanish, never black */
    function shade(hex, k) {
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""), r = 58, g = 64, b = 82;
        if (m) { var n = parseInt(m[1], 16); r = n >> 16 & 255; g = n >> 8 & 255; b = n & 255; }
        var lum = 0.3 * r + 0.59 * g + 0.11 * b;
        if (lum > 175) k *= 0.5;                                                  // white, yellow: deeper
        if (lum < 24) { r += 40; g += 42; b += 50; }                              // black: a dark grey
        return "rgb(" + Math.round(r * k) + "," + Math.round(g * k) + "," + Math.round(b * k) + ")";
    }
    // Apple TV's Live & Upcoming cards: the two clubs' colours split on a slant
    function rgbOf(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""), n = m ? parseInt(m[1], 16) : -1; return n < 0 ? null : [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    function lum(c) { return c ? 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] : 0; }
    function far(x, y) { return !x || !y || Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) > 90; }
    /* The colours of a match: a black kit takes its second colour (Nice: red), and two alike (Italy and France, both
       blue) give the visitors their second one */
    /* A country's colours are its flag's, not ESPN's (Italy's kit is blue, its colour here green: France - Italy is
       blue against green). [main, second] by the country's code */
    var FLAG_COLORS = { FR: "0055A4 EF4135", IT: "009246 CE2B37", ES: "C60B1E FFC400", DE: "000000 DD0000", PT: "006600 DA291C", NL: "F36C21 21468B",
        BE: "EF3340 FDDA24", HR: "D7141A 171796", CH: "DA291C FFFFFF", AT: "ED2939 FFFFFF", DK: "C8102E FFFFFF", SE: "006AA7 FECC02", NO: "BA0C2F 00205B",
        FI: "002F6C FFFFFF", IS: "02529C DC1E35", IE: "169B62 FF883E", PL: "DC143C FFFFFF", CZ: "D7141A 11457E", SK: "0B4EA2 EE1C25", SI: "005CE5 ED1C24",
        HU: "CE2939 477050", RO: "FCD116 002B7F", BG: "00966E D62612", RS: "C6363C 0C4076", BA: "002395 FECB00", ME: "C40308 D3AE3B", MK: "D20000 FFE600",
        AL: "E41E20 000000", XK: "244AA5 D0A650", GR: "0D5EAF FFFFFF", TR: "E30A17 FFFFFF", UA: "0057B7 FFD700", GE: "FF0000 FFFFFF", AM: "D90012 0033A0",
        AZ: "00B5E2 EF3340", CY: "D57800 4E5B31", LV: "9E3039 FFFFFF", LT: "FDB913 006A44", EE: "0072CE 000000", LU: "00A1DE EF3340", MT: "CF142B FFFFFF",
        MD: "0046AE FFD200", BY: "C8313E 4AA657", RU: "0039A6 D52B1E", KZ: "00AFCA FEC50C", FO: "005EB8 EF303E", AD: "10069F FEDF00", SM: "5EB6E4 FFFFFF",
        LI: "002B7F CE1126", GI: "DA000C FFFFFF", MA: "C1272D 006233", DZ: "006233 D21034", TN: "E70013 FFFFFF", EG: "CE1126 000000", SN: "00853F FDEF42",
        CI: "F77F00 009E60", CM: "007A5E CE1126", NG: "008751 FFFFFF", GH: "006B3F FCD116", ML: "14B53A FCD116", BF: "EF2B2D 009E49", CD: "007FFF CE1021",
        ZA: "007749 FFB612", CV: "003893 CF2027", GN: "CE1126 009460", GA: "009E60 3A75C4", AO: "CC092F 000000", ZM: "198A00 EF7D00", BJ: "008751 FCD116",
        MR: "006233 D01C1F", LY: "000000 E70013", SD: "D21034 007229", KE: "006600 BB0000", TZ: "1EB53A 00A3DD", UG: "FCDC04 D90000", MG: "FC3D32 007E3A",
        US: "0A3161 B31942", CA: "D80621 FFFFFF", MX: "006847 CE1126", BR: "FEDF00 009C3B", AR: "74ACDF FFFFFF", UY: "5CBFEB FFFFFF", CO: "FCD116 003893",
        CL: "D52B1E 0039A6", PE: "D91023 FFFFFF", EC: "FFD100 034EA2", PY: "D52B1E 0038A8", BO: "007934 F9E300", VE: "FFCC00 00247D", CR: "002B7F CE1126",
        PA: "DA121A 005293", JM: "009B3A FED100", HN: "0073CF FFFFFF", SV: "0047AB FFFFFF", GT: "4997D0 FFFFFF", HT: "00209F D21034", CW: "002B7F F9E814",
        JP: "BC002D 1F2F98", KR: "CD2E3A 0047A0", KP: "ED1C27 024FA2", CN: "EE1C25 FFFF00", AU: "FFCD00 00843D", NZ: "000000 FFFFFF", SA: "006C35 FFFFFF",
        QA: "8A1538 FFFFFF", AE: "00732F FF0000", IR: "239F40 DA0000", IQ: "007A3D CE1126", JO: "007A3D CE1126", PS: "007A3D CE1126", SY: "CE1126 007A3D",
        LB: "ED1C24 00A651", OM: "DB161B 008000", BH: "CE1126 FFFFFF", KW: "007A3D CE1126", UZ: "1EB53A 0099B5", IN: "FF9933 138808", TH: "A51931 2D2A4A",
        VN: "DA251D FFFF00", ID: "FF0000 FFFFFF", MY: "010066 CC0001", FJ: "68BFE5 FFFFFF", WS: "002B7F CE1126", TO: "C10000 FFFFFF", PG: "CE1126 000000" };
    var NATION_COLORS = { england: "FFFFFF CF081F", scotland: "005EB8 FFFFFF", wales: "C8102E 00AB39", "northern ireland": "00A651 FFFFFF" };
    function kit(t) {
        var k = S.fold(t.name || ""), c = NATION_COLORS[k] || FLAG_COLORS[isoMap()[k] || FLAG_ISO[k] || ""];
        if (c && isNation(t)) { c = c.split(" "); return [c[0], c[1]]; }
        return [t.color, t.alt];
    }
    var FLAG_ISO = { "republic of ireland": "IE", ireland: "IE", "united states of america": "US", usa: "US", "bosnia herzegovina": "BA", "north macedonia": "MK", kosovo: "XK",
        turkiye: "TR", czechia: "CZ", "ivory coast": "CI", "cote d ivoire": "CI", "korea republic": "KR", "south korea": "KR", "dr congo": "CD", "cape verde": "CV", palestine: "PS" };
    function colours(a, b) {
        var ka = kit(a), kb = kit(b), ca = ka[0], cb = kb[0];
        if (lum(rgbOf(ca)) < 30 && lum(rgbOf(ka[1])) >= 30) ca = ka[1];
        if (lum(rgbOf(cb)) < 30 && lum(rgbOf(kb[1])) >= 30) cb = kb[1];
        if (!far(rgbOf(ca), rgbOf(cb)) && kb[1] && far(rgbOf(ca), rgbOf(kb[1]))) cb = kb[1];
        return [clear(a, ca, ka[1]), clear(b, cb, kb[1])];
    }
    /* Liverpool's red crest on Liverpool's red: the crest's own colour (looked at with its darkness) too close to the
       half behind it: the club's other colour, else a much deeper shade of the same one */
    function clear(t, c, alt) {
        var k = t && t.logo && logoKey(t.logo), seen = k && look[k], tint = k && tints[k], rc = rgbOf(c);
        if (seen === "halo") return c;                                      // on its light halo: it shows anyway
        if (seen && seen !== "ok") tint = [235, 235, 235];                 // drawn in its white version (Tottenham)
        if (!tint || !rc || far(rc, tint)) return c;
        if (alt && rgbOf(alt) && far(rgbOf(alt), tint) && lum(rgbOf(alt)) >= 30) return alt;
        var h = function (v) { v = Math.round(v * 0.42); return (v < 16 ? "0" : "") + v.toString(16); };
        return "#" + h(rc[0]) + h(rc[1]) + h(rc[2]);
    }
    function split(a, b, angle) { var cs = colours(a, b), c1 = shade(cs[0], 0.82), c2 = shade(cs[1], 0.82); return "linear-gradient(" + (angle || 112) + "deg, " + c1 + " 0%, " + c1 + " 50%, " + c2 + " 50%, " + c2 + " 100%)"; }
    function names2(m) { var two = sides(m); return shown(two[0], false) + (awayFirst(m) ? " @ " : " – ") + shown(two[1], false); }
    function onAnotherDay(m) { var s = span(); return m.state === "pre" && (dayOff === "next" || m.start < s[0] || m.start >= s[1]) && !/CANCEL|POSTPONED/.test(m.status); }
    // dated: the row mixes days (My Teams in what comes next); a day's row says its time only
    function badge(m, dated) {
        var st = statusOf(m);
        if (m.state === "pre" && !/CANCEL|POSTPONED/.test(m.status) && (dated || (dayOff !== "next" && onAnotherDay(m)))) st.text = dayLabel(m.start) + " · " + TV.hhmm(m.start);
        return "<span class='mc__badge" + (st.live ? " is-live" : st.done ? " is-done" : "") + "'>" + esc(st.text) + "</span>";
    }
    function leagueLogo(m, size) { var u = logos[m.lkey]; return u ? "<i class='mc__lg' style='background-image:" + esc(crestBg(u, size || 48)) + "'></i>" : ""; }
    function makeCard(m, withLeague, dated) {
        var c = el("div", "card mc"), art = el("div", "card__art mc__art"), cap = el("div", "mc__cap"), sub = el("div", "mc__sub");
        c.appendChild(art); c.appendChild(cap); c.appendChild(sub);
        c._m = m;
        /* Apple TV's game tile: the two clubs' colours split on a slant, a jersey's mesh over them. Before the match
           the crests in their halves and the time in a dark capsule; in play and after, Apple's scoreboard across
           the tile (crest, score, the clock or "Final", score, crest), the loser's score dimmed, LIVE in its capsule. */
        c._update = function () {
            var st = statusOf(m), two = sides(m), w = where[m.id], bits = [], board = m.state !== "pre" && !/CANCEL|POSTPONED/.test(m.status);
            var cr = function (t, cls) { return "<i class='mc__crest" + cls + "' style='background-image:" + esc(crestBg(crest(t, m.sport), 160)) + "'></i>"; };
            /* the capsule between the scores: a short word as it is; the period and the clock on two lines ("QT2", "06:52");
               a long word smaller, on two lines if it must ("Terminé (t.a.b.)") */
            var stx = String(st.text || ""), dot = stx.indexOf(" · "), pill = stx.length <= 10 ? "<span>" + esc(stx) + "</span>"
                : dot > 0 ? "<span class='is-two'><em>" + esc(stx.slice(0, dot)) + "</em><em>" + esc(stx.slice(dot + 3)) + "</em></span>"
                : "<span class='is-long'>" + esc(stx) + "</span>";
            var paintBg = "var(--mc-tex), " + split(two[0], two[1], 110), html = (board
                    ? "<div class='mc__board'>" + cr(two[0], "") + "<b class='" + result(two[0], m, st) + "'>" + esc(two[0].score || "0") + "</b>" + pill +
                      "<b class='" + result(two[1], m, st) + "'>" + esc(two[1].score || "0") + "</b>" + cr(two[1], "") + "</div>"
                    : cr(two[0], " mc__crest--a") + cr(two[1], " mc__crest--b")) +
                (board ? (st.live ? "<span class='mc__badge is-live'>" + esc(T("Live")) + "</span>" : "") : badge(m, dated)) +
                (isFavMatch(m) ? "<span class='mc__fav'>" + TV.icon("star", 20) + "</span>" : "");
            if (withLeague) bits.push(T(m.league[1])); else if (m.note) bits.push(m.note);
            var off = tvOf(m), tv = st.done ? "" : off.length ? off.slice(0, 2).join(", ") : w && w.net ? w.net : !w ? "" : w.n ? (w.n > 1 ? T("{n} channels", { n: w.n }) : T("1 channel")) : farAhead(m) ? "" : T("Not in your lists");
            var subHtml = (withLeague ? leagueLogo(m, 40) : "") + (bits.length ? "<span>" + esc(bits.join(" · ")) + "</span>" : "") + (bits.length && tv ? "<b class='mc__dot'>·</b>" : "") +
                (tv ? "<span class='mc__tv" + (w && w.n ? " is-on" : "") + "'>" + (w && w.n ? TV.icon("tv", 20) : "") + esc(tv) + "</span>" : "");
            /* the channels found, a refresh of the scores: each tile was made again from nothing (a screen of 120
               tiles froze 300 to 700 ms on the M8, and pressing ▼ then waited); now only what changed */
            var sig = paintBg + html + subHtml;
            if (sig === c._sig) return;
            c._sig = sig;
            art.style.background = paintBg;
            art.innerHTML = html;
            cap.textContent = names2(m);
            sub.innerHTML = subHtml;
        };
        c._update();
        return c;
    }

    /* ---------- the match's picture (Apple TV puts a photo behind a match) ----------
       After the match ESPN's photo of it (its report); otherwise the stadium's photo on Wikipedia (free pictures,
       credited on the screen), found by the venue's name and kept a month. Without one: the clubs' colours. */
    var venuePics = TV.load("sportsVenuePics", {}) || {}, venueAsk = {};
    if (Object.keys(venuePics).length > 400) venuePics = {};
    // { u, by } now, null: none, undefined: not known yet
    // a picture's arrival (already decoded when the browser has it): how long it took
    function seen(u, cb) {
        var im = new global.Image(), t = Date.now(), done = function () { cb(Date.now() - t); };
        im.src = u;
        if (im.decode) im.decode().then(done, done); else { im.onload = done; im.onerror = done; }
    }
    function photoNow(m) {
        var d = details[m.id] && details[m.id].d, v = venueKey(m), c = v && venuePics[v];
        if (m.state === "post" && d && d.photo) return { u: d.photo, by: T("Photo: ESPN") };
        if (!v) return null;
        if (!c) return undefined;
        return c.u ? { u: c.u.replace("/1920px-", "/1280px-"), by: T("Photo: Wikipedia") } : null;
    }
    var VENUE_WORD = / (stadium|stade|stadio|estadio|estadi|stadion|arena|park|parc|center|centre|field|ground|road|bowl|dome|garden|coliseum|velodrome) /;
    function venueKey(m) { return m.venue ? S.fold(m.venue + (m.city ? " " + m.city : "")) : ""; }
    function photoOf(m) {
        var v = m.venue, k = venueKey(m), c = k && venuePics[k];
        if (!k) return Promise.resolve(null);
        if (c && Date.now() - c.at < 30 * 86400000) return Promise.resolve(c.u ? { u: c.u, by: T("Photo: Wikipedia") } : null);
        if (venueAsk[k]) return venueAsk[k];
        var url = "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=4&gsrsearch=" + encodeURIComponent(v + (m.city ? " " + m.city : "") + " stadium") +
                  "&prop=pageimages&piprop=thumbnail%7Cname&pithumbsize=1280&pilicense=free";
        venueAsk[k] = TV.fetchJSON(url, { timeout: 15000 }).then(function (j) {
            var q = j && j.query && j.query.pages, pages = [], u = "";
            var words = S.fold(v).split(" ").filter(function (w) { return w.length > 2 && !/^(stade|stadium|stadio|estadio|estadi|arena|park|parc|the|del|des|municipal)$/.test(w); });
            for (var id in q) if (Object.prototype.hasOwnProperty.call(q, id)) pages.push(q[id]);
            pages.sort(function (a, b) { return a.index - b.index; });
            /* a photo (not a logo, a map, a plan); the page that looks most like a venue: a venue's word in its title
               (stadium, arena, park…: 2, plus 2 with a word of the venue's name, plus 1 with it in the picture's name);
               without one, 1 for a word of the name; the search's order between equals ("Spectrum (arena)" loses to
               "Xfinity Mobile Arena", "Allianz" the company to "Juventus Stadium" for Turin's Allianz Stadium) */
            var best = -1;
            pages.forEach(function (p) {
                var t = S.fold(p.title), img = p.pageimage || "", fi = S.fold(img), src = p.thumbnail && p.thumbnail.source;
                if (!src || !/\.(jpe?g|webp)$/i.test(img) || /logo|map|plan|crest|badge|seat/i.test(img)) return;
                var named = words.some(function (w) { return t.indexOf(w) >= 0; }), pic = words.some(function (w) { return fi.indexOf(w) >= 0; });
                var sc = VENUE_WORD.test(" " + t + " ") ? 2 + (named ? 2 : 0) + (pic ? 1 : 0) : (named ? 1 : 0);
                if (sc > best) { best = sc; u = src; }
            });
            venuePics[k] = { at: Date.now(), u: u };
            TV.save("sportsVenuePics", venuePics);
            delete venueAsk[k];
            return u ? { u: u, by: T("Photo: Wikipedia") } : null;
        }, function () {
            venuePics[k] = { at: Date.now() - 29 * 86400000, u: "" };       // asked again tomorrow
            delete venueAsk[k];
            return null;
        });
        return venueAsk[k];
    }

    /* ---------- the banner: your teams' next match (Apple TV's MLS hero) ----------
       Your teams' match in play, else their next one; without favourites, what is live, else what comes next.
       ◀ ▶ past its buttons goes to the next one; it changes by itself every 10 s while you are elsewhere. */
    // How long until it starts; dated: the text says the day and the time already
    function countdown(m) {
        var d = m.start - Date.now(), d0 = dayStart(0), h = TV.hhmm(m.start), day = new Date(m.start);
        if (d <= 0) return { text: "" };
        if (d < 3600000) return { text: T("In {n} min", { n: Math.max(1, Math.round(d / 60000)) }) };
        if (m.start < d0 + 86400000) return { text: T("Today at {time}", { time: h }), dated: true };
        if (m.start < d0 + 2 * 86400000) return { text: T("Tomorrow at {time}", { time: h }), dated: true };
        day.setHours(0, 0, 0, 0);
        return { text: T("In {n} days", { n: Math.round((day.getTime() - d0) / 86400000) }) };
    }
    function longDay(t) { try { var s = new Date(t).toLocaleDateString(TV.locale, { weekday: "long", day: "numeric", month: "long" }); return s.charAt(0).toUpperCase() + s.slice(1); } catch (e) { return TV.dayName(new Date(t)); } }
    function featured() {
        var favs = mine.filter(ofSport).filter(function (m) { return m.state !== "post" && !stale(m) && !/CANCEL|POSTPONED/.test(m.status); });
        var list = favs.filter(isLive).concat(favs.filter(function (m) { return !isLive(m); }).sort(byTime)), ours = true;
        if (!list.length) {
            ours = false;
            var day = shownList().filter(function (m) { return !/CANCEL|POSTPONED/.test(m.status); });
            list = day.filter(isLive).concat(day.filter(function (m) { return m.state === "pre"; }).sort(byTime));
        }
        return { list: list.slice(0, 6), ours: ours };
    }
    function Hero(f) {
        this.root = el("div", "sh"); this.items = f.list; this.ours = f.ours; this.index = 0; this.active = false; this.t0 = Date.now();
        // every match of the banner: its photo asked and loaded now, so turning to it shows it at once
        this.items.forEach(function (m) { photoOf(m).then(function (p) { if (p) seen(p.u, function () {}); }); });
        this.key = "hero"; this.isHero = true; this.cards = [this];
        var self = this;
        this.nav = new TV.Nav({
            onSelect: function (i) { if (self.acts[i]) self.acts[i](); },
            onEdge: function (dir) { if ((dir === "left" || dir === "right") && self.items.length > 1) { self.go(dir === "left" ? -1 : 1); return true; } }
        });
        this._update = function () { self.draw(); };
        this.draw();
    }
    Hero.prototype.go = function (d) {
        this.index = (this.index + d + this.items.length) % this.items.length;
        TV.sound.tick();
        this.draw();
    };
    Hero.prototype.current = function () { return this.items[this.index]; };
    Hero.prototype.ahead = function () {
        var self = this;
        clearTimeout(this.aheadTimer);
        this.aheadTimer = setTimeout(function () {
            if (!visible || zone > 0 || strips[0] !== self) return;
            if (Date.now() - TV.keyAt < 900) { self.ahead(); return; }     // not while you move: a moment later
            for (var i = 0; i < self.items.length; i++) {
                var m = self.items[i];
                if (self.slides[m.id] || i === self.index) continue;
                // only its picture layer: the text and the buttons on screen stay as they are
                self.slideFor(m);
                self.near();
                self.ahead();                                               // the next one a moment later
                return;
            }
        }, 1200);
    };
    Hero.prototype.setActive = function (on) { this.active = on; if (on) this.nav.refocus(); else this.nav.blur(); this.near(); };
    /* A match's picture layer, made (or made again when its photo or score changed) without touching the text */
    Hero.prototype.slideFor = function (m) {
        var self = this, two = sides(m), score = m.state !== "pre" && !/CANCEL|POSTPONED/.test(m.status), ph = photoNow(m);
        if (ph === undefined) photoOf(m).then(function (p) { if (p && self.items[self.index] === m) self.draw(); });
        if (!this.slidesEl) {
            this.root.innerHTML = "<div class='sh__slides'></div><div class='sh__fg'></div>";
            this.slidesEl = this.root.firstChild; this.fgEl = this.root.lastChild; this.slides = {};
        }
        var sk = m.id + "|" + (ph ? ph.u : "") + "|" + (score ? (two[0].score || "") + "-" + (two[1].score || "") : ""), sl = this.slides[m.id];
        if (!sl || sl._k !== sk) {
            var cs = colours(two[0], two[1]);
            var fresh = el("div", "sh__slide" + (ph ? " has-photo" : ""), (ph ? "<div class='sh__photo' style='background-image:" + esc(TV.cssUrl(ph.u)) + "'></div>"
                    : "<div class='sh__bg'><i style='background:" + esc(shade(cs[0], 0.82)) + "'></i><i class='sh__c2' style='background:" + esc(shade(cs[1], 0.82)) + "'></i></div><div class='sh__tex'></div>") +
                "<div class='sh__scrim'></div>" +
                (ph ? "" : "<div class='sh__board'><i class='sh__crest' style='background-image:" + esc(crestBg(crest(two[0], m.sport), 300)) + "'></i>" +
                      (score ? "<div class='sh__score'>" + esc(two[0].score || "0") + "<i>–</i>" + esc(two[1].score || "0") + "</div>" : "<div class='sh__vs'>" + esc(TV.hhmm(m.start)) + "</div>") +
                      "<i class='sh__crest' style='background-image:" + esc(crestBg(crest(two[1], m.sport), 300)) + "'></i></div>"));
            fresh._k = sk;
            if (sl) { var old = sl; old.classList.remove("is-on"); setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 600); }
            this.slidesEl.appendChild(fresh);
            this.slides[m.id] = sl = fresh;
            void fresh.offsetWidth;                                         // so it fades in, not appears
        }
        return sl;
    };
    /* The match shown, and the ones that can come next. The graphics chip blends each of the six almost transparent
       pictures at every frame (7 of the 12 million pixels a frame drawn on Sports), too much for an LG G5: on LG only
       the next one (and the one before, while you are on the banner) stays ready, the others are not drawn (tv.css,
       .is-webos). The next one is made ready once the fade is over, never during a move. */
    Hero.prototype.near = function () {
        var self = this, n = this.items.length, cur = this.items[this.index];
        if (!cur || !this.slides) return;
        for (var sid in this.slides) if (Object.prototype.hasOwnProperty.call(this.slides, sid)) this.slides[sid].classList.toggle("is-on", sid === String(cur.id));
        clearTimeout(this.nearTimer);
        this.nearTimer = setTimeout(function () {
            var at = self.items[self.index], nx = n > 1 ? self.items[(self.index + 1) % n] : null, pv = n > 2 && self.active ? self.items[(self.index - 1 + n) % n] : null;
            if (!at || at !== cur) return;
            for (var id in self.slides) if (Object.prototype.hasOwnProperty.call(self.slides, id))
                self.slides[id].classList.toggle("is-near", !!(nx && id === String(nx.id)) || !!(pv && id === String(pv.id)));
        }, 650);
    };
    Hero.prototype.move = function (d) { this.nav.move(d < 0 ? "left" : "right"); return true; };
    Hero.prototype.draw = function () {
        var m = this.items[this.index], self = this;
        if (!m) return;
        var st = statusOf(m), two = sides(m), w = where[m.id], keepBtn = this.nav.index > 0 ? this.nav.index : 0;
        var cd = isLive(m) || st.done ? { text: st.text } : countdown(m), when = cd.text;
        var meta = [cd.dated ? "" : longDay(m.start) + " · " + TV.hhmm(m.start), m.venue].filter(Boolean).join(" · ");
        var list = w ? (w.langs[w.order[0]] || []) : [], soon = isLive(m) || m.start - Date.now() < 45 * 60000;
        // "TF1, France 2 · French · Also in English, Spanish"
        var tv = !w ? "" : w.n && w.guess ? T("On {net} where you live", { net: w.net }) + " · " + list.slice(0, 2).map(function (x) { return x.ch.name; }).join(", ") + (list.length > 2 ? " +" + (list.length - 2) : "")
               : w.n ? list.slice(0, 3).map(function (x) { return x.ch.name; }).join(", ") + (list.length > 3 ? " +" + (list.length - 3) : "") + " · " + langName(w.order[0]) +
                                 (w.order.length > 1 ? " · " + T("Also in {langs}", { langs: w.order.slice(1, 4).map(langName).join(", ") }) : "")
                           : w.net ? T("On {net} where you live", { net: w.net }) : farAhead(m) ? T("The channel comes with your TV guide, the day before.") : T("Not in your lists");
        var score = m.state !== "pre" && !/CANCEL|POSTPONED/.test(m.status);
        /* Apple TV's hero: the whole width, under the menu and the tabs; the two clubs' colours on a slant with the
           jersey's mesh, the crests and the score or the time on the right, the text at the bottom left, one white
           capsule and a round glass button, the dots in the middle at the bottom. */
        var ph = photoNow(m);
        var pill = "<span class='sh__pill" + (isLive(m) ? " is-live" : "") + "'>" + esc(isLive(m) || st.done ? st.text : TV.hhmm(m.start)) + "</span>";
        var line = function (t) {
            return "<div class='sh__team'><i style='background-image:" + esc(crestBg(crest(t, m.sport), 120)) + "'></i><span>" + esc(shown(t, false)) + "</span>" +
                   (score ? "<b class='" + result(t, m, st) + "'>" + esc(t.score || "0") + "</b>" : "") + "</div>";
        };
        // "Today at 21:00 · Mohamed V Stadium", "In 3 days · Saturday 21 November · San Siro"
        var day = isLive(m) || st.done ? (st.done ? longDay(m.start) : "") : cd.dated ? when : [when, longDay(m.start)].filter(Boolean).join(" · ");
        meta = [day, m.venue].filter(Boolean).join(" · ");
        if (ph && TV.DEV && !this.told) { this.told = 1; var h0 = this.t0; seen(ph.u, function () { TV.log("sports: banner photo shown " + (Date.now() - h0) + " ms after the page"); }); }
        /* Each match of the banner has its picture on a layer of its own, painted once: turning to another one fades
           layers (redrawing the whole banner at each ◀ ▶ cost the M8 about 150 ms a press). The text above is
           written again, a small part of the screen. */
        this.slideFor(m);
        this.near();
        var fg = "<div class='sh__txt'><div class='sh__cap'>" + pill + leagueLogo(m, 64) + "<span>" + esc(T(m.league[1]) + (m.note ? " · " + m.note : "")) + "</span>" +
                (this.ours ? "<span class='sh__ours'>" + TV.icon("star", 22) + esc(T("My Teams")) + "</span>" : "") + "</div>" +
            line(two[0]) + line(two[1]) +
            (meta ? "<div class='sh__meta'>" + esc(meta) + "</div>" : "") +
            "<div class='sh__tv'>" + (w && w.n ? TV.icon("tv", 26) : "") + "<span>" + esc(tv) + "</span></div>" +
            "<div class='sh__btns'></div></div>" +
            (this.items.length > 1 ? "<div class='sh__dots'>" + this.items.map(function (x, i) { return "<i" + (i === self.index ? " class='is-on'" : "") + "></i>"; }).join("") + "</div>" : "");
        // the other matches' layers made ahead, one at a time while you stay at the top of the page
        this.ahead();
        /* The scores' refresh every 30 s drew the banner again even when nothing in it had changed: its text
           (1920x800) and its buttons were painted again each time (an LG G5's graphics chip: 13 ms, and the buttons) */
        var sig = fg + "|" + m.id + "|" + (list.length && soon ? list.map(function (x) { return x.ch.id; }).join(",") : "");
        if (sig === this._sig && this.nav.tiles.length) return;
        this._sig = sig;
        this.fgEl.innerHTML = fg;
        var box = this.fgEl.querySelector(".sh__btns"), tiles = [];
        this.acts = [];
        function btn(html, run, cls) { var b = el("div", "btn " + cls, html); box.appendChild(b); tiles.push(b); self.acts.push(run); }
        // one capsule (watch it, else its page) and, next to "Watch", a round glass button for the page
        if (list.length && soon) {
            btn(TV.icon("play", 28) + esc(T("Watch on {name}", { name: list[0].ch.name })), function () { var chs = list.map(function (x) { return x.ch; }); TV.live.play(chs[0], chs); }, "btn--primary");
            btn(TV.icon("info", 30), function () { openMatch(m); }, "btn--round sh__round");
        } else btn(TV.icon("info", 28) + esc(T("Match Details")), function () { openMatch(m); }, "btn--primary");
        this.nav.setTiles(tiles, Math.min(keepBtn, tiles.length - 1));
        if (!this.active) this.nav.blur();
    };

    /* ---------- the page ---------- */
    var root, page, barEl, rowsEl, msgEl, chipNav = null, chipDefs = [], strips = [], zone = -1, visible = false;
    var pageTop = 0;
    var dayOff = 0, sportId = "all", matches = [], mine = [], loadTok = 0, loading = false, failed = false, timer = null, shownSig = "";
    function build() {
        root = TV.$("v-sports");
        root.innerHTML = "";
        page = el("div", "sports");
        barEl = el("div", "sports__bar");
        rowsEl = el("div", "sports__rows");
        msgEl = el("div", "empty sports__msg");
        page.appendChild(barEl); page.appendChild(rowsEl); page.appendChild(msgEl);
        root.appendChild(page);
        chipNav = new TV.Nav({ onSelect: function (i) { pick(chipDefs[i]); } });
        // the banner turns by itself while you look elsewhere on the page
        // only while you see it (on the tabs above it), its next photo decoded before it shows: turning while you
        // were down in the rows made the M8 decode a photo when you came back up
        setInterval(function () {
            var h = strips[0];
            if (!visible || !h || !h.isHero || zone !== -1 || h.items.length < 2 || TV.topNav() !== TV.shell.screen) return;
            if (Date.now() - TV.keyAt < 2500) return;                   // you are moving along the chips: not now
            var next = (h.index + 1) % h.items.length, ph = photoNow(h.items[next]);
            var go = function () { if (zone === -1 && strips[0] === h && visible) { h.index = next; h.draw(); } };
            if (ph) seen(ph.u, go); else go();
        }, 10000);
    }
    function count(id) { return matches.filter(function (m) { return id === "all" || m.sport === id; }).length; }
    function drawBar() {
        var at = chipNav.current() ? chipNav.index : -1;
        // Your favourites first; then the calendar; then ONE chip for the sports (the one you are on), which opens them
        // in a list: eight chips of sports went off the screen
        chipDefs = [{ favs: true, label: T("Favorites") }, { day: "past", label: T("Results"), first: true }, { day: 0, label: T("Today") }, { day: 1, label: T("Tomorrow") }, { day: "next", label: T("Upcoming") },
                    { cal: true, label: isCalDay() ? shortDay(dayStart(dayOff)) : T("Calendar") }];
        var sports = SPORTS.filter(function (sp) { return count(sp.id) > 0; });
        if (sportId !== "all" && !sports.some(function (sp) { return sp.id === sportId; })) sportId = "all";
        if (sports.length > 1) {
            var cur = sportId === "all" ? null : SPORTS.filter(function (sp) { return sp.id === sportId; })[0];
            chipDefs.push({ sports: true, label: cur ? T(cur.label) : T("All Sports"), n: cur ? count(cur.id) : 0, first: true });
        }
        barEl.innerHTML = "";
        var tiles = chipDefs.map(function (d) {
            var on = d.cal ? isCalDay() : d.day !== undefined ? d.day === dayOff : false;
            var c = el("div", "chip" + (on ? " is-current" : "") + (d.sports && sportId !== "all" ? " is-on" : "") + (d.first ? " sports__gap" : ""), (d.favs ? TV.icon("star", 24) + "&nbsp;" : d.cal ? TV.icon("calendar", 26) + "&nbsp;" : d.sports ? TV.icon("list", 24) + "&nbsp;&nbsp;" : "") + esc(d.label) + (d.n ? "<span class='chip__n'>" + d.n + "</span>" : ""));
            barEl.appendChild(c);
            return c;
        });
        chipNav.setTiles(tiles, at >= 0 ? Math.min(at, tiles.length - 1) : 2);
        if (zone !== -1 || !active()) chipNav.blur();
    }
    function pick(d) {
        if (!d) return;
        TV.sound.select();
        if (d.favs) { openSetup(); return; }
        if (d.cal) { openCal(); return; }
        if (d.sports) { sportsMenu(); return; }
        if (d.day !== undefined) { if (d.day === dayOff) return; dayOff = d.day; matches = []; mine = []; load(true); }
        drawBar();
    }
    /* The sports in a list, like Live TV's categories: All Sports, then the ones with matches, each with its count */
    function sportsMenu() {
        var list = [{ id: "all", label: T("All Sports"), n: count("all") }].concat(SPORTS.filter(function (sp) { return count(sp.id) > 0; })
            .map(function (sp) { return { id: sp.id, label: T(sp.label), n: count(sp.id) }; }));
        TV.menu(T("Sports"), list.map(function (x) {
            return { label: x.label + "  ·  " + x.n, check: x.id === sportId, focus: x.id === sportId, run: function () { chooseSport(x.id); } };
        }));
    }
    function chooseSport(id) { if (id === sportId) return; sportId = id; drawRows(); drawBar(); }
    function msg(t, spin) {
        msgEl.className = "empty sports__msg" + (spin ? " is-spin" : "");
        if (spin) msgEl.innerHTML = TV.spinner(76); else msgEl.textContent = t;
        msgEl.style.display = t || spin ? "" : "none";
    }
    function ofSport(m) { return sportId === "all" || m.sport === sportId; }
    function shownList() { return matches.filter(ofSport); }
    function signature(list) { return list.map(function (m) { return m.id + (isLive(m) ? "*" : ""); }).join(","); }
    function sigNow() { return signature(shownList()) + "|" + signature(mine.filter(ofSport)) + "|" + sportId + "|" + dayOff; }
    // In play first, then what comes, then what is over (hidden if you chose so)
    function rank(m) { return isLive(m) ? 0 : m.state === "pre" ? 1 : 2; }
    function byRank(a, b) { return rank(a) - rank(b) || byTime(a, b); }
    function drawRows() {
        var was = strips[zone], wasKey = was && was.key, wasId = was && was.current() && was.current().id;
        var list = shownList();
        var my = mine.filter(ofSport).sort(byRank);
        rowsEl.innerHTML = ""; strips = [];
        shownSig = sigNow();
        if (!list.length && !my.length) {
            if (loading) { msg("", true); zone = -1; paint(); return; }
            msg(failed ? T("The scores can't be reached right now. Check the connection, then try again.") :
                dayOff === 0 ? T("No matches today in these leagues.") : dayOff === "next" ? T("No matches coming up in your competitions.") : dayOff === "past" ? T("No results this week in your competitions.") : T("No matches that day in these leagues."));
            zone = -1; paint(); return;
        }
        msg("");
        var f = featured();
        if (f.list.length) { var h = new Hero(f); strips.push(h); rowsEl.appendChild(h.root); }
        if (dayOff === "past") my.sort(function (a, b) { return b.start - a.start; });
        if (my.length) addRow("mine", T("My Teams"), my, true, "", "star", dayOff === "next" || dayOff === "past");
        // What comes next: a calendar, one row a day
        if (dayOff === "next" || dayOff === "past") {
            var byDay = {}, keys = [], back = dayOff === "past";
            list.forEach(function (m) { var d = new Date(m.start); d.setHours(0, 0, 0, 0); var k = d.getTime(); if (!byDay[k]) { byDay[k] = []; keys.push(k); } byDay[k].push(m); });
            keys.sort(function (a, b) { return back ? b - a : a - b; }).forEach(function (k) {
                // the day's matches by the competitions' order (Ligue 1 before the friendlies), then by time
                var l = byDay[k].sort(function (a, b) { return leagueRank(a) - leagueRank(b) || byTime(a, b); });
                addRow("d" + k, longDay(k), l, true, l.length > 1 ? T("{n} matches", { n: l.length }) : T("1 match"));
            });
            restore(wasKey, wasId);
            return;
        }
        var live = list.filter(isLive);
        if (live.length) addRow("live", T("Live Now"), live, true, "", "live");
        var by = {};
        list.forEach(function (m) { if (activeKey(m)) (by[m.lkey] = by[m.lkey] || []).push(m); });
        SPORTS.forEach(function (sp) {
            sp.leagues.forEach(function (lg) {
                var k = sp.id + "/" + lg[0], l = by[k];
                if (!l) return;
                var n = l.length, nl = l.filter(isLive).length;
                addRow(k, T(lg[1]), l.sort(byRank), false, [sportId === "all" ? T(sp.label) : "", nl ? T("{n} live", { n: nl }) : n > 1 ? T("{n} matches", { n: n }) : T("1 match")].filter(Boolean).join(" · "), logos[k] || "");
            });
        });
        restore(wasKey, wasId);
    }
    // the same row and the same match as before, if still there
    function restore(wasKey, wasId) {
        if (zone >= 0) {
            var z = -1;
            strips.forEach(function (s, i) { if (s.key === wasKey) z = i; });
            zone = z >= 0 ? z : Math.min(zone, strips.length - 1);
            var s = strips[zone], at = -1;
            if (s && !s.isHero) { s.items.forEach(function (m, i) { if (m.id === wasId) at = i; }); if (at > 0) s.focus(at, true); }
        }
        paint();
    }
    /* A row; its title starts with the competition's logo, a star (My Teams) or a red dot (Live Now) */
    function addRow(key, title, items, withLeague, sub, mark, dated) {
        // Apple's metrics: 80 px from the edge, 40 px between the tiles (four 410 px tiles, the fifth peeking)
        var s = new TV.Strip({ title: title, sub: sub, items: items, kind: "match", height: 330, gap: 40, left: 80, make: function (m) { return makeCard(m, withLeague, dated); },
                               onFocus: function (i, m) { prepare(m); } });
        s.key = key;
        var t = s.root.querySelector(".row__title");
        if (t && mark) {
            var i = el("i", "row__mark" + (mark === "live" ? " is-live" : mark === "star" ? " is-star" : ""), mark === "star" ? TV.icon("star", 26) : "");
            if (mark !== "live" && mark !== "star") i.style.backgroundImage = crestBg(mark, 64);
            t.insertBefore(i, t.firstChild);
        }
        strips.push(s);
        rowsEl.appendChild(s.root);
    }
    /* A tile looked at for a moment: its page made ready (the match's details and photo, the summary found), so it
       opens complete. Waits for the arrows to rest: holding ▶ along a row asks nothing. */
    var prepTimer = null;
    function prepare(m) {
        clearTimeout(prepTimer);
        prepTimer = setTimeout(function () {
            if (!m) return;
            var done = m.state === "post" && !/CANCEL|POSTPONED/.test(m.status);
            if (done) summaryOf(m).then(function (d) { if (d && d.photo) seen(d.photo, function () {}); });
            photoOf(m).then(function (p) { if (p && !done) seen(p.u, function () {}); });
            if (done) findVideo(m);
        }, 450);
    }
    function refreshShown() {
        if (visible) strips.forEach(function (s) { s.cards.forEach(function (c) { if (c._update) c._update(); }); });
        if (sheet.open) sheet.draw();
    }
    function active() { return visible && TV.shell && TV.shell.focusOn() === "view" && TV.shell.current() === "sports" && TV.topNav() === TV.shell.screen; }
    function paint(on) {
        if (!chipNav) return;
        if (on === undefined) on = active();
        strips.forEach(function (s, i) { s.setActive(on && i === zone); });
        if (TV.DEV) TV.perfTag = "z" + zone;
        if (on && zone === -1) chipNav.refocus(); else chipNav.blur();
        /* Down in the rows, as Apple's focus moves: the page goes only as far as needed to show the row whole
           (the banner stays half seen above the first row). Bringing each row to the top made the step from the
           banner to the first row a 736 px jump, the M8 missing frames while drawing what came in.
           The row's place and height read once (reading them at every press laid the page out again first). */
        var s0 = zone > 0 && strips[zone], top = zone > 0 ? pageTop : 0;
        if (s0) {
            if (s0._top === undefined) { s0._top = s0.root.offsetTop; s0._h = s0.root.offsetHeight; }
            if (s0._top - top < 110) top = s0._top - 110;
            if (s0._top + s0._h - top > 1060) top = s0._top + s0._h - 1060;
        }
        pageTop = top;
        page.style.transform = "translateY(" + (-top) + "px)";
        page.classList.toggle("is-down", zone > 0);
        document.body.classList.toggle("in-rows", !!on && zone > 0);
    }

    /* A club from 365Scores (the Ekstraklasa) in a competition ESPN has: ESPN's own match, the one its competition
       shows, with its details and its score in play; 365Scores' copy only when ESPN has none */
    function sameTeam(a, b, sport) { var al = aliases(a, sport); return aliases(b, sport).some(function (s) { return al.indexOf(s) >= 0; }); }
    function espnTwin(m, lists) {
        if (m.src !== "365" || is365(m.league)) return null;
        for (var i = 0; i < lists.length; i++) {
            for (var j = 0; lists[i] && j < lists[i].length; j++) {
                var x = lists[i][j];
                if (x.src === "365" || x.lkey !== m.lkey || Math.abs(x.start - m.start) > 20 * 60000) continue;
                if (sameTeam(m.home, x.home, m.sport) || sameTeam(m.home, x.away, m.sport) || sameTeam(m.away, x.home, m.sport) || sameTeam(m.away, x.away, m.sport)) return x;
            }
        }
        return null;
    }
    /* The day's matches, every league at once (six requests at a time). quiet: a refresh, nothing redrawn
       unless a match came, went or started. */
    function load(fresh) {
        var tok = ++loadTok, sp0 = span(), from = sp0[0], to = sp0[1], days = espnDaysIn(from, to), jobs = [], ahead = dayOff === "next" || dayOff === "past" || isCalDay(), t0 = Date.now();
        loading = true;
        if (fresh) { failed = false; mine = []; drawRows(); }
        function ask(sp, lg) {
            if (is365(lg)) { jobs.push(range365(sp, lg, from, to).then(null, function () { return null; })); return; }
            if (!ahead || !lg) { days.forEach(function (d) { jobs.push(league(sp, lg, d).then(null, function () { return null; })); }); return; }
            // what comes next, the results, a calendar's day: the month (or the two months) at once
            monthsIn(days).forEach(function (ym) { jobs.push(month(sp, lg, ym).then(null, function () { return null; })); });
        }
        var asked0 = {};
        SPORTS.forEach(function (sp) {
            if (sp.all) { if (sp.leagues.some(function (lg) { return follows(sp, lg); }) || hasTeams(sp.id)) ask(sp, null); return; }
            sp.leagues.forEach(function (lg) { if (follows(sp, lg)) { asked0[sp.id + "/" + lg[0]] = 1; ask(sp, lg); } });
        });
        return warmSchedules().then(function () {
            teamLeagues().forEach(function (x) { if (!asked0[x.sp.id + "/" + x.lg[0]]) { asked0[x.sp.id + "/" + x.lg[0]] = 1; ask(x.sp, x.lg); } });
            return Promise.all([Promise.all(jobs), myTeams(from, to, to <= Date.now())]);
        }).then(function (r) {
            // your teams' matches of that day in a competition you don't follow: its scoreboard too, for the score in play
            var more = [], asked = {};
            r[1].forEach(function (m) {
                var sp = sportOf(m.sport), mdays = ahead ? [espnDay(m.start)] : days;
                if (!sp || sp.all || m.start < from || m.start >= to || activeKey(m)) return;
                if (is365(m.league)) { if (!asked[m.lkey]) { asked[m.lkey] = 1; more.push(range365(sp, m.league, from, to).then(null, function () { return null; })); } return; }
                if (ahead) {
                    var ym = espnDay(m.start).slice(0, 6);
                    if (!asked[m.lkey + ym]) { asked[m.lkey + ym] = 1; more.push(month(sp, m.league, ym).then(null, function () { return null; })); }
                    return;
                }
                mdays.forEach(function (d) {
                    if (asked[m.lkey + d]) return;
                    asked[m.lkey + d] = 1;
                    more.push(league(sp, m.league, d).then(null, function () { return null; }));
                });
            });
            return Promise.all(more).then(function (extra) { return { lists: r[0].concat(extra), mine: r[1] }; });
        }).then(function (r) {
            if (tok !== loadTok) return;
            var seen = {}, out = [], ok = 0;
            r.lists.forEach(function (l) {
                if (!l) return;
                ok++;
                l.forEach(function (m) {
                    if (seen[m.id] || m.start < from || m.start >= to || !(activeKey(m) || isFavMatch(m)) || stale(m)) return;
                    seen[m.id] = 1; out.push(keep(m));
                });
            });
            loading = false; failed = !ok && jobs.length > 0;
            matches = out.sort(byTime);
            if (fresh) TV.log("sports: " + out.length + " matches (" + dayOff + ") in " + (Date.now() - t0) + " ms, " + jobs.length + " requests");
            // My Teams: your teams' matches in what is shown (today's, tomorrow's, or the calendar's)
            var mid = {}, twins = r.mine.map(function (m) { return espnTwin(m, r.lists); });
            twinFav = {};
            twins.forEach(function (tw) { if (tw) twinFav[tw.id] = 1; });         // its tile and banner say it is yours (★)
            mine = out.filter(isFavMatch);
            mine.forEach(function (m) { mid[m.id] = 1; });
            r.mine.forEach(function (m, i) { var tw = twins[i]; if (tw) m = tw; if (!mid[m.id]) { mid[m.id] = 1; mine.push(tw ? keep(m) : keepSoft(m)); } });
            officialTv(matches.concat(mine));
            if (!visible && !sheet.open) return;
            var show = function () {
                if (!visible && !sheet.open) return;
                var changed = fresh || sigNow() !== shownSig;
                if (changed) { drawBar(); drawRows(); } else refreshShown();
                if (changed || !findDone) findSoon(fresh ? 300 : 1500);
            };
            // a refresh (not a day you chose): drawn once the remote rests, never in the middle of a move
            if (fresh) show(); else TV.calm(show, 500);
        });
    }
    function tick() {
        clearTimeout(timer);
        if (!visible && !sheet.open) return;
        timer = setTimeout(function () {
            if (dayStart(0) !== today) { today = dayStart(0); load(false); }
            else refreshLive();
            tick();
        }, 30000);
    }
    var today = dayStart(0);
    /* Every 30 s while a match is in play (or about to start): only its competition's scoreboard asked again, the
       scores changed in place. Asking every followed competition again (117 in the test, 190 requests) and
       searching the channels each time froze the M8 for 2.7 s every 30 s. */
    function refreshLive() {
        var now = Date.now(), ask = {}, jobs = [];
        matches.concat(mine).forEach(function (m) {
            if (!(isLive(m) || (m.state === "pre" && m.start - now < 15 * 60000 && now - m.start < 3 * 3600000))) return;
            var sp = sportOf(m.sport), k = m.lkey + "|" + espnDay(m.start);
            if (!sp || ask[k]) return;
            ask[k] = 1;
            jobs.push((is365(m.league) ? range365(sp, m.league, dayStart(0), dayStart(1)) : league(sp, m.league, espnDay(m.start))).then(null, function () { return null; }));
        });
        if (!jobs.length) return;
        Promise.all(jobs).then(function (lists) {
            lists.forEach(function (l) { (l || []).forEach(function (m) { if (store[m.id]) keep(m); }); });
            TV.calm(function () {                                       // once the remote rests
                if (!visible && !sheet.open) return;
                if (sigNow() !== shownSig) { drawBar(); drawRows(); findSoon(1500); } else refreshShown();
            }, 500);
        });
    }

    /* ---------- a match's page, FotMob style ----------
       The board (crests, score, minute, the scorers under each team), the buttons (Watch on…, Versions, the video
       summary), then tabs: Where to Watch (your channels), Summary (goals, cards, changes), Stats, Lineups, Table.
       ESPN's match summary (site.api.espn.com …/summary?event=), kept 30 s in play, 10 min after. */
    var sheet = { open: false, m: null, lang: "", zone: "btns", nav: null, tabNav: null, strip: null, el: null, list: [], tab: "", body: null, tabs: [] };
    var details = {}, videos = {}, videoFound = {};
    function eventId(m) { return m.id.slice(m.id.indexOf(":") + 1); }
    function summaryOf(m) {
        var c = details[m.id];
        if (c && c.p) return c.p;
        if (c && Date.now() - c.at < (isLive(m) ? 30000 : 10 * 60000)) return Promise.resolve(c.d);
        // a 365Scores competition's match: no ESPN summary, but its table (table365)
        var p = (m.src === "365" ? table365(m) : limited(function () { return TV.fetchJSON(API + m.sport + "/" + m.league[0] + "/summary?event=" + eventId(m), { timeout: 15000 }); })
            .then(function (j) { return readSummary(j, m); })).then(function (d) {
            details[m.id] = { at: Date.now(), d: d };
            return details[m.id].d;
        }, function (e) {
            TV.log("sports: summary: " + e.message);
            details[m.id] = { at: Date.now(), d: c ? c.d : null };
            return details[m.id].d;
        });
        details[m.id] = { at: c ? c.at : 0, d: c ? c.d : null, p: p };
        return p;
    }
    /* A 365Scores competition's table, from its standings (what the club list reads too): the columns 365Scores
       shows for that sport (no draws in basketball, no points in the EuroLeague), the group of the two teams when
       there are groups (the KHL's conferences), and in football the places 365Scores colours (European places,
       relegation). Kept 10 minutes, one minute while the match is played. */
    var stand365 = {};
    function standings365(id, live) {
        var c = stand365[id];
        if (c && c.p) return c.p;
        if (c && Date.now() - c.at < (live ? 60000 : 10 * 60000)) return Promise.resolve(c.j);
        var p = limited(function () { return TV.fetchJSON(S365 + "standings/?" + q365() + "&competitions=" + id, { timeout: 15000 }); }).then(function (j) {
            stand365[id] = { at: Date.now(), j: j };
            return j;
        }, function (e) {
            TV.log("sports: 365 standings " + id + ": " + e.message);
            stand365[id] = { at: Date.now(), j: c ? c.j : null };
            return stand365[id].j;
        });
        stand365[id] = { at: c ? c.at : 0, j: c ? c.j : null, p: p };
        return p;
    }
    function zone365(name) {
        return /champions league/i.test(name) ? "ucl" : /europa league/i.test(name) ? "uel" : /conference league/i.test(name) ? "uecl" :
               /relegation play/i.test(name) ? "relpo" : /relegation/i.test(name) ? "rel" : "";
    }
    function table365(m) {
        if (!is365(m.league)) return Promise.resolve(null);
        return standings365(String(m.league[0]).slice(5), isLive(m)).then(function (j) {
            var st = j && j.standings && j.standings[0], rows = (st && st.rows) || [];
            if (!rows.length) return null;
            var ids = [String(m.home.id), String(m.away.id)], cols = {}, dest = {}, groupOf = {};
            (st.headers || []).forEach(function (h) { cols[h.key] = 1; });
            (st.destinations || []).forEach(function (x) { dest[x.num] = zone365(x.name || ""); });
            rows.forEach(function (r) { var id = "365-" + (r.competitor && r.competitor.id); if (r.groupNum != null && ids.indexOf(id) >= 0) groupOf[id] = r.groupNum; });
            var num = function (v) { return v == null || v === "" ? "" : String(Math.round(v)); };
            // one group's table (or the whole one), titled with the app's name of the competition and the group's
            function tableOf(group) {
                var mine = group == null ? rows : rows.filter(function (r) { return r.groupNum === group; }), title = T(m.league[1]);
                if (group != null) (st.groups || []).forEach(function (g) { if (g.num === group && g.name) title += " · " + T(g.name); });
                var t = { title: title, rows: mine.map(function (r, i) {
                    var c = r.competitor || {}, gd = Math.round(r.ratio || 0);
                    return { rank: num(r.position) || String(i + 1), id: "365-" + c.id, team: c.name || "", logo: img365("Competitors", c.id, c.imageVersion),
                             gp: num(r.gamePlayed), w: num(r.gamesWon), d: cols.gamesEven ? num(r.gamesEven) : "", l: num(r.gamesLost),
                             gd: cols.ratio ? (gd > 0 ? "+" + gd : String(gd)) : "", pts: cols.points ? num(r.points) : "" };
                }) };
                if (m.sport === "soccer") t.zones = mine.map(function (r) { return dest[r.destinationNum] || ""; });
                return t;
            }
            /* the two teams' group; two groups (a KHL match between its conferences): the home team's, then the visitors' */
            var gh = groupOf[ids[0]], ga = groupOf[ids[1]], table = tableOf(gh != null ? gh : ga);
            if (gh != null && ga != null && ga !== gh) table.more = tableOf(ga);
            return { events: [], stats: [], lineups: [], form: [], table: table, scorers: { h: [], a: [] }, photo: "" };
        });
    }
    // "Arda Güler" → "Güler", "Kevin De Bruyne" → "De Bruyne"
    function lastName(n) {
        var w = String(n || "").split(" ");
        if (w.length > 2 && /^(de|da|di|do|dos|das|del|della|van|von|der|den|le|la|el|al|du|mac|mc|ten|ter|ben|bin)$/i.test(w[w.length - 2])) return w.slice(-2).join(" ");
        return w[w.length - 1];
    }
    var STAT_ROWS = [["possessionPct", "Possession", "%"], ["totalShots", "Shots"], ["shotsOnTarget", "Shots on Target"], ["wonCorners", "Corners"],
                     ["foulsCommitted", "Fouls"], ["yellowCards", "Yellow Cards"], ["redCards", "Red Cards"], ["offsides", "Offsides"], ["saves", "Saves"],
                     ["totalPasses", "Passes"], ["passPct", "Pass Accuracy", "%"]];
    function readSummary(j, m) {
        var out = { events: [], stats: [], lineups: [], table: null, scorers: { h: [], a: [] } }, hid = String(m.home.id), aid = String(m.away.id);
        // the match's photo, in ESPN's report (after the match): behind its page, Apple TV style
        var im0 = j.article && j.article.images && j.article.images[0];
        out.photo = im0 && im0.url && (im0.width || 1200) >= 800 ? im0.url : "";
        (j.keyEvents || []).forEach(function (e) {
            var ty = (e.type && e.type.text) || "", tid = e.team ? String(e.team.id) : "", k = "";
            var who = (e.participants || []).map(function (p) { return p.athlete ? p.athlete.displayName : ""; }).filter(Boolean), min = (e.clock && e.clock.displayValue) || "";
            if (/own goal/i.test(ty)) k = "og";
            else if (e.scoringPlay || /^goal|penalty - scored|^try|conversion|drop goal|penalty goal/i.test(ty)) k = /penalty/i.test(ty) && !/try/i.test(ty) ? "pen" : "goal";
            else if (/red card/i.test(ty)) k = "red";
            else if (/yellow card/i.test(ty)) k = "yellow";
            else if (/substitution/i.test(ty)) k = "sub";
            else if (/halftime/i.test(ty)) k = "ht";
            if (!k) return;
            var ev = { k: k, min: min, side: tid === hid ? "h" : tid === aid ? "a" : "", who: who, what: ty };
            out.events.push(ev);
            if ((k === "goal" || k === "pen" || k === "og") && ev.side) out.scorers[ev.side].push(lastName(who[0]) + " " + min + (k === "pen" ? " " + T("(pen.)") : k === "og" ? " " + T("(o.g.)") : ""));
        });
        var bt = (j.boxscore && j.boxscore.teams) || [];
        if (bt.length === 2) {
            var by = {};
            bt.forEach(function (t) { by[String(t.team && t.team.id)] = t.statistics || []; });
            var H = by[hid] || bt[0].statistics || [], A = by[aid] || bt[1].statistics || [];
            var val = function (list, name) { for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i]; return null; };
            var rows = m.sport === "soccer" ? STAT_ROWS : H.slice(0, 10).map(function (s) { return [s.name, s.label || s.displayName || s.name, "", true]; });
            rows.forEach(function (r) {
                var a = val(H, r[0]), b = val(A, r[0]);
                if (!a || !b || a.displayValue === undefined) return;
                out.stats.push({ label: r[3] ? r[1] : T(r[1]), h: String(a.displayValue), a: String(b.displayValue), unit: r[2] || "", hv: parseFloat(a.displayValue) || 0, av: parseFloat(b.displayValue) || 0 });
            });
        }
        (j.rosters || []).forEach(function (r) {
            var tid = String(r.team && r.team.id), list = r.roster || [];
            var p = function (x) { return { n: x.jersey || "", name: (x.athlete && (x.athlete.shortName || x.athlete.displayName)) || "", inn: !!x.subbedIn, out: !!x.subbedOut }; };
            if (list.length) out.lineups.push({ side: tid === hid ? "h" : "a", formation: r.formation || "", xi: list.filter(function (x) { return x.starter; }).map(p),
                                                bench: list.filter(function (x) { return !x.starter; }).map(p) });
        });
        var g = j.standings && j.standings.groups && j.standings.groups[0], en = g && g.standings && g.standings.entries;
        if (en && en.length) out.table = { title: g.header || "", rows: en.map(function (e, i) {
            var s = function (n) { var v = (e.stats || []).filter(function (x) { return x.name === n; })[0]; return v ? String(v.displayValue) : ""; };
            return { rank: s("rank") || String(i + 1), id: String(e.id || ""), team: e.team || "", gp: s("gamesPlayed"), w: s("wins"), d: s("ties"), l: s("losses"),
                     gd: s("pointDifferential"), pts: s("points") };
        }) };
        // each team's last five matches (the Form tab)
        out.form = (j.lastFiveGames || []).map(function (x) {
            var tid = String(x.team && x.team.id);
            return { side: tid === hid ? "h" : tid === aid ? "a" : "", games: (x.events || []).map(function (e) {
                var o = e.opponent || {};
                return { res: e.gameResult || "", opp: o.displayName || "", logo: o.logo || "", score: e.score || "", home: e.atVs === "vs", t: Date.parse(e.gameDate) || 0, comp: e.competitionName || "" };
            }) };
        }).filter(function (f) { return f.side && f.games.length; });
        return out;
    }

    /* ---------- the video summary: the official one, opened in TizenTube (Samsung), YouTube or SmartTube (Android), YouTube (LG) ----------
       YouTube's own search (no key), asked by the screen itself with its country: YouTube leaves out what can't be
       watched there (DAZN España's summaries in France, Sky's highlights outside the UK). Only verified channels of
       the official broadcasters and of the competitions are kept, never re-uploads: first the one that has the
       competition where you live (in France CANAL+ for the Champions League, DAZN for LaLiga and Serie A, Ligue 1's
       own channel, Téléfoot for Les Bleus), then the other broadcasters of your country, then the competition's own. */
    var VIDEO_WORD = { fr: "résumé", en: "highlights", es: "resumen", it: "highlights", de: "highlights", pt: "resumo", nl: "samenvatting", tr: "özet", sq: "highlights", pl: "skrót" };
    var UCL = "uefa.champions uefa.europa uefa.europa.conf uefa.super_cup", NATIONAL = "uefa.nations fifa.worldq.uefa uefa.euroq fifa.friendly fifa.world uefa.euro";
    /* [channels | separated, the competitions they show (football unless "sport/")]; checked on YouTube in France
       in November 2026, the other countries from their 2026-27 rights */
    var YT_RIGHTS = {
        FR: [["CANAL+ Sport|CANAL+ Foot", UCL + " eng.1 eng.league_cup"], ["DAZN France", "esp.1 ita.1"], ["beIN SPORTS France", "ger.1 ger.dfb_pokal eng.fa fra.2 basketball/nba"],
             ["Ligue 1 McDonald's|Ligue 1+", "fra.1"], ["Ligue 2 BKT", "fra.2"], ["France tv sport", "fra.coupe_de_france rugby/180659 rugby/271937 rugby/17567 rugby/289234"],
             ["Téléfoot|TF1|M6|L'ÉQUIPE", NATIONAL], ["TOP 14 - Officiel|CANAL+ Rugby", "rugby/270559"], ["NBA Extra - beIN SPORTS France", "basketball/nba"],
             ["RMC Sport|Eurosport France|Prime Video Sport France|CANAL+ Sport Afrique", ""]],
        BE: [["RTBF Sport|Sporza|VTM GO|RTL Sport|DAZN Belgique|DAZN Belgium|Pro League", UCL + " bel.1 " + NATIONAL], ["CANAL+ Sport|beIN SPORTS France|DAZN France|L'ÉQUIPE", ""]],
        CH: [["blue Sport|RTS Sport|SRF Sport|RSI Sport", UCL + " sui.1 " + NATIONAL], ["CANAL+ Sport|DAZN Deutschland|Sky Sport", ""]],
        ES: [["Movistar Plus+|Movistar Liga de Campeones|El Día Después por Movistar Plus", UCL + " ger.1 fra.1 esp.copa_del_rey"], ["LALIGA EA SPORTS|DAZN España", "esp.1 esp.2"],
             ["DAZN España", "eng.1 ita.1"], ["RTVE Deportes|Teledeporte|RTVE", NATIONAL + " esp.copa_del_rey"]],
        IT: [["Sky Sport|Prime Video Sport Italia|Sport Mediaset", UCL + " eng.1 ger.1"], ["DAZN Italia|Lega Serie A", "ita.1 ita.2 esp.1"], ["Rai Sport", NATIONAL + " ita.coppa_italia"]],
        DE: [["DAZN Deutschland|Prime Video Sport Deutschland", UCL + " esp.1 ita.1 fra.1"], ["Sky Sport|Sky Sport Bundesliga|sportstudio|Sportschau|ZDFsport", "ger.1 ger.2 ger.dfb_pokal eng.1"],
             ["Sportschau|sportstudio|RTL Sport", NATIONAL]],
        GB: [["Sky Sports Premier League|Sky Sports Football|Sky Sports", "eng.1 eng.2 eng.3 eng.league_cup sco.1 ger.1"], ["TNT Sports", UCL + " ita.1 rugby/267979"],
             ["BBC Sport|ITV Sport|Channel 4 Sport", "eng.fa " + NATIONAL + " rugby/180659"], ["Premier Sports", "esp.1"], ["EFL", "eng.2 eng.3"]],
        US: [["NBC Sports", "eng.1"], ["CBS Sports Golazo", UCL + " ita.1"], ["ESPN FC|ESPN", "esp.1 ger.1 eng.fa"], ["beIN SPORTS USA", "fra.1"], ["FOX Soccer|FOX Sports", NATIONAL],
             ["NBA on NBC|NBA on Prime|ESPN|NBC Sports", "basketball/nba"]],
        CA: [["TSN|Sportsnet", "basketball/nba hockey/nhl"]],
        PT: [["SPORT TV", UCL + " por.1 eng.1"], ["DAZN Portugal", "esp.1 ita.1 ger.1"], ["RTP Desporto", NATIONAL]],
        NL: [["Ziggo Sport", UCL + " esp.1"], ["ESPN NL|Eredivisie", "ned.1 ned.cup"], ["Viaplay Sport NL", "eng.1 ger.1"], ["NOS Sport", NATIONAL]],
        TR: [["beIN SPORTS Türkiye|beIN SPORTS Haber", "tur.1"], ["TRT Spor|tv8", UCL + " " + NATIONAL]],
        // Poland: the channels as YouTube's Polish results show them (November 2026)
        PL: [["CANAL+ SPORT", "uefa.champions eng.1 esp.1 s365:153"], ["ELEVEN SPORTS PL", "ger.1 ger.2 ita.1 fra.1"],
             ["Polsat Sport", "uefa.europa uefa.europa.conf ita.1 ned.1 sco.1 ita.coppa_italia volleyball/s365:5772"],
             ["TVP Sport", "uefa.champions s365:153 s365:157 eng.fa eng.league_cup eng.2 eng.3 por.taca.portugal ger.dfb_pokal " + NATIONAL]]
    };
    YT_RIGHTS.IE = YT_RIGHTS.GB; YT_RIGHTS.AT = YT_RIGHTS.DE; YT_RIGHTS.LU = YT_RIGHTS.BE; YT_RIGHTS.MC = YT_RIGHTS.FR;
    // The competitions' own channels (their summaries go where no broadcaster has them)
    var YT_OWN = ["UEFA", "FIFA", "LALIGA EA SPORTS", "Serie A", "Bundesliga", "Premier League", "Ligue 1 McDonald's", "Liga Portugal Betclic", "Eredivisie", "Major League Soccer",
                  "Saudi Pro League", "CONMEBOL Libertadores", "ESPN College Football", "Scottish Professional Football League", "Pro League", "Ekstraklasa TV", "NBA", "WNBA", "NFL", "NHL", "World Rugby", "Six Nations Rugby",
                  "TOP 14 - Officiel", "EPCR", "Gallagher Prem Rugby", "United Rugby Championship", "Super Rugby Pacific", "The FA", "EuroLeague", "EuroLeague Basketball",
                  "LNB", "Betclic ELITE", "EHF Champions League", "EHF", "Liqui Moly Starligue", "LNH", "CEV", "Champions Hockey League", "KHL", "IIHF"];
    /* Never a talk show (reactions, a debrief, the players' marks) nor the match live or in full; a word that says
       "summary" helps a little, YouTube's own order decides */
    var SUMMARY = / (resume|resumen|resumo|highlights?|sintesi|melhores momentos|samenvatting|ozet|zusammenfassung|extended|temps forts|moments forts|skroty?) /;
    var NOT_SUMMARY = / (live|en direct|direct|en vivo|ao vivo|predictions?|pronostics?|previews?|avant match|conferences?|interviews?|reactions?|reagit|reagissent|watchalong|debats?|debrief|debriefe|analyses?|analysis|replay|integrale|full match|match complet|notes|podcast|compo|composition|shorts|na zywo|kulisy|od kuchni|studio|konferencja|wywiady?|reakcje|zapowiedz) /;
    // The names you would type ("Inter Côme", not "Internazionale Côme")
    var QUERY_NAME = { "internazionale": "Inter", "paris saint germain": "PSG", "borussia monchengladbach": "Gladbach", "wolverhampton wanderers": "Wolves" };
    function minutes(len) { var p = String(len || "").split(":").map(Number); return p.length === 3 ? p[0] * 60 + p[1] : p.length === 2 ? p[0] + p[1] / 60 : 0; }
    var DESK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    // Your country: the region of the screen's language ("fr-BE" -> BE), else your language's main country
    function viewerCountry() {
        if (testCC) return testCC;
        var p = TV.pref("ageRegion");
        if (p && p !== "auto") return p;
        var nl = String(global.navigator && (global.navigator.language || global.navigator.userLanguage) || ""), m = nl.match(/[-_]([A-Za-z]{2})$/);
        if (m && nl.slice(0, 2).toLowerCase() === TV.lang) return m[1].toUpperCase();
        return { fr: "FR", de: "DE", es: "ES", it: "IT", nl: "NL", pt: "PT", tr: "TR", en: "GB", sq: "AL", pl: "PL" }[TV.lang] || "US";
    }
    var rightsMemo = null;
    function rights() {
        var cc = viewerCountry(), byKey = {}, local = [], every = [];
        if (rightsMemo && rightsMemo.cc === cc) return rightsMemo;            // a new region in Settings: read again
        function add(list, x) { if (list.indexOf(x) < 0) list.push(x); }
        Object.keys(YT_RIGHTS).forEach(function (c) {
            YT_RIGHTS[c].forEach(function (r) {
                var chs = r[0].split("|").map(S.fold);
                chs.forEach(function (x) { add(every, x); if (c === cc) add(local, x); });
                if (c !== cc) return;
                r[1].split(" ").filter(Boolean).forEach(function (k) { var key = k.indexOf("/") > 0 ? k : "soccer/" + k; byKey[key] = (byKey[key] || []).concat(chs); });
            });
        });
        return (rightsMemo = { cc: cc, byKey: byKey, local: local, every: every, own: YT_OWN.map(S.fold) });
    }
    function runs(x) { return x && x.runs ? x.runs.map(function (r) { return r.text; }).join("") : (x && x.simpleText) || ""; }
    function readVideos(html) {
        var i = html.indexOf("var ytInitialData = "), j = html.indexOf(";</script>", i), data = null, out = [];
        if (i < 0 || j < 0) return out;
        try { data = JSON.parse(html.slice(i + 20, j)); } catch (e) { return out; }
        (function walk(o, depth) {
            if (!o || depth > 40 || out.length > 30 || typeof o !== "object") return;
            if (Array.isArray(o)) { for (var k = 0; k < o.length; k++) walk(o[k], depth + 1); return; }
            if (o.videoRenderer) {
                var v = o.videoRenderer, badges = JSON.stringify(v.ownerBadges || []);
                if (v.videoId) out.push({ id: v.videoId, title: runs(v.title), channel: runs(v.ownerText), verified: /VERIFIED/.test(badges), length: (v.lengthText && v.lengthText.simpleText) || "" });
                return;
            }
            for (var key in o) if (Object.prototype.hasOwnProperty.call(o, key)) walk(o[key], depth + 1);
        })(data, 0);
        return out;
    }
    /* The video you would pick yourself: YouTube's order, kept to the official channels, the one that has the
       competition where you live first (tier 3), the other broadcasters of your country (2), the competition's own or
       one of the two clubs' own, its title saying "highlights" (1), a broadcaster elsewhere (0). Both teams named,
       1:45 to 22 minutes (not a goal alone, not a talk show nor the match). */
    function pickVideo(list, m) {
        var aH = aliases(m.home, m.sport), aA = aliases(m.away, m.sport), R = rights(), mine = R.byKey[m.lkey] || [], best = null, both = aH.concat(aA);
        // "Leeds United Official", "Chelsea Football Club", "Philadelphia 76ers": one of the two clubs' own channel ("h", "a")
        var club = function (ch) {
            for (var i = 0; i < both.length; i++) if (ch === both[i] || (both[i].length >= 4 && (" " + ch + " ").indexOf(" " + both[i] + " ") >= 0)) return i < aH.length ? "h" : "a";
            return "";
        };
        // a broadcaster's channel for one country: "Sky Sport DE" is Sky Sport
        var known = function (list, ch) { return list.indexOf(ch) >= 0 || (/ [a-z]{2}$/.test(ch) && list.indexOf(ch.slice(0, -3)) >= 0); };
        var has = function (f, al) { for (var i = 0; i < al.length; i++) if (f.indexOf(" " + al[i] + " ") >= 0) return true; return false; };
        list.forEach(function (v, i) {
            if (!v.verified) return;                                         // never a re-upload
            var f = " " + S.fold(v.title) + " ", ch = S.fold(v.channel), mins = minutes(v.length), side = club(ch);
            // both teams named; on a club's own channel the other one is enough ("Sixers Get Back in the Win Column vs. Raptors")
            if (!(side === "h" || has(f, aH)) || !(side === "a" || has(f, aA)) || NOT_SUMMARY.test(f) || mins < 1.75 || mins > 22) return;
            var tier = known(mine, ch) ? 3 : known(R.local, ch) ? 2 : R.own.indexOf(ch) >= 0 ? 1 :
                       side && SUMMARY.test(f) ? 1 : known(R.every, ch) ? 0 : -1;
            if (tier < 0) return;
            // within a tier YouTube's order; "résumé" in the title gains three places, a question or a quote loses some
            var score = tier * 100 - i + (SUMMARY.test(f) ? 3 : 0) - (/\?/.test(v.title) ? 2 : 0) - (/["«»“”]/.test(v.title) ? 5 : 0);
            if (!best || score > best.score) best = { v: v, tier: tier, score: score };
        });
        return best;
    }
    // One search: this week's videos, this month's for an older match, any date past a month
    function ytSearch(q, m) {
        var age = Date.now() - m.start, sp = age < 6 * 86400000 ? "EgQIAxAB" : age < 27 * 86400000 ? "EgQIBBAB" : "EgIQAQ%3D%3D", cc = rights().cc;
        var url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) + "&sp=" + sp + "&hl=" + encodeURIComponent(TV.lang) + "&gl=" + encodeURIComponent(cc);
        /* Asked as a computer's browser: to a phone's or a TV's browser (Android's WebView…) YouTube sends its
           mobile page, whose results are not in the page */
        var p = TV.helper && TV.helper.sget ? TV.helper.sget(url, { "User-Agent": DESK_UA, "Accept-Language": TV.lang }, 15000).catch(function (e) {
                    TV.log("sports: video search through the helper: " + e.message + "; direct");
                    return TV.fetchText(url, { timeout: 15000 });
                }) : TV.fetchText(url, { timeout: 15000 });
        return p.then(function (html) { return readVideos(String(html || "")); });
    }
    function queryName(t) { return QUERY_NAME[S.fold(t.name)] || shown(t, true); }
    function findVideo(m) {
        if (videos[m.id]) return videos[m.id];
        // asked like you would ask YouTube yourself: the two teams, nothing else ("Italie France")
        var q = queryName(m.home) + " " + queryName(m.away), mine = rights().byKey[m.lkey] || [], n = 0, tq = Date.now();
        videos[m.id] = ytSearch(q, m).then(function (list) {
            n = list.length;
            var p = pickVideo(list, m);
            if (p && (p.tier === 3 || !mine.length)) return p;
            /* not the broadcaster of the competition among the first results: asked again with its name
               ("DAZN France Inter Côme"), else with the word "résumé"; the better of the two */
            var who = (YT_RIGHTS[rights().cc] || []).map(function (r) { return r[0].split("|")[0]; }).filter(function (x) { return mine.indexOf(S.fold(x)) >= 0; })[0];
            return ytSearch((who || VIDEO_WORD[TV.lang] || "highlights") + " " + q, m).then(function (l2) {
                n += l2.length;
                var p2 = pickVideo(l2, m);
                return p2 && (!p || p2.tier > p.tier) ? p2 : p;
            }, function () { return p; });
        }).then(function (p) {
            var v = p ? p.v : null;
            videoFound[m.id] = v;
            TV.log("sports: video summary " + (v ? v.id + " (" + v.channel + ")" : "not found among " + n + " videos") + " [" + rights().cc + ", " + (Date.now() - tq) + " ms]");
            if (!v) delete videos[m.id];          // asked again next time (the video often comes an hour after the match)
            return v;
        }, function (e) { TV.log("sports: video search: " + e.message); delete videos[m.id]; return null; });
        return videos[m.id];
    }
    /* ---------- the video summary inside APL TV: YouTube's own player, on the helper's page ----------
       Starts in under a second, no other app, on Samsung, LG and Android alike. OK plays or pauses (gives the sound
       back when the screen started it muted), ◀ ▶ 10 s, Back closes. A video its channel keeps for YouTube, or a
       helper too old to have the page: TizenTube or the TV's YouTube app, as before. */
    var yt = { open: false, el: null, v: null, st: -1, t: 0, d: 0, muted: false, ok: false, timer: null, barTimer: null, pre: null }, ytFailed = {};
    function mmss(s) { s = Math.max(0, Math.floor(s || 0)); var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }
    /* The player inside the app comes with APL TV 1.1's own install (Samsung: config.xml lets the frame in and the
       service has the page; LG: the service; Android: the page in the .apk). A screen still on an older install, with
       1.1 from the automatic updates: the YouTube app straight away, not 9 s of waiting first */
    function ytHere() { var U = global.TV_UPDATE; return !U || !U.installed || U.cmp(U.installed, "1.1.0") >= 0; }
    function openVideo(v) {
        if (TV.helper && TV.helper.PORT && ytHere() && !ytFailed[v.id]) ytPlay(v); else openVideoApp(v);
    }
    function ytShell(v, cue) {
        if (!yt.el) {
            yt.el = el("section", "ytp");
            document.body.appendChild(yt.el);
            global.addEventListener("message", ytMessage);
        }
        yt.el.innerHTML = "<iframe class='ytp__f' tabindex='-1' allow='autoplay; encrypted-media' src='" + esc("http://127.0.0.1:" + TV.helper.PORT + "/yt?v=" + encodeURIComponent(v.id) + (cue ? "&cue=1" : "")) + "'></iframe>" +
            "<div class='ytp__load'>" + TV.spinner(72) + "</div><div class='ytp__bar'><div class='ytp__title'>" + esc(v.title || "") + "</div><div class='ytp__sub'>" + esc(v.channel || "") + "</div>" +
            "<div class='ytp__line'><span class='ytp__now'>0:00</span><div class='ytp__track'><i></i></div><span class='ytp__len'></span></div><div class='ytp__hint'></div></div>";
    }
    /* Made ready ahead: on the summary's button for a moment, the player loads hidden (YouTube's player takes 3 s
       of the TV's time to start; while it did, the video stuttered). OK then only says "play". */
    var prepTimerYt = null;
    function ytPrepareSoon(v) {
        clearTimeout(prepTimerYt);
        prepTimerYt = setTimeout(function () {
            if (!v || yt.open || ytFailed[v.id] || !TV.helper || !TV.helper.PORT || !ytHere() || (yt.pre && yt.pre.id === v.id)) return;
            if (!sheet.open || sheet.zone !== "btns" || sheet.nav.index !== sheet.videoAt) return;
            ytShell(v, true);
            yt.el.className = "ytp is-pre";
            yt.pre = { id: v.id, ready: false };
            TV.log("sports: summary player made ready ahead: " + v.id);
        }, 700);
    }
    function ytDrop() {
        clearTimeout(prepTimerYt);
        if (!yt.pre || yt.open) return;
        var f = yt.el.querySelector(".ytp__f");
        if (f) f.src = "about:blank";
        yt.el.innerHTML = ""; yt.el.className = "ytp"; yt.pre = null;
    }
    function ytPlay(v) {
        var ready = yt.pre && yt.pre.id === v.id;
        clearTimeout(prepTimerYt);
        if (!ready) { yt.pre = null; ytShell(v, false); }
        yt.v = v; yt.st = -1; yt.t = 0; yt.d = 0; yt.muted = false; yt.ok = !!(ready && yt.pre.ready); yt.open = true;
        yt.el.className = "ytp is-open is-bar";
        if (ready) { yt.pre = null; ytCmd("play"); }
        var fr = yt.el.querySelector(".ytp__f");
        if (fr) fr.onload = function () { TV.log("sports: summary page loaded in its frame"); };
        TV.pushNav(ytScreen);
        TV.ytPlaying = true;
        ytDraw(); ytBar();
        clearTimeout(yt.timer);
        // no answer from the page (a helper without it, no network): the TV's YouTube app instead
        yt.timer = setTimeout(function () { if (yt.open && !yt.ok) ytGiveUp("no answer"); }, 9000);
        TV.log("sports: video summary in the app: " + v.id + (ready ? " (ready ahead)" : ""));
    }
    function ytCmd(c, by) {
        var f = yt.el && yt.el.querySelector(".ytp__f");
        try { if (f && f.contentWindow) f.contentWindow.postMessage(JSON.stringify({ apltvCmd: c, by: by || 0 }), "*"); } catch (e) {}
    }
    function ytMessage(ev) {
        var m;
        try { m = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data; } catch (e) { return; }
        if (!m || !m.apltvYt) return;
        if (!yt.open) {                                                     // made ready ahead: only its readiness
            if (yt.pre && m.ready) { yt.pre.ready = true; yt.d = m.d || 0; }
            if (yt.pre && m.error !== undefined) { ytFailed[yt.pre.id] = 1; ytDrop(); }
            return;
        }
        if (m.note) { TV.log("sports: summary player: " + m.note); return; }
        if (m.error !== undefined) { ytGiveUp("error " + m.error); return; }
        if (m.ready) { yt.ok = true; clearTimeout(yt.timer); }
        if (m.muted !== undefined) { yt.muted = !!m.muted; ytBar(); }
        if (m.d) yt.d = m.d;
        if (m.t !== undefined) yt.t = m.t;
        if (m.state !== undefined) {
            if (m.state === 0 && yt.st === 1) { closeYt(); return; }            // the end: back to the match
            if (m.state === 1 && yt.st !== 1) { yt.el.classList.add("is-playing"); ytBar(); }   // the bar goes a few seconds after the start
            if (m.state === 2 && yt.st !== 2) ytBar();
            yt.st = m.state;
        }
        ytDraw();
    }
    function ytDraw() {
        if (!yt.el) return;
        var q = function (s) { return yt.el.querySelector(s); }, now = q(".ytp__now"), len = q(".ytp__len"), bar = q(".ytp__track i"), hint = q(".ytp__hint");
        if (now) now.textContent = mmss(yt.t);
        if (len) len.textContent = yt.d ? mmss(yt.d) : "";
        if (bar) bar.style.width = yt.d ? Math.min(100, 100 * yt.t / yt.d).toFixed(2) + "%" : "0";
        if (hint) hint.textContent = yt.muted ? T("Press OK for the sound") : yt.st === 2 ? T("Paused · OK to play") : T("OK pause · ◀ ▶ 10 s · Back to the match");
    }
    // the bar comes up with each press and goes after a few seconds, unless paused or muted
    function ytBar() {
        if (!yt.el) return;
        yt.el.classList.add("is-bar");
        clearTimeout(yt.barTimer);
        yt.barTimer = setTimeout(function () { if (yt.open && yt.st === 1 && !yt.muted) yt.el.classList.remove("is-bar"); }, 4000);
    }
    function ytGiveUp(why) {
        var v = yt.v;
        TV.log("sports: video summary in the app: " + why + "; the YouTube app instead");
        ytFailed[v.id] = 1;
        closeYt();
        openVideoApp(v);
    }
    function closeYt() {
        if (!yt.open) return;
        yt.open = false;
        TV.ytPlaying = false;
        clearTimeout(yt.timer); clearTimeout(yt.barTimer);
        ytCmd("stop");
        var f = yt.el.querySelector(".ytp__f");
        if (f) f.src = "about:blank";
        yt.el.className = "ytp";
        setTimeout(function () { if (!yt.open) yt.el.innerHTML = ""; }, 300);
        TV.popNav(ytScreen);
    }
    var ytScreen = {
        key: function (code) {
            var K = TV.KEY;
            if (TV.isBack(code) || code === K.STOP) { TV.sound.tick(); closeYt(); return; }
            if (code === K.LEFT || code === K.RW) { ytCmd("seek", -10); yt.t = Math.max(0, yt.t - 10); ytDraw(); ytBar(); return; }
            if (code === K.RIGHT || code === K.FF) { ytCmd("seek", 10); yt.t = yt.d ? Math.min(yt.d, yt.t + 10) : yt.t + 10; ytDraw(); ytBar(); return; }
            if (code === K.PLAY) { ytCmd("play"); ytBar(); return; }
            if (code === K.PAUSE) { ytCmd("pause"); ytBar(); return; }
            if (code === K.PLAYPAUSE) { ytCmd("toggle"); ytBar(); return; }
            ytBar();
        },
        ok: function () { ytCmd("toggle"); ytBar(); },
        tiles: null
    };
    function openVideoApp(v) {
        var url = "https://www.youtube.com/watch?v=" + v.id, A = global.APLAndroid;
        if (TV.ANDROID) { if (!(A && A.openLink && A.openLink(url))) TV.toast(T("Install the new APL TV for Android to open videos.")); return; }
        if (TV.WEBOS && TV.luna) { TV.luna("luna://com.webos.applicationManager/launch", { id: "youtube.leanback.v4", params: { contentTarget: "https://www.youtube.com/tv?v=" + v.id } }, function () {}); return; }
        if (TV.TIZEN) { tizenVideo(v.id); return; }
        global.open(url, "_blank");
    }
    /* Samsung: TizenTube when it is installed (it opens YouTube's TV page with "v=…", without ads), else YouTube's app */
    function tizenVideo(id) {
        var Z = global.tizen;
        function launch(appId, payload, next) {
            try {
                Z.application.launchAppControl(new Z.ApplicationControl("http://tizen.org/appcontrol/operation/view", null, null, null, [new Z.ApplicationControlData("PAYLOAD", [payload])]), appId,
                    function () { TV.log("sports: video opened in " + appId); }, function (e) { TV.log("sports: " + appId + ": " + e.message); if (next) next(); else TV.toast(T("YouTube can't be opened on this screen.")); });
            } catch (e) { if (next) next(); else TV.toast(T("YouTube can't be opened on this screen.")); }
        }
        function youtube() { launch("111299001912", JSON.stringify({ values: "v=" + id })); }
        /* His TizenTube's service (always on) keeps the video for its page, which takes it at a cold start too (a first
           start doesn't hand its page the request); a TizenTube without it just doesn't answer */
        function handOver(done) {
            var x = new XMLHttpRequest(), fin = false, end = function () { if (!fin) { fin = true; done(); } };
            try { x.open("GET", "http://127.0.0.1:8100/apl-open?v=" + encodeURIComponent(id)); x.timeout = 1500; x.onload = end; x.onerror = end; x.ontimeout = end; x.send(); } catch (e) { end(); }
            setTimeout(end, 1800);
        }
        try {
            Z.application.getAppsInfo(function (apps) {
                var tt = apps.filter(function (a) { return /tizentube/i.test(a.id + " " + a.name); })[0];
                // "apl_v": his TizenTube opens it from inside (no account screen, its ad blocker ready); TizenTube's own "args" otherwise
                if (tt) handOver(function () { launch(tt.id, JSON.stringify({ args: "v=" + id, apl_v: id }), youtube); }); else youtube();
            }, youtube);
        } catch (e) { youtube(); }
    }

    function openMatch(m) {
        var r = TV.$("match");
        if (!r) return;
        ytDrop();
        sheet.m = m; sheet.lang = ""; sheet.zone = "btns"; sheet.open = true; sheet.el = r; sheet.tab = ""; sheet.tabIndex = 0; sheet.t0 = Date.now(); sheet.told = {};
        r.innerHTML = "";
        r.classList.add("is-open");
        TV.pushNav(sheetScreen);
        sheet.draw(true);
        tick();
        if (!where[m.id] && !finding && m.state !== "post") findSoon(50);
        summaryOf(m).then(function () { if (sheet.open && sheet.m === m) sheet.draw(); });
        if (m.state === "post" && !/CANCEL|POSTPONED/.test(m.status)) setTimeout(function () {
            findVideo(m).then(function (v) { if (v && sheet.open && sheet.m === m) sheet.draw(); });
        }, 400);
    }
    function closeMatch() {
        if (!sheet.open) return;
        ytDrop();
        sheet.open = false;
        sheet.el.classList.remove("is-open");
        TV.popNav(sheetScreen);
        paint();
    }
    sheet.draw = function (first) {
        var tDraw = Date.now();
        sheet.drawOnce(first);
        if (TV.DEV) TV.log("sports: match page drawn in " + (Date.now() - tDraw) + " ms" + (first ? " (first)" : ""));
    };
    sheet.drawOnce = function (first) {
        var m = sheet.m, r = sheet.el, st = statusOf(m), two = sides(m), w = where[m.id], dc = details[m.id], d = dc && dc.d;
        var keepZone = sheet.zone, keepBtn = sheet.nav ? sheet.nav.index : 0, keepCh = sheet.strip ? sheet.strip.index : 0, keepLang = sheet.lang;
        if (w && (!sheet.lang || !w.langs[sheet.lang])) sheet.lang = w.order[0] || "";
        var list = w && w.langs[sheet.lang] ? w.langs[sheet.lang] : [];
        sheet.list = list;
        r.innerHTML = "";
        var bg = el("div", "match__bg");
        var cols = colours(two[0], two[1]);
        bg.style.background = "radial-gradient(70% 90% at 0% 30%, " + rgba(cols[0], 0.55) + " 0%, rgba(6,7,11,0) 70%), radial-gradient(70% 90% at 100% 30%, " +
            rgba(cols[1], 0.5) + " 0%, rgba(6,7,11,0) 70%), #06070b";
        // Apple TV's match page: a photo behind it (the match after it, else the stadium), darkened for the text
        var ph = photoNow(m);
        if (ph && !sheet.told[ph.u]) { sheet.told[ph.u] = 1; seen(ph.u, function (ms) { TV.log("sports: match photo shown " + (Date.now() - sheet.t0) + " ms after opening (" + ph.by + ")"); }); }
        if (ph) {
            bg.style.background = "#06070b";
            bg.innerHTML = "<i class='match__photo' style='background-image:" + esc(TV.cssUrl(ph.u)) + "'></i><i class='match__tint' style='background:radial-gradient(70% 90% at 0% 30%, " +
                rgba(cols[0], 0.42) + " 0%, rgba(6,7,11,0) 70%), radial-gradient(70% 90% at 100% 30%, " + rgba(cols[1], 0.38) + " 0%, rgba(6,7,11,0) 70%)'></i>";
        } else if (ph === undefined) photoOf(m).then(function (p) { if (p && sheet.open && sheet.m === m) sheet.draw(); });
        r.appendChild(bg);
        var inn = el("div", "match__in");
        r.appendChild(inn);
        inn.appendChild(el("div", "match__kicker", leagueLogo(m, 64) + "<span>" + esc([T(m.league[1]), m.note].filter(Boolean).join(" · ")) + "</span>"));
        var score = m.state !== "pre" && !/CANCEL|POSTPONED/.test(m.status);
        var board = el("div", "match__board");
        function side(t, k) {
            var goals = d ? d.scorers[t === m.home ? "h" : "a"] : [];
            return "<div class='match__side" + (score ? result(t, m, st) : "") + "'><i class='match__logo' style='background-image:" +
                esc(crestBg(crest(t, m.sport), 240)) + "'></i><div class='match__team'>" + esc(shown(t, true)) + "</div>" +
                (goals.length ? "<div class='match__goals'>" + goals.slice(0, 5).map(esc).join("<br>") + (goals.length > 5 ? "<br>+" + (goals.length - 5) : "") + "</div>" : "") + "</div>";
        }
        var day = dayStart(0), when = m.start >= day + 86400000 && m.start < day + 2 * 86400000 ? T("Tomorrow") : m.start >= day - 86400000 && m.start < day ? T("Yesterday") : m.start >= day && m.start < day + 86400000 ? T("Today") : longDay(m.start);
        board.innerHTML = side(two[0]) +
            "<div class='match__mid'>" + (score ? "<div class='match__score'>" + esc(two[0].score || "0") + "<span>–</span>" + esc(two[1].score || "0") + "</div>"
                                                : "<div class='match__time'>" + esc(TV.hhmm(m.start)) + "</div>") +
            "<div class='match__st" + (st.live ? " is-live" : "") + "'>" + esc(st.live || st.done ? st.text : when) + "</div></div>" + side(two[1]);
        inn.appendChild(board);
        // the same in one line, for reading a tab on the whole screen
        r.appendChild(el("div", "match__mini", "<i style='background-image:" + esc(crestBg(crest(two[0], m.sport), 100)) + "'></i><span>" + esc(shown(two[0], true)) + "</span><b>" +
            esc(score ? (two[0].score || "0") + " – " + (two[1].score || "0") : TV.hhmm(m.start)) + "</b><span>" + esc(shown(two[1], true)) + "</span><i style='background-image:" +
            esc(crestBg(crest(two[1], m.sport), 100)) + "'></i>"));
        // the broadcasters where you live
        var bc = tvOf(m);
        var info = [m.venue].concat(bc.length ? [T("On TV: {list}", { list: bc.join(", ") })] : []).filter(Boolean);
        if (info.length) inn.appendChild(el("div", "match__info", esc(info.join(" · "))));

        // the buttons
        var btns = el("div", "match__btns"), tiles = [], acts = [];
        function btn(html, run, primary) { var b = el("div", "btn" + (primary ? " btn--primary" : ""), html); btns.appendChild(b); tiles.push(b); acts.push(run); }
        if (list.length) {
            btn(TV.icon("play", 28) + esc(T("Watch on {name}", { name: list[0].ch.name })), function () { play(0); }, true);
            btn(TV.icon("speaker", 28) + esc(T("Versions") + " · " + langName(sheet.lang)), versions);
        }
        var video = videoFound[m.id];
        if (video && !sheet.told.video) { sheet.told.video = 1; TV.log("sports: summary button " + (Date.now() - sheet.t0) + " ms after opening"); }
        sheet.videoAt = -1;
        if (video) { sheet.videoAt = tiles.length; btn(TV.icon("play", 28) + esc(T("Video Summary") + " · " + video.channel), function () { openVideo(video); }, !list.length); }
        if (!list.length && !st.done) bc.slice(0, 2).forEach(function (b) { btn(TV.icon("search", 28) + esc(T("Search “{name}”", { name: b })), function () { closeMatch(); TV.shell.go("search", true); TV.search.ask(b); }); });
        if (tiles.length) inn.appendChild(btns);

        // the tabs, then what the tab shows
        var tabs = [];
        if (!st.done && !/CANCEL|POSTPONED/.test(m.status)) tabs.push(["where", T("Where to Watch")]);
        if (d && d.events.length) tabs.push(["summary", T("Summary")]);
        if (d && d.stats.some(function (x) { return x.hv || x.av; })) tabs.push(["stats", T("Stats")]);      // not a page of zeros before the start
        if (d && d.lineups.length) tabs.push(["lineups", T("Lineups")]);
        if (d && d.form && d.form.length) tabs.push(["form", T("Form")]);
        if (d && d.table) tabs.push(["table", T("Table")]);
        if (!dc || dc.p) { if (!tabs.length) tabs.push(["load", T("Loading…")]); }
        sheet.tabs = tabs;
        if (!tabs.some(function (t) { return t[0] === sheet.tab; })) sheet.tab = tabs.length ? tabs[0][0] : "";
        var tabRow = el("div", "match__tabs seg"), tabTiles = [];
        tabs.forEach(function (t) { var c = el("div", "chip" + (t[0] === sheet.tab ? " is-current" : ""), esc(t[1])); tabRow.appendChild(c); tabTiles.push(c); });
        if (tabs.length) inn.appendChild(tabRow);
        sheet.tabRow = tabs.length ? tabRow : null;
        var body = el("div", "match__body");
        inn.appendChild(body);
        sheet.body = body;
        sheet.strip = null;
        drawTab(body, m, d, w, list, st, keepLang === sheet.lang ? keepCh : 0);
        var sc = body.firstChild;
        if (!first && sc && sc.classList && sc.classList.contains("match__scroll")) {
            sc.classList.add("is-kept");
            if (sheet.y) { sc.style.transition = "none"; sc.style.transform = "translateY(" + (-sheet.y) + "px)"; void sc.offsetHeight; sc.style.transition = ""; }
        } else sheet.y = 0;
        // the sources (ESPN, 365Scores, the LFP, Wikipedia) are in Settings > Credits, not on the screen
        sheet.acts = acts;
        sheet.nav = new TV.Nav({ onSelect: function (i) { if (acts[i]) acts[i](); }, onFocus: function (i) { if (video && i === sheet.videoAt) ytPrepareSoon(video); else clearTimeout(prepTimerYt); } });
        sheet.nav.setTiles(tiles, first ? 0 : Math.min(keepBtn, Math.max(0, tiles.length - 1)));
        sheet.tabNav = new TV.Nav({});
        sheet.tabNav.setTiles(tabTiles, Math.max(0, tabs.map(function (t) { return t[0]; }).indexOf(sheet.tab)));
        sheet.zone = keepZone === "body" ? "body" : keepZone === "tabs" && tabTiles.length ? "tabs" : tiles.length ? "btns" : tabTiles.length ? "tabs" : "body";
        sheet.paint();
    };
    /* The places of a table, in colour: the European cups, the play-offs, relegation (2026-27 rules, first divisions) */
    var ZONE_TEXT = { ucl: "Champions League", uel: "Europa League", uecl: "Conference League", q: "Next round", po: "Play-offs", rel: "Relegation", relpo: "Relegation play-off" };
    var ZONE_RULES = { "soccer/fra.1": "ucl ucl ucl ucl uel uecl|relpo rel rel", "soccer/eng.1": "ucl ucl ucl ucl ucl uel uecl|rel rel rel", "soccer/esp.1": "ucl ucl ucl ucl ucl uel uecl|rel rel rel",
        "soccer/ita.1": "ucl ucl ucl ucl uel uecl|rel rel rel", "soccer/ger.1": "ucl ucl ucl ucl uel uecl|relpo rel rel", "soccer/por.1": "ucl ucl uel uecl|relpo rel rel",
        "soccer/ned.1": "ucl ucl uel uecl|relpo rel rel", "soccer/bel.1": "ucl uel uecl", "soccer/tur.1": "ucl ucl uel uecl|rel rel rel rel", "soccer/fra.2": "q q po po po|relpo rel rel",
        "soccer/uefa.champions": "q*8 po*16", "soccer/uefa.europa": "q*8 po*16", "soccer/uefa.europa.conf": "q*8 po*16" };
    var RES_LETTER = { W: "W", D: "D", L: "L" };
    function tableZones(m, n) {
        var rule = ZONE_RULES[m.lkey], out = [];
        if (!rule) return out;
        var parts = rule.split("|"), expand = function (txt) { var l = []; txt.split(" ").filter(Boolean).forEach(function (x) { var p = x.split("*"); for (var i = 0; i < (+p[1] || 1); i++) l.push(p[0]); }); return l; };
        var top = expand(parts[0]), bottom = parts[1] ? expand(parts[1]) : [];
        top.forEach(function (z, i) { if (i < n) out[i] = z; });
        bottom.forEach(function (z, i) { var at = n - bottom.length + i; if (at >= top.length) out[at] = z; });
        return out;
    }
    function drawTab(body, m, d, w, list, st, keepCh) {
        var two = sides(m), t = sheet.tab, h = "";
        body.className = "match__body match__body--" + (t || "none");
        if (t === "where") {
            var reach = T("The channel comes with your TV guide, the day before.");
            if (list.length) {
                if (w && w.guess) body.appendChild(el("div", "match__note match__note--top", esc(T("{net} has this competition where you live: the match should be on one of its channels. The exact one comes with the TV guide, the day before.", { net: w.net }))));
                sheet.strip = new TV.Strip({ title: w && w.guess ? w.net : langName(sheet.lang), sub: list.length > 1 ? T("{n} channels", { n: list.length }) : T("1 channel"),
                    items: list.map(function (x) { return x.ch; }), kind: "channel", height: 270, make: function (ch) { return TV.card.channel(ch); } });
                body.appendChild(sheet.strip.root);
                if (keepCh) sheet.strip.focus(Math.min(keepCh, list.length - 1), true);
                return;
            }
            var net = tvRights(m);
            h = "<div class='match__note'>" + esc(net ? T("Shown on {net} where you live, but none of its channels is in your lists.", { net: net.net }) :
                !w ? (m.start >= guideEnd() ? reach : T("Looking in your TV guide…")) : farAhead(m) ? reach : T("No channel of your lists shows this match, according to your provider's TV guide.")) + "</div>";
        } else if (t === "summary") {
            var ball = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (SPORT_ICONS[m.sport] || SPORT_ICONS.soccer) + "</svg>";
            // one line a moment: the home team's on the left, the visitors' on the right, the minute between
            h = "<div class='mev'>" + d.events.map(function (e) {
                if (e.k === "ht") return "<div class='mev__sep'>" + esc(T("Half-time")) + "</div>";
                var icon = e.k === "yellow" ? "<i class='mev__card'></i>" : e.k === "red" ? "<i class='mev__card is-red'></i>" : e.k === "sub" ? "<i class='mev__sub'>⇅</i>" : "<i class='mev__goal'>" + ball + "</i>";
                var txt = e.k === "sub" ? "<b>" + esc(lastName(e.who[0] || "")) + "</b>" + (e.who[1] ? " <small>" + esc(T("for {name}", { name: lastName(e.who[1]) })) + "</small>" : "")
                        : "<b>" + esc(lastName(e.who[0] || "")) + "</b>" + (e.k === "pen" ? " <small>" + esc(T("(pen.)")) + "</small>" : e.k === "og" ? " <small>" + esc(T("(o.g.)")) + "</small>" : "");
                var line = icon + "<span>" + txt + "</span>", first = awayFirst(m) ? "a" : "h";
                return "<div class='mev__row" + (e.k === "goal" || e.k === "pen" || e.k === "og" ? " is-goal" : "") + "'><div class='mev__l'>" + (e.side === first ? line : "") + "</div>" +
                       "<div class='mev__min'>" + esc(e.min) + "</div><div class='mev__r'>" + (e.side && e.side !== first ? line : "") + "</div></div>";
            }).join("") + "</div>";
        } else if (t === "stats") {
            var fi = awayFirst(m), sc = colours(two[0], two[1]), c0 = rgba(sc[0], 1), c1 = rgba(sc[1], 1);
            h = "<div class='mst'><div class='mst__head'><i style='background-image:" + esc(crestBg(crest(two[0], m.sport), 80)) + "'></i><span></span><i style='background-image:" +
                esc(crestBg(crest(two[1], m.sport), 80)) + "'></i></div>" + d.stats.map(function (s) {
                var l = fi ? s.av : s.hv, rr = fi ? s.hv : s.av, lt = fi ? s.a : s.h, rt = fi ? s.h : s.a, sum = l + rr || 1;
                return "<div class='mst__row'><b class='" + (l > rr ? "is-more" : "") + "'>" + esc(lt + s.unit) + "</b><div class='mst__mid'><span>" + esc(s.label) + "</span><div class='mst__bar'><i style='background:" + c0 + ";width:" +
                       Math.round(100 * l / sum) + "%'></i><i style='background:" + c1 + ";width:" + Math.round(100 * rr / sum) + "%'></i></div></div><b class='" + (rr > l ? "is-more" : "") + "'>" + esc(rt + s.unit) + "</b></div>";
            }).join("") + "</div>";
        } else if (t === "lineups") {
            var col = function (lu, tm) {
                if (!lu) return "<div class='mlu__col'></div>";
                var p = function (x) { return "<div class='mlu__p" + (x.out ? " is-out" : "") + (x.inn ? " is-in" : "") + "'><b>" + esc(x.n) + "</b><span>" + esc(x.name) + "</span></div>"; };
                return "<div class='mlu__col'><div class='mlu__head'><i style='background-image:" + esc(crestBg(crest(tm, m.sport), 80)) + "'></i><span>" + esc(shown(tm, true)) + "</span>" +
                       (lu.formation ? "<em>" + esc(lu.formation) + "</em>" : "") + "</div>" + lu.xi.map(p).join("") +
                       (lu.bench.length ? "<div class='mlu__sub'>" + esc(T("Substitutes")) + "</div>" + lu.bench.map(p).join("") : "") + "</div>";
            };
            var of = function (tm) { var k = tm === m.home ? "h" : "a"; return d.lineups.filter(function (x) { return x.side === k; })[0]; };
            h = "<div class='mlu'>" + col(of(two[0]), two[0]) + col(of(two[1]), two[1]) + "</div>";
        } else if (t === "table") {
            // FotMob's table: the places that qualify in colour, the crests, played / won / drawn / lost, goal difference, points
            var ids = [String(m.home.id), String(m.away.id)];
            var crestOf = function (id) { return m.sport === "soccer" && id ? "https://a.espncdn.com/i/teamlogos/soccer/500/" + id + ".png" : ""; };
            // the teams' table; a second one when they play in two groups (the visitors' conference)
            var oneTable = function (tb, first) {
                var zones = tb.zones || (first ? tableZones(m, tb.rows.length) : []), used = {};
                return "<div class='mtb'><div class='mtb__title'>" + esc(tb.title) + "</div><div class='mtb__row mtb__row--head'><b>#</b><span>" + esc(T("Team")) + "</span><em>" + esc(T("P")) + "</em>" +
                    "<em>" + esc(T("W")) + "</em><em>" + esc(T("D")) + "</em><em>" + esc(T("L")) + "</em><em>" + esc(T("GD")) + "</em><em class='mtb__pts'>" + esc(T("Pts")) + "</em></div>" +
                    tb.rows.map(function (rw, i) {
                        var z = zones[i], u = rw.logo || crestOf(rw.id);
                        if (z) used[z] = 1;
                        return "<div class='mtb__row" + (ids.indexOf(rw.id) >= 0 ? " is-team" : "") + "'><b" + (z ? " class='mtb__z mtb__z--" + z + "'" : "") + ">" + esc(rw.rank) + "</b><span>" +
                               (u ? "<i style='background-image:" + esc(crestBg(u, 60)) + "'></i>" : "") + esc(shown({ name: rw.team }, true)) + "</span><em>" + esc(rw.gp) + "</em><em>" + esc(rw.w) +
                               "</em><em>" + esc(rw.d) + "</em><em>" + esc(rw.l) + "</em><em>" + esc(rw.gd) + "</em><em class='mtb__pts'>" + esc(rw.pts) + "</em></div>";
                    }).join("") +
                    "<div class='mtb__legend'>" + Object.keys(ZONE_TEXT).filter(function (z) { return used[z]; }).map(function (z) { return "<span><i class='mtb__z--" + z + "'></i>" + esc(T(ZONE_TEXT[z])) + "</span>"; }).join("") + "</div></div>";
            };
            h = oneTable(d.table, true) + (d.table.more ? oneTable(d.table.more, false) : "");
        } else if (t === "form") {
            // each side's last five: won, drawn, lost, against whom, the score
            var fcol = function (tm) {
                var k = tm === m.home ? "h" : "a", f = d.form.filter(function (x) { return x.side === k; })[0];
                if (!f) return "<div class='mfo__col'></div>";
                var pills = f.games.slice(0, 5).map(function (g) { return "<i class='mfo__pill is-" + esc(g.res.toLowerCase()) + "'>" + esc(T(RES_LETTER[g.res] || g.res)) + "</i>"; }).join("");
                return "<div class='mfo__col'><div class='mfo__head'><i style='background-image:" + esc(crestBg(crest(tm, m.sport), 80)) + "'></i><span>" + esc(shown(tm, true)) + "</span><em>" + pills + "</em></div>" +
                    f.games.slice(0, 5).reverse().map(function (g) {          // the latest first
                        return "<div class='mfo__g'><i class='mfo__pill is-" + esc(g.res.toLowerCase()) + "'>" + esc(T(RES_LETTER[g.res] || g.res)) + "</i><b>" + esc(g.score) + "</b><span>" + esc(g.home ? T("vs") : "@") +
                               "</span><i class='mfo__crest' style='background-image:" + esc(crestBg(g.logo, 60)) + "'></i><strong>" + esc(shown({ name: g.opp }, false)) + "</strong><small>" +
                               esc(g.t ? shortDay(g.t) : "") + (g.comp ? " · " + esc(g.comp.replace(/^\d{4}(-\d{2,4})?\s+/, "")) : "") + "</small></div>";
                    }).join("") + "</div>";
            };
            h = "<div class='mfo'>" + fcol(two[0]) + fcol(two[1]) + "</div>";
        } else if (t === "load") h = "<div class='match__note is-spin'>" + TV.spinner(64) + "</div>";
        body.innerHTML = h ? "<div class='match__scroll'>" + h + "</div>" : "";
    }
    /* The tab slides up or down by a third of the screen, never past its ends */
    function scrollBody(dy) {
        var sc = sheet.body && sheet.body.firstChild;
        if (!sc || !sc.classList || !sc.classList.contains("match__scroll")) return false;
        var max = Math.max(0, sc.offsetHeight - sheet.body.clientHeight + 40), y = Math.max(0, Math.min(max, (sheet.y || 0) + dy));
        if (y === (sheet.y || 0)) return false;
        sheet.y = y;
        sc.style.transform = "translateY(" + (-y) + "px)";
        return true;
    }
    sheet.paint = function () {
        var z = sheet.zone;
        if (z === "btns") sheet.nav.refocus(); else sheet.nav.blur();
        if (z === "tabs") sheet.tabNav.refocus(); else sheet.tabNav.blur();
        if (sheet.strip) sheet.strip.setActive(z === "body");
        sheet.body.classList.toggle("is-on", z === "body");
        // reading a tab: the page slides up to its tabs, the board fades into one line at the top
        var reading = z === "body", inn = sheet.el.querySelector(".match__in"), shift = reading && sheet.tabRow ? Math.max(0, sheet.tabRow.offsetTop - 104) : 0;
        sheet.el.classList.toggle("is-reading", reading);
        if (inn) inn.style.transform = shift ? "translateY(" + (-shift) + "px)" : "";
    };
    function showTab(i) {
        var t = sheet.tabs[i];
        if (!t || t[0] === sheet.tab) return;
        sheet.tab = t[0];
        sheet.tabNav.tiles.forEach(function (c, k) { c.classList.toggle("is-current", k === i); });
        var m = sheet.m, w = where[m.id], dc = details[m.id], list = w && w.langs[sheet.lang] ? w.langs[sheet.lang] : [];
        sheet.strip = null;
        sheet.body.innerHTML = "";
        sheet.body.scrollTop = 0;
        sheet.y = 0;
        drawTab(sheet.body, m, dc && dc.d, w, list, statusOf(m), 0);
    }
    function play(i) {
        var list = sheet.list.map(function (x) { return x.ch; });
        if (list[i]) TV.live.play(list[i], list);
    }
    function versions() {
        var w = where[sheet.m.id];
        if (!w) return;
        TV.menu(T("Versions"), w.order.map(function (l) {
            var n = w.langs[l].length;
            return { label: langName(l) + " · " + (n > 1 ? T("{n} channels", { n: n }) : T("1 channel")), check: l === sheet.lang, focus: l === sheet.lang,
                     run: function () { sheet.lang = l; sheet.zone = "btns"; sheet.tab = "where"; sheet.draw(); } };
        }));
    }
    var sheetScreen = {
        key: function (code) {
            var K = TV.KEY, z = sheet.zone, b = sheet.body, hasBtns = sheet.nav.tiles.length > 0, hasTabs = sheet.tabNav.tiles.length > 0;
            if (TV.isBack(code)) { if (z === "body" && hasTabs) { sheet.zone = "tabs"; TV.sound.tick(); sheet.paint(); return; } closeMatch(); return; }
            if (code === K.LEFT || code === K.RIGHT) {
                var dir = code === K.LEFT ? "left" : "right";
                if (z === "btns") sheet.nav.move(dir);
                else if (z === "tabs") { if (sheet.tabNav.move(dir)) showTab(sheet.tabNav.index); }
                else if (sheet.strip) { if (!sheet.strip.move(code === K.LEFT ? -1 : 1)) TV.sound.edge(); }
                else TV.sound.edge();
                return;
            }
            if (code === K.DOWN) {
                if (z === "btns") { if (hasTabs || sheet.strip || b.scrollHeight > b.clientHeight) { sheet.zone = hasTabs ? "tabs" : "body"; TV.sound.tick(); sheet.paint(); } else TV.sound.edge(); return; }
                if (z === "tabs") { sheet.zone = "body"; TV.sound.tick(); sheet.paint(); return; }
                if (!sheet.strip && scrollBody(300)) TV.sound.tick(); else TV.sound.edge();
                return;
            }
            if (code === K.UP) {
                if (z === "body") {
                    if (!sheet.strip && sheet.y > 0) { scrollBody(-300); TV.sound.tick(); return; }
                    sheet.zone = hasTabs ? "tabs" : hasBtns ? "btns" : "body"; TV.sound.tick(); sheet.paint(); return;
                }
                if (z === "tabs" && hasBtns) { sheet.zone = "btns"; TV.sound.tick(); sheet.paint(); return; }
                TV.sound.edge();
            }
        },
        ok: function () {
            if (sheet.zone === "btns") sheet.nav.ok();
            else if (sheet.zone === "tabs") { sheet.zone = "body"; TV.sound.tick(); sheet.paint(); }
            else if (sheet.strip) play(sheet.strip.index);
        },
        tiles: null
    };

    /* ---------- choosing your favourites, FotMob style ----------
       Four steps: what you follow (sports, men's / women's matches, friendlies), your competitions, your clubs, your
       national teams. Opened the first time you go into Sports (Later = every league, as before), then by ★ Favorites. */
    var teamLists = {};
    var teamCache = {};
    function teamsOf(sportId, slug) {
        var k = sportId + "/" + slug;
        if (String(slug).indexOf("s365:") === 0) {
            if (!teamLists[k]) teamLists[k] = limited(function () { return TV.fetchJSON(S365 + "standings/?" + q365() + "&competitions=" + slug.slice(5), { timeout: 15000 }); }).then(function (j) {
                var seen = {}, out = [];
                ((j && j.standings) || []).forEach(function (st) {
                    (st.rows || []).forEach(function (r) {
                        var c = r.competitor;
                        if (!c || seen[c.id] || leftOut(c)) return;
                        seen[c.id] = 1;
                        out.push({ id: "365-" + c.id, name: c.name || "", short: c.name || "", logo: img365("Competitors", c.id, c.imageVersion) });
                    });
                });
                out.sort(function (a, b) { return a.name.localeCompare(b.name); });
                teamCache[k] = out;
                return out;
            }, function (e) { delete teamLists[k]; throw e; });
            return teamLists[k];
        }
        if (!teamLists[k]) teamLists[k] = limited(function () { return TV.fetchJSON(API + sportId + "/" + slug + "/teams", { timeout: 15000 }); }).then(function (j) {
            var lg = j && j.sports && j.sports[0] && j.sports[0].leagues && j.sports[0].leagues[0];
            var list2 = ((lg && lg.teams) || []).map(function (x) {
                var t = x.team || {};
                return { id: String(t.id), name: t.displayName || t.name || "", short: t.shortDisplayName || t.displayName || t.name || "", logo: (t.logos && t.logos[0] && t.logos[0].href) || t.logo || "" };
            }).filter(function (t) { return !leftOut(t); });
            teamCache[k] = list2;
            return list2;
        }, function (e) { delete teamLists[k]; throw e; });
        return teamLists[k];
    }
    /* National teams by continent; the friendlies' list (about 200 countries) brings everyone else */
    var NATION_LISTS = {
        soccer: [["uefa.nations", "Europe"], ["caf.nations", "Africa"], ["afc.asian.cup", "Asia"], ["fifa.worldq.afc", "Asia"], ["conmebol.america", "South America"],
                 ["concacaf.gold", "North and Central America"], ["fifa.world", "Rest of the World"], ["fifa.friendly", "Rest of the World"]],
        rugby: [["180659", ""], ["244293", ""], ["289234", ""], ["17567", ""]]
    };
    var CONTINENTS = ["Europe", "Africa", "Asia", "South America", "North and Central America", "Rest of the World", ""];

    /* Countries keep their flag everywhere (his choice): rugby's national teams (FFR's rooster, the Springbok) show the
       flag football uses, found by the country's name in ESPN's lists of national teams (198 in the friendlies'). Kept. */
    var flags = TV.load("sportsFlags", null), flagsAsked = false;
    var FLAG_NAME = { "united states of america": "united states", usa: "united states", ireland: "republic of ireland" };
    function needFlags() {
        if (flags || flagsAsked) return;
        flagsAsked = true;
        Promise.all(["fifa.friendly", "uefa.nations"].map(function (slug) { return teamsOf("soccer", slug).then(null, function () { return []; }); })).then(function (lists) {
            var map = {}, n = 0;
            lists.forEach(function (l) { l.forEach(function (t) { if (t.logo && /\/countries\//.test(t.logo)) { map[S.fold(t.name)] = t.logo; n++; } }); });
            if (!n) { flagsAsked = false; return; }
            flags = map;
            TV.save("sportsFlags", map);
            refreshShown();
            if (setup.open && setup.step === 3) drawSetup();
        });
    }
    function isNation(t) { var k = S.fold(t.name); return !!(isoMap()[k] || NATIONS[k] || FR_NATIONS[k] || FLAG_NAME[k]); }
    /* A team's picture: its crest, or its flag for a country */
    function crest(t, sport) {
        if (sport !== "soccer" && t && isNation(t)) {
            var k = S.fold(t.name), f = flags && (flags[k] || flags[FLAG_NAME[k]]);
            if (f) return f;
            needFlags();
        }
        return (t && t.logo) || initials(t);
    }
    var initialsMemo = {};
    function initials(t) {
        if (!t || !t.name) return "";
        var key = t.name + "|" + (t.color || "");
        if (initialsMemo[key]) return initialsMemo[key];
        var words = S.fold(t.short || t.name).split(" ").filter(function (w) { return w && !STOP[w]; }), txt = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 3);
        var c = /^[0-9a-f]{6}$/i.test(t.color || "") ? "#" + t.color : "#3a3f4d";
        var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='47' fill='" + c + "' stroke='rgba(255,255,255,0.85)' stroke-width='4'/>" +
                  "<text x='50' y='50' dy='0.35em' text-anchor='middle' font-family='sans-serif' font-weight='700' font-size='" + (txt.length > 2 ? 30 : 38) + "' fill='#fff'>" + txt.toUpperCase() + "</text></svg>";
        return (initialsMemo[key] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    }
    var nationLists = {};
    function nationsOf(sportId) {
        if (nationLists[sportId]) return nationLists[sportId];
        var lists = NATION_LISTS[sportId];
        nationLists[sportId] = Promise.all(lists.map(function (x) { return teamsOf(sportId, x[0]).then(null, function () { return null; }); })).then(function (all) {
            var seen = {}, out = [];
            all.forEach(function (l, i) {
                (l || []).forEach(function (t) {
                    if (seen[t.id]) return;
                    seen[t.id] = 1;
                    out.push({ id: t.id, name: t.name, short: t.short, logo: t.logo, l: sportId + "/" + lists[i][0], g: lists[i][1] });
                });
            });
            if (all.some(function (l) { return !l; })) delete nationLists[sportId];          // asked again next time
            return out.sort(function (a, b) { return CONTINENTS.indexOf(a.g) - CONTINENTS.indexOf(b.g) || shown(a, true).localeCompare(shown(b, true), TV.locale); });
        });
        return nationLists[sportId];
    }
    // Ticked at first: what is followed most where you live
    var SUGGEST = ["uefa.champions", "uefa.europa", "uefa.europa.conf", "fifa.world", "uefa.euro", "uefa.nations", "fifa.worldq.uefa", "uefa.euroq", "fifa.friendly",
                   "eng.1", "esp.1", "ita.1", "ger.1", "nba", "nfl", "nhl", "180659", "164205", "17567", "289234"];
    var SUGGEST_LANG = { fr: ["fra.1", "fra.2", "fra.coupe_de_france", "270559", "271937", "fra.w.1", "s365:569", "s365:38", "s365:6182", "s365:542", "s365:5712"], en: ["eng.fa", "eng.league_cup", "267979", "sco.1", "eng.w.1"],
        es: ["esp.copa_del_rey", "esp.w.1"], pt: ["por.1"], it: ["ita.coppa_italia"], de: ["ger.dfb_pokal"], nl: ["ned.1"], tr: ["tur.1"], ar: ["ksa.1", "caf.nations"], pl: ["s365:153", "s365:157", "s365:5772", "s365:392"] };
    function draftOf() {
        var f = chosen();
        if (f) return JSON.parse(JSON.stringify(f));
        var want = SUGGEST.concat(SUGGEST_LANG[TV.lang] || []).concat(US ? ["college-football"] : []), leagues = [];
        SPORTS.forEach(function (sp) { sp.leagues.forEach(function (lg) { if (want.indexOf(lg[0]) >= 0) leagues.push(sp.id + "/" + lg[0]); }); });
        return { sports: ["soccer", "rugby", "basketball"].concat(US ? ["football", "hockey"] : []), types: { men: 1, women: 0, friendly: 1 }, leagues: leagues, teams: [] };
    }
    var SPORT_ICONS = {
        soccer: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2l3.8 2.8-1.4 4.4H9.6L8.2 10z"/><path d="M12 3v4.2M15.8 10l4.6-1.6M14.4 14.4l2.8 3.8M9.6 14.4l-2.8 3.8M8.2 10L3.6 8.4"/>',
        rugby: '<ellipse cx="12" cy="12" rx="9.5" ry="5.6" transform="rotate(-38 12 12)"/><path d="M8.6 15.4l6.8-6.8M10.2 11.4l2.4 2.4M11.8 9.8l2.4 2.4"/>',
        basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.7 5.7c3.4 3.2 3.4 9.4 0 12.6M18.3 5.7c-3.4 3.2-3.4 9.4 0 12.6"/>',
        football: '<ellipse cx="12" cy="12" rx="9.5" ry="5.2" transform="rotate(-38 12 12)"/><path d="M5.5 15.8l2.4 2.4M16.1 5.8l2.4 2.4M10 14l4-4M10.6 11.4l1.4 1.4M12 10l1.4 1.4"/>',
        hockey: '<path d="M7 3l6.2 13.2h5.3"/><path d="M3.5 20h8"/><ellipse cx="17.5" cy="19.5" rx="3" ry="1.5"/>',
        handball: '<circle cx="12" cy="12" r="9"/><path d="M12 3c-2.4 3-2.4 15 0 18M3.6 9.2c4.6 1.6 12.2 1.6 16.8 0M3.6 14.8c4.6-1.6 12.2-1.6 16.8 0"/>',
        volleyball: '<circle cx="12" cy="12" r="9"/><path d="M12 12c0-4 2-7.4 5.2-8.2M12 12c-3.5 2-7.4 2-9.6-.4M12 12c3.5 2 5.6 5.5 4.8 8.6M7.4 4.3c1.5 3.6 1 8.1-1.6 11.4"/>'
    };
    function sportIcon(id) { return '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + (SPORT_ICONS[id] || SPORT_ICONS.soccer) + "</svg>"; }

    /* Any club or country, by name: ESPN's own search (the one of its site; no key), Israel's clubs left out */
    var FIND_URL = "https://site.web.api.espn.com/apis/common/v3/search?limit=30&type=team&query=", finds = {};
    function findTeams(q) {
        q = S.fold(q).trim();
        if (finds[q]) return finds[q];
        finds[q] = TV.fetchJSON(FIND_URL + encodeURIComponent(q), { timeout: 12000 }).then(function (j) {
            return ((j && j.items) || []).filter(function (x) {
                var sp = sportOf(x.sport), lg = x.league || x.defaultLeagueSlug || "";
                if (x.type !== "team" || !sp || /^isr\./.test(lg) || leftOut(x)) return false;
                // football's clubs from any league (their schedule is one for all); elsewhere the leagues of Sports only (no American colleges)
                return sp.id === "soccer" || sp.all || sp.leagues.some(function (l) { return l[0] === lg; });
            }).map(function (x) {
                var lg = x.league || x.defaultLeagueSlug || "", u = (x.logos && x.logos[0] && x.logos[0].href) || "";
                return { id: String(x.id), name: x.displayName || x.name || "", short: x.shortDisplayName || x.displayName || x.name || "", logo: u, s: x.sport, l: x.sport + "/" + lg, nat: /\/countries\//.test(u) };
            });
        }, function (e) { delete finds[q]; TV.log("sports: search: " + e.message); return []; });
        return finds[q];
    }
    function leagueName(s, slug) {
        var sp = sportOf(s), lg = sp && sp.leagues.filter(function (x) { return x[0] === slug; })[0];
        return lg && !(kind(lg, "x") && lg[1] === slug) ? T(lg[1]) : "";
    }
    function wordStart(text, q) { return (" " + S.fold(text) + " ").indexOf(" " + q) >= 0; }

    var setup = { open: false, step: 0, d: null, sub: {}, nav: null, acts: [], grid: null, tok: 0, chipAt: -1, q: null, keepAt: -1, y: 0 };
    function openSetup() {
        var r = TV.$("sfav");
        if (!r || setup.open) return;
        setup.el = r; setup.open = true; setup.step = 0; setup.d = draftOf(); setup.sub = {}; setup.q = null;
        r.classList.add("is-open");
        TV.pushNav(setupScreen);
        drawSetup(true);
    }
    function closeSetup(save) {
        if (save) TV.setPref("sportsFav", setup.d);
        else if (!fav()) TV.setPref("sportsFav", { skipped: 1 });
        setup.open = false;
        setup.el.classList.remove("is-open");
        TV.popNav(setupScreen);
        if (save) { mine = []; matches = []; zone = -1; if (root) load(true); }
        paint();
    }
    function toggle(list, v) { var i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); return i < 0; }
    function teamIndex(s, id) { var l = setup.d.teams; for (var i = 0; i < l.length; i++) if (l[i].s === s && String(l[i].id) === String(id)) return i; return -1; }
    function stepLeagues() {
        var d = setup.d, out = [];
        SPORTS.forEach(function (sp) {
            if (d.sports.indexOf(sp.id) < 0) return;
            sp.leagues.forEach(function (lg) {
                if (kind(lg, "x") || (kind(lg, "w") ? !d.types.women : !d.types.men) || (kind(lg, "f") && !d.types.friendly)) return;
                out.push({ sp: sp, lg: lg, key: sp.id + "/" + lg[0] });
            });
        });
        return out;
    }
    function groupOf(x) { return x.lg[3] ? T(x.sp.label) + " · " + T(x.lg[3]) : T(x.sp.label); }
    /* Typing a search: the screen's letters (tvOS's line of keys) or the TV's own keyboard, results as you type */
    function typed(v) { setup.q = String(v || "").slice(0, 40); setup.keepAt = setup.nav ? setup.nav.index : 0; drawSetup(); }
    function tvKeys() {
        var before = setup.q;
        TV.editText({ value: setup.q || "", onInput: TV.debounce(function (v) { if (setup.open && setup.q !== null) typed(v); }, 350),
            onDone: function (v) { if (setup.open) typed(v); }, onCancel: function () { if (setup.open) typed(before); } });
    }
    var KEYS = "abcdefghijklmnopqrstuvwxyz";
    /* The choice, one screen per step. The list slides (tvOS): the focused line stays near the middle and the title
       goes up with the rest; the chips at the top jump straight to a country, a competition or the search. */
    function drawSetup(first) {
        var r = setup.el, d = setup.d, step = setup.step, tok = ++setup.tok;
        if (first) { setup.chipAt = -1; setup.q = null; setup.keepAt = -1; }
        var searching = setup.q !== null && step > 0;
        var TITLES = [[T("What do you follow?"), T("Your sports and the kind of matches. You can change all this later with ★ Favorites, at the top of Sports.")],
                      [T("Your competitions"), T("Sports shows only these. The ones followed most where you live are already ticked.")],
                      [T("Your clubs"), T("Their matches come first in My Teams, with their next match, even in another competition.")],
                      [T("Your national teams"), T("Their matches come first in My Teams too.")]];
        var FIND = ["", T("Find a competition"), T("Find a club"), T("Find a national team")];
        r.innerHTML = "";
        var inn = el("div", "sfav__in");
        r.appendChild(inn);
        var steps = el("div", "sfav__steps");
        [T("Sports"), T("Competitions"), T("Clubs"), T("National Teams")].forEach(function (s, i) {
            steps.appendChild(el("div", "sfav__step" + (i === step ? " is-on" : i < step ? " is-done" : ""), "<b>" + (i < step ? TV.icon("check", 20) : i + 1) + "</b>" + esc(s)));
        });
        inn.appendChild(steps);
        var frame = el("div", "sfav__grid"), list = el("div", "sfav__list"), foot = el("div", "sfav__foot");
        frame.appendChild(list); inn.appendChild(frame); inn.appendChild(foot);
        list.appendChild(el("h1", "sfav__title", esc(searching ? FIND[step] : TITLES[step][0])));
        if (searching) list.appendChild(el("div", "sfav__field", TV.icon("search", 34) + "<span>" + (setup.q ? esc(setup.q) : "<span class='sfav__ph'>" + esc(step === 1 ? T("A competition, a country") : step === 2 ? T("A club, a city") : T("A country")) + "</span>") + "<i class='caret'></i></span>"));
        else list.appendChild(el("p", "sfav__text", esc(TITLES[step][1])));
        var chipsEl = el("div", "sfav__chips" + (searching ? " sfav__kb" : "")), grid = el("div", "sfav__tiles");
        list.appendChild(chipsEl); list.appendChild(grid);
        setup.grid = grid; setup.list = list; setup.frame = frame; setup.frameH = 0; setup.y = 0; setup.lgTiles = {};
        var tiles = [], acts = [], chipTiles = [], firstOf = {};
        function tile(html, on, run, cls) {
            if (html.indexOf("sfav__sub") >= 0) cls = (cls ? cls + " " : "") + "has-sub";
            var t = el("div", "sfav__tile" + (cls ? " " + cls : "") + (on ? " is-on" : ""), html + "<span class='sfav__check'>" + TV.icon("check", 22) + "</span>");
            grid.appendChild(t); tiles.push(t);
            acts.push(function () { var now = run(); t.classList.toggle("is-on", !!now); TV.sound.select(); });
            return t;
        }
        function head(text) { if (firstOf[text] === undefined) firstOf[text] = tiles.length; grid.appendChild(el("div", "sfav__h", esc(text))); }
        function chip(html, on, run, cls) { var c = el("div", (cls || "chip") + (on ? " is-current" : ""), html); chipsEl.appendChild(c); chipTiles.push(c); tiles.push(c); acts.push(run); return c; }
        function art(u, size) { return "<i class='sfav__logo' style='background-image:" + esc(crestBg(u, size || 120)) + "'></i>"; }
        function name(text) { return "<span class='sfav__name'>" + esc(text) + "</span>"; }
        function sub(text) { return text ? "<span class='sfav__sub'>" + esc(text) + "</span>" : ""; }
        function empty(text) { grid.appendChild(el("div", "sfav__empty", esc(text))); }
        function waiting() { grid.appendChild(el("div", "sfav__empty is-spin", TV.spinner(64))); }
        function leagueTile(x, label) {
            var u = logos[x.key];
            setup.lgTiles[x.key] = tile((u ? art(u, 120) : "<i class='sfav__logo sfav__logo--icon'>" + sportIcon(x.sp.id) + "</i>") + name(T(x.lg[1])) + sub(label), d.leagues.indexOf(x.key) >= 0, function () {
                var on = toggle(d.leagues, x.key);
                // found by the search in a sport or a kind of matches not ticked yet: ticked with it
                if (on) { if (d.sports.indexOf(x.sp.id) < 0) d.sports.push(x.sp.id); if (kind(x.lg, "w")) d.types.women = 1; else d.types.men = 1; if (kind(x.lg, "f")) d.types.friendly = 1; }
                return on;
            });
        }
        function teamTile(t, s, l, nat, label) {
            tile(art(nat ? crest(t, s) : t.logo, 120) + name(shown(t, false)) + sub(label), teamIndex(s, t.id) >= 0, function () {
                var i = teamIndex(s, t.id);
                if (i >= 0) { d.teams.splice(i, 1); return false; }
                d.teams.push({ s: s, l: l, id: t.id, n: t.name, logo: t.logo, nat: nat ? 1 : 0 });
                if (d.sports.indexOf(s) < 0) d.sports.push(s);
                return true;
            });
        }
        function searchChip() { chip(TV.icon("search", 24) + "<span>" + esc(T("Search")) + "</span>", false, function () { TV.sound.select(); setup.q = ""; setup.keepAt = 0; drawSetup(); }, "chip sfav__find"); }
        function relist(fill, keep) { grid.innerHTML = ""; tiles.length = chipTiles.length; acts.length = chipTiles.length; fill(); finish(keep && setup.nav ? Math.min(setup.nav.index, chipTiles.length - 1) : startAt()); }

        if (searching) {
            KEYS.split("").forEach(function (k) { chip(k.toUpperCase(), false, function () { TV.sound.tick(); typed(setup.q + k); }, "sfav__key"); });
            chip(esc(T("Space")), false, function () { if (setup.q && setup.q.slice(-1) !== " ") typed(setup.q + " "); }, "sfav__key is-wide");
            chip("⌫", false, function () { typed(setup.q.slice(0, -1)); }, "sfav__key is-wide");
            chip(TV.icon("keyboard", 30), false, tvKeys, "sfav__key is-wide");
            var q = S.fold(setup.q || "").trim();
            if (q.length < 2) empty(T("Type at least two letters."));
            else if (step === 1) {
                // every competition of every sport: one found in a sport not ticked brings its sport along
                var hits = [];
                SPORTS.forEach(function (sp) {
                    sp.leagues.forEach(function (lg) {
                        if (kind(lg, "x")) return;
                        var x = { sp: sp, lg: lg, key: sp.id + "/" + lg[0] }, g = groupOf(x);
                        if (wordStart(T(lg[1]) + " " + lg[1] + " " + g, q)) { x.g = g; hits.push(x); }
                    });
                });
                hits.slice(0, 48).forEach(function (x) { leagueTile(x, x.g); });
                if (!hits.length) empty(T("No results for “{q}”", { q: setup.q }));
            } else {
                waiting();
                // a pause in the typing first: one request for the word, not one per letter
                setTimeout(function () {
                    if (tok !== setup.tok || !setup.open) return;
                    var jobs = [findTeams(setup.q)], sps = step === 3 ? ["soccer", "rugby"].filter(function (s) { return d.sports.indexOf(s) >= 0 || s === "soccer"; }) : [];
                    sps.forEach(function (s) { jobs.push(nationsOf(s).then(null, function () { return []; })); });
                    Promise.all(jobs).then(function (rs) {
                        if (tok !== setup.tok || !setup.open) return;
                        relist(function () {
                            var seen = {}, n = 0;
                            function put(t, s, l, nat, label) { var k = s + ":" + t.id; if (seen[k] || n >= 48) return; seen[k] = 1; n++; teamTile(t, s, l, nat, label); }
                            sps.forEach(function (s, i) { rs[i + 1].forEach(function (t) { if (wordStart(shown(t, true) + " " + t.name, q)) put(t, s, t.l, true, T(sportOf(s).label)); }); });
                            if (step === 2) Object.keys(teamCache).forEach(function (k) {
                                var s2 = k.split("/")[0], slug = k.slice(s2.length + 1), lgName = leagueName(s2, slug);
                                teamCache[k].forEach(function (t) { if (wordStart(t.name, q)) put(t, s2, k, false, T(sportOf(s2).label) + (lgName ? " · " + lgName : "")); });
                            });
                            rs[0].slice().sort(function (x, y) { return (d.sports.indexOf(x.s) < 0) - (d.sports.indexOf(y.s) < 0); }).forEach(function (t) {
                                if (!!t.nat !== (step === 3)) return;
                                var lgName = leagueName(t.s, t.l.split("/")[1]);
                                put(t, t.s, t.l, t.nat, T(sportOf(t.s).label) + (lgName ? " · " + lgName : ""));
                            });
                            if (!n) empty(T("No results for “{q}”", { q: setup.q }));
                        }, true);
                    });
                }, 400);
            }
        } else if (step === 0) {
            head(T("Sports"));
            SPORTS.forEach(function (sp) { tile("<i class='sfav__logo sfav__logo--icon'>" + sportIcon(sp.id) + "</i>" + name(T(sp.label)), d.sports.indexOf(sp.id) >= 0, function () { return toggle(d.sports, sp.id); }, "is-small"); });
            head(T("Matches"));
            [["men", T("Men's competitions")], ["women", T("Women's competitions")], ["friendly", T("Friendlies")]].forEach(function (x) {
                tile(name(x[1]), !!d.types[x[0]], function () { d.types[x[0]] = d.types[x[0]] ? 0 : 1; return !!d.types[x[0]]; }, "is-small is-text");
            });
        } else if (step === 1) {
            var all = stepLeagues(), groups = [], last = "";
            searchChip();
            // a chip per country or region, and per sport: straight to its competitions
            all.forEach(function (x) { var g = groupOf(x); if (g !== last) { last = g; groups.push([x.lg[3] ? T(x.lg[3]) : T(x.sp.label), g]); } });
            groups.forEach(function (gp) { chip(esc(gp[0]), false, function () { var at = firstOf[gp[1]]; if (at !== undefined && setup.nav) { TV.sound.tick(); setup.nav.focus(at); } }); });
            last = "";
            all.forEach(function (x) { var g = groupOf(x); if (g !== last) { last = g; head(g); } leagueTile(x, ""); });
            if (!all.length) empty(T("Choose a sport first."));
        } else {
            // Clubs: one competition at a time; national teams: football or rugby, by continent
            var opts = step === 2
                ? stepLeagues().filter(function (x) { return d.leagues.indexOf(x.key) >= 0 && !kind(x.lg, "i") && !kind(x.lg, "f"); }).map(function (x) { return { key: x.key, label: T(x.lg[1]), sp: x.sp.id, slug: x.lg[0] }; })
                : ["soccer", "rugby"].filter(function (s) { return d.sports.indexOf(s) >= 0; }).map(function (s) { return { key: s, label: T(sportOf(s).label), sp: s }; });
            var cur = opts.filter(function (o) { return o.key === setup.sub[step]; })[0] || opts[0];
            if (cur) setup.sub[step] = cur.key;
            searchChip();
            opts.forEach(function (o, i) { chip(esc(o.label), o === cur, function () { if (setup.sub[step] === o.key) return; setup.sub[step] = o.key; setup.chipAt = i + 1; TV.sound.select(); drawSetup(); }); });
            var n = d.teams.filter(function (t) { return step === 2 ? !t.nat : t.nat; }).length;
            if (n) chipsEl.appendChild(el("div", "sfav__count", esc(T("{n} chosen", { n: n }))));
            if (!cur) empty(step === 2 ? T("Choose a competition with clubs first, or search for a club.") : T("Football or rugby, first."));
            else {
                waiting();
                (step === 2 ? teamsOf(cur.sp, cur.slug) : nationsOf(cur.sp)).then(function (list2) {
                    if (tok !== setup.tok || !setup.open) return;
                    relist(function () {
                        var lastG = null;
                        list2.forEach(function (t) {
                            if (step === 3 && t.g !== lastG) { lastG = t.g; if (t.g) head(T(t.g)); }
                            teamTile(t, cur.sp, step === 2 ? cur.key : t.l, step === 3, "");
                        });
                        if (!list2.length) empty(T("The list can't be reached right now."));
                    });
                }, function () { if (tok === setup.tok) relist(function () { empty(T("The list can't be reached right now.")); }); });
            }
        }
        // Back, Later, Next / Done; Back (or ▲ at the top) goes straight to Continue, however long the list
        var btns = [];
        if (!searching) foot.appendChild(el("div", "sfav__hint", esc(T("Back: straight to “{b}”", { b: step < 3 ? T("Continue") : T("Done") }))));
        function btn(html, run, primary) { var b = el("div", "btn" + (primary ? " btn--primary" : ""), html); foot.appendChild(b); btns.push([b, run]); }
        if (searching) btn(esc(T("Back to the list")), function () { setup.q = null; drawSetup(); });
        else if (step > 0) btn(esc(T("Back")), function () { setup.step--; drawSetup(true); });
        else btn(esc(fav() && !fav().skipped ? T("Cancel") : T("Later")), function () { closeSetup(false); });
        if (step < 3) btn(esc(T("Continue")) + TV.icon("chevron", 26), function () { setup.step++; drawSetup(true); }, true);
        else btn(TV.icon("check", 26) + esc(T("Done")), function () { closeSetup(true); }, true);
        function finish(at) {
            var all2 = tiles.concat(btns.map(function (b) { return b[0]; })), runs = acts.concat(btns.map(function (b) { return b[1]; }));
            if (setup.nav) setup.nav.blur();            // the list arrived after the buttons: one focus only (seen on the M8)
            setup.acts = runs;
            setup.layout = layoutOf(all2);
            setup.nav = new TV.Nav({ onSelect: function (i) { if (runs[i]) runs[i](); }, onFocus: function (i, t) { inView(t, i); }, onKey: moveIn });
            setup.nav.setTiles(all2, Math.max(0, Math.min(at, all2.length - 1)));
            setupScreen.tiles = all2;                   // the mouse of the PC preview (nav.js)
        }
        // typing: the key just pressed; a competition just chosen: its chip; otherwise the first tile
        function startAt() {
            if (searching) return setup.keepAt >= 0 && setup.keepAt < chipTiles.length ? setup.keepAt : 0;
            return setup.chipAt >= 0 ? setup.chipAt : chipTiles.length < tiles.length ? chipTiles.length : 0;
        }
        finish(startAt());
    }
    /* Moving in the choice: rows read once per drawing (the chips, the grid's lines, the buttons), so a press costs no
       layout work (each press measured 100 to 200 ms on the M8 with the screen's own search), and ▼ goes through every
       line of the grid before the buttons. */
    function layoutOf(all) {
        var g = setup.grid, gl = setup.list.getBoundingClientRect().left, rows = [], at = [], tops = [], chips = [], cells = [], foot = [], line = null, top = null;
        all.forEach(function (t, i) { var p = t.parentNode; (p === g ? cells : p && p.classList && p.classList.contains("sfav__chips") ? chips : foot).push(i); });
        function edge(list) { if (!list.length) return; rows.push(list.map(function (i) { var r = all[i].getBoundingClientRect(); return { i: i, x: r.left + r.width / 2 }; })); }
        edge(chips);
        cells.forEach(function (i) {
            var t = all[i];
            if (top === null || Math.abs(t.offsetTop - top) > 20) { line = []; rows.push(line); top = t.offsetTop; }
            line.push({ i: i, x: gl + t.offsetLeft + t.offsetWidth / 2 });
            tops[i] = [t.offsetTop, t.offsetHeight];                         // the sliding list is the tiles' offsetParent
        });
        edge(foot);
        rows.forEach(function (r, ri) { r.forEach(function (p, ci) { at[p.i] = [ri, ci]; }); });
        setup.listH = setup.list.offsetHeight;
        return { rows: rows, at: at, tops: tops, foot: foot };
    }
    function moveIn(code) {
        var K = TV.KEY, n = setup.nav, L = setup.layout, p = L && n && L.at[n.index];
        if (!p) return false;
        var row = L.rows[p[0]];
        if (code === K.LEFT || code === K.RIGHT) {
            var c = p[1] + (code === K.LEFT ? -1 : 1);
            if (c < 0 || c >= row.length) { TV.sound.edge(); return true; }
            n.focus(row[c].i); TV.sound.tick();
            return true;
        }
        if (code === K.UP || code === K.DOWN) {
            var next = L.rows[p[0] + (code === K.UP ? -1 : 1)], x = row[p[1]].x, best = null, go = L.foot && L.foot[L.foot.length - 1];
            // ▲ at the very top: the buttons at the bottom (Continue), not the long way down
            if (!next && code === K.UP && go !== undefined && L.foot.indexOf(n.index) < 0) { n.focus(go); TV.sound.tick(); return true; }
            if (!next) { TV.sound.edge(); return true; }
            next.forEach(function (q) { if (!best || Math.abs(q.x - x) < Math.abs(best.x - x)) best = q; });
            n.focus(best.i); TV.sound.tick();
            return true;
        }
        return false;
    }
    // A competition's logo known only now (the first scores arrive while the choice is open)
    function logoLearned(key, href) {
        var t = setup.open && setup.lgTiles && setup.lgTiles[key], old = t && t.querySelector(".sfav__logo");
        if (!old) return;
        old.className = "sfav__logo";
        old.textContent = "";
        old.style.backgroundImage = crestBg(href, 120);
    }
    function inView(t, i) {
        var row = t.parentNode;
        // the chips (or the keys): the row slides sideways to show the one focused, the list back at its top
        if (row && row.classList && row.classList.contains("sfav__chips")) {
            var x = t.offsetLeft, w = t.offsetWidth, view = row.clientWidth;
            if (x - 60 < row.scrollLeft) row.scrollLeft = Math.max(0, x - 60);
            else if (x + w + 60 > row.scrollLeft + view) row.scrollLeft = x + w + 60 - view;
            slide(0);
            return;
        }
        if (!setup.list || row !== setup.grid) return;
        // where the tile is, measured once (layoutOf): its line near the middle of the frame
        var c = setup.layout && setup.layout.tops[i], top = c ? c[0] : t.offsetTop, h = c ? c[1] : t.offsetHeight;
        var frameH = setup.frameH || (setup.frameH = setup.frame.clientHeight);
        slide(top + h / 2 - frameH * 0.45);
    }
    function slide(y) {
        if (!setup.list) return;
        var frameH = setup.frameH || (setup.frameH = setup.frame.clientHeight), max = Math.max(0, (setup.listH || 0) - frameH);
        y = Math.round(Math.max(0, Math.min(max, y)));
        if (y === setup.y) return;
        setup.y = y;
        setup.list.style.transform = "translateY(" + (-y) + "px)";
    }
    var setupScreen = {
        key: function (code) {
            if (TV.isBack(code)) {
                // from the list, Back first goes to Continue (Done); pressed again there, it goes back as before
                var L = setup.layout, n = setup.nav, go = L && L.foot && L.foot[L.foot.length - 1];
                if (setup.q === null && n && go !== undefined && L.foot.indexOf(n.index) < 0) { n.focus(go); TV.sound.tick(); return; }
                if (setup.q !== null && setup.step > 0) { setup.q = null; drawSetup(); }
                else if (setup.step > 0) { setup.step--; drawSetup(true); }
                else closeSetup(false);
                return;
            }
            if (setup.nav) setup.nav.key(code);
        },
        ok: function () { if (setup.nav) setup.nav.ok(); },
        focus: function (i) { if (setup.nav) setup.nav.focus(i); },
        tiles: null
    };

    /* ---------- the calendar: any day, as in Apple's Calendar ----------
       A month at a time. Under a day, the logos of your competitions that play it (their ESPN calendars) and a star
       when one of your teams plays (their schedules). ◀ ▶ a day, ▲ ▼ a week, OK shows that day's matches. */
    function isCalDay() { return typeof dayOff === "number" && dayOff !== 0 && dayOff !== 1; }
    function shortDay(t) { try { return new Date(t).toLocaleDateString(TV.locale, { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return TV.dayName(new Date(t)); } }
    function dayKey(t) { var d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
    var cal = { open: false, el: null, at: 0, marks: {}, mine: {}, asked: 0 };
    function openCal() {
        if (cal.open) return;
        if (!cal.el) { cal.el = el("section", "scal"); document.body.appendChild(cal.el); }
        cal.open = true;
        cal.at = typeof dayOff === "number" ? dayStart(dayOff) : dayStart(dayOff === "next" ? 2 : dayOff === "past" ? -1 : 0);
        cal.el.classList.add("is-open");
        TV.pushNav(calScreen);
        drawCal();
        if (Date.now() - cal.asked > 600000) calMarks();
    }
    function closeCal(show) {
        cal.open = false;
        cal.el.classList.remove("is-open");
        TV.popNav(calScreen);
        if (show) {
            var off = Math.round((cal.at - dayStart(0)) / 86400000);
            if (off !== dayOff) { dayOff = off; matches = []; mine = []; zone = -1; load(true); }
            drawBar();
        }
        paint();
    }
    var calSoon = TV.debounce(function () { if (cal.open) drawCal(); }, 200);
    function calMarks() {
        cal.asked = Date.now(); cal.marks = {}; cal.mine = {};
        SPORTS.forEach(function (sp) {
            if (sp.all) return;
            sp.leagues.forEach(function (lg) {
                if (!follows(sp, lg)) return;
                var key = sp.id + "/" + lg[0];
                calendar(sp, lg).then(function (c) {
                    if (!c.days) return;
                    for (var d in c.days) (cal.marks[d] = cal.marks[d] || []).push(key);
                    calSoon();
                });
            });
        });
        // your teams' matches over the season: what comes, then what was played, and those already seen on the page
        Object.keys(store).forEach(function (k) {
            var m = store[k], d = dayKey(m.start), l;
            if (!isFavMatch(m)) return;
            l = cal.mine[d] = cal.mine[d] || [];
            if (!l.some(function (x) { return x.id === m.id; })) l.push(m);
        });
        // the last days: a match of last night is missing from ESPN's lists for hours (France - Italy); the
        // scoreboards of your teams' competitions have it
        function star(m) {
            if (!isFavMatch(m)) return;
            var d = dayKey(m.start), l = cal.mine[d] = cal.mine[d] || [];
            if (!l.some(function (x) { return x.id === m.id; })) { l.push(keep(m)); calSoon(); }
        }
        warmSchedules().then(function () {
            var from = dayStart(-4), to = dayStart(1), days = espnDaysIn(from, to);
            teamLeagues().forEach(function (x) {
                if (is365(x.lg)) { range365(x.sp, x.lg, from, to).then(function (l) { l.forEach(star); }, function () {}); return; }
                days.forEach(function (d) { league(x.sp, x.lg, d).then(function (l) { l.forEach(star); }, function () {}); });
            });
        });
        [false, true].forEach(function (past) {
            myTeams(dayStart(-90), dayStart(366), past).then(function (list) {
                list.forEach(function (m) {
                    var k = dayKey(m.start), l = cal.mine[k] = cal.mine[k] || [];
                    if (!l.some(function (x) { return x.id === m.id; })) l.push(keepSoft(m));
                });
                calSoon();
            });
        });
    }
    function drawCal(dir) {
        var at = new Date(cal.at), first = new Date(at.getFullYear(), at.getMonth(), 1), today0 = dayStart(0), shownT = isCalDay() || dayOff === 0 || dayOff === 1 ? dayStart(dayOff) : -1;
        var sundayFirst = /^en-us/i.test(TV.locale || "") || US, lead = (first.getDay() + 7 - (sundayFirst ? 0 : 1)) % 7, h = "";
        var month = first.toLocaleDateString(TV.locale, { month: "long", year: "numeric" });
        h += "<div class='scal__top'><h1>" + esc(month.charAt(0).toUpperCase() + month.slice(1)) + "</h1><span>" + esc(T("◀ ▶ a day, ▲ ▼ a week, OK shows it")) + "</span></div><div class='scal__grid'>";
        for (var w = 0; w < 7; w++) h += "<div class='scal__wd'>" + esc(new Date(first.getFullYear(), first.getMonth(), 1 - lead + w).toLocaleDateString(TV.locale, { weekday: "short" })) + "</div>";
        for (var i = 0; i < 42; i++) {
            var d = new Date(first.getFullYear(), first.getMonth(), 1 - lead + i), t = d.getTime();
            if (i === 35 && d.getMonth() !== first.getMonth()) break;            // five weeks are enough
            var ours = cal.mine[dayKey(t)] || [], comps = cal.marks[espnDay(t + 14 * 3600000)] || [], marks = "";
            comps.slice(0, 3).forEach(function (k) { marks += logos[k] ? "<i style='background-image:" + esc(crestBg(logos[k], 40)) + "'></i>" : "<b></b>"; });
            if (comps.length > 3) marks += "<em>+" + (comps.length - 3) + "</em>";
            h += "<div data-k='" + dayKey(t) + "' class='scal__day" + (d.getMonth() !== first.getMonth() ? " is-out" : "") + (t === today0 ? " is-today" : "") + (t === shownT ? " is-shown" : "") +
                 (t === cal.at ? " is-focused" : "") + (ours.length ? " is-ours" : "") + "'><span class='scal__n'>" + d.getDate() + "</span>" +
                 (ours.length ? "<span class='scal__star'>" + TV.icon("star", 22) + "</span>" : "") + "<span class='scal__marks'>" + marks + "</span></div>";
        }
        h += "</div>";
        h += "<div class='scal__info'>" + calInfo() + "</div>";
        cal.el.innerHTML = "<div class='scal__in" + (dir ? " is-" + dir : "") + "'>" + h + "</div>";
    }
    // the day focused, said in words
    function calInfo() {
        var mineThat = (cal.mine[dayKey(cal.at)] || []).slice().sort(byTime), compsThat = cal.marks[espnDay(cal.at + 14 * 3600000)] || [], lines = [];
        mineThat.slice(0, 3).forEach(function (m) { lines.push("<p class='is-ours'>" + TV.icon("star", 22) + esc(names2(m) + " · " + (m.state === "pre" ? TV.hhmm(m.start) : statusOf(m).text) + " · " + T(m.league[1])) + "</p>"); });
        if (compsThat.length) lines.push("<p>" + esc(compsThat.map(function (k) { var sp = sportOf(k.split("/")[0]), lg = sp && sp.leagues.filter(function (x) { return sp.id + "/" + x[0] === k; })[0]; return lg ? T(lg[1]) : ""; }).filter(Boolean).join(" · ")) + "</p>");
        if (!lines.length) lines.push("<p class='is-dim'>" + esc(T("No matches in your competitions that day.")) + "</p>");
        return "<h2>" + esc(longDay(cal.at)) + "</h2>" + lines.join("");
    }
    var calScreen = {
        key: function (code) {
            var K = TV.KEY;
            if (TV.isBack(code)) { TV.sound.tick(); closeCal(false); return; }
            var step = code === K.LEFT ? -1 : code === K.RIGHT ? 1 : code === K.UP ? -7 : code === K.DOWN ? 7 : 0;
            if (!step) return;
            var d = new Date(cal.at);
            d.setDate(d.getDate() + step);
            if (d.getTime() < dayStart(-90) || d.getTime() > dayStart(366)) { TV.sound.edge(); return; }
            var was = new Date(cal.at), sameMonth = was.getMonth() === d.getMonth() && was.getFullYear() === d.getFullYear();
            cal.at = d.getTime();
            TV.sound.tick();
            var old = cal.el.querySelector(".scal__day.is-focused"), now = cal.el.querySelector(".scal__day[data-k='" + dayKey(cal.at) + "']");
            if (sameMonth && now) {
                if (old) old.classList.remove("is-focused");
                now.classList.add("is-focused");
                var info = cal.el.querySelector(".scal__info");
                if (info) info.innerHTML = calInfo();
                return;
            }
            drawCal(step > 0 ? "next" : "prev");
        },
        ok: function () { TV.sound.select(); closeCal(true); },
        tiles: null
    };

    /* ---------- the tab ---------- */
    var view = {
        show: function () {
            document.body.classList.add("in-sports");
            if (!root) build();
            visible = true;
            TV.bg("");
            if (dayStart(0) !== today) { today = dayStart(0); matches = []; }
            if (!matches.length) load(true); else { load(false); drawBar(); paint(); }
            tick();
            if (TV.epg.loadAll) TV.epg.loadAll();
        },
        hide: function () { visible = false; tick(); document.body.classList.remove("in-rows"); document.body.classList.remove("in-sports"); },
        enter: function () {
            if (zone >= strips.length) zone = strips.length - 1;
            paint(true);
            if (!fav()) openSetup();                     // the first time: your favourites
        },
        blur: function () { zone = -1; paint(false); },
        key: function (code) {
            var K = TV.KEY;
            if (code === K.UP) { if (zone === -1) return false; zone--; TV.sound.tick(); paint(true); return true; }
            if (code === K.DOWN) { if (zone < strips.length - 1) { zone++; TV.sound.tick(); paint(true); } else TV.sound.edge(); return true; }
            if (code === K.LEFT || code === K.RIGHT) {
                if (zone === -1) chipNav.move(code === K.LEFT ? "left" : "right");
                else if (!strips[zone].move(code === K.LEFT ? -1 : 1)) TV.sound.edge();
                return true;
            }
            return false;
        },
        ok: function () {
            if (zone === -1) { chipNav.ok(); return; }
            if (strips[zone] && strips[zone].isHero) { strips[zone].nav.ok(); return; }
            var m = strips[zone] && strips[zone].current();
            if (m) { TV.sound.select(); openMatch(m); }
        }
    };
    TV.epg.onUpdate(function () { if (visible || sheet.open) findSoon(1500); });
    D.onChange(function () { langsCache = null; aliasMemo = {}; if (visible || sheet.open) findSoon(1500); });

    TV.views = TV.views || {};
    TV.views.sports = view;
    TV.sports = { open: openMatch, matches: function () { return matches; }, where: function (id) { return where[id]; } };
    /* Development builds: the test bench (other favourites, another country, a tab by name), nothing saved */
    if (TV.DEV) {
        TV.sports.test = function (o) {
            o = o || {};
            if (o.fav !== undefined) testFav = o.fav;
            if (o.cc !== undefined) { testCC = o.cc; rightsMemo = null; videos = {}; videoFound = {}; }
            if (o.reload) { matches = []; mine = []; zone = -1; if (root) { drawBar(); load(true); } }
            return "ok";
        };
        TV.sports.all = function () {
            var out = { sports: [], leagues: [] };
            SPORTS.forEach(function (sp) { out.sports.push(sp.id); sp.leagues.forEach(function (lg) { if (!kind(lg, "x")) out.leagues.push(sp.id + "/" + lg[0]); }); });
            return out;
        };
        // the days' chips, then the sports of the list (one chip for them now): the bench walks through them all
        TV.sports.chips = function () {
            var out = chipDefs.filter(function (d) { return !d.sports; }).map(function (d) { return d.label; });
            if (chipDefs.some(function (d) { return d.sports; })) { out.push(T("All Sports")); SPORTS.forEach(function (sp) { if (count(sp.id) > 0) out.push(T(sp.label)); }); }
            return out;
        };
        TV.sports.chip = function (label) {
            for (var i = 0; i < chipDefs.length; i++) if (!chipDefs[i].sports && chipDefs[i].label === label) { pick(chipDefs[i]); chipNav.focus(i); return "ok"; }
            if (label === T("All Sports")) { chooseSport("all"); return "ok"; }
            for (var j = 0; j < SPORTS.length; j++) if (T(SPORTS[j].label) === label && count(SPORTS[j].id) > 0) { chooseSport(SPORTS[j].id); return "ok"; }
            return "no " + label;
        };
        TV.sports.state = function () {
            return { day: dayOff, sport: sportId, zone: zone, n: matches.length, mine: mine.length, rows: strips.map(function (s) { return s.isHero ? "hero" : s.key + ":" + s.items.length; }),
                     loading: loading, open: sheet.open, tab: sheet.tab, video: sheet.m ? (videoFound[sheet.m.id] ? videoFound[sheet.m.id].channel : null) : null };
        };
        TV.sports.find = function (id) { return store[id] || null; };
        TV.sports.close = function () { if (sheet.open) closeMatch(); if (cal.open) closeCal(); return "ok"; };
    }
})(window);
