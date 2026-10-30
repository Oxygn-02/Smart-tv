package io.github.oxygn02.smarttv

import android.app.Activity
import android.app.AppOpsManager
import android.app.SearchManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationManagerCompat
import androidx.palette.graphics.Palette
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * `window.Android` in the launcher UI (see launcher/bridge.js). Each method is
 * called from JavaScript on a background thread; anything that starts an
 * activity hops to the UI thread. Methods return JSON strings, or "null"
 * when the data isn't available (for example, a permission not granted yet).
 */
class LauncherBridge(private val activity: Activity) {

    private val pm = activity.packageManager
    private val audio = activity.getSystemService(AudioManager::class.java)
    private val govee = GoveeLan(activity)

    // ---------- Apps ----------

    /** Installed TV apps: [{pkg, label, icon}] with the banner or icon as a PNG data URL. */
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
                val drawable = info.loadIcon(pm)
                out.put(
                    JSONObject()
                        .put("pkg", info.packageName)
                        .put("label", ri.loadLabel(pm).toString())
                        .put("icon", dataUrl(drawable, 192)),
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

    /**
     * Most recently used TV apps, newest first. Needs usage access, granted
     * over ADB: adb shell appops set io.github.oxygn02.smarttv GET_USAGE_STATS allow
     */
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

    // ---------- Now playing ----------

    /**
     * The active media session (YouTube Music or any player):
     * {title, artist, durationMs, positionMs, playing, art, colors}. "null"
     * if nothing is playing or notification access hasn't been granted.
     */
    @JavascriptInterface
    fun nowPlaying(): String {
        val c = controller() ?: return "null"
        val md = c.metadata ?: return "null"
        val title = md.getString(MediaMetadata.METADATA_KEY_TITLE) ?: return "null"
        val state = c.playbackState
        val json = JSONObject()
            .put("title", title)
            .put("artist", md.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: "")
            .put("durationMs", md.getLong(MediaMetadata.METADATA_KEY_DURATION))
            .put("positionMs", state?.position ?: 0)
            .put("playing", state?.state == PlaybackState.STATE_PLAYING)
            .put("pkg", c.packageName)

        val art = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_ART)
        if (art != null) {
            json.put("art", dataUrl(art, 320, Bitmap.CompressFormat.JPEG))
            // Card tint, as in the prototype: light, mid and dark tones of the cover.
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

    private fun controller(): MediaController? {
        val msm = activity.getSystemService(MediaSessionManager::class.java) ?: return null
        val sessions = try {
            msm.getActiveSessions(ComponentName(activity, MediaListener::class.java))
        } catch (_: SecurityException) {
            return null // notification access not granted yet
        }
        return sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: sessions.firstOrNull()
    }

    // ---------- Sound (HDMI ARC passes TV volume to the soundbar) ----------

    @JavascriptInterface
    fun volume(step: Int) {
        val direction = if (step > 0) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
        audio?.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
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

    // ---------- Govee lights ----------

    @JavascriptInterface
    fun goveeColor(sku: String, r: Int, g: Int, b: Int) = govee.setColor(sku, r, g, b)

    @JavascriptInterface
    fun goveePower(sku: String, on: Boolean) = govee.setPower(sku, on)

    /** DreamView (picture sync) needs Govee's cloud API; not wired up yet. */
    @JavascriptInterface
    fun goveeSync(sku: String): Boolean = false

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

    /** Which permissions are granted: {"nowPlaying": bool, "recentApps": bool}. */
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
            .toString()
    }

    fun close() = govee.close()

    // ---------- Helpers ----------

    private fun dataUrl(drawable: Drawable, size: Int): String {
        val w = drawable.intrinsicWidth.takeIf { it > 0 } ?: size
        val h = drawable.intrinsicHeight.takeIf { it > 0 } ?: size
        val scale = size.toFloat() / maxOf(w, h)
        val bmp = Bitmap.createBitmap((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        drawable.setBounds(0, 0, bmp.width, bmp.height)
        drawable.draw(Canvas(bmp))
        return dataUrl(bmp, size)
    }

    private fun dataUrl(bitmap: Bitmap, size: Int, format: Bitmap.CompressFormat = Bitmap.CompressFormat.PNG): String {
        val scaled = if (maxOf(bitmap.width, bitmap.height) > size) {
            val s = size.toFloat() / maxOf(bitmap.width, bitmap.height)
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * s).toInt(), (bitmap.height * s).toInt(), true)
        } else {
            bitmap
        }
        val out = ByteArrayOutputStream()
        scaled.compress(format, 85, out)
        val mime = if (format == Bitmap.CompressFormat.PNG) "image/png" else "image/jpeg"
        return "data:$mime;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun hex(color: Int) = String.format("#%06x", color and 0xFFFFFF)

    private companion object {
        const val WEEK_MS = 7L * 24 * 60 * 60 * 1000
    }
}
