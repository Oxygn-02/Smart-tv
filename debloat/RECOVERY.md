# Recovery: if the TV has no home screen or the launcher misbehaves

Everything this project does is reversible. Nothing was uninstalled.

## 1. Without a computer (in order)

1. **Hold Back for 3 seconds** as soon as the launcher appears (within 20 seconds).
   This is safe mode: it goes straight to Google's home screen, switching it
   back on first if it was switched off.
2. **Wait.** The launcher checks itself every time it comes to the front. If the
   page is blank or frozen it reloads; after three failures in a row (or three
   failed starts) it switches Google's home screen back on by itself. This needs
   USB debugging to stay on.
3. **Unplug the TV for 10 seconds**, then switch on. A restart re-runs the checks.
4. **Choose the home screen by hand:** Settings > Apps > Default apps (or Special app
   access) > Home app > Google TV / Android TV Home.
5. **Switch Google's home back on:** Settings > Apps > See all apps > Show system apps
   > Google TV Home (or Android TV Home) > Enable. Same for "Android TV
   Recommendations".
6. **Last resort, factory reset:** Settings > System > About > Reset. This wipes the
   TV, including every switched-off app (they all come back on). Re-install the
   launcher with Downloader from
   `raw.githubusercontent.com/Oxygn-02/Smart-tv/main/tv.apk`, then restore your
   settings from the phone page backup.

## 2. With a computer and adb

```sh
adb connect <tv-ip>:5555          # or a USB cable
# Google's home screen back on, and made the home screen
adb shell pm enable com.google.android.tvlauncher
adb shell pm enable com.google.android.tvrecommendations
adb shell pm enable com.google.android.apps.tv.launcherx
adb shell cmd package set-home-activity com.google.android.tvlauncher/.MainActivity
# Everything this project switched off, back on
./debloat/restore.sh               # all of it
./debloat/restore.sh --launcher-only
# Remove the launcher completely (only if you want to)
adb shell pm uninstall io.github.oxygn02.smarttv
```

The full list of what can be switched off, with reasons, is in
`debloat/disabled-packages.txt`. The TV's package list from before the first
change is saved by the launcher and can be downloaded from the phone setup page
("Package list before clean-up").

## 3. The safety-net drill (do this before switching Google's home screen off)

Do it with a computer and adb ready, ideally on an Android TV / Google TV emulator
in Android Studio first.

1. Install the launcher beside Google's home and make it the home screen.
2. Show Developer options (press OK on the Settings icon three times quickly), then Settings > Developer options > Debug connection and clean-up > Connect to the TV > Clean up the TV > **Test the safety net**. It must say Ready.
3. **Crash test:** `adb shell am crash io.github.oxygn02.smarttv` then press Home,
   three times. Google's home screen must come back on its own.
4. **Blank-page test:** `adb shell am force-stop com.google.android.webview` while the
   launcher is showing, three times. It must reload, then hand over.
5. **Safe mode:** start the launcher and hold Back for 3 seconds. Google's home appears.
6. **Reboot test:** reboot the TV and repeat step 3 once.
7. After a firmware (OTA) update: check Developer options > USB debugging is still on
   and repeat step 2. Some firmware switches Developer options off after an update,
   which disables the automatic rescue (safe mode and step 1.4 still work).

Only when all of this passes, switch Google's home screen off.
