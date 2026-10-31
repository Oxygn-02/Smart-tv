package io.github.oxygn02.smarttv

import android.Manifest
import android.app.Activity
import android.app.AppOpsManager
import android.app.SearchManager
import android.app.role.RoleManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationManagerCompat
import androidx.palette.graphics.Palette
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface

/** What the bridge needs from the screen that hosts it (see [MainActivity]). */
interface BridgeHost {
    /** Sends an event to the page: window.onNative(name, json). */
    fun emit(name: String, json: String)

    /** Shows the system's location permission question. */
    fun requestLocationPermission()

    /** Opens the system's "make this your home app" question. False if the TV can't. */
    fun requestHomeRole(): Boolean
}

/**
 * `window.Android` in the launcher UI (see launcher/bridge.js). Each method is
 * called from JavaScript on a background thread; anything that starts an
 * activity hops to the UI thread. Methods return JSON strings, or "null" when
 * the data isn't available (for example, a permission not granted yet), and
 * anything slow (Govee, the phone setup) returns at once and reports back
 * through [BridgeHost.emit].
 */
class LauncherBridge(private val activity: Activity, private val host: BridgeHost) {

    private val pm = activity.packageManager
    private val audio = activity.getSystemService(AudioManager::class.java)
    private val govee = GoveeHub(activity) { json -> host.emit("govee", json) }
    private val main = Handler(Looper.getMainLooper())

    // ---------- Apps ----------

    /**
     * Installed TV apps: [{pkg, label, icon}]. The icon is a URL the page loads
     * on demand (served by [iconPng] through MainActivity), so this call stays
     * small and fast at start-up.
     */
    @JavascriptInterface
    fun apps(): String {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        val out = JSONArray()
        pm.queryIntentActivities(intent, 0)
            .filter { it.activityInfo.packageName != activity.packageName }
            .distinctBy { it.activityInfo.packageName }
            .sortedBy { it.loadLabel(pm).toString().lowercase() }
            .forEach { ri ->
                val info = ri.activityInfo
                out.put(
                    JSONObject()
                        .put("pkg", info.packageName)
                        .put("label", ri.loadLabel(pm).toString())
                        .put("icon", "$ORIGIN/icons/${info.packageName}.png"),
                )
            }
        return out.toString()
    }

    @JavascriptInterface
    fun launch(pkg: String): Boolean {
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg)
            ?: pm.getLaunchIntentForPackage(pkg)
            ?: return false
        activity.runOnUiThread { activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        return true
    }

    /** Most recently used TV apps, newest first. Needs usage access (Settings). */
    @JavascriptInterface
    fun recentApps(limit: Int): String {
        val usm = activity.getSystemService(UsageStatsManager::class.java) ?: return "[]"
        val now = System.currentTimeMillis()
        val launchable = pm.queryIntentActivities(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), 0,
        ).map { it.activityInfo.packageName }.toSet()
        val recent = usm.queryUsageStats(UsageStatsManager.INTERVAL_WEEKLY, now - WEEK_MS, now)
            .filter { it.packageName in launchable && it.packageName != activity.packageName && it.lastTimeUsed > 0 }
            .sortedByDescending { it.lastTimeUsed }
            .map { it.packageName }
            .distinct()
            .take(limit)
        return JSONArray(recent).toString()
    }

    // ---------- Continue watching: the system's Watch Next list ----------

    /**
     * What apps have put on the TV's Watch Next list, as
     * {ok, error, items:[{title, sub, pkg, uri, poster, pos, dur}]}. Android
     * may refuse (error "permission") or the list may be empty; both are
     * reported rather than hidden.
     */
    @JavascriptInterface
    fun watchNext(): String {
        val out = JSONObject()
        val items = JSONArray()
        try {
            val cols = arrayOf(
                TvContract.WatchNextPrograms.COLUMN_TITLE,
                TvContract.WatchNextPrograms.COLUMN_SHORT_DESCRIPTION,
                TvContract.WatchNextPrograms.COLUMN_PACKAGE_NAME,
                TvContract.WatchNextPrograms.COLUMN_INTENT_URI,
                TvContract.WatchNextPrograms.COLUMN_POSTER_ART_URI,
                TvContract.WatchNextPrograms.COLUMN_LAST_PLAYBACK_POSITION_MILLIS,
                TvContract.WatchNextPrograms.COLUMN_DURATION_MILLIS,
                TvContract.WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS,
            )
            activity.contentResolver.query(
                TvContract.WatchNextPrograms.CONTENT_URI, cols, null, null,
                TvContract.WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS + " DESC",
            )?.use { c ->
                while (c.moveToNext() && items.length() < 6) {
                    items.put(
                        JSONObject()
                            .put("title", c.getString(0).orEmpty())
                            .put("sub", c.getString(1).orEmpty())
                            .put("pkg", c.getString(2).orEmpty())
                            .put("uri", c.getString(3).orEmpty())
                            .put("poster", c.getString(4).orEmpty())
                            .put("pos", c.getLong(5))
                            .put("dur", c.getLong(6)),
                    )
                }
            }
            out.put("ok", true)
        } catch (e: SecurityException) {
            out.put("ok", false).put("error", "permission")
        } catch (e: Exception) {
            out.put("ok", false).put("error", e.javaClass.simpleName)
        }
        return out.put("items", items).toString()
    }

    /** Opens a Watch Next item in the app that published it. */
    @JavascriptInterface
    fun watchNextOpen(uri: String, pkg: String): Boolean {
        return try {
            val intent = Intent.parseUri(uri, Intent.URI_INTENT_SCHEME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.runOnUiThread { runCatching { activity.startActivity(intent) } }
            true
        } catch (_: Exception) {
            launch(pkg)
        }
    }

    // ---------- Clean-up over the TV's own debugging port (read only so far) ----------

    private val adb = AdbClient(File(activity.filesDir, "adb"))
    private val adbIo = java.util.concurrent.Executors.newSingleThreadExecutor()

    private fun adbEvent(state: String, message: String = "", extra: JSONObject = JSONObject()) =
        host.emit("adb", extra.put("state", state).put("message", message).toString())

    /**
     * Connects to this TV's debugging port and, the first time, waits while the
     * TV asks on screen to allow it. Reads three facts (model, Android version,
     * how many apps are already switched off) and changes nothing. The progress
     * arrives as "adb" events: connecting, approve, ready, error.
     */
    @JavascriptInterface
    fun adbConnect() {
        adbIo.execute {
            try {
                adbEvent("connecting", "Connecting to the TV")
                val hosts = listOfNotNull("127.0.0.1", lanAddress())
                var last: Exception? = null
                var done = false
                for (h in hosts) {
                    try {
                        adb.connect(h, 5555) { adbEvent("approve", "Allow it on the TV: press OK on the question that appears") }
                        done = true
                        break
                    } catch (e: Exception) {
                        last = e
                    }
                }
                if (!done) throw last ?: AdbClient.AdbException("Couldn't reach the debug port")
                val model = adb.shell("getprop ro.product.model").trim()
                val android = adb.shell("getprop ro.build.version.release").trim()
                val off = adb.shell("pm list packages -d").lines().count { it.startsWith("package:") }
                adbEvent(
                    "ready", "Connected",
                    JSONObject().put("model", model).put("android", android).put("off", off).put("ours", switchedOffByUs().size),
                )
            } catch (e: Exception) {
                adb.close()
                adbEvent("error", e.message ?: "Couldn't connect")
            }
        }
    }

    @JavascriptInterface
    fun adbDisconnect() {
        adbIo.execute { adb.close() }
    }

    // ---------- Apps you can choose to switch off (picked on the phone page) ----------

    private class Entry(val pkg: String, val label: String, val system: Boolean, val enabled: Boolean, val protectedApp: Boolean, val why: String)

    private val cleanupPrefs = activity.getSharedPreferences("cleanup", Context.MODE_PRIVATE)

    private var chosen: List<String>
        get() = runCatching {
            JSONArray(cleanupPrefs.getString("chosen", "[]")).let { a -> (0 until a.length()).map { a.getString(it) } }
        }.getOrDefault(emptyList())
        set(v) { cleanupPrefs.edit().putString("chosen", JSONArray(v).toString()).apply() }

    /** What must never be switched off from here: the stock launcher, TV inputs, system services, apps you use. */
    private fun protectionFor(pkg: String, label: String, inputs: Set<String>, homes: Set<String>): String? {
        val key = label.lowercase().filter { it.isLetterOrDigit() }
        return when {
            pkg == activity.packageName -> "This launcher"
            pkg in homes -> "A home screen"
            pkg in inputs -> "TV input"
            pkg in PROTECTED_PKGS -> "Needed by the TV"
            Regex("update|\\.ota|setup|provision|permission|installer|webview|systemui|settings|bluetooth|keyboard|inputmethod|tvprovider|\\.gms|\\.gsf|vending").containsMatchIn(pkg.lowercase()) -> "Needed by the TV"
            KEEP_LABELS.any { key == it || key.startsWith(it) } -> "An app you use"
            else -> null
        }
    }

    private fun catalog(): List<Entry> {
        val inputs = (activity.getSystemService(TvInputManager::class.java)?.tvInputList ?: emptyList())
            .map { it.serviceInfo.packageName }.toSet()
        val homes = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)
            .map { it.activityInfo.packageName }.toSet()
        val launchable = (
            pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), 0) +
                pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            ).map { it.activityInfo.packageName }.toSet()
        return launchable.mapNotNull { pkg ->
            val info = runCatching { pm.getApplicationInfo(pkg, 0) }.getOrNull() ?: return@mapNotNull null
            val label = pm.getApplicationLabel(info).toString()
            val why = protectionFor(pkg, label, inputs, homes)
            Entry(pkg, label, info.flags and ApplicationInfo.FLAG_SYSTEM != 0, info.enabled, why != null, why.orEmpty())
        }.sortedBy { it.label.lowercase() }
    }

    /** For the phone page: [{pkg, label, system, enabled, protected, why, chosen}]. */
    private fun appCatalog(): JSONArray {
        val picked = chosen.toSet()
        val out = JSONArray()
        catalog().forEach {
            out.put(
                JSONObject().put("pkg", it.pkg).put("label", it.label).put("system", it.system)
                    .put("enabled", it.enabled).put("protected", it.protectedApp).put("why", it.why)
                    .put("chosen", it.pkg in picked),
            )
        }
        return out
    }

    /** The apps picked on the phone: [{pkg, label, enabled, installed}]. */
    @JavascriptInterface
    fun chosenApps(): String = packageStates(JSONArray(chosen).toString())

    private val adbLog = activity.getSharedPreferences("adblog", Context.MODE_PRIVATE)

    private fun switchedOffByUs(): List<String> = runCatching {
        JSONArray(adbLog.getString("off", "[]")).let { a -> (0 until a.length()).map { a.getString(it) } }
    }.getOrDefault(emptyList())

    private fun setSwitchedOff(v: List<String>) = adbLog.edit().putString("off", JSONArray(v.distinct()).toString()).apply()

    private val pkgName = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")

    /**
     * Switches off the apps picked on the phone with `pm disable-user --user 0`
     * (reversible). Apps that are protected are refused. Needs the connection
     * from Connect to the TV. Progress arrives as "adb" events.
     */
    @JavascriptInterface
    fun adbDisable() {
        adbIo.execute {
            try {
                if (!adb.connected) throw AdbClient.AdbException("Connect to the TV first")
                val allowed = catalog().filter { !it.protectedApp }.map { it.pkg }.toSet()
                val todo = chosen.filter { it in allowed && pkgName.matches(it) }
                val done = mutableListOf<String>()
                val failed = JSONArray()
                todo.forEachIndexed { i, pkg ->
                    adbEvent("working", "Switching off ${i + 1} of ${todo.size}")
                    val out = adb.shell("pm disable-user --user 0 $pkg")
                    if (out.contains("disabled-user") || out.contains("new state: disabled")) done.add(pkg)
                    else failed.put(JSONObject().put("pkg", pkg).put("why", out.trim().take(120)))
                }
                setSwitchedOff(switchedOffByUs() + done)
                adbEvent("done", "Switched off ${done.size} of ${todo.size}", JSONObject().put("failed", failed).put("ours", switchedOffByUs().size))
            } catch (e: Exception) {
                adbEvent("error", e.message ?: "That didn't work")
            }
        }
    }

    /** Switches back on everything this launcher switched off. */
    @JavascriptInterface
    fun adbRestore() {
        adbIo.execute {
            try {
                if (!adb.connected) throw AdbClient.AdbException("Connect to the TV first")
                val todo = switchedOffByUs().filter { pkgName.matches(it) }
                val back = mutableListOf<String>()
                todo.forEachIndexed { i, pkg ->
                    adbEvent("working", "Switching on ${i + 1} of ${todo.size}")
                    val out = adb.shell("pm enable $pkg")
                    if (out.contains("enabled")) back.add(pkg)
                }
                setSwitchedOff(switchedOffByUs() - back.toSet())
                adbEvent("done", "Switched back on ${back.size} of ${todo.size}", JSONObject().put("ours", switchedOffByUs().size))
            } catch (e: Exception) {
                adbEvent("error", e.message ?: "That didn't work")
            }
        }
    }

    // ---------- Show search: the TMDB key saved from the phone page ----------

    private val lookup = activity.getSharedPreferences("lookup", Context.MODE_PRIVATE)

    @JavascriptInterface
    fun tmdbKey(): String = lookup.getString("tmdb", "").orEmpty()

    // ---------- Now playing: whatever is coming out of the speakers ----------

    private class Playing(
        val key: String,
        val title: String,
        val artist: String,
        val durationMs: Long,
        val positionMs: Long,
        val playing: Boolean,
        val pkg: String,
        val source: String,
        val art: Bitmap?,
        val controls: Boolean,
    )

    /**
     * What is playing right now, from any source: an app on the TV, or a phone
     * or iPad casting to it (the Cast receiver publishes its own media session).
     * Falls back to the media notification, then to "the TV is playing audio".
     *
     * {key, title, artist, durationMs, positionMs, playing, source, icon,
     * controls, art, colors}. The cover (a URL served by [artJpeg]) and its
     * colours are only included when the song differs from [knownKey], so repeat
     * polls stay tiny. "null" if nothing is playing, or notification access
     * hasn't been granted.
     */
    @JavascriptInterface
    fun nowPlaying(knownKey: String): String {
        val np = findPlaying() ?: return "null"
        val json = JSONObject()
            .put("key", np.key)
            .put("title", np.title)
            .put("artist", np.artist)
            .put("durationMs", np.durationMs)
            .put("positionMs", np.positionMs)
            .put("playing", np.playing)
            .put("source", np.source)
            .put("controls", np.controls)
        if (np.pkg.isNotEmpty()) json.put("icon", "$ORIGIN/icons/${np.pkg}.png")
        if (np.key == knownKey) return json.toString()

        val art = np.art
        nowArt = art?.let { jpeg(it, 320) }
        if (art != null) {
            json.put("art", "$ORIGIN/art/now.jpg?k=${np.key.hashCode()}")
            // Card tint: light, mid and dark tones of the cover.
            val p = Palette.from(art).generate()
            val fallback = p.getDominantColor(0xFF3A3A48.toInt())
            json.put(
                "colors",
                JSONArray(
                    listOf(
                        hex(p.getLightVibrantColor(p.getVibrantColor(fallback))),
                        hex(p.getMutedColor(fallback)),
                        hex(p.getDarkMutedColor(p.getDarkVibrantColor(fallback))),
                    ),
                ),
            )
        }
        return json.toString()
    }

    private fun findPlaying(): Playing? {
        // 1. A media session: the best source, with time and controls.
        controller()?.let { c ->
            val md = c.metadata
            val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE)
                ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
            if (md != null && !title.isNullOrBlank()) {
                val artist = md.getString(MediaMetadata.METADATA_KEY_ARTIST)
                    ?: md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
                    ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
                    ?: ""
                val state = c.playbackState
                return Playing(
                    key = "${c.packageName}|$title|$artist",
                    title = title,
                    artist = artist,
                    durationMs = md.getLong(MediaMetadata.METADATA_KEY_DURATION),
                    positionMs = state?.position ?: 0,
                    playing = state?.state == PlaybackState.STATE_PLAYING || state?.state == PlaybackState.STATE_BUFFERING,
                    pkg = c.packageName,
                    source = sourceName(c.packageName),
                    art = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) ?: md.getBitmap(MediaMetadata.METADATA_KEY_ART),
                    controls = true,
                )
            }
        }
        // 2. The media notification, for a session with no details.
        MediaListener.instance?.mediaNotes()?.firstOrNull()?.let { n ->
            return Playing("${n.pkg}|${n.title}|${n.text}", n.title, n.text, 0, 0, true, n.pkg, sourceName(n.pkg), n.art, false)
        }
        // 3. Audio is coming out, source unknown (needs no permission).
        if (audioIsPlaying()) return Playing("audio", "Playing on this TV", "", 0, 0, true, "", "Audio", null, false)
        return null
    }

    private fun audioIsPlaying(): Boolean = try {
        audio?.activePlaybackConfigurations?.any {
            val usage = it.audioAttributes.usage
            usage == AudioAttributes.USAGE_MEDIA || usage == AudioAttributes.USAGE_GAME
        } == true
    } catch (_: Exception) {
        false
    }

    /** "YouTube Music", or "Cast" for the Chromecast receiver. */
    private fun sourceName(pkg: String): String = when {
        pkg == "com.google.android.apps.mediashell" -> "Cast"
        pkg.isEmpty() -> ""
        else -> runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
    }

    /** "play", "pause", "next" or "prev" on the active media session. */
    @JavascriptInterface
    fun media(action: String) {
        val controls = controller()?.transportControls ?: return
        when (action) {
            "play" -> controls.play()
            "pause" -> controls.pause()
            "next" -> controls.skipToNext()
            "prev" -> controls.skipToPrevious()
        }
    }

    /** The session that's playing, else any session, from any app including Cast. */
    private fun controller(): MediaController? {
        val msm = activity.getSystemService(MediaSessionManager::class.java) ?: return null
        val sessions = try {
            msm.getActiveSessions(ComponentName(activity, MediaListener::class.java))
        } catch (_: SecurityException) {
            return null // notification access not granted yet
        }
        fun isPlaying(c: MediaController) = c.playbackState?.state.let { it == PlaybackState.STATE_PLAYING || it == PlaybackState.STATE_BUFFERING }
        fun hasTitle(c: MediaController) = !c.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE).isNullOrBlank()
        return sessions.firstOrNull { isPlaying(it) && hasTitle(it) }
            ?: sessions.firstOrNull { isPlaying(it) }
            ?: sessions.firstOrNull { hasTitle(it) }
            ?: sessions.firstOrNull()
    }

    // ---------- Sound (HDMI ARC passes TV volume to the soundbar) ----------

    @JavascriptInterface
    fun volume(step: Int) {
        val direction = if (step > 0) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
        audio?.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
    }

    /** The TV's real music volume, as JSON {level, max, muted}. */
    @JavascriptInterface
    fun volumeInfo(): String {
        val a = audio ?: return "{}"
        val muted = a.isStreamMute(AudioManager.STREAM_MUSIC)
        return JSONObject().put("level", a.getStreamVolume(AudioManager.STREAM_MUSIC))
            .put("max", a.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).put("muted", muted).toString()
    }

    @JavascriptInterface
    fun toggleMute() {
        audio?.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI)
    }

    // ---------- HDMI (Games → Xbox) ----------

    /**
     * Switches the TV to HDMI input [port] (1-based). HDMI inputs are taken in
     * the order the TV lists them; which one is "HDMI 2" must be confirmed on
     * the actual TV. Returns false if there is no such input.
     */
    @JavascriptInterface
    fun switchToHdmi(port: Int): Boolean {
        val tim = activity.getSystemService(TvInputManager::class.java) ?: return false
        val hdmi = tim.tvInputList
            .filter { it.type == TvInputInfo.TYPE_HDMI && it.parentId == null }
            .sortedBy { it.id }
        val input = hdmi.getOrNull(port - 1) ?: return false
        val intent = Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(input.id))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread { activity.startActivity(intent) }
        return true
    }

    // ---------- Weather: where the TV is ----------

    /** {lat, lon}, or {error: "permission" | "none"}. Uses the TV's own Location setting. */
    @JavascriptInterface
    fun location(): String {
        if (activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            host.requestLocationPermission()
            return JSONObject().put("error", "permission").toString()
        }
        val lm = activity.getSystemService(LocationManager::class.java)
        val best = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER, LocationManager.GPS_PROVIDER)
            .mapNotNull { runCatching { lm?.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
            ?: return JSONObject().put("error", "none").toString()
        return JSONObject().put("lat", best.latitude).put("lon", best.longitude).toString()
    }

    // ---------- Govee lights ----------

    /** Connects with the saved key (or [key] if given); the result arrives as a "govee" event. */
    @JavascriptInterface
    fun goveeConnect(key: String) = govee.connect(key)

    @JavascriptInterface
    fun goveeStatus(): String = govee.status()

    @JavascriptInterface
    fun goveeColor(id: String, r: Int, g: Int, b: Int) = govee.color(id, r, g, b)

    @JavascriptInterface
    fun goveePower(id: String, on: Boolean) = govee.power(id, on)

    @JavascriptInterface
    fun goveeBrightness(id: String, percent: Int) = govee.brightness(id, percent)

    @JavascriptInterface
    fun goveeWhite(id: String, kelvin: Int) = govee.white(id, kelvin)

    /** Reads a light's current state; the answer arrives as a "govee" event. */
    @JavascriptInterface
    fun goveeRead(id: String) = govee.readLive(id)

    /** Picture sync on the TV backlight, if Govee offers it for that light. */
    @JavascriptInterface
    fun goveeDreamView(id: String, on: Boolean) = govee.dreamView(id, on)

    // ---------- Set up from your phone ----------

    private var server: SetupServer? = null
    private val stopServer = Runnable { stopSetup() }

    /** Starts the phone page. {url, pin}, or {error}. It stops itself after 20 minutes. */
    @JavascriptInterface
    @Synchronized
    fun startSetup(): String {
        stopSetup()
        val ip = lanAddress() ?: return JSONObject().put("error", "The TV isn't on Wi-Fi").toString()
        val pin = (1000 + java.security.SecureRandom().nextInt(9000)).toString()
        for (port in 8080..8090) {
            try {
                val s = SetupServer(activity, port, pin, setupEvents)
                s.start(5000, false)
                server = s
                main.postDelayed(stopServer, 20 * 60_000L)
                return JSONObject().put("url", "http://$ip:$port").put("pin", pin).toString()
            } catch (_: java.io.IOException) {
                // Port taken; try the next.
            }
        }
        return JSONObject().put("error", "Couldn't open the setup page").toString()
    }

    @JavascriptInterface
    @Synchronized
    fun stopSetup() {
        main.removeCallbacks(stopServer)
        server?.stop()
        server = null
    }

    private val guest = activity.getSharedPreferences("guest", Context.MODE_PRIVATE)

    /**
     * The guest Wi-Fi saved from the phone setup page, as {ssid, payload}. The
     * payload is the text a phone camera reads from the QR code. Empty when
     * nothing is saved.
     */
    @JavascriptInterface
    fun guestWifi(): String {
        val ssid = guest.getString("ssid", "").orEmpty()
        if (ssid.isEmpty()) return "{}"
        fun esc(v: String) = v.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace(":", "\\:").replace("\"", "\\\"")
        val security = guest.getString("security", "WPA")
        val pass = guest.getString("password", "").orEmpty()
        val hide = if (guest.getBoolean("hidden", false)) "H:true;" else ""
        val payload = if (security == "nopass" || pass.isEmpty()) "WIFI:T:nopass;S:${esc(ssid)};${hide};"
        else "WIFI:T:${if (security == "WEP") "WEP" else "WPA"};S:${esc(ssid)};P:${esc(pass)};${hide};"
        return JSONObject().put("ssid", ssid).put("payload", payload).toString()
    }

    /** Turns every light off after [minutes] (0 cancels). Works while another app is open. */
    @JavascriptInterface
    fun goveeSleep(minutes: Int) = govee.sleepIn(minutes)

    /** When the sleep timer will fire (epoch milliseconds), or 0. */
    @JavascriptInterface
    fun goveeSleepAt(): Long = govee.sleepAt

    private val setupEvents = object : SetupServer.Events {
        override fun onGoveeKey(key: String) {
            if (key.isEmpty()) govee.forgetKey() else govee.connect(key)
        }

        override fun onTmdb(key: String) {
            lookup.edit().putString("tmdb", key).apply()
            host.emit("setup", "{}")
        }

        override fun onWifi(ssid: String, password: String, security: String, hidden: Boolean) {
            guest.edit().putString("ssid", ssid).putString("password", password)
                .putString("security", security).putBoolean("hidden", hidden).apply()
            host.emit("setup", "{}")
        }

        override fun appsJson(): String = appCatalog().toString()

        override fun iconPng(pkg: String): ByteArray? = this@LauncherBridge.iconPng(pkg)

        override fun onCleanup(pkgs: List<String>) {
            val allowed = catalog().filter { !it.protectedApp }.map { it.pkg }.toSet()
            chosen = pkgs.filter { it in allowed }
            host.emit("setup", "{}")
        }

        override fun onTown(town: String) = host.emit("setup", JSONObject().put("town", town).toString())

        override fun onWallpapersChanged() = host.emit("setup", "{}")

        override fun stateJson(): JSONObject = JSONObject()
            .put("govee", JSONObject(govee.status()))
            .put("town", "")
            .put("wifi", guest.getString("ssid", "").orEmpty())
            .put("tmdb", lookup.getString("tmdb", "").orEmpty().isNotEmpty())
            .put("wallpapers", JSONArray(wallpapers()))

        override fun packagesText(): String = packageList()
    }

    /**
     * Read-only check: is the TV's debugging port (5555) listening, on the TV
     * itself or on its network address? Returns {local, lan, ip}. It only opens
     * and closes a connection; it sends nothing.
     */
    @JavascriptInterface
    fun debugPortOpen(): String {
        fun open(host: String): Boolean = try {
            java.net.Socket().use { it.connect(java.net.InetSocketAddress(host, 5555), 1200); true }
        } catch (_: Exception) {
            false
        }
        val ip = lanAddress()
        return JSONObject().put("local", open("127.0.0.1")).put("lan", ip != null && open(ip)).put("ip", ip ?: "").toString()
    }

    private fun lanAddress(): String? = NetworkInterface.getNetworkInterfaces().toList()
        .flatMap { it.inetAddresses.toList() }
        .firstOrNull { it is Inet4Address && !it.isLoopbackAddress && it.isSiteLocalAddress }
        ?.hostAddress

    /** Every app on the TV, one per line: package, name, system or user, on or off. */
    private fun packageList(): String = pm.getInstalledApplications(0)
        .sortedBy { it.packageName }
        .joinToString("\n") { a ->
            val system = if (a.flags and ApplicationInfo.FLAG_SYSTEM != 0) "system" else "user"
            val state = if (a.enabled) "on" else "off"
            "${a.packageName}\t${pm.getApplicationLabel(a)}\t$system\t$state"
        }

    // ---------- Wallpapers sent from a phone ----------

    /** [{name, url}] for photos added from a phone, oldest first. */
    @JavascriptInterface
    fun wallpapers(): String {
        val files = SetupServer.wallpaperDir(activity).listFiles { f -> f.extension == "jpg" }?.sortedBy { it.name } ?: emptyList()
        return JSONArray(files.map { JSONObject().put("name", it.name).put("url", "$ORIGIN/wall/${it.name}") }).toString()
    }

    /** A photo added from a phone, or null. */
    fun wallpaperBytes(name: String): ByteArray? =
        File(SetupServer.wallpaperDir(activity), File(name).name).takeIf { it.isFile }?.readBytes()

    // ---------- Which app opens on Home ----------

    @JavascriptInterface
    fun isDefaultHome(): Boolean = if (Build.VERSION.SDK_INT >= 29) {
        activity.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_HOME) == true
    } else {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName == activity.packageName
    }

    /** Asks Android to make this the home app (the TV shows its own question). */
    @JavascriptInterface
    fun requestDefaultHome(): String = if (host.requestHomeRole()) "started" else "unavailable"

    // ---------- Clean up: switching apps off from the TV's own Settings ----------

    /** For a list of package names: [{pkg, label, installed, enabled}]. */
    @JavascriptInterface
    fun packageStates(listJson: String): String {
        val names = JSONArray(listJson)
        val out = JSONArray()
        for (i in 0 until names.length()) {
            val pkg = names.getString(i)
            val info = runCatching { pm.getApplicationInfo(pkg, 0) }.getOrNull()
            out.put(
                JSONObject()
                    .put("pkg", pkg)
                    .put("label", info?.let { pm.getApplicationLabel(it).toString() } ?: pkg)
                    .put("installed", info != null)
                    .put("enabled", info?.enabled == true),
            )
        }
        return out.toString()
    }

    /** Opens the TV Settings page for one app, where it can be switched off (Disable) or on (Enable). */
    @JavascriptInterface
    fun openAppInfo(pkg: String) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$pkg"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread {
            runCatching { activity.startActivity(intent) }.onFailure { openSettings("") }
        }
    }

    // ---------- Hand-offs to the system ----------

    /** Google TV's own search, with the query typed so far. */
    @JavascriptInterface
    fun googleSearch(query: String) {
        val search = Intent(Intent.ACTION_SEARCH)
            .putExtra(SearchManager.QUERY, query)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val assist = Intent(Intent.ACTION_ASSIST).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread {
            val intent = if (query.isNotEmpty() && search.resolveActivity(pm) != null) search else assist
            runCatching { activity.startActivity(intent) }
        }
    }

    /**
     * Opens a system settings screen: "wifi", "notification-access" (for Now
     * playing) or "usage-access" (for recent apps). Falls back to the main
     * settings if the TV hides that screen.
     */
    @JavascriptInterface
    fun openSettings(which: String) {
        val action = when (which) {
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "notification-access" -> Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
            "usage-access" -> Settings.ACTION_USAGE_ACCESS_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        activity.runOnUiThread {
            runCatching { activity.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onFailure {
                    runCatching {
                        activity.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }
        }
    }

    /** Which permissions are granted: {"nowPlaying", "recentApps", "location"}, each a bool. */
    @JavascriptInterface
    fun access(): String {
        val pkg = activity.packageName
        val listener = NotificationManagerCompat.getEnabledListenerPackages(activity).contains(pkg)
        val ops = activity.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), pkg)
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), pkg)
        }
        return JSONObject()
            .put("nowPlaying", listener)
            .put("recentApps", mode == AppOpsManager.MODE_ALLOWED)
            .put("location", activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED)
            .toString()
    }

    fun close() {
        stopSetup()
        adb.close()
        adbIo.shutdownNow()
        govee.close()
    }

    // ---------- Images served to the page (see MainActivity) ----------

    @Volatile private var nowArt: ByteArray? = null

    /** The current song's cover as JPEG, or null. */
    fun artJpeg(): ByteArray? = nowArt

    /** An app's icon as a 128px PNG, cached on disk per app version. */
    fun iconPng(pkg: String): ByteArray? {
        val info = runCatching { pm.getPackageInfo(pkg, 0) }.getOrNull() ?: return null
        val version = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        val file = File(activity.cacheDir, "icons/$pkg-$version.png")
        if (file.exists()) return file.readBytes()
        val drawable = runCatching { pm.getApplicationIcon(pkg) }.getOrNull() ?: return null
        val bytes = png(drawable, 128)
        file.parentFile?.mkdirs()
        runCatching { file.writeBytes(bytes) }
        return bytes
    }

    // ---------- Helpers ----------

    private fun png(drawable: Drawable, size: Int): ByteArray {
        val w = drawable.intrinsicWidth.takeIf { it > 0 } ?: size
        val h = drawable.intrinsicHeight.takeIf { it > 0 } ?: size
        val scale = size.toFloat() / maxOf(w, h)
        val bmp = Bitmap.createBitmap((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        drawable.setBounds(0, 0, bmp.width, bmp.height)
        drawable.draw(Canvas(bmp))
        return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    private fun jpeg(bitmap: Bitmap, size: Int): ByteArray {
        val s = size.toFloat() / maxOf(bitmap.width, bitmap.height)
        val scaled = if (s < 1f) {
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * s).toInt(), (bitmap.height * s).toInt(), true)
        } else {
            bitmap
        }
        return ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
    }

    private fun hex(color: Int) = String.format("#%06x", color and 0xFFFFFF)

    companion object {
        val PROTECTED_PKGS = setOf(
            "android", "com.android.settings", "com.android.systemui", "com.google.android.gms", "com.google.android.gsf",
            "com.android.vending", "com.google.android.tvlauncher", "com.google.android.apps.tv.launcherx",
            "com.google.android.leanbacklauncher", "com.google.android.tvrecommendations", "com.android.tv.settings",
            "com.google.android.permissioncontroller", "com.google.android.packageinstaller", "com.android.providers.tv",
        )
        val KEEP_LABELS = setOf(
            "youtube", "youtubemusic", "bbciplayer", "itvx", "channel4", "my5", "primevideo", "disney", "crunchyroll",
            "googleplaystore", "playstore", "googletv", "netflix",
        )
    
        /** Where the page and its images are served from inside the app. */
        const val ORIGIN = "https://appassets.androidplatform.net"
        private const val WEEK_MS = 7L * 24 * 60 * 60 * 1000
    }
}
