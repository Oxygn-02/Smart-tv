#!/usr/bin/env bash
# Put the TV back the way a backup recorded it: re-enable every package that
# was enabled at backup time but is disabled now (including the stock home
# screen). Nothing is uninstalled or reinstalled; this only undoes
# `pm disable-user`.
#
# Usage:  ./restore.sh backups/tv-<serial>-<date>
#         ./restore.sh --launcher-only   (just bring back the stock home screen)

set -euo pipefail

# Google's home screen is com.google.android.tvlauncher on the Logik 4K Android TV (Android TV 11);
# newer Google TV firmware uses com.google.android.apps.tv.launcherx. Enabling a package that isn't
# there is harmless.
STOCK_LAUNCHERS=(com.google.android.tvlauncher com.google.android.tvrecommendations com.google.android.apps.tv.launcherx)

if ! adb get-state >/dev/null 2>&1; then
  echo "No TV connected. Run: adb connect <tv-ip>:5555" >&2
  exit 1
fi

if [[ "${1:-}" == "--launcher-only" ]]; then
  for pkg in "${STOCK_LAUNCHERS[@]}"; do adb shell pm enable "$pkg" || true; done
  # Make the TV answer the Home button with Google's home screen again.
  adb shell cmd package set-home-activity com.google.android.tvlauncher/.MainActivity 2>/dev/null || true
  exit 0
fi

backup="${1:?Usage: ./restore.sh backups/tv-<serial>-<date>}"
[[ -f "$backup/packages-enabled.txt" ]] || { echo "Not a backup folder: $backup" >&2; exit 1; }

now_disabled=$(adb shell pm list packages -d | tr -d '\r' | sed 's/^package://' | sort)
to_enable=$(comm -12 <(sort "$backup/packages-enabled.txt") <(echo "$now_disabled"))

if [[ -z "$to_enable" ]]; then
  echo "Nothing to restore: every package enabled at backup time is still enabled."
  exit 0
fi

echo "Re-enabling:"
echo "$to_enable"
while read -r pkg; do
  adb shell pm enable "$pkg" >/dev/null && echo "  enabled $pkg"
done <<< "$to_enable"
