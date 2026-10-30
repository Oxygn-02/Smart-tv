# Launcher UI prototype

**Design v2 (iPadOS-inspired, sized for a TV).** Floating glass tab bar along the top, a Home widget grid (analog clock, weather, now playing, continue watching) above a glass dock of apps, and a Customize panel for icon style (Default, Dark, Clear, Tinted), appearance (Light, Dark, Auto) and wallpaper (Photo, Gradient, Lights). The first design is backed up in `designs/v1-sidebar/`.

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
