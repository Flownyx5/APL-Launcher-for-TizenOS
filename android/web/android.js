/* ============================================================
   android.js — APL Launcher on Android TV and Google TV.

   The Android app (android/, MainActivity.kt) shows the launcher's page
   in a WebView and gives it window.APLAndroid (Bridge.kt). This file,
   added to the page by tools/make-android.py (never on Samsung), turns
   the launcher's Samsung calls into Android ones:
     the apps (names, icons, TV banners), opening them, deleting them;
     sound, network, device, storage, picture size;
     the TV's HDMI inputs, for Sources (Google TV and Android TV televisions);
     the remote (Samsung's key codes, sent by Android), Home, typing;
     sleep and the Sleep Timer (accessibility service, KeyService.kt);
     Settings and the Control Center: what Android can't do without root
     (picture, Game Mode, Samsung's services…) is left out, Android's own
     screens are offered instead.
   It runs after the launcher's modules and before launcher.js starts.
   The Control Center over other apps (cc.html) uses it too ("overlay").
   ES5, like the rest of the launcher.
   ============================================================ */
(function (global) {
    "use strict";

    var B = global.APLAndroid;
    if (!B) return;
    var APL = global.APL, sys = APL.sys;
    var OVERLAY = !!(B.overlay && B.overlay());

    function json(s, d) { try { var v = JSON.parse(s); return v === null || v === undefined ? d : v; } catch (e) { return d; } }
    var info = json(B.info(), {});
    function fresh() { info = json(B.info(), info); return info; }

    /* ---------- French for what only Android says ---------- */
    var FR = global.APL_LANG_FR;
    if (FR) {
        var add = {
            "This needs root on Android.": "Il faut le root sur Android.",
            "Turn on APL Launcher Home Button first (Settings › Android TV).": "Activez d'abord APL Launcher Home Button (Réglages › Android TV).",
            "Install APL Launcher Home Button first (Settings › Android TV).": "Installez d'abord APL Launcher Home Button (Réglages › Android TV).",
            "Get APL Launcher Home Button": "Obtenir APL Launcher Home Button",
            "Not installed": "Pas installé",
            "Home, holding Home and ⏯ over every app need a small second app, APL Launcher Home Button. It is separate because Google Play Protect blocks any app installed outside the Play Store that uses Accessibility.":
                "Accueil, l'appui long sur Accueil et ⏯ par-dessus les apps demandent une petite seconde app, APL Launcher Home Button. Elle est à part car Google Play Protect bloque toute app installée hors du Play Store qui utilise l'accessibilité.",
            "To install it: in the Play Store, open your profile › Settings › Play Protect and turn off “Scan apps with Play Protect”. Open the address below in Downloader and install it, then turn Play Protect back on. From a PC: adb install. Then turn it on in Accessibility.":
                "Pour l'installer : dans le Play Store, ouvrez votre profil › Paramètres › Play Protect et désactivez « Analyser les applications avec Play Protect ». Ouvrez l'adresse ci-dessous dans Downloader et installez-la, puis réactivez Play Protect. Depuis un PC : adb install. Ensuite, activez-la dans Accessibilité.",
            "Open Downloader": "Ouvrir Downloader",
            "Downloader code": "Code Downloader",
            "The Control Center over the app in front needs “draw over other apps”. Without it, holding Home opens the launcher with its Control Center. From a PC: adb shell appops set com.knikt.apllauncher SYSTEM_ALERT_WINDOW allow":
                "Le Centre de contrôle par-dessus l'app au premier plan demande « superposition sur d'autres applis ». Sans elle, un appui long sur Accueil ouvre le launcher avec son Centre de contrôle. Depuis un PC : adb shell appops set com.knikt.apllauncher SYSTEM_ALERT_WINDOW allow",
            "Allow Over Other Apps": "Autoriser la superposition",
            "Not allowed": "Non autorisé",
            "This device has no HDMI inputs.": "Cet appareil n'a pas d'entrée HDMI.",
            "This TV has no {port} input.": "Ce téléviseur n'a pas d'entrée {port}.",
            "Android couldn't open {port}.": "Android n'a pas pu ouvrir l'entrée {port}.",
            "Not used on Android": "Pas utilisé sur Android",
            "Android TV": "Android TV",
            "Google TV": "Google TV",
            "Home App": "App d'accueil",
            "Make APL Launcher the Home App": "Faire d'APL Launcher l'app d'accueil",
            "The app Home on the remote opens, and the one the device starts on.": "L'app qu'ouvre le bouton Accueil de la télécommande, et celle sur laquelle l'appareil démarre.",
            "Android asks which app to use: choose APL Launcher. If nothing opens, docs/android.md has the adb command.":
                "Android demande quelle app utiliser : choisissez APL Launcher. Si rien ne s'ouvre, docs/android.md donne la commande adb.",
            "APL Launcher is already the Home app.": "APL Launcher est déjà l'app d'accueil.",
            "This device has no setting for it: see docs/android.md (adb).": "Cet appareil n'a pas ce réglage : voir docs/android.md (adb).",
            "Remote Buttons": "Touches de la télécommande",
            "Turn On the Remote Buttons": "Activer les touches de la télécommande",
            "In Accessibility, choose APL Launcher Home Button and turn it on. Then Home opens APL Launcher, holding Home or ⏯ opens the Control Center over any app, and Sleep and the Sleep Timer work.":
                "Dans Accessibilité, choisissez APL Launcher Home Button et activez-le. Accueil ouvre alors APL Launcher, l'appui long sur Accueil ou ⏯ ouvre le Centre de contrôle par-dessus n'importe quelle app, et la veille et la minuterie marchent.",
            "Home Button": "Bouton Accueil",
            "Android TV and Google TV keep their own launcher on the Home button, even once APL Launcher is chosen. APL Launcher: the remote buttons (Accessibility) take it and open APL Launcher.":
                "Android TV et Google TV gardent leur propre launcher sur le bouton Accueil, même quand APL Launcher est choisi. APL Launcher : les touches de la télécommande (Accessibilité) le prennent et ouvrent APL Launcher.",
            "Android chose APL Launcher, but this device keeps its own launcher on Home: turn on the remote buttons below.":
                "Android a choisi APL Launcher, mais cet appareil garde son propre launcher sur Accueil : activez les touches de la télécommande, juste en dessous.",
            "Over Apps": "Sur les apps",
            "Accessibility": "Accessibilité",
            "Allowed": "Autorisé",
            "Root": "Root",
            "Not needed": "Pas nécessaire",
            "Found, not used": "Présent, pas utilisé",
            "APL Launcher works without root. With root, a later version could close every app and reach deeper settings.":
                "APL Launcher marche sans root. Avec le root, une version future pourrait fermer toutes les apps et atteindre des réglages plus profonds.",
            "Setup guide: github.com/Knikt/APL-Launcher, docs/android.md.": "Guide d'installation : github.com/Knikt/APL-Launcher, docs/android.md.",
            "Home app, remote buttons, the Control Center over apps.": "App d'accueil, touches de la télécommande, Centre de contrôle sur les apps.",
            "Android Settings": "Réglages Android",
            "Android's own settings: Wi-Fi, picture, sound, date, language, accounts, apps, reset.": "Les réglages d'Android : Wi-Fi, image, son, date, langue, comptes, apps, réinitialisation.",
            "Picture Settings": "Réglages de l'image",
            "The device's picture settings, in Android.": "Les réglages de l'image de l'appareil, dans Android.",
            "Sound Settings": "Réglages du son",
            "Sound output, surround and the device's sound settings, in Android.": "Sortie audio, son surround et réglages du son de l'appareil, dans Android.",
            "Remotes and Accessories": "Télécommandes et accessoires",
            "Bluetooth headphones, speakers, game controllers and remotes, in Android.": "Casques, enceintes, manettes et télécommandes Bluetooth, dans Android.",
            "Network Settings": "Réglages du réseau",
            "Wi-Fi and Ethernet, in Android.": "Wi-Fi et Ethernet, dans Android.",
            "Manage Apps": "Gérer les apps",
            "Storage, permissions, force stop, in Android.": "Stockage, autorisations, forcer l'arrêt, dans Android.",
            "An app left in the background for more than 10 minutes is closed by Android (through the remote buttons, Accessibility). The app in front, music playing in the background and the launcher are never closed.":
                "Une app restée plus de 10 minutes en arrière-plan est fermée par Android (par les touches de la télécommande, Accessibilité). L'app au premier plan, la musique en arrière-plan et le launcher ne sont jamais fermés.",
            "Asks Android to close the apps left in the background. They reopen normally, but start over from the beginning.":
                "Demande à Android de fermer les apps laissées en arrière-plan. Elles se rouvrent normalement, mais repartent du début.",
            "When an app closes, or the device starts, APL Launcher instead of the device's own home screen. Needs the remote buttons (Accessibility).":
                "Quand une app se ferme, ou au démarrage de l'appareil, APL Launcher plutôt que l'écran d'accueil de l'appareil. Il faut les touches de la télécommande (Accessibilité).",
            "About This Device": "À propos de cet appareil",
            "Android Version": "Version d'Android",
            "Updates come with a new APK, from the GitHub releases.": "Les mises à jour arrivent avec un nouvel APK, depuis les versions sur GitHub.",
            "{mb} MB freed": "{mb} Mo libérés",
            "Nothing to free: the apps in the background were already closed.": "Rien à libérer : les apps en arrière-plan étaient déjà fermées.",
            "Opens the device's own home screen ({name}). Press Home to come back.": "Ouvre l'écran d'accueil de l'appareil ({name}). Appuyez sur Accueil pour revenir.",
            "Home Screen of the device": "Accueil de l'appareil",
            "Ethernet": "Ethernet",
            "Up Next": "À suivre",
            "Continue Watching from the apps that fill Android TV's Play Next row (Nuvio, YouTube, Plex…), as cards over the Top Shelf. Android asks once to let APL Launcher read it.":
                "Le « Continuer de regarder » des apps qui remplissent la rangée « À suivre » d'Android TV (Nuvio, YouTube, Plex…), en cartes au-dessus du Top Shelf. Android demande une fois d'autoriser APL Launcher à la lire.",
            "Make APL Launcher Your Home Screen?": "Faire d'APL Launcher votre écran d'accueil ?",
            "So that the remote's Home button and the device's start-up open APL Launcher. Android then asks which app to use: choose APL Launcher, then Set as default.":
                "Pour que le bouton Accueil de la télécommande et le démarrage de l'appareil ouvrent APL Launcher. Android demande ensuite quelle app utiliser : choisissez APL Launcher, puis Définir par défaut.",
            "Continue": "Continuer",
            "Later": "Plus tard",
            "One More Step: the Remote Buttons": "Encore une étape : les touches de la télécommande",
            "This device keeps its own home screen on the Home button, even once APL Launcher is chosen. In Accessibility, choose APL Launcher Home Button and turn it on: Home then opens APL Launcher, and holding Home opens the Control Center over any app. Android then shows its usual warning about accessibility services: the module only sees the remote's buttons and which app is in front, and sends nothing anywhere.":
                "Cet appareil garde son propre écran d'accueil sur le bouton Accueil, même quand APL Launcher est choisi. Dans Accessibilité, choisissez APL Launcher Home Button et activez-le : Accueil ouvre alors APL Launcher, et un appui long sur Accueil ouvre le Centre de contrôle par-dessus n'importe quelle app. Android affiche alors son avertissement habituel sur l'accessibilité : le module ne voit que les touches de la télécommande et l'app au premier plan, et n'envoie rien nulle part.",
            "Open Accessibility": "Ouvrir Accessibilité",
            "All set: Home now opens APL Launcher.": "C'est prêt : le bouton Accueil ouvre maintenant APL Launcher.",
            "Not yet: in Accessibility, choose APL Launcher Home Button and turn it on. Settings › Android TV has it too.":
                "Pas encore : dans Accessibilité, choisissez APL Launcher Home Button et activez-le. C'est aussi dans Réglages › Android TV.",
            "Other": "Autre",
            "Type the key, then OK. The Google TV app on your phone can type it too. Back to cancel.":
                "Tapez la clé, puis OK. L'app Google TV de votre téléphone peut aussi la taper. Retour pour annuler.",
            "Saved: the Top Shelf uses it now.": "Enregistrée : le Top Shelf l'utilise maintenant.",
            "This doesn't look like a key.": "Ça ne ressemble pas à une clé.",
            "TMDB refused this key: check it on themoviedb.org.": "TMDB refuse cette clé : vérifiez-la sur themoviedb.org.",
            "Films and series in What's Popular. Free on themoviedb.org › Settings › API (API Key). OK to type it.":
                "Films et séries dans Ce qui est populaire. Gratuite sur themoviedb.org › Paramètres › API (clé d'API). OK pour la taper.",
            "Optional: trending videos in YouTube's Top Shelf (YouTube Data API v3, console.cloud.google.com). OK to type it.":
                "Optionnelle : vidéos tendance dans le Top Shelf de YouTube (YouTube Data API v3, console.cloud.google.com). OK pour la taper.",
            "Optional: HD backgrounds for movies and shows (fanart.tv › your profile › API Key). OK to type it.":
                "Optionnelle : fonds HD des films et séries (fanart.tv › votre profil › API Key). OK pour la taper.",
            "The keys are kept on this device. Type them here, or APL Launcher Setup sends them from the PC.":
                "Les clés restent sur cet appareil. Tapez-les ici, ou APL Launcher Setup les envoie depuis le PC.",
            "Remove the Typed Keys": "Effacer les clés tapées",
            "The Top Shelf goes back to the keys in the app, if it has any.": "Le Top Shelf revient aux clés de l'app, si elle en a.",
            "Keys removed.": "Clés effacées."
        };
        for (var k in add) if (Object.prototype.hasOwnProperty.call(add, k) && !Object.prototype.hasOwnProperty.call(FR, k)) FR[k] = add[k];
    }
    /* ---------- Polish for what only Android says (the same texts as the French above) ---------- */
    var PL = global.APL_LANG_PL;
    if (PL) {
        var addPl = {
            "This needs root on Android.": "To wymaga roota na Androidzie.",
            "Turn on APL Launcher Home Button first (Settings › Android TV).": "Najpierw włącz APL Launcher Home Button (Ustawienia › Android TV).",
            "Install APL Launcher Home Button first (Settings › Android TV).": "Najpierw zainstaluj APL Launcher Home Button (Ustawienia › Android TV).",
            "Get APL Launcher Home Button": "Pobierz APL Launcher Home Button",
            "Not installed": "Nie zainstalowano",
            "Home, holding Home and ⏯ over every app need a small second app, APL Launcher Home Button. It is separate because Google Play Protect blocks any app installed outside the Play Store that uses Accessibility.":
                "Przycisk Home, przytrzymanie Home i ⏯ nad każdą aplikacją wymagają drugiej, małej aplikacji: APL Launcher Home Button. Jest osobna, bo Google Play Protect blokuje każdą aplikację spoza Sklepu Play, która korzysta z ułatwień dostępu.",
            "To install it: in the Play Store, open your profile › Settings › Play Protect and turn off “Scan apps with Play Protect”. Open the address below in Downloader and install it, then turn Play Protect back on. From a PC: adb install. Then turn it on in Accessibility.":
                "Aby ją zainstalować: w Sklepie Play otwórz swój profil › Ustawienia › Play Protect i wyłącz „Skanuj aplikacje za pomocą Play Protect”. Otwórz poniższy adres w aplikacji Downloader i zainstaluj ją, a potem ponownie włącz Play Protect. Z komputera: adb install. Na koniec włącz ją w ustawieniach Ułatwienia dostępu.",
            "Open Downloader": "Otwórz Downloader",
            "Downloader code": "Kod do aplikacji Downloader",
            "The Control Center over the app in front needs “draw over other apps”. Without it, holding Home opens the launcher with its Control Center. From a PC: adb shell appops set com.knikt.apllauncher SYSTEM_ALERT_WINDOW allow":
                "Centrum sterowania nad aplikacją na pierwszym planie wymaga uprawnienia „Wyświetlanie nad innymi aplikacjami”. Bez niego przytrzymanie Home otwiera launcher z jego Centrum sterowania. Z komputera: adb shell appops set com.knikt.apllauncher SYSTEM_ALERT_WINDOW allow",
            "Allow Over Other Apps": "Zezwól na wyświetlanie nad innymi aplikacjami",
            "Not allowed": "Niedozwolone",
            "This device has no HDMI inputs.": "To urządzenie nie ma wejść HDMI.",
            "This TV has no {port} input.": "Ten telewizor nie ma wejścia {port}.",
            "Android couldn't open {port}.": "Android nie mógł otworzyć wejścia {port}.",
            "Not used on Android": "Nieużywane na Androidzie",
            "Android TV": "Android TV",
            "Google TV": "Google TV",
            "Home App": "Aplikacja ekranu głównego",
            "Make APL Launcher the Home App": "Ustaw APL Launcher jako aplikację ekranu głównego",
            "The app Home on the remote opens, and the one the device starts on.": "Aplikacja, którą otwiera przycisk Home na pilocie i od której urządzenie zaczyna po włączeniu.",
            "Android asks which app to use: choose APL Launcher. If nothing opens, docs/android.md has the adb command.":
                "Android zapyta, której aplikacji użyć: wybierz APL Launcher. Jeśli nic się nie otworzy, polecenie adb znajdziesz w docs/android.md.",
            "APL Launcher is already the Home app.": "APL Launcher jest już aplikacją ekranu głównego.",
            "This device has no setting for it: see docs/android.md (adb).": "To urządzenie nie ma takiego ustawienia: zobacz docs/android.md (adb).",
            "Remote Buttons": "Przyciski pilota",
            "Turn On the Remote Buttons": "Włącz przyciski pilota",
            "In Accessibility, choose APL Launcher Home Button and turn it on. Then Home opens APL Launcher, holding Home or ⏯ opens the Control Center over any app, and Sleep and the Sleep Timer work.":
                "W ustawieniach Ułatwienia dostępu wybierz APL Launcher Home Button i włącz tę usługę. Wtedy Home otwiera APL Launcher, przytrzymanie Home lub ⏯ otwiera Centrum sterowania nad każdą aplikacją, a uśpienie i wyłącznik czasowy działają.",
            "Home Button": "Przycisk Home",
            "Android TV and Google TV keep their own launcher on the Home button, even once APL Launcher is chosen. APL Launcher: the remote buttons (Accessibility) take it and open APL Launcher.":
                "Android TV i Google TV zostawiają na przycisku Home własny launcher, nawet gdy wybrano APL Launcher. APL Launcher: przyciski pilota (Ułatwienia dostępu) przejmują go i otwierają APL Launcher.",
            "Android chose APL Launcher, but this device keeps its own launcher on Home: turn on the remote buttons below.":
                "Android wybrał APL Launcher, ale to urządzenie zostawia na przycisku Home własny launcher: włącz przyciski pilota poniżej.",
            "Over Apps": "Nad aplikacjami",
            "Accessibility": "Ułatwienia dostępu",
            "Allowed": "Dozwolone",
            "Root": "Root",
            "Not needed": "Niepotrzebny",
            "Found, not used": "Wykryty, nieużywany",
            "APL Launcher works without root. With root, a later version could close every app and reach deeper settings.":
                "APL Launcher działa bez roota. Z rootem przyszła wersja mogłaby zamykać wszystkie aplikacje i sięgać do głębszych ustawień.",
            "Setup guide: github.com/Knikt/APL-Launcher, docs/android.md.": "Instrukcja instalacji: github.com/Knikt/APL-Launcher, docs/android.md.",
            "Home app, remote buttons, the Control Center over apps.": "Aplikacja ekranu głównego, przyciski pilota, Centrum sterowania nad aplikacjami.",
            "Android Settings": "Ustawienia Androida",
            "Android's own settings: Wi-Fi, picture, sound, date, language, accounts, apps, reset.": "Własne ustawienia Androida: Wi-Fi, obraz, dźwięk, data, język, konta, aplikacje, resetowanie.",
            "Picture Settings": "Ustawienia obrazu",
            "The device's picture settings, in Android.": "Ustawienia obrazu urządzenia, w Androidzie.",
            "Sound Settings": "Ustawienia dźwięku",
            "Sound output, surround and the device's sound settings, in Android.": "Wyjście dźwięku, dźwięk przestrzenny i ustawienia dźwięku urządzenia, w Androidzie.",
            "Remotes and Accessories": "Piloty i akcesoria",
            "Bluetooth headphones, speakers, game controllers and remotes, in Android.": "Słuchawki, głośniki, kontrolery do gier i piloty Bluetooth, w Androidzie.",
            "Network Settings": "Ustawienia sieci",
            "Wi-Fi and Ethernet, in Android.": "Wi-Fi i Ethernet, w Androidzie.",
            "Manage Apps": "Zarządzaj aplikacjami",
            "Storage, permissions, force stop, in Android.": "Pamięć, uprawnienia, wymuszanie zatrzymania, w Androidzie.",
            "An app left in the background for more than 10 minutes is closed by Android (through the remote buttons, Accessibility). The app in front, music playing in the background and the launcher are never closed.":
                "Aplikację pozostawioną w tle dłużej niż 10 minut zamyka Android (za pomocą przycisków pilota, Ułatwienia dostępu). Aplikacja na pierwszym planie, muzyka grająca w tle i launcher nigdy nie są zamykane.",
            "Asks Android to close the apps left in the background. They reopen normally, but start over from the beginning.":
                "Prosi Androida o zamknięcie aplikacji pozostawionych w tle. Otwierają się normalnie, ale zaczynają od początku.",
            "When an app closes, or the device starts, APL Launcher instead of the device's own home screen. Needs the remote buttons (Accessibility).":
                "Po zamknięciu aplikacji lub po uruchomieniu urządzenia pojawia się APL Launcher zamiast ekranu głównego urządzenia. Wymaga przycisków pilota (Ułatwienia dostępu).",
            "About This Device": "Informacje o tym urządzeniu",
            "Android Version": "Wersja Androida",
            "Updates come with a new APK, from the GitHub releases.": "Aktualizacje przychodzą jako nowy plik APK z wydań na GitHubie.",
            "{mb} MB freed": "Zwolniono {mb} MB",
            "Nothing to free: the apps in the background were already closed.": "Nie ma czego zwalniać: aplikacje w tle były już zamknięte.",
            "Opens the device's own home screen ({name}). Press Home to come back.": "Otwiera ekran główny urządzenia ({name}). Naciśnij Home, aby wrócić.",
            "Home Screen of the device": "Ekran główny urządzenia",
            "Ethernet": "Ethernet",
            "Up Next": "Następne",
            "Continue Watching from the apps that fill Android TV's Play Next row (Nuvio, YouTube, Plex…), as cards over the Top Shelf. Android asks once to let APL Launcher read it.":
                "„Kontynuuj oglądanie” z aplikacji, które wypełniają rząd Play Next na Androidzie TV (Nuvio, YouTube, Plex…), jako karty nad Top Shelf. Android jednorazowo poprosi o zgodę, aby APL Launcher mógł go odczytać.",
            "Make APL Launcher Your Home Screen?": "Ustawić APL Launcher jako ekran główny?",
            "So that the remote's Home button and the device's start-up open APL Launcher. Android then asks which app to use: choose APL Launcher, then Set as default.":
                "Aby przycisk Home na pilocie i uruchomienie urządzenia otwierały APL Launcher. Android zapyta wtedy, której aplikacji użyć: wybierz APL Launcher i ustaw go jako domyślny.",
            "Continue": "Dalej",
            "Later": "Później",
            "One More Step: the Remote Buttons": "Jeszcze jeden krok: przyciski pilota",
            "This device keeps its own home screen on the Home button, even once APL Launcher is chosen. In Accessibility, choose APL Launcher Home Button and turn it on: Home then opens APL Launcher, and holding Home opens the Control Center over any app. Android then shows its usual warning about accessibility services: the module only sees the remote's buttons and which app is in front, and sends nothing anywhere.":
                "To urządzenie zostawia na przycisku Home własny ekran główny, nawet gdy wybrano APL Launcher. W ustawieniach Ułatwienia dostępu wybierz APL Launcher Home Button i włącz tę usługę: Home będzie wtedy otwierać APL Launcher, a przytrzymanie Home – Centrum sterowania nad każdą aplikacją. Android pokaże swoje zwykłe ostrzeżenie o usługach ułatwień dostępu: moduł widzi tylko przyciski pilota i to, która aplikacja jest na pierwszym planie, i niczego nigdzie nie wysyła.",
            "Open Accessibility": "Otwórz Ułatwienia dostępu",
            "All set: Home now opens APL Launcher.": "Gotowe: przycisk Home otwiera teraz APL Launcher.",
            "Not yet: in Accessibility, choose APL Launcher Home Button and turn it on. Settings › Android TV has it too.":
                "Jeszcze nie: w ustawieniach Ułatwienia dostępu wybierz APL Launcher Home Button i włącz tę usługę. Ta opcja jest też w menu Ustawienia › Android TV.",
            "Other": "Inne",
            "Type the key, then OK. The Google TV app on your phone can type it too. Back to cancel.":
                "Wpisz klucz, a potem naciśnij OK. Możesz go też wpisać w aplikacji Google TV na telefonie. Wstecz: anuluj.",
            "Saved: the Top Shelf uses it now.": "Zapisano: Top Shelf już z niego korzysta.",
            "This doesn't look like a key.": "To nie wygląda na klucz.",
            "TMDB refused this key: check it on themoviedb.org.": "Serwis TMDB odrzucił ten klucz: sprawdź go na themoviedb.org.",
            "Films and series in What's Popular. Free on themoviedb.org › Settings › API (API Key). OK to type it.":
                "Filmy i seriale w sekcji Popularne. Bezpłatny na themoviedb.org › Settings › API (API Key). OK, aby go wpisać.",
            "Optional: trending videos in YouTube's Top Shelf (YouTube Data API v3, console.cloud.google.com). OK to type it.":
                "Opcjonalny: popularne wideo w Top Shelf YouTube (YouTube Data API v3, console.cloud.google.com). OK, aby go wpisać.",
            "Optional: HD backgrounds for movies and shows (fanart.tv › your profile › API Key). OK to type it.":
                "Opcjonalny: tła HD do filmów i seriali (fanart.tv › Twój profil › API Key). OK, aby go wpisać.",
            "The keys are kept on this device. Type them here, or APL Launcher Setup sends them from the PC.":
                "Klucze są przechowywane na tym urządzeniu. Wpisz je tutaj albo wyślij z komputera przez APL Launcher Setup.",
            "Remove the Typed Keys": "Usuń wpisane klucze",
            "The Top Shelf goes back to the keys in the app, if it has any.": "Top Shelf wróci do kluczy wbudowanych w aplikację, jeśli takie są.",
            "Keys removed.": "Usunięto klucze."
        };
        for (var kp in addPl) if (Object.prototype.hasOwnProperty.call(addPl, kp) && !Object.prototype.hasOwnProperty.call(PL, kp)) PL[kp] = addPl[kp];
    }
    /* ---------- Turkish for what only Android says (#67: the same texts as the French above) ---------- */
    var TR = global.APL_LANG_TR;
    if (TR) {
        var addTr = {
            "This needs root on Android.": "Bunun için Android'de root gerekir.",
            "Turn on APL Launcher Home Button first (Settings › Android TV).": "Önce APL Launcher Home Button'ı aç (Ayarlar › Android TV).",
            "Install APL Launcher Home Button first (Settings › Android TV).": "Önce APL Launcher Home Button'ı yükle (Ayarlar › Android TV).",
            "Get APL Launcher Home Button": "APL Launcher Home Button'ı edin",
            "Not installed": "Yüklü değil",
            "Home, holding Home and ⏯ over every app need a small second app, APL Launcher Home Button. It is separate because Google Play Protect blocks any app installed outside the Play Store that uses Accessibility.": "Home, Home'a basılı tutma ve tüm uygulamaların üzerinde ⏯ için küçük ikinci bir uygulama gerekir: APL Launcher Home Button. Ayrı bir uygulamadır, çünkü Google Play Protect, Play Store dışından yüklenen ve Erişilebilirlik kullanan her uygulamayı engeller.",
            "To install it: in the Play Store, open your profile › Settings › Play Protect and turn off “Scan apps with Play Protect”. Open the address below in Downloader and install it, then turn Play Protect back on. From a PC: adb install. Then turn it on in Accessibility.": "Yüklemek için: Play Store'da profilin › Ayarlar › Play Protect'i aç ve “Uygulamaları Play Protect ile tara” seçeneğini kapat. Aşağıdaki adresi Downloader'da açıp yükle, sonra Play Protect'i yeniden aç. Bilgisayardan: adb install. Ardından Erişilebilirlik'te aç.",
            "Open Downloader": "Downloader'ı aç",
            "Downloader code": "Downloader kodu",
            "The Control Center over the app in front needs “draw over other apps”. Without it, holding Home opens the launcher with its Control Center. From a PC: adb shell appops set com.knikt.apllauncher SYSTEM_ALERT_WINDOW allow": "Öndeki uygulamanın üzerinde Kontrol Merkezi için “diğer uygulamaların üzerinde göster” izni gerekir. Bu izin olmadan Home'a basılı tutmak launcher'ı Kontrol Merkezi ile açar. Bilgisayardan: adb shell appops set com.knikt.apllauncher SYSTEM_ALERT_WINDOW allow",
            "Allow Over Other Apps": "Diğer uygulamaların üzerinde göstermeye izin ver",
            "Not allowed": "İzin verilmedi",
            "This device has no HDMI inputs.": "Bu aygıtta HDMI girişi yok.",
            "This TV has no {port} input.": "Bu TV'de {port} girişi yok.",
            "Android couldn't open {port}.": "Android {port} girişini açamadı.",
            "Not used on Android": "Android'de kullanılmaz",
            "Android TV": "Android TV",
            "Google TV": "Google TV",
            "Home App": "Ana ekran uygulaması",
            "Make APL Launcher the Home App": "APL Launcher'ı ana ekran uygulaması yap",
            "The app Home on the remote opens, and the one the device starts on.": "Kumandadaki Home tuşunun açtığı ve aygıtın açılışta başladığı uygulama.",
            "Android asks which app to use: choose APL Launcher. If nothing opens, docs/android.md has the adb command.": "Android hangi uygulamanın kullanılacağını sorar: APL Launcher'ı seç. Hiçbir şey açılmazsa adb komutu docs/android.md içinde.",
            "APL Launcher is already the Home app.": "APL Launcher zaten ana ekran uygulaması.",
            "This device has no setting for it: see docs/android.md (adb).": "Bu aygıtta bunun için bir ayar yok: docs/android.md'ye bak (adb).",
            "Remote Buttons": "Kumanda tuşları",
            "Turn On the Remote Buttons": "Kumanda tuşlarını aç",
            "In Accessibility, choose APL Launcher Home Button and turn it on. Then Home opens APL Launcher, holding Home or ⏯ opens the Control Center over any app, and Sleep and the Sleep Timer work.": "Erişilebilirlik'te APL Launcher Home Button'ı seç ve aç. Böylece Home APL Launcher'ı açar, Home'a ya da ⏯ tuşuna basılı tutmak her uygulamanın üzerinde Kontrol Merkezi'ni açar, Uyku ve Uyku zamanlayıcısı da çalışır.",
            "Home Button": "Home tuşu",
            "Android TV and Google TV keep their own launcher on the Home button, even once APL Launcher is chosen. APL Launcher: the remote buttons (Accessibility) take it and open APL Launcher.": "Android TV ve Google TV, APL Launcher seçilse bile Home tuşunda kendi launcher'larını tutar. APL Launcher: kumanda tuşları (Erişilebilirlik) bu tuşu alır ve APL Launcher'ı açar.",
            "Android chose APL Launcher, but this device keeps its own launcher on Home: turn on the remote buttons below.": "Android APL Launcher'ı seçti, ama bu aygıt Home tuşunda kendi launcher'ını tutuyor: hemen aşağıdaki kumanda tuşlarını aç.",
            "Over Apps": "Uygulamaların üzerinde",
            "Accessibility": "Erişilebilirlik",
            "Allowed": "İzin verildi",
            "Root": "Root",
            "Not needed": "Gerekli değil",
            "Found, not used": "Bulundu, kullanılmıyor",
            "APL Launcher works without root. With root, a later version could close every app and reach deeper settings.": "APL Launcher root olmadan çalışır. Root ile ileriki bir sürüm tüm uygulamaları kapatabilir ve daha derin ayarlara ulaşabilir.",
            "Setup guide: github.com/Knikt/APL-Launcher, docs/android.md.": "Kurulum rehberi: github.com/Knikt/APL-Launcher, docs/android.md.",
            "Home app, remote buttons, the Control Center over apps.": "Ana ekran uygulaması, kumanda tuşları, uygulamaların üzerinde Kontrol Merkezi.",
            "Android Settings": "Android ayarları",
            "Android's own settings: Wi-Fi, picture, sound, date, language, accounts, apps, reset.": "Android'in kendi ayarları: Wi-Fi, resim, ses, tarih, dil, hesaplar, uygulamalar, sıfırlama.",
            "Picture Settings": "Resim ayarları",
            "The device's picture settings, in Android.": "Aygıtın resim ayarları, Android'de.",
            "Sound Settings": "Ses ayarları",
            "Sound output, surround and the device's sound settings, in Android.": "Ses çıkışı, surround ve aygıtın ses ayarları, Android'de.",
            "Remotes and Accessories": "Kumandalar ve Aksesuarlar",
            "Bluetooth headphones, speakers, game controllers and remotes, in Android.": "Bluetooth kulaklıklar, hoparlörler, oyun kumandaları ve kumandalar, Android'de.",
            "Network Settings": "Ağ ayarları",
            "Wi-Fi and Ethernet, in Android.": "Wi-Fi ve Ethernet, Android'de.",
            "Manage Apps": "Uygulamaları yönet",
            "Storage, permissions, force stop, in Android.": "Depolama, izinler, durmaya zorla, Android'de.",
            "An app left in the background for more than 10 minutes is closed by Android (through the remote buttons, Accessibility). The app in front, music playing in the background and the launcher are never closed.": "Arka planda 10 dakikadan uzun kalan bir uygulamayı Android kapatır (kumanda tuşları, Erişilebilirlik aracılığıyla). Öndeki uygulama, arka planda çalan müzik ve launcher asla kapatılmaz.",
            "Asks Android to close the apps left in the background. They reopen normally, but start over from the beginning.": "Android'den arka planda kalan uygulamaları kapatmasını ister. Normal şekilde yeniden açılırlar, ama baştan başlarlar.",
            "When an app closes, or the device starts, APL Launcher instead of the device's own home screen. Needs the remote buttons (Accessibility).": "Bir uygulama kapandığında ya da aygıt açıldığında, aygıtın kendi ana ekranı yerine APL Launcher. Kumanda tuşları gerekir (Erişilebilirlik).",
            "About This Device": "Bu aygıt hakkında",
            "Android Version": "Android sürümü",
            "Updates come with a new APK, from the GitHub releases.": "Güncellemeler GitHub sürümlerinden yeni bir APK ile gelir.",
            "{mb} MB freed": "{mb} MB boşaltıldı",
            "Nothing to free: the apps in the background were already closed.": "Boşaltılacak bir şey yok: arka plandaki uygulamalar zaten kapalıydı.",
            "Opens the device's own home screen ({name}). Press Home to come back.": "Aygıtın kendi ana ekranını açar ({name}). Geri dönmek için Home'a bas.",
            "Home Screen of the device": "Aygıtın ana ekranı",
            "Ethernet": "Ethernet",
            "Up Next": "Sıradaki",
            "Continue Watching from the apps that fill Android TV's Play Next row (Nuvio, YouTube, Plex…), as cards over the Top Shelf. Android asks once to let APL Launcher read it.": "Android TV'nin Sıradaki satırını dolduran uygulamalardan (Nuvio, YouTube, Plex…) İzlemeye devam et, Üst Raf'ın üzerinde kartlar olarak. Android, APL Launcher'ın bunu okumasına izin vermek için bir kez sorar.",
            "Make APL Launcher Your Home Screen?": "APL Launcher ana ekranın olsun mu?",
            "So that the remote's Home button and the device's start-up open APL Launcher. Android then asks which app to use: choose APL Launcher, then Set as default.": "Böylece kumandanın Home tuşu ve aygıtın açılışı APL Launcher'ı açar. Android ardından hangi uygulamanın kullanılacağını sorar: APL Launcher'ı seç, sonra Varsayılan olarak ayarla.",
            "Continue": "Devam",
            "Later": "Daha sonra",
            "One More Step: the Remote Buttons": "Bir adım daha: kumanda tuşları",
            "This device keeps its own home screen on the Home button, even once APL Launcher is chosen. In Accessibility, choose APL Launcher Home Button and turn it on: Home then opens APL Launcher, and holding Home opens the Control Center over any app. Android then shows its usual warning about accessibility services: the module only sees the remote's buttons and which app is in front, and sends nothing anywhere.": "Bu aygıt, APL Launcher seçilse bile Home tuşunda kendi ana ekranını tutar. Erişilebilirlik'te APL Launcher Home Button'ı seç ve aç: böylece Home APL Launcher'ı açar, Home'a basılı tutmak da her uygulamanın üzerinde Kontrol Merkezi'ni açar. Android ardından erişilebilirlik hizmetleri hakkındaki olağan uyarısını gösterir: modül yalnızca kumandanın tuşlarını ve öndeki uygulamayı görür, hiçbir yere bir şey göndermez.",
            "Open Accessibility": "Erişilebilirlik'i aç",
            "All set: Home now opens APL Launcher.": "Hazır: Home artık APL Launcher'ı açıyor.",
            "Not yet: in Accessibility, choose APL Launcher Home Button and turn it on. Settings › Android TV has it too.": "Henüz değil: Erişilebilirlik'te APL Launcher Home Button'ı seç ve aç. Ayarlar › Android TV'de de var.",
            "Other": "Diğer",
            "Type the key, then OK. The Google TV app on your phone can type it too. Back to cancel.": "Anahtarı yaz, sonra OK. Telefonundaki Google TV uygulaması da yazabilir. İptal için Geri.",
            "Saved: the Top Shelf uses it now.": "Kaydedildi: Üst Raf artık bunu kullanıyor.",
            "This doesn't look like a key.": "Bu bir anahtara benzemiyor.",
            "TMDB refused this key: check it on themoviedb.org.": "TMDB bu anahtarı reddetti: themoviedb.org'da kontrol et.",
            "Films and series in What's Popular. Free on themoviedb.org › Settings › API (API Key). OK to type it.": "Popüler olanlar'da filmler ve diziler. themoviedb.org › Settings › API (API Key) üzerinden ücretsiz. Yazmak için OK.",
            "Optional: trending videos in YouTube's Top Shelf (YouTube Data API v3, console.cloud.google.com). OK to type it.": "İsteğe bağlı: YouTube'un Üst Raf'ında trend videolar (YouTube Data API v3, console.cloud.google.com). Yazmak için OK.",
            "Optional: HD backgrounds for movies and shows (fanart.tv › your profile › API Key). OK to type it.": "İsteğe bağlı: filmler ve diziler için HD arka planlar (fanart.tv › profilin › API Key). Yazmak için OK.",
            "The keys are kept on this device. Type them here, or APL Launcher Setup sends them from the PC.": "Anahtarlar bu aygıtta saklanır. Buraya yaz ya da APL Launcher Setup bunları bilgisayardan göndersin.",
            "Remove the Typed Keys": "Yazılan anahtarları sil",
            "The Top Shelf goes back to the keys in the app, if it has any.": "Üst Raf, varsa uygulamadaki anahtarlara geri döner.",
            "Keys removed.": "Anahtarlar silindi."
        };
        for (var t in addTr) if (Object.prototype.hasOwnProperty.call(addTr, t) && !Object.prototype.hasOwnProperty.call(TR, t)) TR[t] = addTr[t];
    }
    var T = APL.t;

    /* ---------- the API keys ----------
       The published .apk has none (tools/make-android.py --release): they are kept by the app (Bridge.keys,
       KeysReceiver.kt), typed in Settings › Appearance › Top Shelf › Online Services or sent by APL Launcher
       Setup over adb. liveshelf.js and autoart.js read the same window.APL_KEYS object: filled in place here,
       before launcher.js starts. A key kept by the app wins over the one in the package (your own build). */
    var KEY_NAMES = ["tmdb", "youtube", "fanart"];
    var KEYS = global.APL_KEYS = global.APL_KEYS || {};
    var builtIn = {};
    KEY_NAMES.forEach(function (n) { builtIn[n] = KEYS[n] || ""; });
    function applyKeys() {
        var saved = B.keys ? json(B.keys(), {}) : {};
        KEY_NAMES.forEach(function (n) { KEYS[n] = saved[n] || builtIn[n]; });
        // The Top Shelf kept what it found without them (6 h): another set of keys starts it again
        var seen = KEY_NAMES.map(function (n) { return KEYS[n] ? n : ""; }).join(",");
        try {
            if (global.localStorage.getItem("apl.keysSeen") !== seen) {
                var del = [];
                for (var i = 0; i < global.localStorage.length; i++) {
                    var k = global.localStorage.key(i);
                    if (k && k.indexOf("apl.live.") === 0) del.push(k);
                }
                del.forEach(function (k) { global.localStorage.removeItem(k); });
                global.localStorage.setItem("apl.keysSeen", seen);
            }
        } catch (e) {}
    }
    applyKeys();

    /* The remote's buttons over apps, sleep and the Sleep Timer: APL Launcher Home Button (android/homebutton) */
    function needsService() {
        return fresh().module ? T("Turn on APL Launcher Home Button first (Settings › Android TV).") : T("Install APL Launcher Home Button first (Settings › Android TV).");
    }
    var MODULE_URL = "https://github.com/Knikt/APL-Launcher/releases/latest/download/apl-launcher-home-button.apk";
    var MODULE_CODE = "";            // a Downloader short code (go.aftvnews.com) for MODULE_URL, once there is one
    var DOWNLOADER = "com.esaba.downloader";
    /* How to get APL Launcher Home Button: why it is separate, Play Protect, where it is */
    function moduleHelp(then) {
        var box = document.createElement("div");
        box.className = "aplalert__qr";
        var url = document.createElement("div");
        url.className = "aplalert__qrurl";
        url.textContent = MODULE_CODE ? T("Downloader code") + " " + MODULE_CODE : MODULE_URL.replace(/^https:\/\//, "");
        box.appendChild(url);
        var buttons = [];
        if (B.installed(DOWNLOADER)) buttons.push({ label: T("Open Downloader"), run: function () { setupWait = "module"; B.launch(DOWNLOADER); } });
        buttons.push({ label: buttons.length ? T("Later") : T("OK"), run: then });
        APL.alert({ title: "APL Launcher Home Button", message: T("Home, holding Home and ⏯ over every app need a small second app, APL Launcher Home Button. It is separate because Google Play Protect blocks any app installed outside the Play Store that uses Accessibility.") + " " + T("To install it: in the Play Store, open your profile › Settings › Play Protect and turn off “Scan apps with Play Protect”. Open the address below in Downloader and install it, then turn Play Protect back on. From a PC: adb install. Then turn it on in Accessibility."),
                    node: box, buttons: buttons });
    }
    function fail(msg) { return Promise.reject(new Error(msg)); }
    function needsRoot() { return fail(T("This needs root on Android.")); }
    function toast(m, quiet) { if (APL.toast) APL.toast(m, quiet); }

    /* ---------- the remote: Android sends each key here (Samsung's codes) ---------- */
    global.__aplKey = function (type, code, repeat) {
        var e;
        try { e = new KeyboardEvent(type, { bubbles: true, cancelable: true, repeat: !!repeat }); }
        catch (x) { e = document.createEvent("Event"); e.initEvent(type, true, true); }
        try {
            Object.defineProperty(e, "keyCode", { get: function () { return code; } });
            Object.defineProperty(e, "which", { get: function () { return code; } });
            if (!e.repeat && repeat) Object.defineProperty(e, "repeat", { get: function () { return true; } });
        } catch (x) {}
        (document.activeElement || document.body).dispatchEvent(e);
    };

    /* ---------- what Android tells the page ---------- */
    var handlers = {};
    function listen(name, fn) { (handlers[name] = handlers[name] || []).push(fn); }
    global.__aplEvent = function (name, data) {
        (handlers[name] || []).forEach(function (fn) {
            try { fn(data); } catch (e) { try { B.log("event " + name + ": " + e.message); } catch (x) {} }
        });
    };

    /* Typing (folder and profile names): the keys go to Android's keyboard meanwhile */
    function isField(n) { return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable); }
    /* Told to Android only when it changes: Android taking the keyboard's focus made the field lose it and get it
       back again and again (tried in the emulator), and a name or a key could not be typed. */
    var editingNow = false, editOff = null;
    function setEditing(on) { if (on !== editingNow) { editingNow = on; B.editing(on); } }
    document.addEventListener("focusin", function (e) { if (isField(e.target)) { clearTimeout(editOff); setEditing(true); } }, true);
    document.addEventListener("focusout", function (e) {
        if (!isField(e.target)) return;
        clearTimeout(editOff);
        editOff = setTimeout(function () { if (!isField(document.activeElement)) setEditing(false); }, 300);
    }, true);

    /* ---------- APL.sys: the device ---------- */
    sys.PREVIEW = false;
    sys.platform = "android";
    if (sys.setDefault) {
        sys.setDefault("autoUpdate", false);      // updates come with the APK: boot.js runs the installed version
        sys.setDefault("bootCleanup", false);     // Samsung's own apps at power-on
        sys.setDefault("alexaBridge", false);
        sys.setDefault("catchHome", true);       // Home opens APL Launcher (KeyService.kt), where the device keeps its own launcher
    }

    sys.audio = {
        getVolume: function () { return json(B.volume(), {}).level || 0; },
        setVolume: function (v) { return B.setVolume(Math.round(v)); },
        isMute: function () { return !!json(B.volume(), {}).muted; },
        setMute: function (m) { B.setMute(!!m); },
        outputMode: function () { return T("Automatic"); }
    };

    var net = null, netAt = 0;
    sys.network = function () {
        // Settings reads it once per row: asked of Android at most every 3 s
        if (net && Date.now() - netAt < 3000) return net;
        var n = json(B.network(), {});
        var type = n.type === "Wi-Fi" || n.type === "Ethernet" ? n.type : n.type === "Mobile" ? "Mobile" : n.connected ? T("Other") : T("Disconnected");
        net = { connected: !!n.connected, type: type, ssid: n.ssid || "—", signal: n.signal || 0, ip: n.ip || "—",
                mac: n.mac || "—", gateway: n.gateway || "—", dns: n.dns || "—" };
        netAt = Date.now();
        return net;
    };

    function deviceName() {
        var m = String(info.manufacturer || ""), model = String(info.model || "");
        if (!m || model.toLowerCase().indexOf(m.toLowerCase()) === 0) return model || "Android TV";
        return m.charAt(0).toUpperCase() + m.slice(1) + " " + model;
    }
    sys.product = function () {
        return { model: info.model || "—", name: deviceName(), firmware: info.build || "—", tizen: "Android " + (info.release || "?") };
    };
    function screen() { return json(B.display(), {}); }
    sys.display = function () {
        var d = screen();
        return Promise.resolve(d.panel && d.ui && d.panel !== d.ui ? T("{panel} (interface {ui})", { panel: d.panel, ui: d.ui }) : (d.panel || d.ui || "—"));
    };
    function gb(bytes) { var n = (bytes / 1e9).toFixed(1); return T("{n} GB", { n: APL.lang === "fr" || APL.lang === "pl" || APL.lang === "tr" ? n.replace(".", ",") : n }); }
    sys.storage = function () {
        var s = json(B.storage(), {});
        return Promise.resolve(s.total ? T("{free} free of {total}", { free: gb(s.free), total: gb(s.total) }) : "—");
    };
    sys.hdr = function () { var d = screen(); return d.hdr === undefined ? "—" : d.hdr ? T("Supported") : T("Not supported"); };

    /* The remote's buttons the launcher presses itself: through the accessibility service */
    var GLOBAL = { KEY_HOME: "home", KEY_EXIT: "home", KEY_RETURN: "back", KEY_MENU: "recents" };
    sys.remoteKey = function (key) {
        if (key === "KEY_POWER") return sys.sleepNow();
        if (GLOBAL[key] && B.globalAction(GLOBAL[key])) return Promise.resolve();
        return fail(needsService());
    };
    sys.sleepNow = function () { return B.sleep() ? Promise.resolve() : fail(needsService()); };
    sys.openSamsungSettings = function (path) { B.openSettings("settings"); return Promise.resolve(path); };
    sys.registerKeys = function () {};

    /* ---------- Sources: the TV's HDMI inputs (Bridge.tvInputs) ----------
       A Google TV or Android TV television lists its HDMI ports: the number in each one's name (HDMI 1 to 4), and
       the name given in Android's Inputs settings or by the HDMI-CEC device on it. A box (Shield, Chromecast) or
       the emulator has none: Sources then stays out of the Home Screen, the Control Center and Settings, as before.
       Asked of Android at most every 5 s (the Control Center asks at each opening); Sources itself and switching
       ask again. */
    var tvIn = null, tvInAt = 0;
    function tvInputs(now) {
        if (!B.tvInputs) return [];
        if (!now && tvIn && Date.now() - tvInAt < 5000) return tvIn;
        var list = json(B.tvInputs(), []);
        tvIn = (Array.isArray(list) ? list : []).filter(function (p) { return p && p.id && p.number > 0; })
            .sort(function (a, b) { return a.number - b.number; });
        tvInAt = Date.now();
        return tvIn;
    }
    function hasInputs() { return tvInputs().length > 0; }
    /* "HDMI 2", "HDMI 3 (eARC)": only the port's own name, which sources.js shows anyway: "" then, as on LG */
    function portOnly(label) { return !String(label || "").replace(/hdmi|e?arc|mhl|\d|[\s\/()\[\]\-_.:,]/gi, ""); }
    /* Samsung's numbers, as sources.js gives them: HDMI 1 to 4 = 13 to 16 (12 + the port's number) */
    sys.switchSource = function (sourceType) {
        var n = sourceType - 12, port = "HDMI " + n;
        // Live TV (0): the TV's tuner is another kind of input, not offered here
        if (n < 1) return fail(T("This input isn't supported on this screen"));
        var all = tvInputs(true);
        if (!all.length) return fail(T("This device has no HDMI inputs."));
        var input = all.filter(function (p) { return p.number === n; })[0];
        if (!input) return fail(T("This TV has no {port} input.", { port: port }));
        return B.openInput(String(input.id)) ? Promise.resolve() : fail(T("Android couldn't open {port}.", { port: port }));
    };
    /* The Home Screen made its list with the answer of then (the Sources tile, the pinned inputs): right after
       start-up a TV can list its inputs late, so the list is made again once they show up (or go) */
    var homeSawInputs = null;
    function inputsChanged() {
        if (homeSawInputs !== null && homeSawInputs !== hasInputs() && APL.refreshHome) setTimeout(APL.refreshHome, 0);
    }

    /* Vetro and the screen's root commands: none on Android. Deleting an app (launcher.js asks Vetro) is
       Android's own "Uninstall?" instead. */
    sys.vetroAlive = function () { return Promise.resolve(false); };
    sys.vetroLink = function () { return Promise.resolve(T("Not used on Android")); };
    sys.noVetro = function () { return false; };
    sys.vetroGet = function () { return needsRoot(); };
    sys.vetroPost = function (path, body) {
        if (path === "/components/action" && body && body.action === "uninstall") return Promise.resolve({ ok: B.uninstall(String(body.appId || "")) });
        return needsRoot();
    };
    /* The App Switcher closes an app with Samsung's app_launcher -k: Android closes it, as it is in the background */
    sys.exec = function (cmd) {
        var m = /^app_launcher -k ([A-Za-z0-9._]+)[^;]*; true$/.exec(String(cmd || ""));
        if (m && info.canClose) { B.freeMemory(JSON.stringify([m[1]])); return Promise.resolve({ ok: true, output: "" }); }
        return needsRoot();
    };
    sys.runningApps = function () { return Promise.resolve(json(B.running(), [])); };

    /* Picture, Game Mode and the screen's other settings: Samsung's, through Vetro */
    sys.game = {
        get: function () { return Promise.resolve({ available: false, on: false }); },
        set: function () { return needsRoot(); },
        applyOnInput: function () { return Promise.resolve(); }
    };
    var nativeInfo = sys.native && sys.native.info;
    sys.native = {
        get: function () { return fail(T("Unavailable")); },
        set: function () { return fail(T("Unavailable")); },
        reset: function () { return needsRoot(); },
        info: function (id) { return nativeInfo ? nativeInfo(id) : null; }
    };
    sys.tvSettings = function () { return fail(T("Unavailable")); };
    sys.tvItem = function () { return Promise.resolve(null); };
    sys.tvValue = function () { return Promise.resolve(null); };
    sys.tvAdjust = function () { return fail(T("Unavailable")); };
    sys.setPictureMode = function () { return fail(T("Unavailable")); };

    /* Sleep Timer: Android counts (SleepReceiver.kt), the launcher and the Control Center show it */
    sys.armSleepTimer = function (minutes) {
        var at = minutes ? Date.now() + minutes * 60000 : 0;
        sys.setPref("sleepTimer", minutes);
        sys.setPref("sleepAt", at);
        B.setSleepAt(at);
        if (minutes && !fresh().accessibility) toast(needsService());
    };
    sys.readSleepTimer = function () {
        var at = +B.sleepAt() || 0;
        if (at < Date.now()) at = 0;
        if (sys.pref("sleepAt") !== at) sys.setPref("sleepAt", at);
        if (!at && sys.pref("sleepTimer")) sys.setPref("sleepTimer", 0);
        return Promise.resolve();
    };

    /* Settings the native side reads too (KeyService.kt) */
    function syncNative() {
        B.setNativePref("pauseKey", String(sys.pref("pauseKey") || "controlcenter"));
        B.setNativePref("idleClose", sys.pref("idleClose") ? "1" : "0");
        B.setNativePref("homeReturn", sys.pref("homeReturn") ? "1" : "0");
        B.setNativePref("catchHome", sys.pref("catchHome") ? "1" : "0");
    }
    ["pauseKey", "idleClose", "homeReturn", "catchHome"].forEach(function (k) { sys.onPref(k, syncNative); });
    syncNative();

    /* ---------- the apps ---------- */
    var waiting = [];
    listen("apps", function (list) { var w = waiting; waiting = []; w.forEach(function (fn) { fn(list || []); }); });
    function nativeApps() {
        return new Promise(function (resolve) {
            waiting.push(resolve);
            if (waiting.length === 1) B.requestApps();
        });
    }
    APL.loadApps = function () {
        return nativeApps().then(function (list) {
            var byId = {};
            list.forEach(function (a) { byId[a.id] = a; });
            var apps = APL.appsFromList(list.map(function (a) {
                // Android's Settings app, next to the launcher's own Settings tile
                var name = /^com\.android\.tv\.settings$|^com\.google\.android\.tv\.settings$/.test(a.id) ? T("Android Settings") : a.name;
                return { id: a.id, name: name, icon: a.icon || null };
            }));
            // A TV app's banner is its tile, where the catalogue has no artwork of its own for it
            apps.forEach(function (a) {
                var n = byId[a.id];
                if (n && n.banner && !a.tile) { a.tile = n.banner; a.banner = true; }
            });
            return apps;
        });
    };
    APL.launchApp = function (id) { return B.launch(String(id)) ? Promise.resolve() : fail(T("Can't launch the app")); };

    /* APL TV's Top Shelf (widgets.js): APL TV keeps it for APL Launcher only (its ShelfProvider) */
    if (B.appShelf) sys.appShelf = function () {
        var shelf = json(B.appShelf(), null);
        return shelf ? Promise.resolve(shelf) : fail("nothing to read");
    };
    APL.isInstalled = function (id) { return Promise.resolve(!!B.installed(String(id))); };
    APL.openUrl = function (url) { return B.openUrl(String(url)) ? Promise.resolve() : fail(T("Can't open Internet")); };
    APL.launchDeepLink = function () { return fail(T("Can't launch the app")); };
    APL.launchTizenTube = function () { return fail(T("Can't launch the app")); };

    /* An app installed, updated or removed: launcher.js reloads the list (the way it listens to Tizen's) */
    var pkgListener = null;
    listen("packages", function () { if (pkgListener && pkgListener.oninstalled) pkgListener.oninstalled(); });

    function freeMemory() {
        var ids = ((APL.allApps && APL.allApps()) || []).filter(function (a) { return !a.virtual; }).map(function (a) { return a.id; });
        var r = json(B.freeMemory(JSON.stringify(ids)), {});
        // Android doesn't say which of them were open: what was freed tells
        toast(r.freed > 0 ? T("{mb} MB freed", { mb: r.freed }) : T("Nothing to free: the apps in the background were already closed."), true);
    }

    /* ---------- Android TV's Watch Next row: each app's own cards (WatchNext.kt, widgets.js) ----------
       Nuvio's Continue Watching, the next episode…, read once per focus change at most (20 s), and again for
       the cards themselves. What You're Watching (Settings › Appearance › Top Shelf) turns it off. */
    var wn = null, wnAt = 0;
    function watchNext() {
        if (!B.watchNext || !sys.pref("hubShelf") || !B.watchNextAllowed()) return {};
        if (wn && Date.now() - wnAt < 20000) return wn;
        wn = {}; wnAt = Date.now();
        json(B.watchNext(), []).forEach(function (r) {
            if (r.kind === 0 || r.kind === 1) (wn[r.pkg] = wn[r.pkg] || []).push(r);     // Continue, Next (not New, Watchlist)
        });
        return wn;
    }
    function watchNextCards(id) {
        var app = ((APL.allApps && APL.allApps()) || []).filter(function (a) { return a.id === id; })[0] || {};
        return (watchNext()[id] || []).slice(0, 6).map(function (r) {      // the row slides past two (widgets.js)
            var ep = r.season && r.number ? "S" + r.season + " E" + r.number : r.number ? "E" + r.number : "";
            var started = r.duration > 0 && r.position > 0;
            var left = started ? T("{n} min left", { n: Math.max(1, Math.round((r.duration - r.position) / 60000)) }) : "";
            // Not started yet: the next episode (Nuvio writes it as "continue" too, at 0)
            return { kind: "video", label: r.kind === 1 || !started ? T("Up Next") : T("Continue Watching"), title: String(r.title),
                     sub: [ep, r.episode, left].filter(Boolean).join(" · "),
                     image: r.image || app.bg || app.tile || "", appArt: !r.image,
                     progress: started ? Math.min(1, r.position / r.duration) : undefined,
                     launch: { key: "watchNext", value: String(r.id) } };
        });
    }
    listen("listings", function () { wnAt = 0; });          // Android's answer: read again at the next focus

    /* ---------- APL.platform: the few places where launcher.js and controlcenter.js ask ---------- */
    var homeName = String(B.systemHomeName() || "") || T("Home Screen of the device");
    APL.platform = {
        name: "android",
        trailerRelay: "https://apl.app/yt.html",     // the trailer through a page with an https origin (yt.html, Web.kt; #56)
        /* An app opened with one piece of data (APL TV from the Top Shelf: resume / channel), as an Intent extra */
        launch: function (id, params) {
            var key = Object.keys(params || {})[0];
            // A Watch Next card: the program's own link, inside its app (WatchNext.open)
            if (key === "watchNext") return B.openWatchNext && B.openWatchNext(String(id), String(params[key])) ? Promise.resolve() : fail(T("Can't launch the app"));
            if (!key || !B.launchWith) return fail(T("Can't launch the app"));
            return B.launchWith(String(id), key, String(params[key])) ? Promise.resolve() : fail(T("Can't launch the app"));
        },
        packages: { setPackageInfoEventListener: function (l) { pkgListener = l; } },
        /* widgets.js: the cards of an app that has rows in Android TV's Watch Next */
        cardsReader: function (id) {
            return watchNext()[id] ? function () { wnAt = 0; return Promise.resolve(watchNextCards(id)); } : null;
        },
        /* A new version is out (updater.js, once per version): how to get it on Android */
        updateNotice: function (v) {
            APL.alert({
                title: T("APL Launcher {v} is available", { v: v.version }),
                message: T("To install it: in the Downloader app, type the code 9890834, then install. Or run APL Launcher Setup again on your PC. Your settings are kept."),
                buttons: [{ label: T("OK") }]
            });
        },
        /* Delete App: Android's own Uninstall? question (B.uninstall, through the launcher's /components/action) */
        canDelete: function () { return !!B.uninstall; },
        /* Sources (sources.js): the TV's HDMI ports, null without any */
        readPorts: function () {
            var ports = tvInputs(true).map(function (p) {
                return { type: "HDMI", number: p.number, label: portOnly(p.label) ? "" : String(p.label) };
            });
            inputsChanged();           // sources.js asks 20 s after start-up: late inputs show up on the Home Screen then
            return Promise.resolve(ports.length ? ports : null);
        },
        /* The launcher's own tiles: Sources on a TV with HDMI inputs only; Smart Hub becomes the device's own home */
        virtualApps: function (list) {
            return list.map(function (v) {
                if (v.id === "apl.sources") {
                    // Asked again each time the list is made (launcher.js buildList)
                    v.when = function () { homeSawInputs = hasInputs(); return homeSawInputs; };
                    return v;
                }
                if (v.id !== "apl.samsunghome") return v;
                v.name = homeName;
                v.run = function () { if (!B.openSystemHome()) toast(T("Can't launch the app")); };
                return v;
            });
        },
        /* The Control Center's tiles: no Game Mode, AirPlay or brightness, Sources on a TV with HDMI inputs only;
           Audio is Android's Bluetooth */
        ccItems: function (items) {
            var sources = hasInputs();
            return items.filter(function (it) {
                return it.type !== "backlight" && it.icon !== "gamepad" && it.icon !== "airplay" && (it.icon !== "source" || sources);
            }).map(function (it) {
                if (it.icon === "airplayAudio") {
                    it.sub = function () { return T("Remotes and Accessories"); };
                    it.select = function () { closeCc(); B.openSettings("bluetooth"); };
                }
                return it;
            });
        }
    };
    function closeCc() { if (APL.controlCenter && APL.controlCenter.isOpen()) APL.controlCenter.close(); }

    /* ---------- Settings: Android's version of the tree ---------- */
    function menu(label, icon, children, desc) { return { type: "menu", label: label, icon: icon, children: children, desc: desc }; }
    function infoRow(label, get, desc) { return { type: "info", label: label, get: get, desc: desc }; }
    function action(label, run, desc, icon) { return { type: "action", label: label, run: run, desc: desc, icon: icon }; }
    function opener(label, which, desc, icon) { return action(label, function () { B.openSettings(which); }, desc, icon); }
    function onOff(v) { return v ? T("On") : T("Off"); }

    var SAMSUNG_TYPES = { native: 1, tv: 1, tvmode: 1, game: 1, service: 1, samsung: 1 };
    /* Rows that are Samsung's only (Vetro, the screen's own settings) go; then menus left empty */
    function strip(list) {
        return list.filter(function (it) { return !SAMSUNG_TYPES[it.type] && it.vetro !== true; }).map(function (it) {
            if (it.type === "menu" && it.children) it.children = strip(it.children);
            return it;
        }).filter(function (it) { return it.type !== "menu" || (it.children && it.children.length); });
    }
    function find(list, label) {
        for (var i = 0; i < list.length; i++) if (list[i].label === T(label)) return list[i];
        return null;
    }
    function without(list, labels) {
        var drop = labels.map(function (l) { return T(l); });
        return list.filter(function (it) { return drop.indexOf(it.label) === -1; });
    }
    function after(list, label, items) {
        var at = -1;
        for (var i = 0; i < list.length; i++) if (list[i].label === T(label)) at = i;
        Array.prototype.splice.apply(list, [at === -1 ? list.length : at + 1, 0].concat(items));
    }

    function androidMenu() {
        var rows = [
            infoRow(T("Home App"), function () {
                var i = fresh();
                return i.defaultHome || (i.accessibility && sys.pref("catchHome")) ? "APL Launcher" : (homeName || "—");
            },
                T("The app Home on the remote opens, and the one the device starts on.")),
            action(T("Make APL Launcher the Home App"), function () {
                var r = B.requestHome();
                if (r === "held") toast(T("APL Launcher is already the Home app."), true);
                else if (r === "kept") toast(T("Android chose APL Launcher, but this device keeps its own launcher on Home: turn on the remote buttons below."));
                else if (r === "role" || r === "settings") toast(T("Android asks which app to use: choose APL Launcher. If nothing opens, docs/android.md has the adb command."), true);
                else toast(T("This device has no setting for it: see docs/android.md (adb)."));
            }, T("Android asks which app to use: choose APL Launcher. If nothing opens, docs/android.md has the adb command."), "grid"),
            infoRow("APL Launcher Home Button", function () { var i = fresh(); return !i.module ? T("Not installed") : onOff(i.accessibility); },
                T("Home, holding Home and ⏯ over every app need a small second app, APL Launcher Home Button. It is separate because Google Play Protect blocks any app installed outside the Play Store that uses Accessibility.")),
            info.module ? opener(T("Turn On the Remote Buttons"), "accessibility", T("In Accessibility, choose APL Launcher Home Button and turn it on. Then Home opens APL Launcher, holding Home or ⏯ opens the Control Center over any app, and Sleep and the Sleep Timer work."), "remote")
                        : action(T("Get APL Launcher Home Button"), function () { moduleHelp(); }, T("To install it: in the Play Store, open your profile › Settings › Play Protect and turn off “Scan apps with Play Protect”. Open the address below in Downloader and install it, then turn Play Protect back on. From a PC: adb install. Then turn it on in Accessibility."), "remote")
        ];
        if (!info.defaultHome) {
            rows.push({ type: "choice", label: T("Home Button"), key: "catchHome", options: [[true, "APL Launcher"], [false, homeName]],
                        desc: T("Android TV and Google TV keep their own launcher on the Home button, even once APL Launcher is chosen. APL Launcher: the remote buttons (Accessibility) take it and open APL Launcher.") });
        }
        var over = T("The Control Center over the app in front needs “draw over other apps”. Without it, holding Home opens the launcher with its Control Center. From a PC: adb shell appops set com.knikt.apllauncher SYSTEM_ALERT_WINDOW allow");
        rows.push(infoRow(T("Over Apps"), function () { return fresh().overlayAllowed ? T("Allowed") : T("Not allowed"); }, over));
        if (!info.overlayAllowed) rows.push(opener(T("Allow Over Other Apps"), "overlay", over, "sliders"));
        rows.push(infoRow(T("Root"), function () { return fresh().root ? T("Found, not used") : T("Not needed"); },
            T("APL Launcher works without root. With root, a later version could close every app and reach deeper settings.")));
        rows.push(infoRow("docs/android.md", function () { return ""; }, T("Setup guide: github.com/Knikt/APL-Launcher, docs/android.md.")));
        return menu(info.googleTv ? "Google TV" : "Android TV", "display", rows, T("Home app, remote buttons, the Control Center over apps."));
    }

    /* Online Services: each key is typed on the TV (Android's keyboard, or the Google TV app on a phone) */
    var KEY_LABELS = { tmdb: "TMDB Key", youtube: "YouTube Key", fanart: "Fanart.tv Key" };
    var KEY_DESCS = {
        tmdb: "Films and series in What's Popular. Free on themoviedb.org › Settings › API (API Key). OK to type it.",
        youtube: "Optional: trending videos in YouTube's Top Shelf (YouTube Data API v3, console.cloud.google.com). OK to type it.",
        fanart: "Optional: HD backgrounds for movies and shows (fanart.tv › your profile › API Key). OK to type it."
    };
    function keyRows() {
        var rows = KEY_NAMES.map(function (n) {
            return { type: "info", label: T(KEY_LABELS[n]), desc: T(KEY_DESCS[n]),
                     get: function () { return KEYS[n] ? T("Configured") : T("Missing"); },
                     run: function (done) { askKey(n, done); } };
        });
        rows.push(action(T("Remove the Typed Keys"), function (done) {
            KEY_NAMES.forEach(function (n) { B.setKey(n, ""); });
            applyKeys();
            if (done) done();
            toast(T("Keys removed."), true);
        }, T("The Top Shelf goes back to the keys in the app, if it has any."), "trash"));
        return rows;
    }
    function askKey(name, done) {
        var box = document.createElement("div");
        box.className = "pprompt";
        box.innerHTML = '<div class="pprompt__box"><h2 class="pprompt__title"></h2>' +
            '<input class="pprompt__input" type="text" maxlength="100" autocomplete="off" autocapitalize="off" spellcheck="false">' +
            '<p class="pprompt__hint"></p></div>';
        box.querySelector("h2").textContent = T(KEY_LABELS[name]);
        box.querySelector("p").textContent = T("Type the key, then OK. The Google TV app on your phone can type it too. Back to cancel.");
        document.body.appendChild(box);
        var input = box.querySelector("input"), over = false;
        function finish(ok) {
            if (over) return;
            over = true;
            var v = String(input.value || "").replace(/\s+/g, "");
            if (box.parentNode) box.parentNode.removeChild(box);
            if (!ok || !v) return;
            if (!/^[A-Za-z0-9_-]{8,100}$/.test(v)) { toast(T("This doesn't look like a key.")); return; }
            function save() {
                if (!B.setKey(name, v)) { toast(T("This doesn't look like a key.")); return; }
                applyKeys();
                if (done) done();
                toast(T("Saved: the Top Shelf uses it now."), true);
            }
            if (name !== "tmdb") { save(); return; }
            // TMDB says at once whether the key is right: a refused one never replaces the key already there
            var x = new global.XMLHttpRequest();
            x.open("GET", "https://api.themoviedb.org/3/configuration?api_key=" + encodeURIComponent(v));
            x.timeout = 15000;
            x.onload = function () { if (x.status === 401) toast(T("TMDB refused this key: check it on themoviedb.org.")); else save(); };
            x.onerror = x.ontimeout = save;          // no network now: kept, it is checked when the Top Shelf asks
            x.send();
        }
        input.addEventListener("keydown", function (e) {
            if (e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); finish(true); }
            else if (e.keyCode === 27 || e.keyCode === 10009) { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        // Android's keyboard can take the focus when it closes ("Done"): what was typed is kept, as for profile names
        input.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== input) finish(true); }, 300); });
        setTimeout(function () { input.focus(); }, 50);
    }

    var baseTree = APL.settingsTree;
    APL.settingsTree = function () {
        var root = baseTree();
        var top = strip(root.children);
        top = without(top, hasInputs() ? ["Gaming"] : ["Gaming", "Sources"]);

        var appearance = find(top, "Appearance"), shelf = appearance && find(appearance.children, "Top Shelf");
        // Samsung's home rows there; on Android 11+, the apps' Watch Next row instead (WatchNext.kt)
        var watching = shelf && find(shelf.children, "What You're Watching");
        if (watching && B.watchNextSupported && B.watchNextSupported()) watching.desc = T("Continue Watching from the apps that fill Android TV's Play Next row (Nuvio, YouTube, Plex…), as cards over the Top Shelf. Android asks once to let APL Launcher read it.");
        else if (shelf) shelf.children = without(shelf.children, ["What You're Watching"]);
        var online = shelf && find(shelf.children, "Online Services");
        if (online && B.setKey) {
            online.desc = T("The keys are kept on this device. Type them here, or APL Launcher Setup sends them from the PC.");
            online.children = keyRows();
        }

        var home = find(top, "Home Screen");
        if (home) {
            var show = find(home.children, "Show on Home Screen");
            if (show && show.children[0] && show.children[0].id === "apl.samsunghome") {
                show.children[0].label = homeName;
                show.children[0].desc = T("Opens the device's own home screen ({name}). Press Home to come back.", { name: homeName });
            }
            var ret = find(home.children, "Return to the Launcher");
            if (ret) {
                if (!info.defaultHome) ret.desc = T("When an app closes, or the device starts, APL Launcher instead of the device's own home screen. Needs the remote buttons (Accessibility).");
                else home.children = without(home.children, ["Return to the Launcher"]);     // Android does it: Home really is APL Launcher
            }
        }

        var remote = find(top, "Remote and Devices");
        if (remote) {
            remote.children = without(remote.children, ["Alexa (Echo Dot)", "Bluetooth"]);
            remote.children.push(info.module ? opener(T("Turn On the Remote Buttons"), "accessibility", T("In Accessibility, choose APL Launcher Home Button and turn it on. Then Home opens APL Launcher, holding Home or ⏯ opens the Control Center over any app, and Sleep and the Sleep Timer work."), "remote")
                                             : action(T("Get APL Launcher Home Button"), function () { moduleHelp(); }, T("Home, holding Home and ⏯ over every app need a small second app, APL Launcher Home Button. It is separate because Google Play Protect blocks any app installed outside the Play Store that uses Accessibility."), "remote"));
            remote.children.push(opener(T("Remotes and Accessories"), "bluetooth", T("Bluetooth headphones, speakers, game controllers and remotes, in Android."), "bluetooth"));
        }

        var picture = find(top, "Picture");
        var pictureRows = [infoRow(T("Screen Resolution"), sys.display), infoRow("HDR", function () { return sys.hdr(); }),
                           opener(T("Picture Settings"), "display", T("The device's picture settings, in Android."), "display")];
        if (picture) picture.children = pictureRows;
        else after(top, "Users and Accounts", [menu(T("Picture"), "display", pictureRows, T("Picture Mode, colors and fine-tuning."))]);

        var sound = find(top, "Sound");
        if (sound) {
            sound.children = without(sound.children, ["Digital Output Audio Format", "Sound Output", "Expert Settings"]);
            sound.children.push(opener(T("Sound Settings"), "sound", T("Sound output, surround and the device's sound settings, in Android."), "speaker"));
            sound.children.push(opener(T("Remotes and Accessories"), "bluetooth", T("Bluetooth headphones, speakers, game controllers and remotes, in Android."), "bluetooth"));
        }

        var cnx = find(top, "Connection");
        if (cnx) {
            cnx.children = without(cnx.children, ["AirPlay", "HDMI"]);
            cnx.children.push(opener(T("Network Settings"), "wifi", T("Wi-Fi and Ethernet, in Android."), "wifi"));
        }

        var apps = find(top, "Apps");
        if (apps) {
            // Android 14 and later let an app close nothing but its own processes: that's for root there
            if (info.canClose) {
                apps.children.push({ type: "toggle", label: T("Close Unused Apps"), key: "idleClose",
                    desc: T("An app left in the background for more than 10 minutes is closed by Android (through the remote buttons, Accessibility). The app in front, music playing in the background and the launcher are never closed.") });
                apps.children.push(action(T("Free Up Memory"), freeMemory,
                    T("Asks Android to close the apps left in the background. They reopen normally, but start over from the beginning."), "reset"));
            }
            apps.children.push(opener(T("Manage Apps"), "apps", T("Storage, permissions, force stop, in Android."), "apps"));
        }

        var general = find(top, "General & Privacy");
        if (general) {
            general.children = without(general.children, ["Samsung Services", "Power and Energy Saving"]);
            general.children.push(opener(T("Android Settings"), "settings", T("Android's own settings: Wi-Fi, picture, sound, date, language, accounts, apps, reset."), "gear"));
        }

        var support = find(top, "Support");
        if (support) {
            var upd = find(support.children, "Launcher Update"), ver = upd && find(upd.children, "Version");
            support.children = without(support.children, ["Launcher Update"]);
            if (ver) { ver.desc = T("Updates come with a new APK, from the GitHub releases."); support.children.unshift(ver); }
            var about = find(support.children, "About This Screen");
            if (about) {
                about.label = T("About This Device");
                about.children = without(about.children, ["Link to Vetro"]);
                var tz = find(about.children, "Tizen Version");
                if (tz) tz.label = T("Android Version");
            }
        }

        top.splice(1, 0, androidMenu());
        root.children = top;
        return root;
    };

    /* ---------- the Control Center over the apps (cc.html) ---------- */
    if (OVERLAY) {
        var shownAt = 0;
        var stub = function (a) { return function () { B.launcherAction(a); }; };
        APL.settings = { open: function (section) { B.launcherAction(section ? "settings:" + section : "settings"); },
                         close: function () {}, isOpen: function () { return false; } };
        APL.search = { open: stub("search"), isOpen: function () { return false; } };
        APL.screensaver = { start: stub("screensaver"), isActive: function () { return false; } };
        APL.openSources = stub("sources");          // the launcher's Sources page, as Settings and Search
        if (APL.profilesUI) APL.profilesUI.open = stub("profiles");
        APL.alert = function (o) { toast((o && (o.title || o.message)) || ""); };
        APL.toast = function (msg, quiet) {
            if (quiet && sys.pref("dnd")) return;
            var t = document.getElementById("toast");
            if (!t) return;
            t.textContent = msg;
            t.classList.add("is-visible");
            clearTimeout(t._t);
            t._t = setTimeout(function () { t.classList.remove("is-visible"); }, 2600);
        };
        function theme() {
            var a = sys.pref("appearance"), h = new Date().getHours();
            document.body.classList.toggle("theme-light", a === "light" || (a === "auto" && h >= 7 && h < 20));
            document.body.classList.toggle("perf", !sys.pref("visualEffects"));
        }
        /* The launcher may have changed a setting since this page was loaded: it is read again */
        function snapshot() {
            try {
                var s = global.localStorage, p = JSON.parse(s.getItem("apl.profiles") || "{}");
                return (s.getItem("apl.prefs") || "") + "|" + (s.getItem("apl.profiles") || "") + "|" + (s.getItem("apl.prefs." + p.current) || "");
            } catch (e) { return ""; }
        }
        var seen = snapshot();
        global.__aplCcOpen = function () {
            if (snapshot() !== seen) { global.location.reload(); return; }    // opens again by itself once loaded
            theme();
            shownAt = Date.now();
            if (APL.controlCenter && !APL.controlCenter.isOpen()) APL.controlCenter.open();
        };
        global.__aplCcClosed = function () { closeCc(); };
        // The Control Center closed itself (Back, an item chosen): its window goes too
        new MutationObserver(function () {
            if (!document.body.classList.contains("has-cc") && Date.now() - shownAt > 200 && B.overlayShown()) B.closeOverlay();
        }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
        B.ccReady();
        if (B.overlayShown()) global.__aplCcOpen();
        return;
    }

    /* ---------- the Home Screen ---------- */
    /* Home on the remote: the same event as on Samsung, so launcher.js does what it does there
       (back to the first app, twice for the App Switcher) */
    function appcontrol() {
        var ev = document.createEvent("Event");
        ev.initEvent("appcontrol", false, false);
        global.dispatchEvent(ev);
    }
    listen("home", appcontrol);

    /* What the Control Center over an app asked for */
    function runAction(a) {
        if (!a) return;
        if (a !== "controlcenter") closeCc();
        if (a === "controlcenter") { if (APL.controlCenter) APL.controlCenter.toggle(); }
        else if (a === "settings") APL.settings.open();
        else if (a.indexOf("settings:") === 0) APL.settings.open(a.substr(9));
        else if (a === "search") { if (APL.search) APL.search.open(); }
        else if (a === "sources") { if (APL.openSources) APL.openSources(); }
        else if (a === "screensaver") { if (APL.screensaver) APL.screensaver.start(); }
        else if (a === "profiles") { if (APL.profilesUI) APL.profilesUI.open(); }
        else if (a === "switcher") { if (APL.switcher && !APL.switcher.isOpen()) APL.switcher.open(); }
    }
    listen("action", function (a) { setTimeout(function () { runAction(String(a || "")); }, 50); });

    /* Inputs pinned to the Home Screen: none on a device without HDMI inputs, even when the settings were copied
       from a TV that had them */
    if (APL.sources && APL.sources.homeTiles) {
        var pinnedTiles = APL.sources.homeTiles;
        APL.sources.homeTiles = function () { return hasInputs() ? pinnedTiles() : []; };
    }
    listen("homeRole", function () { fresh(); });
    listen("accessibility", function () { fresh(); });

    /* Back on the Home Screen: what the Control Center over an app changed (Do Not Disturb, Sleep Timer) */
    document.addEventListener("visibilitychange", function () {
        if (document.hidden) return;
        fresh();
        sys.readSleepTimer();
        inputsChanged();
        try {
            var p = JSON.parse(global.localStorage.getItem("apl.profiles") || "{}");
            var mine = JSON.parse(global.localStorage.getItem("apl.prefs." + p.current) || "{}");
            if ("dnd" in mine && mine.dnd !== sys.pref("dnd")) sys.setPref("dnd", mine.dnd);
        } catch (e) {}
    });

    /* ---------- the first starts: make it the Home app, then turn on the remote buttons ----------
       Asked at start-up until Home really opens APL Launcher, three times at most ("Later" waits for the
       next start); Settings › Android TV has the same steps. Where the device's own launcher has a system
       priority on Home (Android TV 12+, Google TV: info.homeBlocked), Android's question changes nothing
       and the device even goes back to its own home after it (tried): only the remote buttons are asked. */
    var setupWait = "";
    function homeWorks(i) { return !!(i.defaultHome || (i.accessibility && sys.pref("catchHome"))); }
    function setupDone() { toast(T("All set: Home now opens APL Launcher."), true); }
    function askRemoteButtons(alone) {
        var i = fresh();
        if (homeWorks(i)) { setupDone(); return; }
        if (!i.module) { moduleHelp(); return; }          // the module first: Play Protect keeps it out of the launcher itself
        APL.alert({ title: alone ? T("Turn On the Remote Buttons") : T("One More Step: the Remote Buttons"),
            message: T("This device keeps its own home screen on the Home button, even once APL Launcher is chosen. In Accessibility, choose APL Launcher Home Button and turn it on: Home then opens APL Launcher, and holding Home opens the Control Center over any app. Android then shows its usual warning about accessibility services: the module only sees the remote's buttons and which app is in front, and sends nothing anywhere."),
            buttons: [{ label: T("Open Accessibility"), run: function () { setupWait = "accessibility"; B.openSettings("accessibility"); } },
                      { label: T("Later") }] });
    }
    function askHome() {
        APL.alert({ title: T("Make APL Launcher Your Home Screen?"),
            message: T("So that the remote's Home button and the device's start-up open APL Launcher. Android then asks which app to use: choose APL Launcher, then Set as default."),
            buttons: [{ label: T("Continue"), run: function () {
                          var r = B.requestHome();
                          if (r === "role" || r === "settings") setupWait = "home";      // back here once Android has asked
                          else askRemoteButtons();
                      } },
                      { label: T("Later") }] });
    }
    function backFromAndroid() {
        var w = setupWait;
        setupWait = "";
        if (w === "home") setTimeout(askRemoteButtons, 400);
        else if (w === "module") { if (fresh().module) setTimeout(function () { askRemoteButtons(true); }, 400); }
        else if (w === "accessibility") {
            if (homeWorks(fresh())) setupDone();
            else toast(T("Not yet: in Accessibility, choose APL Launcher Home Button and turn it on. Settings › Android TV has it too."));
        }
    }
    listen("homeRole", function () { if (setupWait === "home") backFromAndroid(); });
    // The module installed from Downloader while the launcher waits behind it: the next step once back here
    listen("packages", function () { if (!setupWait && !homeWorks(fresh()) && info.module && !info.accessibility) setupWait = "module"; });
    document.addEventListener("visibilitychange", function () {
        // Android's Home settings and Accessibility say nothing when they close: the launcher showing again is the answer
        if (!document.hidden && setupWait) setTimeout(function () { if (setupWait && !document.hidden) backFromAndroid(); }, 600);
    });
    var listingsTries = 0;
    function askListings() {
        if (!B.requestWatchNext || !B.watchNextSupported() || B.watchNextAllowed() || !sys.pref("hubShelf") || sys.pref("listingsAsked")) return;
        var busy = document.hidden || (APL.settings && APL.settings.isOpen()) || (APL.alert && APL.alert.isOpen && APL.alert.isOpen()) || setupWait;
        if (busy) { if (++listingsTries < 40) setTimeout(askListings, 15000); return; }
        sys.setPref("listingsAsked", true);
        B.requestWatchNext();
    }
    // Turned on again in Settings: Android asks again if it was refused
    sys.onPref("hubShelf", function (v) { wnAt = 0; if (v && B.requestWatchNext && B.watchNextSupported() && !B.watchNextAllowed()) B.requestWatchNext(); });
    function firstStarts() {
        var i = fresh(), n = sys.pref("androidSetupAsked") || 0;
        // Updated from 1.1.3 or before, where the launcher had the Home button itself: once, why it's gone and where it is
        if (i.oldService && !i.module && !sys.pref("moduleNoticeShown") && !document.hidden) {
            sys.setPref("moduleNoticeShown", true);
            moduleHelp();
            return;
        }
        if (homeWorks(i) || n >= 3 || document.hidden) return;
        if ((APL.settings && APL.settings.isOpen()) || (APL.alert && APL.alert.isOpen && APL.alert.isOpen())) return;
        sys.setPref("androidSetupAsked", n + 1);
        if (i.homeBlocked || i.chosenHome) askRemoteButtons(true); else askHome();
    }

    /* Once the launcher has started: what it was opened for, otherwise the first starts' questions */
    setTimeout(function wait() {
        if (!global.APL_BOOT_OK) { setTimeout(wait, 300); return; }
        var a = String(B.takeAction() || "");
        if (a) runAction(a); else setTimeout(firstStarts, 1500);
        setTimeout(askListings, 6000);
    }, 300);
})(window);
