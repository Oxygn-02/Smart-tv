package io.github.oxygn02.smarttv

import android.content.Context
import java.io.File

/**
 * The safety net for the home screen. If this launcher keeps failing to start
 * (three starts in a row that never reach a working page), Google's home screen
 * is switched back on over the TV's own debug connection and made the home
 * screen again, so the TV is never left without one.
 */
object HomeGuard {
    const val MAX_FAILS = 3

    private val GOOGLE_HOME = listOf(
        "com.google.android.tvlauncher",
        "com.google.android.tvrecommendations",
        "com.google.android.apps.tv.launcherx",
    )

    private val component = Regex("^[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+$")

    /** Records the last safety-net event (shown on the Diagnostics page). Keeps the last 8. */
    fun note(prefs: android.content.SharedPreferences, what: String) {
        val line = "${java.text.SimpleDateFormat("d MMM HH:mm", java.util.Locale.UK).format(java.util.Date())}  $what"
        val old = prefs.getString("events", "").orEmpty().split('\n').filter { it.isNotBlank() }
        prefs.edit().putString("events", (listOf(line) + old).take(8).joinToString("\n")).apply()
    }

    /** True when the last starts all failed, so it is time to give the home screen back. */
    fun shouldRescue(startFails: Int) = startFails >= MAX_FAILS

    /** The shell commands that put Google's home screen back. */
    fun rescueCommands(previousHome: String?): List<String> = buildList {
        GOOGLE_HOME.forEach { add("pm enable $it") }
        if (!previousHome.isNullOrBlank() && component.matches(previousHome)) add("cmd package set-home-activity $previousHome")
    }

    /** Runs the rescue on an already connected client. Returns how many commands ran. */
    fun runRescue(client: AdbClient, previousHome: String?): Int {
        var ran = 0
        rescueCommands(previousHome).forEach {
            runCatching { client.shell(it); ran++ }
        }
        return ran
    }

    /** Connects to this TV's own debug port (already trusted) and gives Google's home screen back. */
    fun rescue(context: Context): Boolean {
        val client = AdbClient(File(context.filesDir, "adb"))
        return try {
            client.connect("127.0.0.1", 5555, onNeedApproval = { throw AdbClient.AdbException("Not trusted yet") })
            val prev = context.getSharedPreferences("adblog", Context.MODE_PRIVATE).getString("prevHome", null)
            runRescue(client, prev) > 0
        } catch (_: Exception) {
            false
        } finally {
            client.close()
        }
    }
}
