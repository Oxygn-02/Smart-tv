# Android TV launcher (shell)

A small native Android app that makes the launcher UI in `../launcher/` the TV's home screen. It shows the UI full screen in a WebView and gives it `window.Android` (`LauncherBridge.kt`) for the real things:

| UI feature | Android side |
|---|---|
| Dock: installed apps, real icons, launching | `PackageManager` (Leanback launcher apps) |
| Now playing, play/pause/skip, album colours | `MediaSessionManager` + `Palette` (needs notification access) |
| Continue watching | Most recently used apps, via `UsageStatsManager` (needs usage access) |
| Volume and mute (soundbar over HDMI ARC) | `AudioManager` |
| Games → HDMI 2 | `TvInputManager` + passthrough input intent |
| TV backlight colour and power | Govee LAN API over UDP (`GoveeLan.kt`) |
| Search with Google TV, Wi-Fi settings | System intents |
| Remote Back and Home | Forwarded to the UI (`launcherBack`, `launcherHome`) |

The UI is copied into the app on every build (`copyWebUi` in `app/build.gradle.kts`), so `launcher/` stays the one source of the design. The same page still runs in a normal browser, where `launcher/bridge.js` does nothing and the sample data is used.

## What each feature does on the TV

- **Now playing** shows whatever is coming out of the speakers: an app on the TV, or a phone or iPad casting to it (the Cast receiver publishes its own media session). If a session has no details it falls back to the media notification, then to "Playing on this TV". Needs *Now playing access* (Settings).
- **Weather** uses the TV's own location (Settings > Privacy > Location must be on; the launcher asks once), else the town set in Settings or on the phone page, else an approximate place from the internet connection. Data from Open-Meteo.
- **Govee**: lights and the TV backlight, through the Govee account. Needs the API key (see *Set up from your phone*). Lights that answer on the local network (Govee Home app > the light > LAN Control) are controlled instantly; the rest go through Govee's cloud. The cloud code follows Govee's published API but hasn't been run against a real account yet: Settings > Govee account and the setup screen show exactly what Govee answers.
- **Set up from your phone** (Settings): the TV shows an address and a four-digit code. On a phone on the same Wi-Fi, open the address, enter the code, then paste the Govee key, set the town, send wallpaper photos, or download the list of apps on the TV. The page only runs while that screen is open.
- **Wallpaper photos**: seven built in (`wallpapers/`), plus photos sent from a phone (kept in the app's private storage).
- **Home button** (Settings): asks Android to make this the home app. The TV shows its own question and you choose. It can be undone in the TV's settings, and the stock home screen stays installed.
- **Clean up apps** (Settings): lists the apps agreed for switching off; each row opens that app's page in the TV's Settings where you press Disable. See `../debloat/README.md`.

## Not done yet

- Picture sync (DreamView) only works if Govee lists it for the light in its cloud API; otherwise the button says so.
- Search results still use the sample catalogue. Real data: TMDB search and "where to watch" (JustWatch data) plus a pricing source.
- The Games switch to HDMI 2 depends on the TV's firmware allowing it; test it early.

## Build

Needs Android Studio (or JDK 17 and the Android SDK; set `sdk.dir` in `local.properties`). From this folder:

```sh
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio and run it on an Android TV emulator (Google TV image) first.

## Install without a computer

The latest test build is `tv.apk` at the top of the repo. To update, download it again the same way and choose Install; your settings are kept.

1. On the TV, install **Downloader** (by AFTVnews) from the Play Store.
2. Open Downloader, allow it to install apps when asked (or Settings › Apps › Security & restrictions › Unknown sources › Downloader), and enter:
   `raw.githubusercontent.com/Oxygn-02/Smart-tv/main/tv.apk`
   (capital O; it's case-sensitive). Choose Install.
3. Open **Smart TV Launcher** from your apps. The first time, it asks you to fit the screen: press Up or Down until the white border sits just inside the TV's edges, then OK (change it later in Settings > Screen size).
4. In Settings, press OK on **Now playing access** and **Recent apps access** and switch the launcher on in the screen that opens. Say yes if it asks about location.
5. Press OK on **Set up from your phone** and follow the steps to add your Govee key.

This installs it as a normal app; uninstalling it removes it completely. Making it the home screen (below) still needs adb.

## Install on the TV

Ask before each step that changes the TV (see `../CLAUDE.md`).

0. **Back up the TV first.** With adb connected (step 2), run `../debloat/backup-tv.sh --apks`. It only reads from the TV and saves its packages, home screen and settings to `debloat/backups/`. `../debloat/restore.sh <that folder>` puts the TV back.
1. On the TV: Settings › System › About › tap "Android TV OS build" 7 times, then turn on USB/wireless debugging in Developer options.
2. Connect and install:
   ```sh
   adb connect <tv-ip>:5555
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
3. Grant the two permissions the launcher needs:
   ```sh
   adb shell cmd notification allow_listener io.github.oxygn02.smarttv/io.github.oxygn02.smarttv.MediaListener
   adb shell appops set io.github.oxygn02.smarttv GET_USAGE_STATS allow
   ```
4. Open "Smart TV Launcher" from the apps row and try it. The Home button still goes to Google TV at this point.
5. Only once it works: make it the home screen by turning off the stock one (confirm the package name first with `adb shell pm list packages | grep -i launcher`):
   ```sh
   adb shell pm disable-user --user 0 com.google.android.apps.tv.launcherx
   ```
6. To undo at any time:
   ```sh
   adb shell pm enable com.google.android.apps.tv.launcherx
   ```
   or `../debloat/restore.sh --launcher-only`. Record it in `../debloat/disabled-packages.txt`.

After a firmware update, check that the TV hasn't switched the stock home screen back on.

## Clean-up over the TV's own debugging port (v0.8)
Settings > Clean up apps > Connect to the TV lets the launcher open a connection to this TV's network debugging port (5555) and read three facts: the model, the Android version, and how many apps are already switched off. The first time, the TV asks on screen to allow the launcher; press OK. It changes nothing. Switching apps off will use `pm disable-user` from the agreed list, with a matching restore (see debloat/README.md).
The ADB client is `AdbClient.kt`. Unit tests (`./gradlew testDebugUnitTest`) check its public key against a key made by the real `adb keygen`, and run a full connect, approve and shell round trip against a stand-in for the TV's adbd.
