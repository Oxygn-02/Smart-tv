package io.github.oxygn02.smarttv

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Everything the launcher does with Govee lights, in one place. It keeps the
 * account's device list, sends each command the fastest way that works (the
 * local network if the light answered a scan, otherwise Govee's cloud) and
 * reports the result to the page through [publish].
 *
 * Commands run one at a time on a background thread, with a short gap between
 * cloud calls to stay inside Govee's rate limits.
 */
class GoveeHub(context: Context, private val publish: (String) -> Unit) {

    private val prefs = context.applicationContext.getSharedPreferences("govee", Context.MODE_PRIVATE)
    private val io = Executors.newSingleThreadExecutor()
    private val lan = GoveeLan(context)
    private val cloud = GoveeCloud { prefs.getString("key", "").orEmpty() }

    @Volatile private var devices: List<GoveeDevice> = emptyList()
    @Volatile private var connected = false
    @Volatile private var error = ""
    private val isOn = ConcurrentHashMap<String, Boolean>()
    private val dreamOn = ConcurrentHashMap<String, Boolean>()

    fun hasKey() = prefs.getString("key", "").orEmpty().isNotBlank()

    /** Saves a new key (if given), then loads the account's devices. Returns at once. */
    fun connect(newKey: String?) {
        if (!newKey.isNullOrBlank()) prefs.edit().putString("key", newKey.trim()).apply()
        if (!hasKey()) {
            connected = false
            publish(status())
            return
        }
        io.execute {
            try {
                devices = cloud.devices()
                connected = true
                error = ""
                lan.scan()
                // Which lights are on right now (a few calls; skipped on any error).
                for (d in devices.filter { it.isLight && it.has("powerSwitch") }.take(10)) {
                    runCatching { cloud.powerState(d) }.getOrNull()?.let { isOn[d.id] = it }
                    Thread.sleep(150)
                }
            } catch (e: GoveeCloud.GoveeError) {
                connected = false
                error = e.message ?: "Govee error"
            }
            publish(status())
        }
    }

    fun forgetKey() {
        prefs.edit().remove("key").apply()
        devices = emptyList()
        connected = false
        error = ""
        publish(status())
    }

    /** {hasKey, connected, error, devices:[{id, sku, name, light, on, color, white, brightness, dream}]} */
    fun status(message: String? = null): String {
        val list = JSONArray()
        devices.forEach { d ->
            list.put(
                JSONObject()
                    .put("id", d.id)
                    .put("sku", d.sku)
                    .put("name", d.name)
                    .put("light", d.isLight)
                    .put("on", isOn[d.id] ?: false)
                    .put("color", d.has("colorRgb"))
                    .put("white", d.has("colorTemperatureK"))
                    .put("brightness", d.has("brightness"))
                    .put("dream", d.dreamViewInstance != null)
                    .put("lan", lan.ipFor(d.id) != null),
            )
        }
        val json = JSONObject()
            .put("hasKey", hasKey())
            .put("connected", connected)
            .put("error", error)
            .put("devices", list)
        if (message != null) json.put("message", message)
        return json.toString()
    }

    fun power(id: String, on: Boolean) = run {
        val d = find(id)
        val ip = lan.ipFor(id)
        if (ip != null) {
            lan.send(ip, GoveeLan.turn(on))
        } else {
            cloud.control(d, ON_OFF, "powerSwitch", if (on) 1 else 0)
        }
        isOn[id] = on
    }

    fun brightness(id: String, percent: Int) = run {
        val d = find(id)
        val ip = lan.ipFor(id)
        if (ip != null) {
            lan.send(ip, GoveeLan.brightness(percent))
        } else {
            cloud.control(d, RANGE, "brightness", percent.coerceIn(1, 100))
        }
    }

    fun color(id: String, r: Int, g: Int, b: Int) = run {
        val d = find(id)
        stopDreamView(d)
        val ip = lan.ipFor(id)
        if (ip != null) {
            lan.send(ip, GoveeLan.turn(true), GoveeLan.color(r, g, b))
        } else {
            if (isOn[id] != true) cloud.control(d, ON_OFF, "powerSwitch", 1)
            cloud.control(d, COLOR, "colorRgb", (r shl 16) or (g shl 8) or b)
        }
        isOn[id] = true
    }

    /** Warm or cool white at [kelvin] (clamped to what the light supports). */
    fun white(id: String, kelvin: Int) = run {
        val d = find(id)
        val k = d.kelvinRange?.let { kelvin.coerceIn(it.first, it.second) } ?: kelvin
        val ip = lan.ipFor(id)
        if (ip != null) {
            lan.send(ip, GoveeLan.turn(true), GoveeLan.white(k))
        } else {
            if (isOn[id] != true) cloud.control(d, ON_OFF, "powerSwitch", 1)
            cloud.control(d, COLOR, "colorTemperatureK", k)
        }
        isOn[id] = true
    }

    /**
     * Reads what a light is doing now (so a change made in the Govee app shows
     * up here). The answer arrives as a "govee" event: {live:{id,on,rgb,...}}.
     */
    fun readLive(id: String) {
        io.execute {
            try {
                val live = cloud.state(find(id)).put("id", id)
                if (live.has("on")) isOn[id] = live.optBoolean("on")
                publish(JSONObject().put("live", live).toString())
            } catch (_: Exception) {
                // Offline or rate-limited: try again next time.
            }
        }
    }

    /** DreamView: the backlight follows the picture (its camera). */
    fun dreamView(id: String, enable: Boolean) = run {
        val d = find(id)
        val instance = d.dreamViewInstance
            ?: throw GoveeCloud.GoveeError("Govee doesn't offer picture sync for this light through its account. Use the Govee Home app for it")
        cloud.control(d, TOGGLE, instance, if (enable) 1 else 0)
        dreamOn[id] = enable
    }

    fun close() = io.shutdownNow()

    // ---------- internals ----------

    private fun find(id: String): GoveeDevice =
        devices.firstOrNull { it.id == id } ?: throw GoveeCloud.GoveeError("That light isn't on the Govee account")

    private fun stopDreamView(d: GoveeDevice) {
        if (dreamOn[d.id] == true) {
            d.dreamViewInstance?.let { cloud.control(d, TOGGLE, it, 0) }
            dreamOn[d.id] = false
        }
    }

    private fun run(block: () -> Unit) {
        io.execute {
            try {
                block()
                Thread.sleep(200) // keeps cloud calls inside Govee's rate limit
            } catch (e: GoveeCloud.GoveeError) {
                publish(status(e.message))
            } catch (e: Exception) {
                publish(status("That light command didn't go through"))
            }
        }
    }

    private companion object {
        const val ON_OFF = "devices.capabilities.on_off"
        const val RANGE = "devices.capabilities.range"
        const val COLOR = "devices.capabilities.color_setting"
        const val TOGGLE = "devices.capabilities.toggle"
    }
}
