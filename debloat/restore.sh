#!/usr/bin/env bash
# Put the TV back the way a backup recorded it: re-enable every package that
# was enabled at backup time but is disabled now (including the stock home
# screen). Nothing is uninstalled or reinstalled; this only undoes
# `pm disable-user`.
#
# Usage:  ./restore.sh backups/tv-<serial>-<date>
#         ./restore.sh --launcher-only   (just bring back the stock home screen)

set -euo pipefail

STOCK_LAUNCHER=com.google.android.apps.tv.launcherx

if ! adb get-state >/dev/null 2>&1; then
  echo "No TV connected. Run: adb connect <tv-ip>:5555" >&2
  exit 1
fi

if [[ "${1:-}" == "--launcher-only" ]]; then
  adb shell pm enable "$STOCK_LAUNCHER"
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
