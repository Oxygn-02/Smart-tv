#!/usr/bin/env bash
# Back up the TV's current state before changing anything. Read-only: this
# script only reads from the TV.
#
# Usage:  ./backup-tv.sh [--apks]
#   --apks   also copy the APKs of apps you installed yourself (not system apps)
#
# Needs adb connected to the TV first:  adb connect <tv-ip>:5555
# Saves to backups/tv-<serial>-<date>/ next to this script.

set -euo pipefail

if ! adb get-state >/dev/null 2>&1; then
  echo "No TV connected. Run: adb connect <tv-ip>:5555" >&2
  exit 1
fi

serial=$(adb shell getprop ro.serialno | tr -d '\r')
out="$(dirname "$0")/backups/tv-${serial:-unknown}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
sh() { adb shell "$@" | tr -d '\r'; }

echo "Backing up to $out"

# What the TV is: model, Android version, build
sh getprop > "$out/device-properties.txt"
{
  echo "model:   $(sh getprop ro.product.model)"
  echo "maker:   $(sh getprop ro.product.manufacturer)"
  echo "android: $(sh getprop ro.build.version.release) (SDK $(sh getprop ro.build.version.sdk))"
  echo "build:   $(sh getprop ro.build.display.id)"
  echo "serial:  $serial"
} > "$out/device.txt"

# Every package and its state; restore.sh uses the enabled/disabled lists
sh pm list packages -f   | sed 's/^package://' | sort > "$out/packages-all.txt"
sh pm list packages -e   | sed 's/^package://' | sort > "$out/packages-enabled.txt"
sh pm list packages -d   | sed 's/^package://' | sort > "$out/packages-disabled.txt"
sh pm list packages -s   | sed 's/^package://' | sort > "$out/packages-system.txt"
sh pm list packages -3   | sed 's/^package://' | sort > "$out/packages-user-installed.txt"

# Which app is the home screen now (the stock launcher)
sh cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN \
  > "$out/home-screen.txt" || true

# System settings (no Wi-Fi passwords live here)
for ns in global secure system; do
  sh settings list "$ns" > "$out/settings-$ns.txt" || true
done

if [[ "${1:-}" == "--apks" ]]; then
  mkdir -p "$out/apks"
  while read -r pkg; do
    sh pm path "$pkg" | sed 's/^package://' | while read -r path; do
      adb pull "$path" "$out/apks/${pkg}__$(basename "$path")" >/dev/null
    done
  done < "$out/packages-user-installed.txt"
fi

echo
cat "$out/device.txt"
echo "home screen: $(tail -1 "$out/home-screen.txt" 2>/dev/null)"
echo "packages: $(wc -l < "$out/packages-all.txt") total, $(wc -l < "$out/packages-disabled.txt") disabled"
echo "Done. Keep this folder: restore.sh uses it to put the TV back."
