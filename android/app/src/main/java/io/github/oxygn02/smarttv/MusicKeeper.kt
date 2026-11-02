package io.github.oxygn02.smarttv

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import java.io.File

/**
 * "Keep the launcher in front": when music starts playing in another app (YouTube
 * Music, or a song cast from a phone), the launcher is brought back to the front
 * after a few seconds while the music carries on. It only reacts to music
 * starting, so opening the music app yourself afterwards is left alone.
 */
class MusicKeeper(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private val prefs = context.getSharedPreferences("keep", Context.MODE_PRIVATE)
    private val watched = HashMap<String, MediaController.Callback>()
    private val wasPlaying = HashMap<String, Boolean>()
    private var lastBrought = 0L

    private val onSessions = MediaSessionManager.OnActiveSessionsChangedListener { list -> attach(list.orEmpty()) }

    fun start() {
        val msm = context.getSystemService(MediaSessionManager::class.java) ?: return
        val cn = ComponentName(context, MediaListener::class.java)
        try {
            msm.addOnActiveSessionsChangedListener(onSessions, cn)
            attach(msm.getActiveSessions(cn))
        } catch (_: SecurityException) { /* notification access not granted yet */ }
    }

    fun stop() {
        context.getSystemService(MediaSessionManager::class.java)?.removeOnActiveSessionsChangedListener(onSessions)
        handler.removeCallbacksAndMessages(null)
    }

    private fun attach(list: List<MediaController>) {
        list.forEach { c ->
            val key = c.packageName
            if (watched.containsKey(key)) return@forEach
            val cb = object : MediaController.Callback() {
                override fun onPlaybackStateChanged(state: PlaybackState?) = changed(c, state)
                override fun onMetadataChanged(metadata: android.media.MediaMetadata?) = changed(c, c.playbackState)
            }
            watched[key] = cb
            c.registerCallback(cb, handler)
            wasPlaying[key] = isPlaying(c.playbackState)
        }
    }

    private fun isPlaying(s: PlaybackState?) = s?.state == PlaybackState.STATE_PLAYING

    private fun isMusic(c: MediaController): Boolean {
        if (c.packageName == "com.google.android.youtube.tvmusic") return true
        // A song has an artist; a video from YouTube or a cast film doesn't.
        val md = c.metadata ?: return false
        return !md.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST).isNullOrBlank()
    }

    private fun changed(c: MediaController, state: PlaybackState?) {
        val key = c.packageName
        val now = isPlaying(state)
        val was = wasPlaying[key] == true
        wasPlaying[key] = now
        if (!enabled() || !now || was || MainActivity.resumed) return
        if (!isMusic(c)) return
        handler.postDelayed({
            if (enabled() && !MainActivity.resumed && isPlaying(c.playbackState) && System.currentTimeMillis() - lastBrought > 15000) {
                lastBrought = System.currentTimeMillis()
                Thread { bringLauncherForward() }.start()
            }
        }, 3500)
    }

    fun enabled() = prefs.getBoolean("on", false)

    private fun bringLauncherForward() {
        // Over the TV's own trusted debug port, which is not limited like an app starting a window from the background.
        val client = AdbClient(File(context.filesDir, "adb"))
        val ok = try {
            client.connect("127.0.0.1", 5555, onNeedApproval = { throw AdbClient.AdbException("Not trusted yet") })
            client.shell("am start -n ${context.packageName}/.MainActivity")
            true
        } catch (_: Exception) {
            false
        } finally {
            client.close()
        }
        if (!ok) runCatching {
            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        }
    }
}
