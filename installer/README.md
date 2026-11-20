# APL Launcher Setup

`APL Launcher Setup.exe` is the Windows app that installs APL Launcher on the screen, optimizes it, restores it and opens the diagnostic tools. It replaces the `.bat` files: the PowerShell scripts in `scripts/` stay the engine, and the app runs them without questions (`APL_GUI=1`) and shows their progress.

It is a WPF app for the .NET Framework 4.8 that comes with Windows 10 and 11: nothing to install for users, no admin rights.

## Build

You need the C# compiler of [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) (C# workload) and git.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build.ps1
```

Output: `dist\APL Launcher Setup.exe` (`dist/` is not committed). The build:

- compiles every `installer\*.cs` with Roslyn `csc.exe` against the .NET Framework 4.8 assemblies (no NuGet, no MSBuild project);
- embeds every `installer\*.xaml` as a resource (loaded at run time with `XamlReader`), and `launcher\icon.png`;
- zips the **git-tracked** files of `launcher/`, `scripts/`, `overlay/`, `webos/` and `LICENSE` into the exe (never keys, avatars or certificates). A new script must be added to git (`git add`) to be part of the build;
- makes the icon (16, 32, 48 and 256 px) from `launcher\icon.png`;
- takes the version from `version="…"` on `<widget>` in `launcher\config.xml`.

## Where the app finds the scripts

- Next to the exe, or in its parent folder (`dist\` in a clone): the scripts of the clone are used as they are.
- Anywhere else: the embedded copy is extracted once to `%LOCALAPPDATA%\APL-Launcher\setup\<version>\` (refreshed when the exe changes).

Errors at start-up are written to `%LOCALAPPDATA%\APL-Launcher\setup.log` (never the keys).

## Contract with the scripts

The app starts `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts\<script>.ps1 …` with `APL_GUI=1` (and `APL_LANG=en|fr`), no window, standard input closed, and reads the output as UTF-8. Lines starting with `APL-CHECK`, `APL-PLAN`, `APL-STEP`, `APL-PROGRESS` and `APL-RESULT` drive the screens; every other line goes to *Details*. The websites are passed to `install.ps1 -Sites` as base64 (UTF-8 JSON).

## Options

| Argument | Effect |
|---|---|
| `--lang fr` / `--lang en` | Forces the language (default: French when Windows is in French). |
| `--shot <folder>` | Renders every page and state with fake data to PNG files in the folder, then quits without showing a window. Combine with `--lang`. In French it also writes `missing-fr.txt` (texts without a translation). |
| `--root <folder>` | Uses the scripts of another folder (for testing with fake scripts). |

## Files

| File | Role |
|---|---|
| `Program.cs` | Entry point, arguments, `setup.log` |
| `MainWindow.cs`, `MainWindow.xaml` | Window, sidebar, confirmation sheet, shared state |
| `PlatformPage.*` | The first page: Samsung, LG or Android TV, rooted or not (saved in `%APPDATA%\APL-Launcher\setup-platform.txt`) |
| `InstallPage.*` | Install on Samsung (`install.ps1`) |
| `DevicePage.*` | Install on LG (`install-webos.ps1`) or Android TV (`install-android.ps1`), one page for both |
| `OptimizePage.*`, `RestorePage.*`, `ToolsPage.*`, `AboutPage.xaml` | The other pages (Optimize, Restore and Tools are for Samsung: they work through Vetro) |
| `Styles.xaml` | Colors, fonts and the style of every control |
| `ScriptRunner.cs` | Runs the scripts and parses their marker lines |
| `Vetro.cs` | Vetro status check and the network scan (`GET /status` only) |
| `Payload.cs` | Finds or extracts the scripts |
| `Saved.cs` | Reads `tv-ip.txt` and `keys.local.js` to prefill the form |
| `Strings.cs`, `StringsFr.cs` | `T("English")` and the French texts |
| `Steps.cs`, `Ui.cs`, `Json.cs` | Step list, small UI helpers, minimal JSON |
| `Shots.cs` | `--shot` |

Every visible text is written in English in the code and the XAML, and goes through `T()`. To translate a new text, add it to `StringsFr.cs`; `--shot … --lang fr` lists the ones that are missing.
