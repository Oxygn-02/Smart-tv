# Launcher UI prototype

**Design v2 (iPadOS-inspired, sized for a TV).** Floating glass tab bar along the top, a Home widget grid (analog clock, weather, now playing, continue watching) above a glass dock of apps, and a Customize panel for icon style (Default, Dark, Clear, Tinted), appearance (Light, Dark, Auto) and wallpaper (Photo, Gradient, Lights). Earlier designs are backed up in `designs/`.

**Council review changes (v3).** Bright focus ring with a soft glow, distinct from "selected"; text at least 16px on the canvas (24px on a 1080p TV); 5% TV-safe margins; the clock widget is replaced by a Room status widget; Home starts focused on the dock; every Home widget has an empty state (turn off Settings › Sample content to preview them); plain labels in Room; top-right tools show their name on focus.

**Design pass (v4).** One idea carries the look: the backlight bleed. The screen edges glow in the room's light colour, like the Govee strip spilling onto the wall, and the focus ring is lit the same colour. In "Sync to TV" mode the glow follows whatever is focused. Everything else is quieter: Geist type on a 1.25 scale, sentence case, no dot-joined text, posters straight on the wallpaper, and one power-on moment instead of entrance animations on every section.

## Notes for the Android port

- Blur the wallpaper once when it's set and draw the panels as translucent fills over that image. Live blur behind every panel will stutter on a budget TV chip.
- Watch memory: on a 1.5–2 GB TV, Android may close the launcher while an app is open. Keep startup fast and remember focus.
- Prove each data source on the TV before relying on it: media session (Now playing), Watch Next (Continue watching), HDMI input switching, Govee LAN control. The empty states cover the ones that fail.
- Disable the stock launcher only after this one is installed, set as default and working (see `HANDOFF.md`), and keep a way back. Re-check after firmware updates.

Standalone web version of the TV home screen, built to match `mockup/index.html` and the spec in `HANDOFF.md`. It exists so the UI can be iterated on before it is ported to the Android launcher.

## Run

Open `index.html` in a browser, or serve the folder:

```sh
cd launcher && python3 -m http.server 8080
```

## Controls

| Input | Action |
|---|---|
| Arrow keys | Move focus to the nearest control in that direction (D-pad) |
| Enter / Space | Activate the focused control |
| Esc / Backspace | Back: close the Games overlay, or return to Home |
| Mouse / touch | Click any control |

## Tabs

- **Home**: now playing, weather, continue watching, pinned apps.
- **Search**: suggestions from installed apps only. Free titles first; rent or buy titles show the price in the card's bottom corner.
- **Music**: now playing, a working up-next queue, and mixes.
- **Live TV**: Freeview channels with now and next. Each opens in the broadcaster's app.
- **All apps**: every installed app.
- **Games**: opening it switches the TV to the Xbox's HDMI input (HDMI 2) after a short countdown you can cancel. Input, countdown and auto-switch are set in Settings.
- **Settings**: weather town, appearance, wallpaper, Games input, Wi-Fi.

Real logos come from Simple Icons (CC0) where available. BBC iPlayer, My5 and Google TV use lettermarks until the device supplies their icons.

## Files

- `index.html`: page shell, loads the scripts below in order.
- `data.js`: placeholder content (now playing, weather, hero, continue watching, apps). Replace with real sources on device.
- `icons.js`: line icons copied from the mockup.
- `styles.css`: design tokens for dark and light, glass surfaces, and layout.
- `app.js`: builds the screen once, updates only changing nodes (so focus survives the clock tick), and handles D-pad focus.

## Not yet done

- Photo wallpapers: the photo mode shows the placeholder label. Real photos go in `wallpapers/`.
- Launching and input switching: the prototype shows a toast or a stand-in HDMI screen.
- Data: all content is static placeholder data. Show titles, tracks and prices are made up.
