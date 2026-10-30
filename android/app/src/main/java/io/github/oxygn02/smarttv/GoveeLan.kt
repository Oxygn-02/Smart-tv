package io.github.oxygn02.smarttv

import android.content.Context
import android.net.wifi.WifiManager
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Govee LAN API: local control over Wi-Fi, no account. Each device must have
 * "LAN Control" switched on in the Govee Home app.
 *
 * - Discovery: multicast {"msg":{"cmd":"scan",...}} to 239.255.255.250:4001;
 *   devices answer on UDP 4002 with their ip and sku (model).
 * - Control: JSON to <device ip>:4003 ("turn", "brightness", "colorwc").
 *
 * DreamView (picture sync) isn't in the LAN API; switching it back on needs
 * Govee's cloud API with an API key (not wired up yet).
 */
class GoveeLan(context: Context) {

    private val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
    private val io = Executors.newSingleThreadExecutor()

    /** sku (e.g. "H6097") -> device IPs seen in the last scan. */
    private val devices = ConcurrentHashMap<String, MutableSet<String>>()

    init {
        io.execute { scan() }
    }

    fun setColor(sku: String, r: Int, g: Int, b: Int) = send(sku) {
        command("turn", JSONObject().put("value", 1))
        command(
            "colorwc",
            JSONObject()
                .put("color", JSONObject().put("r", r).put("g", g).put("b", b))
                .put("colorTemInKelvin", 0),
        )
    }

    fun setPower(sku: String, on: Boolean) = send(sku) {
        command("turn", JSONObject().put("value", if (on) 1 else 0))
    }

    fun close() = io.shutdownNow()

    private fun send(sku: String, build: Commands.() -> Unit) {
        io.execute {
            if (devices[sku].isNullOrEmpty()) scan()
            val ips = devices[sku] ?: return@execute
            val commands = Commands().apply(build).list
            DatagramSocket().use { socket ->
                for (ip in ips) for (msg in commands) {
                    val bytes = msg.toByteArray()
                    socket.send(DatagramPacket(bytes, bytes.size, InetAddress.getByName(ip), CONTROL_PORT))
                }
            }
        }
    }

    private fun scan() {
        // Multicast replies are dropped on many TVs unless we hold this lock.
        val lock = wifi?.createMulticastLock("govee-scan")?.apply {
            setReferenceCounted(false)
            acquire()
        }
        try {
            DatagramSocket(null).use { listen ->
                listen.reuseAddress = true
                listen.bind(InetSocketAddress(REPLY_PORT))
                listen.soTimeout = 1500

                val scan = """{"msg":{"cmd":"scan","data":{"account_topic":"reserve"}}}""".toByteArray()
                DatagramSocket().use {
                    it.send(DatagramPacket(scan, scan.size, InetAddress.getByName(MULTICAST), SCAN_PORT))
                }

                val buf = ByteArray(2048)
                while (true) {
                    val packet = DatagramPacket(buf, buf.size)
                    try {
                        listen.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        break
                    }
                    val data = JSONObject(String(packet.data, 0, packet.length))
                        .optJSONObject("msg")?.optJSONObject("data") ?: continue
                    val sku = data.optString("sku")
                    val ip = data.optString("ip")
                    if (sku.isNotEmpty() && ip.isNotEmpty()) {
                        devices.getOrPut(sku) { ConcurrentHashMap.newKeySet() }.add(ip)
                    }
                }
            }
        } catch (_: Exception) {
            // No Wi-Fi or port in use: try again on the next command.
        } finally {
            lock?.release()
        }
    }

    private class Commands {
        val list = mutableListOf<String>()
        fun command(cmd: String, data: JSONObject) {
            list += JSONObject().put("msg", JSONObject().put("cmd", cmd).put("data", data)).toString()
        }
    }

    private companion object {
        const val MULTICAST = "239.255.255.250"
        const val SCAN_PORT = 4001
        const val REPLY_PORT = 4002
        const val CONTROL_PORT = 4003
    }
}
