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
 * open on the TV (and for 20 minutes at most), listening only on the TV's Wi-Fi
 * address. The six-digit code the TV shows is exchanged once for a random
 * session token, which every later request must carry. Wrong codes lock the
 * page, and the lock survives restarting the launcher. Requests whose Host or
 * Origin isn't this TV's address are refused (DNS rebinding, other web pages).
 * From a phone on the same Wi-Fi you can:
 * - save the Govee API key (typing it with a remote would be painful),
 * - set the weather town,
 * - send wallpaper photos, and remove them again,
 * - download the list of apps on the TV.
 */
class SetupServer(
    private val context: Context,
    private val ip: String,
    private val port: Int,
    private val pin: String,
    private val events: Events,
) : NanoHTTPD(ip, port) {

    interface Events {
        fun onGoveeKey(key: String)
        fun onTown(town: String)
        fun onTmdb(key: String)
        fun onPrices(key: String)
        fun onWifi(ssid: String, password: String, security: String, hidden: Boolean)
        fun appsJson(): String
        fun backupJson(): String
        fun onRestore(text: String): Boolean
        fun wallpaperBytes(name: String): ByteArray?
        fun iconPng(pkg: String): ByteArray?
        fun onCleanup(pkgs: List<String>)
        fun onWallpapersChanged()
        fun stateJson(): JSONObject
        fun packagesText(): String
        fun packagesBefore(): String
        fun diagnosticsText(): String
    }

    private val guard = context.getSharedPreferences("setup-guard", Context.MODE_PRIVATE)
    private val triesByDevice = HashMap<String, Int>()
    private var token: String? = null

    override fun serve(session: IHTTPSession): Response = try {
        secure(route(session))
    } catch (e: Exception) {
        json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "Something went wrong on the TV"))
    }

    private fun secure(r: Response): Response = r.apply {
        addHeader("X-Frame-Options", "DENY")
        addHeader("X-Content-Type-Options", "nosniff")
        addHeader("Referrer-Policy", "no-referrer")
        addHeader("Cache-Control", "no-store")
    }

    private fun same(a: String, b: String) = java.security.MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

    /** Only this TV's own address: a page elsewhere, or a renamed host (DNS rebinding), is refused. */
    private fun fromThisTv(session: IHTTPSession): Boolean {
        val self = "$ip:$port"
        val host = session.headers["host"] ?: return false
        if (host != self) return false
        val origin = session.headers["origin"]
        return origin == null || origin == "http://$self"
    }

    /** Wrong codes: 5 tries, then a lock that doubles each time (1 min up to 1 hour). Kept across restarts. */
    private fun locked() = System.currentTimeMillis() < guard.getLong("lockedUntil", 0)

    private fun wrongCode(device: String) {
        val mine = (triesByDevice[device] ?: 0) + 1
        triesByDevice[device] = mine
        val all = guard.getInt("fails", 0) + 1
        val e = guard.edit().putInt("fails", all)
        if (mine >= 5 || all % 5 == 0) {
            val level = guard.getInt("level", 0)
            e.putLong("lockedUntil", System.currentTimeMillis() + minOf(60_000L shl level, 3_600_000L)).putInt("level", level + 1)
            triesByDevice[device] = 0
        }
        e.apply()
    }

    private fun route(session: IHTTPSession): Response {
        val uri = session.uri
        if (session.method == Method.GET && (uri == "/" || uri == "/index.html")) {
            val page = context.assets.open("setup.html").bufferedReader().use { it.readText() }
            // Never cached, so a phone that kept an old tab open loads the new page on reload.
            return NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", page)
                .also { it.addHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'") }
        }

        if (session.method == Method.GET && uri == "/qrcode.js") {
            val js = context.assets.open("web/qrcode.js").bufferedReader().use { it.readText() }
            return NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "application/javascript; charset=utf-8", js)
        }

        if (!fromThisTv(session)) return json(Response.Status.FORBIDDEN, JSONObject().put("error", "Open the address shown on the TV"))

        val files = HashMap<String, String>()
        if (session.method == Method.POST || session.method == Method.PUT) session.parseBody(files)
        fun param(name: String) = session.parameters[name]?.firstOrNull().orEmpty()

        if (locked()) {
            return json(Response.Status.FORBIDDEN, JSONObject().put("error", "Too many wrong codes. Wait, then try again"))
        }
        val device = session.remoteIpAddress.orEmpty()
        if (uri == "/api/login") {
            if (session.method != Method.POST || !same(param("pin"), pin)) {
                wrongCode(device)
                return json(Response.Status.FORBIDDEN, JSONObject().put("error", "That code isn't right"))
            }
            guard.edit().putInt("fails", 0).putInt("level", 0).apply()
            triesByDevice.clear()
            val t = ByteArray(24).also { java.security.SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
            token = t
            return json(Response.Status.OK, JSONObject().put("token", t))
        }
        val sent = session.headers["x-token"] ?: param("token")
        val current = token
        if (current == null || !same(sent, current)) {
            return json(Response.Status.FORBIDDEN, JSONObject().put("error", "Enter the code from the TV again"))
        }
        // Anything that changes the TV must be a POST (links and images can't change anything).
        val changes = uri !in setOf("/api/backup", "/api/wall", "/api/icon", "/packages.txt", "/packages-before.txt", "/api/diagnostics")
        if (changes && session.method != Method.POST) return json(Response.Status.METHOD_NOT_ALLOWED, JSONObject().put("error", "Not allowed"))

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
            "/api/prices" -> {
                events.onPrices(param("key").trim())
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
                if (File(tmp).length() > 25L * 1024 * 1024) return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "That photo is too big (25 MB at most)"))
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
            "/api/backup" -> NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "application/json", events.backupJson())
                .also { it.addHeader("Content-Disposition", "attachment; filename=smart-tv-backup.json") }
            "/api/restore" ->
                if (events.onRestore(param("backup"))) ok()
                else json(Response.Status.BAD_REQUEST, JSONObject().put("error", "That isn't a backup from this launcher"))
            "/api/apps" -> NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "application/json", events.appsJson())
            "/api/wall" -> events.wallpaperBytes(param("name"))?.let {
                NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "image/jpeg", it.inputStream(), it.size.toLong())
            } ?: json(Response.Status.NOT_FOUND, JSONObject().put("error", "No photo"))
            "/api/icon" -> events.iconPng(param("pkg"))?.let {
                NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "image/png", it.inputStream(), it.size.toLong())
            } ?: json(Response.Status.NOT_FOUND, JSONObject().put("error", "No icon"))
            "/api/cleanup" -> {
                events.onCleanup(param("pkgs").split(",").map { it.trim() }.filter { it.isNotEmpty() })
                ok()
            }
            "/packages.txt" -> NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", events.packagesText())
            "/packages-before.txt" -> NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", events.packagesBefore())
                .also { it.addHeader("Content-Disposition", "attachment; filename=packages-before-clean-up.txt") }
            "/api/diagnostics" -> NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", events.diagnosticsText())
                .also { it.addHeader("Content-Disposition", "attachment; filename=smart-tv-diagnostics.txt") }
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
