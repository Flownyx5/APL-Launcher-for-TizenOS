# APL TV (in this fork)

APL TV is the IPTV player in APL Launcher's style made by **Knikt (Gero Corp.)**, MIT License (see `LICENSE`).
Original project: [Knikt/APL-TV-for-TizenOS](https://github.com/Knikt/APL-TV-for-TizenOS).

This folder is APL TV 1.0.10 (commit `0cfe9a2`) with the fork's changes, numbered 1.0.11 and up:

- **Home loads in one go.** Each piece of information arriving at start-up (the catalog, the trending titles, the
  hidden themes, the genres) used to draw every row of Home again, pictures included. Rows that did not change are
  now kept as they are, the changes that arrive by themselves are drawn once per burst, and the row in focus stays in
  focus when a row arrives above it.
- **No row twice.** A genre or "Top Rated" arriving while rows were still waiting their turn below the fold added the
  same rows again (on a big account: Comedy seventeen times, 101 rows instead of 20).
- **Covers only near the screen.** The rows on screen and the two after the one in focus load their covers and TMDB
  information; the others when the focus comes near (twenty rows asked for every cover at start-up).

APL TV updates itself from `apltv/app` of this repository (js/boot.js). APL Launcher Setup installs it from this
folder ("Also install APL TV"), or: `.\scripts\06-install-apltv.ps1 -TvIp <ip> -ProfileName <profile>`.
