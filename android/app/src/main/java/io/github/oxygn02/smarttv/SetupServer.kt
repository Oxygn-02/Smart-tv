package io.github.oxygn02.smarttv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject
import java.io.File

/**
 * The page behind "Set up from your phone". It runs only while that screen is
 * open on the TV, and every request needs the four-digit code the TV shows.
 * From a phone on the same Wi-Fi you can:
 * - save the Govee API key (typing it with a remote would be painful),
 * - set the weather town,
 * - send wallpaper photos, and remove them again,
 * - download the list of apps on the TV.
 */
class SetupServer(
    private val context: Context,
    port: Int,
    private val pin: String,
    private val events: Events,
) : NanoHTTPD(port) {

    interface Events {
        fun onGoveeKey(key: String)
        fun onTown(town: String)
        fun onTmdb(key: String)
        fun onWifi(ssid: String, password: String, security: String, hidden: Boolean)
        fun appsJson(): String
        fun iconPng(pkg: String): ByteArray?
        fun onCleanup(pkgs: List<String>)
        fun onWallpapersChanged()
        fun stateJson(): JSONObject
        fun packagesText(): String
    }

    private var wrongTries = 0
    private var lockedUntil = 0L

    override fun serve(session: IHTTPSession): Response = try {
        route(session)
    } catch (e: Exception) {
        json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "Something went wrong on the TV"))
    }

    private fun route(session: IHTTPSession): Response {
        val uri = session.uri
        if (session.method == Method.GET && (uri == "/" || uri == "/index.html")) {
            val page = context.assets.open("setup.html").bufferedReader().use { it.readText() }
            return NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", page)
        }

        if (session.method == Method.GET && uri == "/qrcode.js") {
            val js = context.assets.open("web/qrcode.js").bufferedReader().use { it.readText() }
            return NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "application/javascript; charset=utf-8", js)
        }

        val files = HashMap<String, String>()
        if (session.method == Method.POST || session.method == Method.PUT) session.parseBody(files)
        fun param(name: String) = session.parameters[name]?.firstOrNull().orEmpty()

        if (System.currentTimeMillis() < lockedUntil) {
            return json(Response.Status.FORBIDDEN, JSONObject().put("error", "Too many tries. Wait a minute"))
        }
        if (param("pin") != pin) {
            if (++wrongTries >= 5) {
                wrongTries = 0
                lockedUntil = System.currentTimeMillis() + 60_000
            }
            return json(Response.Status.FORBIDDEN, JSONObject().put("error", "That code isn't right"))
        }
        wrongTries = 0

        return when (uri) {
            "/api/state" -> json(Response.Status.OK, events.stateJson())
            "/api/govee" -> {
                events.onGoveeKey(param("key").trim())
                ok()
            }
            "/api/tmdb" -> {
                events.onTmdb(param("key").trim())
                ok()
            }
            "/api/wifi" -> {
                events.onWifi(
                    param("ssid").trim(), param("password"),
                    when (param("security")) { "nopass" -> "nopass"; "WEP" -> "WEP"; else -> "WPA" },
                    param("hidden") == "true",
                )
                ok()
            }
            "/api/town" -> {
                events.onTown(param("town").trim())
                ok()
            }
            "/api/wallpaper" -> {
                val tmp = files["file"] ?: return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "No photo came through"))
                if (saveWallpaper(File(tmp))) {
                    events.onWallpapersChanged()
                    ok()
                } else {
                    json(Response.Status.BAD_REQUEST, JSONObject().put("error", "Couldn't read that photo. Try a JPEG or PNG"))
                }
            }
            "/api/wallpaper/delete" -> {
                val name = File(param("name")).name // no folders
                File(wallpaperDir(context), name).delete()
                events.onWallpapersChanged()
                ok()
            }
            "/api/apps" -> NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "application/json", events.appsJson())
            "/api/icon" -> events.iconPng(param("pkg"))?.let {
                NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "image/png", it.inputStream(), it.size.toLong())
            } ?: json(Response.Status.NOT_FOUND, JSONObject().put("error", "No icon"))
            "/api/cleanup" -> {
                events.onCleanup(param("pkgs").split(",").map { it.trim() }.filter { it.isNotEmpty() })
                ok()
            }
            "/packages.txt" -> NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", events.packagesText())
            else -> json(Response.Status.NOT_FOUND, JSONObject().put("error", "Not found"))
        }
    }

    /** Scales a photo to at most 1920 wide, turns it upright and keeps it as a JPEG. */
    private fun saveWallpaper(src: File): Boolean {
        val dir = wallpaperDir(context)
        dir.mkdirs()
        if ((dir.listFiles()?.size ?: 0) >= MAX_PHOTOS) return false

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(src.path, bounds)
        if (bounds.outWidth <= 0) return false
        var sample = 1
        while (bounds.outWidth / sample > 2 * MAX_WIDTH) sample *= 2
        val decoded = BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return false

        val turn = when (runCatching { ExifInterface(src.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) }.getOrDefault(1)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        var bmp: Bitmap = decoded
        if (turn != 0f) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(turn) }, true)
        if (bmp.width > MAX_WIDTH) {
            bmp = Bitmap.createScaledBitmap(bmp, MAX_WIDTH, (bmp.height * MAX_WIDTH.toFloat() / bmp.width).toInt(), true)
        }
        File(dir, "${System.currentTimeMillis()}.jpg").outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 86, it) }
        return true
    }

    private fun ok() = json(Response.Status.OK, JSONObject().put("ok", true))

    private fun json(status: Response.IStatus, body: JSONObject): Response =
        NanoHTTPD.newFixedLengthResponse(status, "application/json; charset=utf-8", body.toString())

    companion object {
        private const val MAX_WIDTH = 1920
        private const val MAX_PHOTOS = 24

        /** Where photos sent from a phone are kept (private to the app). */
        fun wallpaperDir(context: Context) = File(context.filesDir, "wallpapers")
    }
}
