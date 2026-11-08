# APL Launcher pour Tizen OS

Un écran d'accueil **façon Apple TV** pour les TV et Smart Monitors Samsung
(Tizen) : Top Shelf, dock en verre, Centre de contrôle, Réglages, Sources… et
plus aucun menu Samsung.

Créé par Knikt (Gero Corp.)

![Accueil](docs/images/home.jpg)

**[▶ L'essayer dans le navigateur](https://knikt.github.io/APL-Launcher-for-TizenOS/)** : rien à télécharger, rien ne touche à ta TV.
Flèches, Entrée et Échap (ou la télécommande à l'écran).

La documentation complète est en anglais : [README.md](README.md). Ce qui marche, écran par écran et
fonction par fonction : [docs/compatibility.md](docs/compatibility.md).

## Ce qu'il faut avant

- **Vetro, obligatoire** : [Vetro](https://github.com/andrearicci93/vetro) doit
  être installé et lancé sur l'écran **avant** APL Launcher. Il donne l'accès
  root par un petit service sur l'écran : sans lui, pas de touche Home, pas de
  Centre de contrôle sur les vidéos, pas d'Alexa, pas d'optimisation. Installe-le
  avec **le guide de Vetro** (l'écran doit être rooté), puis vérifie que
  `http://<ip-de-l-écran>:8099` s'ouvre sur le PC.
- **Un PC Windows 10 ou 11**, sur le même réseau que l'écran.
- **[Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)**
  avec la ligne de commande et la *Samsung Certificate Extension*.
- **Un certificat Samsung** (auteur + distributeur) fait pour ton écran, par
  Tizen Studio ou Apps2Samsung. L'installateur le trouve tout seul. Garde-le
  précieusement : les mises à jour doivent être signées avec le même.

TizenBrew et TizenTube ne sont **pas** nécessaires. Rien d'autre que le launcher
et son petit assistant, APL Overlay, n'est installé sur l'écran.

## Installer

1. **Installe Vetro** sur l'écran (voir plus haut).
2. **Télécharge APL Launcher Setup** (`APL-Launcher-Setup.exe`) dans la
   [dernière version](https://github.com/Knikt/APL-Launcher-for-TizenOS/releases/latest) et ouvre-le. Si Windows dit que l'app n'est pas signée :
   *Informations complémentaires › Exécuter quand même*.
3. Page **Installer** : le logiciel trouve l'écran (ou tape son adresse IP),
   vérifie Tizen Studio, le certificat Samsung sur le PC, et prend les clés
   TMDB, YouTube et Fanart.tv (facultatives) et les sites à afficher comme des apps.
   Clique sur **Installer** : il compile, signe, installe le launcher et APL Overlay
   par Vetro, puis ouvre le launcher.
4. Termine une seule fois, comme le logiciel te le montre :
   - **sur l'écran** : *Paramètres › Tous les paramètres › Fonctions avancées* →
     **Lancer Smart Hub automatiquement** : Désactivé ;
     **Lancer automatiquement la dernière app** : Activé ;
   - **dans Vetro** › **Remapper** : choisis ta télécommande dans la liste des
     appareils (**Smart Control 2016** si elle est appairée en Bluetooth,
     **wt61p807 rc device** si elle marche en infrarouge seulement ; pour l'appairer :
     vise l'écran et maintiens **Retour** et **⏯** ensemble 3 secondes), touche
     **Home** → **APL Launcher**, puis active **Remote interception**. Clique ensuite
     sur **C'est fait — configurer les boutons** : Home et ⏯ passent à APL Overlay
     (et Samsung TV Plus / Prime Video si AquaPlay / TizenTube sont installés).

   Après un redémarrage complet, Vetro met jusqu'à 2 minutes à reprendre la main.
5. Facultatif : la page **Optimiser** retire les apps et services inutiles.
   Elle montre tout et attend ta confirmation.
6. Facultatif : **Alexa** sur le bouton micro : *Réglages › Fonctions avancées ›
   Alexa sur le bouton micro* dans le launcher, choisis Amazon Alexa et connecte
   ton compte Amazon (télécommande appairée en Bluetooth).

**Un problème ?** La page **Restaurer** remet le bouton Home et le menu Samsung, et
annule l'optimisation.

## Mises à jour

Automatiques : l'écran vérifie GitHub toutes les 6 h,
s'installe tout seul la nouvelle version, et revient de lui-même à la version
installée si la nouvelle ne démarre pas. Rouvre APL Launcher Setup seulement quand
l'écran le demande, ou pour mettre à jour APL Overlay.

## APL Launcher Setup

Un seul logiciel Windows, en français quand Windows est en français. Rien à
installer pour le lancer.

| Page | Rôle |
|---|---|
| **Installer** | Trouve l'écran, vérifie le PC, compile, signe, installe le launcher et APL Overlay, puis guide les deux derniers réglages. Peut aussi installer [APL TV](https://github.com/Knikt/APL-TV-for-TizenOS), le lecteur IPTV dans le même style pour tes propres playlists. |
| **Optimiser** | Allège l'écran (apps, pubs, pistage, Bixby). Montre tout avant ; réversible. |
| **Restaurer** | Rend le bouton Home à Samsung et annule l'optimisation ; peut aussi désinstaller le launcher. |
| **Outils** | Aperçu du launcher sur le PC, réparation de TizenBrew et TizenTube, diagnostics en lecture seule, ouvrir Vetro. |

## Sur l'écran

- **Home** deux fois : le sélecteur d'apps. **Home maintenu** ou **⏯** : le Centre de contrôle, même sur une vidéo.
- **OK maintenu sur une app** : Modifier l'écran d'accueil, Masquer l'app, Supprimer l'app.
- **Continuer de regarder** : pour AquaPlay, Hot Player et Stremio, la dernière
  chaîne avec son logo, ou le film ou la série en cours avec son image, l'épisode
  et la jauge.
- **Sources** : OK pour passer sur une entrée ; OK maintenu pour choisir
  l'appareil branché (Switch 2, Steam Deck, PS5…).
- **Réglages** : tous les menus de l'écran, à la façon d'Apple TV.
- **Profils** (avatar en haut à droite, depuis le Centre de contrôle) : chaque
  personne a son accueil, ses apps masquées, ses préférences et son historique.
  OK maintenu sur un profil : choisir son **Memoji**. Tes propres Memoji : mets
  les images PNG dans *Images › APL Launcher avatars* sur le PC, puis relance
  l'installation.
- **Économiseur d'écran** : les vidéos aériennes d'Apple, en 4K.
- Les apps laissées **10 minutes en fond** se ferment toutes seules, jamais celle
  qui est devant (*Réglages › Apps* pour couper).
- **Langue** : le launcher est en français quand l'écran l'est, en anglais sinon ;
  *Réglages › Général et Confidentialité › Langue* pour choisir.

Le launcher lui-même reste en 1920×1080 : sur ces écrans, la couche qui dessine
les apps et les menus n'a que ce mode. Seules les vidéos passent en 4K.

Guide complet (en anglais) : [docs/user-guide.md](docs/user-guide.md).

## APL TV

**[APL TV](https://github.com/Knikt/APL-TV-for-TizenOS)** est le lecteur IPTV fait pour aller avec APL Launcher, par le
même créateur : TV en direct, films et séries depuis tes propres playlists M3U et comptes Xtream, dans le
même style Apple TV.

[![APL TV : l'accueil, la page d'un titre, la TV en direct et le lecteur](https://raw.githubusercontent.com/Knikt/APL-TV-for-TizenOS/main/docs/images/home.jpg)](https://github.com/Knikt/APL-TV-for-TizenOS)

- **TV en direct** avec la chaîne qui joue derrière l'interface, un **guide des programmes** en grille et le
  **multi-écran** (jusqu'à 4 chaînes à la fois).
- **Films et séries** avec le résumé en français, le casting, les notes IMDb, les saisons et les épisodes, et
  les âges conseillés à la française (-12, -16…).
- **Reprendre la lecture**, chaînes favorites, **recherche** au clavier ou avec **Alexa**, et réglage depuis
  le téléphone avec un QR code.
- **Fait pour APL Launcher** : sur l'accueil, le Top Shelf d'APL TV montre ce que tu regardais et ta dernière
  chaîne, et OK l'ouvre directement au bon endroit.
- **S'installe** avec APL Launcher Setup (page *Installer* › *Installer aussi APL TV*) ou depuis ses
  [versions](https://github.com/Knikt/APL-TV-for-TizenOS/releases/latest). Pas besoin de root, Tizen 6 ou plus récent.

APL TV n'est qu'un lecteur : aucune chaîne, aucune playlist, aucun fournisseur. À utiliser avec des contenus
que tu as le droit de regarder.

## Soutenir APL Launcher

APL Launcher est gratuit, open source et fait par une seule personne sur son temps libre. Si tu l'aimes et que tu veux m'aider, tu peux m'offrir un café sur [Ko-fi](https://ko-fi.com/knikt). Ce n'est jamais obligatoire et tout reste gratuit. La même page soutient aussi [APL TV](https://github.com/Knikt/APL-TV-for-TizenOS).

[![Me soutenir sur Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/knikt)

## Licence

APL Launcher est créé par Knikt (Gero Corp.). Code sous [licence MIT](LICENSE). APL Launcher est un projet indépendant, sans lien
avec Apple, Samsung ou Amazon ; leurs marques et logos appartiennent à leurs
propriétaires.
