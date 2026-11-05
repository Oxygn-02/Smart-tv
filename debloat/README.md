# Cleaning up the TV

The aim is a faster, ad-free TV: switch off the apps and background services that only add adverts, recommendations and tracking. Nothing is ever uninstalled, and everything can be switched back on.

## How it works (no computer needed)

1. In the launcher, Settings > **Set up from your phone**. On a phone on the same Wi-Fi, open the address and enter the code, then choose **Open the list** under *Apps on the TV*. That is a plain list of every app on the TV: its name, whether it is a system app, and whether it is on.
2. Send that list to Claude (paste it, or a screenshot). Claude proposes what to switch off, **with a reason for every app**, and nothing is touched until you say yes. Apps you use (see `HANDOFF.md`), the system updater and anything the TV needs to work are never on the list.
3. The agreed apps go into `cleanup` in `launcher/data.js`. Settings > **Clean up apps** then lists them. Press OK on one: the TV's own Settings opens on that app, where you press **Disable**. Press Back and the row shows Off.
4. To undo any of them, open the same row and press **Enable**.

Record each switched-off app in `disabled-packages.txt` with its reason.

## Making the launcher the home app

Settings > **Home button** asks Android to make Smart TV Launcher the home app. The TV shows its own question. If the Home button still opens Google TV afterwards, the stock home screen has to be switched off too, and that is done last: only once the launcher has been used for a while and works. It is switched off the same way as any other app (Disable in the TV's Settings) and switched back on the same way.

## With a computer (optional)

`backup-tv.sh` saves the TV's app list and settings before any change, and `restore.sh` re-enables anything switched off since. They need adb; see `../android/README.md`.

## Choosing apps from the phone (v0.9)
On the phone setup page, **Apps to switch off** lists the apps that show an icon on the TV. Tick the ones you don't want and send the choice. Apps the TV needs (home screens, TV inputs, system and Google services, the update service) and the apps you use are locked and can't be ticked. In the launcher, Settings > Apps > Apps you don't use shows the choice. After **Connect to the TV** (see android/README.md) the launcher switches the chosen apps off with `pm disable-user --user 0`, after a second confirmation, and keeps a list so **Switch back on** undoes it with `pm enable`. The stock launcher is never offered.

## The deeper clean-up and the home screen (v0.11)
In Settings > Developer options > Debug connection and clean-up, after **Connect to the TV**, the launcher shows **Make this my home screen** (runs `cmd package set-home-activity`; the previous home screen is remembered and **Put Google's home screen back** undoes it) and **Clean up the TV**. The list is in `disabled-packages.txt` with a reason for each package. Recommended items switch off together after a second confirmation; careful items one at a time; Google's home screen and recommendations only once this launcher is the home screen. Nothing is uninstalled, and **Switch back on what I switched off** reverses everything.

## Updates
Settings > Apps > **Check for updates** reads `version.json` in this repository, and if a newer launcher is there, downloads `tv.apk` and hands it to Android's installer (Android asks you to confirm; the first time it asks you to allow this app to install apps). Downloader stays installed and is never offered for switching off, as a second route.

## Safety net, scenes, updates and backup (v0.12)

- **Safety net.** If this launcher fails to start three times in a row, or never reports ready within 40 seconds, it switches Google's home screen back on by itself (over the TV's own trusted debug connection) and hands over to it. This needs USB debugging to stay on and the "Always allow" key to stay trusted. Run Settings > Developer options > Debug connection and clean-up > Clean up the TV > Test the safety net first: it only checks, it changes nothing. Google's home screen group stays locked until this launcher is the home screen and that test has passed. The rescue has not been run on a real TV yet.
- **My scenes.** Room > Save this as a scene stores the current lights and backlight under a name. Settings > Lights > My scenes deletes them.
- **Update available.** The launcher checks `version.json` 8 seconds after start and every 6 hours, and shows a small update button in the top bar when a newer version exists. Press OK on it to install.
- **Backup.** Settings are mirrored on the TV and can be downloaded from the phone setup page (Backup) and restored there after a reinstall. Keys and the Wi-Fi password are not included.

- **For you / Inputs (v0.13).** Search shows a "For you" row (your apps' own recommendations plus popular titles on your services), search results use landscape thumbnails, and the Apps tab has an Inputs row (HDMI, aerial). See `debloat/PROPOSAL-next.md` and `debloat/RECOVERY.md`.

- **Title pages (v0.15).** Pressing a film or series in Search opens its page: poster, rating, description, a muted trailer fading in behind it (Customize > Trailers turns it off) and every UK service that carries it, free first, with Open or Install. Prices (like £3.99) need the optional free Watchmode key on the phone page; without it the page says Rent or Buy with no price.

- **Keep this screen in front (v0.16, three modes in v0.17).** Settings > Apps > Music in the background. Off, Casts only (songs cast from a phone; music you start inside YouTube Music stays put), or Casts and YouTube Music (the launcher returns 3.5 s after music starts). Needs Now playing access and USB debugging. Videos are left alone.

## What's new in v0.20

- **Developer options are hidden.** Focus the Settings icon (top right) and press OK three times quickly. They appear at the end of Settings: Debug connection and clean-up (connect, safety net, home screen, Clean up the TV), Diagnostics, Now playing access, Update channel, Continue watching check, Speed test, Show the welcome again, and Hide developer options.
- **Everyday Settings in plain words:** Appearance, Apps (Home button, Apps you don't use, Music in the background, Check for updates), Lights, Games, Phone and Wi-Fi.
- **A welcome on first start** with what is set up (lights, films and series, weather) and Set up with my phone, instead of the fit-the-screen tool (still in Appearance > Fit to screen).
- **Focus lifts instead of ringing:** cards grow with a deeper shadow and a sheen; buttons, rows and tabs turn white.
- **Labels on the top-right icons**, placeholder cards while searching, For you says why it is empty, dark by default, a softer edge glow, a thin strip of white glass at the bottom when there is more to scroll, and a fade-in at start.

## What's new in v0.22

- **AirPlay speaker.** The TV shows up as "Living Room TV" in the AirPlay list on your iPhone or iPad (Control Centre, or the AirPlay button in any app). Music from any app (YouTube Music, Apple Music, Spotify, podcasts) plays inside the launcher, so no other app opens, and Now playing shows the song, artist and artwork; play, pause and skip on the TV control the phone. Settings > Apps > AirPlay speaker turns it off. Audio only (AirPlay 1), about 2 seconds behind the phone, same Wi-Fi needed.
- **Fixed:** Settings > Apps > Music in the background now changes when you press OK (the switch had lost its connection to the Android side in v0.18). A new test stops that kind of break from shipping again.
