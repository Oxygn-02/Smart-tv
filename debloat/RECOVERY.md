# If the TV shows no home screen or the launcher misbehaves

Do these in order. All of it is reversible; nothing was uninstalled.

1. **Wait.** If the launcher fails to start three times it switches Google's home screen back on by itself (needs USB debugging left on).
2. **Press Home again, or unplug the TV for 10 seconds.** A restart re-runs the start-up check.
3. **Pick a home screen by hand.** Settings > Apps > Special app access > Home screen app (the wording varies), choose Google TV / Android TV Home.
4. **Turn Google's home back on.** Settings > Apps > See all apps > Show system apps > "Google TV Home" (or Android TV Home) > Enable. Do the same for "Android TV Recommendations".
5. **From a computer** (only if you ever get one): `debloat/restore.sh`, or `debloat/restore.sh --launcher-only`.
6. **Last resort:** Settings > System > Reset. This wipes the TV; the launcher is installed again from Downloader (`raw.githubusercontent.com/Oxygn-02/Smart-tv/main/tv.apk`).

If you cannot reach Settings at all, hold Home / the Settings button on the remote: the TV's own Settings are never switched off by this project.
