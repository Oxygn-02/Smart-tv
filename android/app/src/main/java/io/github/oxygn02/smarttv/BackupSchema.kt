package io.github.oxygn02.smarttv

import org.json.JSONArray
import org.json.JSONObject

/**
 * The only settings a backup may carry, each with its type and limits.
 * Anything else in a backup file is dropped.
 */
object BackupSchema {
    private fun str(max: Int, vararg allowed: String) = { v: Any? ->
        (v as? String)?.takeIf { it.length <= max && (allowed.isEmpty() || it in allowed) }
    }
    private fun num(min: Double, max: Double) = { v: Any? ->
        (v as? Number)?.toDouble()?.takeIf { it in min..max }
    }
    private val bool = { v: Any? -> v as? Boolean }

    private val fields: Map<String, (Any?) -> Any?> = mapOf(
        "edge" to str(10, "lights", "media", "custom", "off"),
        "edgeHue" to num(0.0, 360.0),
        "edgeInt" to num(10.0, 100.0),
        "trailers" to bool,
        "clock24" to bool,
        "motion" to str(10, "smooth", "fast"),
        "spread" to { v -> v as? Boolean ?: (v as? Number)?.toDouble()?.takeIf { it in 0.0..100.0 } },
        "ambient" to num(0.0, 240.0),
        "appearance" to str(6, "auto", "light", "dark"),
        "iconStyle" to str(10, "default", "dark", "clear", "tinted"),
        "wallpaper" to str(10, "photo", "gradient", "lights"),
        "wallpaperName" to str(80),
        "matchLights" to bool,
        "town" to str(64),
        "tint" to ::tint,
        "roles" to ::roles,
        "myScenes" to ::scenes,
        "games" to ::games,
    )

    fun clean(settings: JSONObject): JSONObject {
        val out = JSONObject()
        fields.forEach { (k, check) ->
            if (!settings.has(k)) return@forEach
            val v = settings.opt(k)
            if (v == JSONObject.NULL && k == "wallpaperName") out.put(k, JSONObject.NULL)
            else check(v)?.let { out.put(k, it) }
        }
        return out
    }

    private fun tint(v: Any?): JSONObject? {
        val o = v as? JSONObject ?: return null
        val out = JSONObject()
        listOf("hue" to 360.0, "warmth" to 100.0, "opacity" to 100.0).forEach { (k, max) ->
            num(0.0, max)(o.opt(k))?.let { out.put(k, it) }
        }
        str(10, "room", "custom")(o.opt("source"))?.let { out.put("source", it) }
        return out
    }

    private val id = Regex("^[A-Za-z0-9_.:-]{1,80}$")

    private fun roles(v: Any?): JSONObject? {
        val o = v as? JSONObject ?: return null
        val out = JSONObject()
        o.keys().asSequence().take(40).forEach { k ->
            if (id.matches(k)) str(12, "", "ceiling", "lamp", "cabinet", "monitor")(o.opt(k))?.let { out.put(k, it) }
        }
        return out
    }

    private fun scenes(v: Any?): JSONArray? {
        val a = v as? JSONArray ?: return null
        val out = JSONArray()
        for (i in 0 until minOf(a.length(), 30)) {
            val sc = a.optJSONObject(i) ?: continue
            val sid = sc.optString("id").takeIf { id.matches(it) } ?: continue
            val name = sc.optString("name").take(24)
            if (name.isBlank()) continue
            val clean = JSONObject().put("id", sid).put("name", name)
            str(24)(sc.opt("backlight"))?.let { clean.put("backlight", it) }
            val lights = JSONObject()
            (sc.opt("lights") as? JSONObject)?.let { l ->
                l.keys().asSequence().take(40).forEach { k -> if (id.matches(k)) bool(l.opt(k))?.let { lights.put(k, it) } }
            }
            clean.put("lights", lights)
            out.put(clean)
        }
        return out
    }

    private fun games(v: Any?): JSONObject? {
        val o = v as? JSONObject ?: return null
        val out = JSONObject()
        num(1.0, 4.0)(o.opt("hdmiPort"))?.let { out.put("hdmiPort", it.toInt()) }
        bool(o.opt("autoSwitch"))?.let { out.put("autoSwitch", it) }
        num(0.0, 30.0)(o.opt("countdownSec"))?.let { out.put("countdownSec", it.toInt()) }
        return out
    }
}
