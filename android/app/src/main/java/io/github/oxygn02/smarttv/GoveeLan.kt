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

/**
 * Govee LAN API: local control over Wi-Fi, instant and with no account. A light
 * is only found if "LAN Control" is switched on for it in the Govee Home app;
 * anything else goes through the cloud ([GoveeCloud]).
 *
 * - Discovery: multicast {"msg":{"cmd":"scan",...}} to 239.255.255.250:4001;
 *   devices answer on UDP 4002 with their id, model (sku) and ip.
 * - Control: JSON to <device ip>:4003 ("turn", "brightness", "colorwc").
 *
 * Not thread-safe on its own: [GoveeHub] calls it from one thread.
 */
class GoveeLan(context: Context) {

    private val wifi = context.applicationContext.getSystemService(WifiManager::class.java)

    /** device id -> ip, from the last scan. */
    private val ips = ConcurrentHashMap<String, String>()

    fun ipFor(id: String): String? = ips[id]

    /** Looks for lights on the network for a couple of seconds. Blocks. */
    fun scan() {
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
                    val id = data.optString("device")
                    val ip = data.optString("ip")
                    if (id.isNotEmpty() && ip.isNotEmpty()) ips[id] = ip
                }
            }
        } catch (_: Exception) {
            // No Wi-Fi, or the port is in use: lights fall back to the cloud.
        } finally {
            lock?.release()
        }
    }

    fun send(ip: String, vararg messages: JSONObject) {
        DatagramSocket().use { socket ->
            for (m in messages) {
                val bytes = m.toString().toByteArray()
                socket.send(DatagramPacket(bytes, bytes.size, InetAddress.getByName(ip), CONTROL_PORT))
            }
        }
    }

    companion object {
        private const val MULTICAST = "239.255.255.250"
        private const val SCAN_PORT = 4001
        private const val REPLY_PORT = 4002
        private const val CONTROL_PORT = 4003

        private fun msg(cmd: String, data: JSONObject) =
            JSONObject().put("msg", JSONObject().put("cmd", cmd).put("data", data))

        fun turn(on: Boolean) = msg("turn", JSONObject().put("value", if (on) 1 else 0))

        fun brightness(percent: Int) = msg("brightness", JSONObject().put("value", percent.coerceIn(1, 100)))

        fun color(r: Int, g: Int, b: Int) = msg(
            "colorwc",
            JSONObject()
                .put("color", JSONObject().put("r", r).put("g", g).put("b", b))
                .put("colorTemInKelvin", 0),
        )

        fun white(kelvin: Int) = msg(
            "colorwc",
            JSONObject()
                .put("color", JSONObject().put("r", 0).put("g", 0).put("b", 0))
                .put("colorTemInKelvin", kelvin),
        )
    }
}
