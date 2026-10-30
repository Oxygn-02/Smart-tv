# Launcher UI prototype

**Design v2 (iPadOS-inspired, sized for a TV).** Floating glass tab bar along the top, a Home widget grid (analog clock, weather, now playing, continue watching) above a glass dock of apps, and a Customize panel for icon style (Default, Dark, Clear, Tinted), appearance (Light, Dark, Auto) and wallpaper (Photo, Gradient, Lights). Earlier designs are backed up in `designs/`.

**v0.3.** Tint sliders for icons (Customize), a dock that fits its icons, one type voice (Geist at medium weight, like the date), weather from the TV's location, seven wallpapers plus photos sent from a phone, a Room tab wired to the Govee account, Now playing from any source (apps and casts), a phone setup page, a Home-button setting and a Clean up apps screen. Colours are computed in `color.js` and `applyColors()` rather than with newer CSS, so an older TV browser can't drop the focus ring.

**Council review changes (v3).** Bright focus ring with a soft glow, distinct from "selected"; text at least 16px on the canvas (24px on a 1080p TV); 5% TV-safe margins; the clock widget is replaced by a Room status widget; Home starts focused on the dock; every Home widget has an empty state (turn off Settings › Sample content to preview them); plain labels in Room; top-right tools show their name on focus.

**Top bar and tabs.** Icons only; each shows its name when focused. Live TV was removed: no programme guide data is available to a third-party launcher, and opening a channel only duplicated the dock.

**Design pass (v4).** One idea carries the look: the backlight bleed. The screen edges glow in the room's light colour, like the Govee strip spilling onto the wall, and the focus ring is lit the same colour. In "Sync to TV" mode the glow follows whatever is focused. Everything else is quieter: Geist type on a 1.25 scale, sentence case, no dot-joined text, posters straight on the wallpaper, and one power-on moment instead of entrance animations on every section.

## Notes for the Android port

- Done: panels no longer blur live (that halved the frame rate on a slow processor). The wallpaper is blurred once into a small "frost" image that the panels show (`makeFrost` in `app.js`).
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
- **Search**: suggestions from installed apps only (on device: TMDB with JustWatch "where to watch" data, prices from a pricing source; "Search with Google TV" covers the rest). Free titles first; rent or buy titles show the price in the card's bottom corner.
- **Music**: now playing, a working up-next queue, and mixes.
- **All apps**: every installed app.
- **Games**: opening it switches the TV to the Xbox's HDMI input (HDMI 2) after a short countdown you can cancel. Input, countdown and auto-switch are set in Settings.
- **Settings**: weather town, appearance, wallpaper, Games input, Wi-Fi.

Real logos come from Simple Icons (CC0) where available. BBC iPlayer, My5 and Google TV use lettermarks until the device supplies their icons.

## Files

- `index.html`: page shell, loads the scripts below in order.
- `data.js`: placeholder content (now playing, weather, hero, continue watching, apps). Replace with real sources on device.
- `icons.js`: line icons copied from the mockup.
- `bridge.js`: on the TV, swaps sample data for real data from the Android shell (`../android/`); does nothing in a browser.
- `styles.css`: design tokens for dark and light, glass surfaces, and layout.
- `app.js`: builds the screen once, updates only changing nodes (so focus survives the clock tick), and handles D-pad focus.

## Not yet done

- Photo wallpapers: the photo mode shows the placeholder label. Real photos go in `wallpapers/`.
- Launching and input switching: the prototype shows a toast or a stand-in HDMI screen.
- Data: all content is static placeholder data. Show titles, tracks and prices are made up.

## App icons and real data (v0.3.1)

- Every app has a one-colour glyph for the Dark, Clear and Tinted icon styles: a logo, a hand-drawn glyph (BBC iPlayer, My5, Google TV), or one traced on the TV from the app's own icon (flat background removed). If tracing finds nothing clear, the app's letters are used. Default style shows the app's real icon.
- The top bar shows no hover text. Dock names remain.
- On the TV, only real data is shown: Search lists the installed apps (titles and prices come from Search with Google TV), the backlight reads "Not chosen yet" until you pick one, and volume is the TV's real volume.

## Room features (v0.5)
- **Light roles** (Room tab): give each light a place (ceiling, lamp, TV cabinet, monitor). Picking a backlight scene then colours the cabinet, monitor and lamp lights from the scene's palette (Spread to room). Lights with no place are left alone.
- **Gaming mode:** when Games switches the TV to the console, the Gaming scene runs (ceiling lights off, others dimmed, backlight on picture sync) and the lights return to how they were when you come back to the launcher. The console wakes through HDMI-CEC when the TV switches to its input, if both have CEC on.
- **Good night** scene and a **sleep timer** (15, 30 or 60 minutes) that turns every light off, even while another app is open.
- **Ambient screen:** after 5, 10 or 20 idle minutes (Settings), photos, the clock and weather; the ceiling lights go off and come back on the first key press.
- **Guest Wi-Fi:** save the network name and password on the phone setup page; Settings > Guest Wi-Fi shows a QR code guests scan. The password is stored in the launcher's private app storage and is only in the code.
