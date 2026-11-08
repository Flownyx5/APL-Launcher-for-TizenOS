# Apps2Samsung catalog entry

`Knikt__APL-Launcher-for-TizenOS.json` is the entry for [Apps2Samsung/tizen-community-packages](https://github.com/Apps2Samsung/tizen-community-packages) (copy it to `packages/` there in a PR; schema: `packages.schema.json` in that repo).

It offers two assets that `.github/workflows/setup.yml` attaches to every `v*` release, as two variants of one entry: `apl-launcher-full-v<version>.wgt` for Tizen 7 and newer (built by `tools/make-package.sh --overlay`) and the launcher-only `apl-launcher-v<version>.wgt` for Tizen 6. If you rename them, update `match` here and in the catalog.

`user_settings` writes the optional API keys into `res/wgt/js/keys.local.js` before Apps2Samsung re-signs the package: the web part of the hybrid package, and in the launcher-only package a second copy at that same path (since 1.0.20), which `launcher/js/liveshelf.js` reads when `js/keys.local.js` has no key. One path for both, as Apps2Samsung needs: a missing `find` fails the install. The `find` strings are the `tmdb: "",` lines of `launcher/js/keys.example.js`, which the package ships as `keys.local.js`: if you change those lines, change the entry too (`make-package.sh` fails when they are missing).

The package is hybrid: the launcher (web, under `res/wgt/`), APL Overlay (`APLauncher.Overlay`) and two .NET services, the bridge to Vetro and the start-up service (built by `tools/make-overlay.sh`, manifest in `overlay/hybrid/`). `cert_level` is `partner`: the launcher's privileges need it.
