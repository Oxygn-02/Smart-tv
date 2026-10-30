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

## Not done yet

- DreamView on/off needs Govee's cloud API (API key); `goveeSync` returns false for now.
- Room lights other than the backlight aren't sent to Govee yet (their models are unknown).
- Search results still use the sample catalogue. Real data: TMDB search and "where to watch" (JustWatch data) plus a pricing source.
- The weather card still uses sample numbers; Open-Meteo goes here.
- The glass blur is live CSS. If it stutters on the TV, pre-blur the wallpaper (see `launcher/README.md`).

## Build

Needs Android Studio (or JDK 17 and the Android SDK). From this folder:

```sh
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio and run it on an Android TV emulator (Google TV image) first.

## Install on the TV

Ask before each step that changes the TV (see `../CLAUDE.md`).

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
   Add both commands to `debloat/disabled-packages.txt` and `debloat/restore.sh`.

After a firmware update, check that the TV hasn't switched the stock home screen back on.
