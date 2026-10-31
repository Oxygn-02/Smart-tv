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
On the phone setup page, **Apps to switch off** lists the apps that show an icon on the TV. Tick the ones you don't want and send the choice. Apps the TV needs (home screens, TV inputs, system and Google services, the update service) and the apps you use are locked and can't be ticked. In the launcher, Settings > Home and apps > Clean up apps shows the choice. After **Connect to the TV** (see android/README.md) the launcher switches the chosen apps off with `pm disable-user --user 0`, after a second confirmation, and keeps a list so **Switch back on** undoes it with `pm enable`. The stock launcher is never offered.
