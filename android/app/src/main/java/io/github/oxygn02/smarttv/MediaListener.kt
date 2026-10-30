package io.github.oxygn02.smarttv

import android.service.notification.NotificationListenerService

/**
 * Exists only so the launcher can be granted notification-listener access,
 * which is what lets [LauncherBridge.nowPlaying] read other apps' media
 * sessions (MediaSessionManager.getActiveSessions). It handles no
 * notifications itself.
 *
 * Grant once over ADB:
 * adb shell cmd notification allow_listener io.github.oxygn02.smarttv/io.github.oxygn02.smarttv.MediaListener
 */
class MediaListener : NotificationListenerService()
