# Security notes

What the launcher holds: API keys (Govee, TMDB, Watchmode), the guest Wi-Fi
password, a small web server for phone setup, its own updater, and the ability
to switch system apps off over the TV's debug connection. How each is protected:

## Phone setup page
- Runs only while "Set up from your phone" is open on the TV, for 20 minutes at most, bound to the TV's Wi-Fi address. Never port-forward it.
- A 6-digit code is exchanged once for a random session token; codes are compared in constant time.
- Wrong codes: 5 tries per device (and every 5th overall) locks the page, doubling from 1 minute up to 1 hour. The lock survives restarting the launcher.
- Every request must come to the TV's own address (Host check) and from its own page (Origin check), which blocks DNS rebinding and other web pages. Anything that changes the TV must be a POST with the token. No CORS headers.
- Keys are never sent back to the page; it only shows whether each is set.
- Photos: 25 MB at most, decoded and re-encoded as JPEG, stored privately with generated names.
- Backups are filtered to known settings with fixed types (`BackupSchema.kt`); they can't change the update address, the clean-up list or the safety net, and contain no keys.
- Plain HTTP on a home network can be sniffed: keep the setup window short and don't use it on a shared or guest network.

## Secrets
- Keys and the Wi-Fi password are encrypted (AES-GCM) with a key in the TV's Android Keystore (`SecretStore.kt`). Older plain-text copies are moved in and deleted.
- TMDB and Watchmode calls are made by the Android side (`tmdbFetch`, `pricesFetch`, fixed paths only), so keys never reach page scripts. A TMDB v3 key has to go in the request address (TMDB's rule); the longer "read access token" is sent as a header instead, so prefer that one.
- `allowBackup` is off. No analytics, no logging of searches.

## WebView
- Only the bundled page, through `WebViewAssetLoader`; file and content access off; any navigation away is blocked.
- Content-Security-Policy: bundled scripts only, no CDN; network limited to the weather services and this repository; frames only from youtube-nocookie.com.
- Outside data (TMDB, other apps) is escaped, and addresses are checked before going into the page.
- Release builds are not debuggable, so WebView remote debugging is off.

## Updates
- HTTPS from this repository only; the address is fixed in the app.
- Before Android's installer is asked, the download must match the SHA-256 in `version.json`, be this app, be a newer version, and be signed with the same key as the installed launcher. Downgrades are refused (Android refuses them too).
- The signing key is not in the repo. Keep a private backup.

## Clean-up and adb
- Package names come from fixed lists or the installed-app list and must match a strict pattern before being used; protected packages (Android core, Settings, updates, Bluetooth, keyboard, Cast, MediaTek TV services, Freeview guide, Downloader, your apps) are refused.
- The safety-net helper only re-enables Google's home screen.
- Debugging left on is a standing risk: the TV's adb port is reachable from your home network. Never expose it to the internet, and revoke old authorisations now and then (Developer options > Revoke USB debugging authorisations; then allow the launcher again).

## Permissions
Internet and Wi-Fi state (weather, lights), all packages (the app list), usage stats (recent apps), coarse location (weather, optional), TV listings (Continue watching), install packages (updates), and notification access (Now playing only; nothing is stored or sent).

## For the owner
Review the safety-net, update, adb and web-server diffs before merging. Turn on two-factor authentication for GitHub, protect the main branch, and enable secret scanning (repository Settings > Code security).
