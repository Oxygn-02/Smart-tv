package io.github.oxygn02.smarttv

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/** One Govee device from the account: what it is called and what it can do. */
data class GoveeDevice(
    val id: String,
    val sku: String,
    val name: String,
    val type: String,
    /** capability instance name -> its description from Govee (parameters, ranges). */
    val caps: Map<String, JSONObject>,
) {
    val isLight get() = type.contains("light", ignoreCase = true)
    fun has(instance: String) = caps.containsKey(instance)

    /** The DreamView (picture sync) switch, if this device offers one. */
    val dreamViewInstance: String? get() = caps.keys.firstOrNull { it.contains("dreamview", ignoreCase = true) }

    /** Colour temperature range in kelvin, if the light can do white. */
    val kelvinRange: Pair<Int, Int>?
        get() = caps["colorTemperatureK"]?.optJSONObject("parameters")?.optJSONObject("range")
            ?.let { it.optInt("min", 2000) to it.optInt("max", 9000) }
}

/**
 * Govee's cloud API (the account route). Needs the API key from the Govee Home
 * app (Profile > Settings > Apply for API Key; it is emailed). The key stays in
 * this app's private storage and is never sent anywhere but Govee.
 *
 * Written from Govee's published OpenAPI shape. The first run on a real
 * account is what confirms it, so every failure is turned into a plain message
 * the launcher can show.
 */
class GoveeCloud(private val key: () -> String) {

    class GoveeError(message: String) : Exception(message)

    fun devices(): List<GoveeDevice> {
        val json = call("GET", "/router/api/v1/user/devices", null)
        val data = json.optJSONArray("data") ?: JSONArray()
        return (0 until data.length()).map { i ->
            val d = data.getJSONObject(i)
            val caps = d.optJSONArray("capabilities") ?: JSONArray()
            GoveeDevice(
                id = d.optString("device"),
                sku = d.optString("sku"),
                name = d.optString("deviceName").ifBlank { d.optString("sku") },
                type = d.optString("type"),
                caps = (0 until caps.length()).associate { j ->
                    val c = caps.getJSONObject(j)
                    c.optString("instance") to c
                },
            )
        }
    }

    /** Sends one capability value, e.g. powerSwitch 1, brightness 40, colorRgb 16711680. */
    fun control(device: GoveeDevice, type: String, instance: String, value: Any) {
        val body = JSONObject()
            .put("requestId", UUID.randomUUID().toString())
            .put(
                "payload",
                JSONObject()
                    .put("sku", device.sku)
                    .put("device", device.id)
                    .put("capability", JSONObject().put("type", type).put("instance", instance).put("value", value)),
            )
        try {
            call("POST", "/router/api/v1/device/control", body)
        } catch (e: MethodNotAllowed) {
            call("PUT", "/router/api/v1/device/control", body) // older docs used PUT
        }
    }

    /** Whether the light is on, or null if Govee doesn't say. */
    fun powerState(device: GoveeDevice): Boolean? {
        val body = JSONObject()
            .put("requestId", UUID.randomUUID().toString())
            .put("payload", JSONObject().put("sku", device.sku).put("device", device.id))
        val caps = call("POST", "/router/api/v1/device/state", body)
            .optJSONObject("payload")?.optJSONArray("capabilities") ?: return null
        for (i in 0 until caps.length()) {
            val c = caps.getJSONObject(i)
            if (c.optString("instance") == "powerSwitch") {
                return c.optJSONObject("state")?.optInt("value", 0) == 1
            }
        }
        return null
    }

    /** What the light is doing now: {on, brightness, rgb, kelvin}. Missing values are left out. */
    fun state(device: GoveeDevice): JSONObject {
        val body = JSONObject()
            .put("requestId", UUID.randomUUID().toString())
            .put("payload", JSONObject().put("sku", device.sku).put("device", device.id))
        val out = JSONObject()
        val caps = call("POST", "/router/api/v1/device/state", body)
            .optJSONObject("payload")?.optJSONArray("capabilities") ?: return out
        for (i in 0 until caps.length()) {
            val c = caps.getJSONObject(i)
            val v = c.optJSONObject("state")?.opt("value") ?: continue
            when (c.optString("instance")) {
                "powerSwitch" -> out.put("on", (v as? Number)?.toInt() == 1)
                "brightness" -> (v as? Number)?.let { out.put("brightness", it.toInt()) }
                "colorRgb" -> (v as? Number)?.toInt()?.takeIf { it > 0 }?.let { out.put("rgb", it) }
                "colorTemperatureK" -> (v as? Number)?.toInt()?.takeIf { it > 0 }?.let { out.put("kelvin", it) }
            }
        }
        return out
    }

    private class MethodNotAllowed : Exception()

    private fun call(method: String, path: String, body: JSONObject?): JSONObject {
        val apiKey = key().trim()
        if (apiKey.isEmpty()) throw GoveeError("No Govee key yet")
        val conn = try {
            (URL(BASE + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 8000
                readTimeout = 10000
                setRequestProperty("Govee-API-Key", apiKey)
                setRequestProperty("Content-Type", "application/json")
                if (body != null) {
                    doOutput = true
                    outputStream.use { it.write(body.toString().toByteArray()) }
                }
            }
        } catch (e: IOException) {
            throw GoveeError("Couldn't reach Govee. Check the TV is online")
        }
        try {
            val code = try {
                conn.responseCode
            } catch (e: IOException) {
                throw GoveeError("Couldn't reach Govee. Check the TV is online")
            }
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            val apiCode = json.optInt("code", code)
            when {
                code == 405 && method == "POST" -> throw MethodNotAllowed()
                code == 401 || code == 403 || apiCode == 401 || apiCode == 403 ->
                    throw GoveeError("Govee did not accept that key. Check it and try again")
                code == 429 || apiCode == 429 -> throw GoveeError("Govee says too many requests. Try again in a minute")
                code !in 200..299 || apiCode !in 200..299 ->
                    throw GoveeError(json.optString("message").ifBlank { json.optString("msg") }.ifBlank { "Govee error $apiCode" })
            }
            return json
        } finally {
            conn.disconnect()
        }
    }

    private companion object {
        const val BASE = "https://openapi.api.govee.com"
    }
}
