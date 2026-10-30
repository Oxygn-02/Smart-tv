# Handoff: Logik Google TV — debloat + custom launcher

Context carried over from a planning/design chat (30 Oct 2026). Read this first, then `CLAUDE.md`.

## Goal

Make my Logik smart TV (runs **Google TV**, confirmed from the home screen — see `reference/01-current-logik-google-tv.jpeg`) faster and ad-free, and replace the stock home screen with a custom launcher that matches the mock-up in `mockup/`.

Two parts:
1. **Debloat** — disable (not uninstall) ads, recommendation and tracking packages over ADB. No root.
2. **Launcher** — take an existing **open-source** Android TV launcher as the base and rewrite only its UI layer to match the mock-up.

## Background (why this is feasible)

Since mid-Oct 2026 people have been pointing Claude Code at Android/Google TVs over wireless ADB to strip ads and bloat and write launchers. Repos to look at: **tv-vibehack**, **CleanYourTV** (says it supports ~92 models from 31 brands), **DumbTV**. Sources:
- https://techcrunch.com/2026/10/19/people-are-using-ai-to-make-their-smart-tvs-dumb-again/
- https://itsfoss.com/news/debloat-smart-tv/
- https://www.androidauthority.com/android-tv-vibe-hacking-remove-ads-bloatware-3725338/
- https://www.pcworld.com/article/3266473/please-dont-use-ai-hacks-to-debloat-your-tv.html (the risks)

## Decisions already made

- **Base on an existing open-source launcher, reskin it.** Keep its app-listing, launching and especially **D-pad focus/navigation** logic; rewrite visuals. Candidates: the launcher in tv-vibehack/CleanYourTV, or FLauncher (Flutter). Check the licence first (MIT fine; GPL fine for personal use).
- Projectivy is closed source — not usable as a base.
- Prototype in an **Android TV emulator** before installing on the real TV.

## Apps I actually use (must NOT be disabled)

YouTube, BBC iPlayer, ITVX, Channel 4, My5 (Channel 5), Prime Video, Google Play Store, Google Play Movies & TV, YouTube Music.

## Things to kill (seen on the stock home screen)

- Promoted hero banner (e.g. the Paramount+ "Star Trek" tile)
- Shop / Discover tabs
- Recommendation rows: "Top-selling movies", "Popular movies and TV shows", "Trending on Google"

## Design spec (final mock-up, v6)

Open `mockup/index.html` in a browser — it's a standalone, interactive copy. `mockup/canvas-source.dc.html` is the original canvas file (needs the Claude Design runtime; use for reference only).

**Canvas:** 1280×720 (scale to 1920×1080 on device).

**Look & feel:** sleek, thin, not childish. Font **Inter** weights 200–500 (clock 200, body 300, labels 400). Icon strokes 1.5px. Frosted glass surfaces: `backdrop-filter: blur(30px) saturate(160%)`. Card radius 28px, small tiles 22–24px, pill fully rounded.

**Themes** (toggle in sidebar):
| Token | Dark | Light |
|---|---|---|
| Base bg | `#050508` + faint radial glows (purple TL, blue TR, ember bottom) | `#eff0f5` + pastel radial glows (peach, periwinkle, apricot) |
| Ink | `#ececf1` | `#15151d` |
| Secondary text | ink @ 62% | ink @ 62% |
| Glass fill | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.5)` |
| Glass border | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.85)` |

Dark mode should be *very* dark — near black.

**Wallpaper modes** (toggle in sidebar): **gradient** (above) or **photo**. I'll supply real photos to cycle through in photo mode — do not recreate photos from the reference images. Photo mode currently shows a placeholder.

**Layout:**
- **Left sidebar** — vertical glass oval, 60px wide, vertically centred, 32px from left. Top group: Home, Search, Music, Live TV, All apps, Games (selected = soft filled circle). Divider. Bottom group: Wi-Fi, light/dark toggle, wallpaper toggle, Settings.
- **Header** — big thin clock (52px/200) + date to the right of it; weather summary top-right.
- **Widget grid** (2 columns, 1 : 1.2):
  - Left: **Now playing** card (YouTube Music) — source label, album art, title, artist, progress bar, prev / play-pause / next. Under it: **Weather** card — town, big temperature, condition, hi/lo, line icon.
  - Right: **Continue watching** hero — full-bleed artwork, source app with its colour dot (e.g. BBC iPlayer), title, "Series · Episode · time left", progress, Resume button. Under it: two smaller continue-watching cards (artwork, app, title, time left, progress).
- **App row** along the bottom — 7 glass tiles; focused tile gets a thin ring + soft glow in the app's brand colour.

Real app icons/banners should come from the installed apps (PackageManager `getApplicationBanner` / icon), not be hand-drawn.

## Data sources for the widgets (to investigate — not verified yet)

- **Now playing:** `MediaSessionManager.getActiveSessions()` — needs the launcher to hold notification-listener access (granted via ADB: `cmd notification allow_listener <component>`).
- **Continue watching:** Android TV "Watch Next" (`TvContractCompat.WatchNextPrograms`). Reading *other apps'* Watch Next rows may need a privileged permission — check on the device. Fallback: recently used apps via `UsageStatsManager` (grant `PACKAGE_USAGE_STATS` via `appops`).
- **Weather:** Open-Meteo (free, no API key). Location to be set by me in launcher settings.

## Suggested next steps

1. Get the TV model number (back of TV / Settings › System › About) and Android version.
2. Enable Developer options + wireless debugging; `adb connect <tv-ip>:<port>`.
3. `adb shell pm list packages` → produce a **proposed** disable list, with a reason per package. Show it to me before running anything.
4. Disable with `pm disable-user --user 0 <pkg>` (reversible: `pm enable`). Save the list to `debloat/disabled-packages.txt` plus a `restore.sh`.
5. Pick the base launcher, read its repo, map where UI is separated from logic.
6. Rebuild the UI to the spec above, test in the emulator, then install and set as default home.

## Risks / gotchas

- Don't disable the system **update** service unless I agree — it stops security fixes.
- Google TV can be stubborn about third-party home apps; the Home button may still open the stock launcher. Common workaround is disabling the stock launcher package (`com.google.android.apps.tv.launcherx` on many Google TV builds — confirm on device) **only after** the new launcher is installed and working, otherwise the TV can be left with no home screen.
- Never `pm uninstall` system packages; use `disable-user` so everything is reversible.
- Keep a working ADB connection while testing.
