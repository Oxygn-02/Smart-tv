# Launcher UI prototype

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
| Mouse / touch | Click any control |

## Files

- `index.html`: page shell, loads the scripts below in order.
- `data.js`: placeholder content (now playing, weather, hero, continue watching, apps). Replace with real sources on device.
- `icons.js`: line icons copied from the mockup.
- `styles.css`: design tokens for dark and light, glass surfaces, and layout.
- `app.js`: builds the screen once, updates only changing nodes (so focus survives the clock tick), and handles D-pad focus.

## Not yet done

- Photo wallpapers: the photo mode shows the placeholder label. Real photos go in `wallpapers/`.
- App icons: colour swatches stand in for real icons read from `PackageManager`.
- Launching: clicking an app only logs to the console.
- Data: all content is static placeholder data.
