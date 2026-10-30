# CLAUDE.md — TV launcher project

Read `HANDOFF.md` for full context and the design spec.

## Rules for this project

- **Ask before any change to the TV.** Propose ADB commands (with a reason per package) and wait for my OK before running `pm disable-user`, changing the default launcher, or anything similar.
- **Reversible only.** Use `pm disable-user --user 0`, never `pm uninstall`. Keep `debloat/disabled-packages.txt` and `debloat/restore.sh` up to date.
- **Never disable** the apps listed under "Apps I actually use" in HANDOFF.md, or the system update service, without asking.
- **Never disable the stock launcher** until the custom launcher is installed, set as default, and confirmed working.
- Launcher work: we build our own launcher (decided 30 Oct 2026, replacing the plan to reskin FLauncher). `android/` is a native shell that hosts the UI from `launcher/` in a WebView and gives it `window.Android` for real data. D-pad focus is our own spatial navigation in `launcher/app.js`. Test in an Android TV emulator before the real TV.
- The design lives in `launcher/` (iPadOS-inspired, Liquid Glass, Geist type, backlight-bleed glow in the room's light colour). Earlier designs are kept in `designs/`; `mockup/` is the original brief.
- Photos for wallpaper mode will be supplied by me in `wallpapers/`.
