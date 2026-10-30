package io.github.oxygn02.smarttv

import android.app.Notification
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.service.notification.NotificationListenerService

/**
 * Lets the launcher be granted notification-listener access, which is what lets
 * [LauncherBridge.nowPlaying] see other apps' media sessions. It also reads the
 * media notifications that apps and the Cast receiver show, for songs whose
 * session carries no details.
 *
 * Grant it in the launcher's Settings (Now playing access), or over ADB:
 * adb shell cmd notification allow_listener io.github.oxygn02.smarttv/io.github.oxygn02.smarttv.MediaListener
 */
class MediaListener : NotificationListenerService() {

    class MediaNote(val pkg: String, val title: String, val text: String, val art: Bitmap?)

    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        if (instance === this) instance = null
    }

    /** What the system's media notifications currently say. */
    fun mediaNotes(): List<MediaNote> = try {
        activeNotifications.orEmpty().mapNotNull { sbn ->
            val n = sbn.notification
            val extras = n.extras
            val isMedia = n.category == Notification.CATEGORY_TRANSPORT || extras.containsKey(Notification.EXTRA_MEDIA_SESSION)
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
            if (!isMedia || title.isNullOrBlank()) return@mapNotNull null
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
            val art = runCatching { (n.getLargeIcon()?.loadDrawable(this) as? BitmapDrawable)?.bitmap }.getOrNull()
            MediaNote(sbn.packageName, title, text, art)
        }
    } catch (_: Exception) {
        emptyList()
    }

    companion object {
        @Volatile var instance: MediaListener? = null
    }
}
