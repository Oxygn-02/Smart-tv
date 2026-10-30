package io.github.oxygn02.smarttv

import android.Manifest
import android.app.Activity
import android.app.AppOpsManager
import android.app.SearchManager
import android.app.role.RoleManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
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

    private val setupEvents = object : SetupServer.Events {
        override fun onGoveeKey(key: String) {
            if (key.isEmpty()) govee.forgetKey() else govee.connect(key)
        }

        override fun onTown(town: String) = host.emit("setup", JSONObject().put("town", town).toString())

        override fun onWallpapersChanged() = host.emit("setup", "{}")

        override fun stateJson(): JSONObject = JSONObject()
            .put("govee", JSONObject(govee.status()))
            .put("town", "")
            .put("wallpapers", JSONArray(wallpapers()))

        override fun packagesText(): String = packageList()
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
        /** Where the page and its images are served from inside the app. */
        const val ORIGIN = "https://appassets.androidplatform.net"
        private const val WEEK_MS = 7L * 24 * 60 * 60 * 1000
    }
}
