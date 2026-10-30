# CLAUDE.md — TV launcher project

Read `HANDOFF.md` for full context and the design spec.

## Rules for this project

- **Ask before any change to the TV.** Propose ADB commands (with a reason per package) and wait for my OK before running `pm disable-user`, changing the default launcher, or anything similar.
- **Reversible only.** Use `pm disable-user --user 0`, never `pm uninstall`. Keep `debloat/disabled-packages.txt` and `debloat/restore.sh` up to date.
- **Never disable** the apps listed under "Apps I actually use" in HANDOFF.md, or the system update service, without asking.
- **Never disable the stock launcher** until the custom launcher is installed, set as default, and confirmed working.
- Launcher work: reuse the base launcher's focus/D-pad handling; change the visual layer. Test in an Android TV emulator before the real TV.
- Match `mockup/index.html` for the UI: thin Inter type, frosted glass, near-black dark mode, light mode, gradient/photo wallpaper toggle.
- Photos for wallpaper mode will be supplied by me in `wallpapers/`.
