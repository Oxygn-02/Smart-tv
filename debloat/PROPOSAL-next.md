# Proposed next clean-up (NOT applied, waiting for your OK)

Built from the package list you sent. Nothing here is in `launcher/data.js` or the in-launcher
Clean up list yet. Everything is `pm disable-user --user 0` only, so reversible.
Tell me which groups to add.

## A. Low risk (nothing on a TV uses them)
| Package | Why | If wrong |
|---|---|---|
| com.android.printspooler | Printing; a TV has no printer flow | nothing visible |
| com.android.htmlviewer | Opens saved .html files | nothing visible |
| com.android.soundpicker | Ringtone picker; a TV has no ringtones | nothing visible |
| com.android.dreams.basic | Android's plain screensaver (our ambient screen replaces it) | the screensaver option shows nothing |
| com.android.settings.intelligence | Suggestions inside Settings | Settings shows no suggestions |
| com.google.android.play.games | Play Games hub | none unless you use it |
| com.google.android.apps.nbu.smartconnect.tv | "Data Saver" | none |
| com.android.providers.userdictionary | Typing dictionary sync | keyboard learns no words |
| com.android.wallpaperbackup, com.android.sharedstoragebackup, com.android.backupconfirm | Phone-style backup helpers | no backup/restore of the TV |

## B. Freeview apps you did not list as used
| Package | Label |
|---|---|
| uk.co.freeview.amc_catchup | WATCH FREE UK |
| uk.co.freeview.amc_horror | Legend |
| uk.co.freeview.stv | STV Player |
| uk.co.freeview.uktv | U |
| uk.co.freeview.bbc_sounds | BBC Sounds |

Keep: `uk.co.freeview.bbc`, `itv`, `ch4_vod`, `ch5` (your apps) and the services
`explore`, `onnow`, `tifbridge`, `mdsclient`, `fvpconfigauth` (live TV guide needs them).
Tell me if you use any of these five.

## C. Ask me first (could affect something you use)
| Package | Question |
|---|---|
| com.google.android.katniss (already listed) | Do you use the voice button? |
| com.google.android.tts | Needed only for spoken menus/Assistant answers |
| com.google.android.tungsten.setupwraith, com.mediatek.wwtv.setupwizard | First-run wizards. Safe after setup, but a factory reset would need them (re-enable first) |
| com.mediatek.tvinput ("TIF Test") | A test input; probably safe, verify the Inputs row still works after |
| com.android.documentsui ("Files") | Some apps' file pickers use it |
| com.airoha.btd (RemoteOTA) | Updates the remote's firmware; leave unless the remote never needs updating |
| Netflix, Spotify, TikTok TV, Apple TV, Crunchyroll, Disney+ | These are apps you installed; only if you want them gone |

## D. Never (breaks the TV)
android, systemui, tv.settings, providers.*, gms/gsf, vending, webview, packageinstaller,
permissioncontroller, bluetooth, the MediaTek tv.service/tvcenter/freeviewplay, networkstack, ctsshim, Cast, Gboard.
