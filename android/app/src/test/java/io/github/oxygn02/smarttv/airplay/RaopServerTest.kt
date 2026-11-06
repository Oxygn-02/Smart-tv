package io.github.oxygn02.smarttv.airplay

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.RSAPublicKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Plays a song to the speaker the way an iPhone does: challenge, encrypted
 * key, RTP audio (shuffled, with one packet held back until the speaker asks
 * for it again), song details, then teardown. Every decoded sample must match.
 */
class RaopServerTest {
    private class CollectSink : AudioSink {
        private val buf = ShortArray(4_000_000)
        @Volatile var count = 0
        operator fun get(i: Int) = buf[i]
        @Volatile var level = -1f
        @Volatile var started = false
        override fun start(sampleRate: Int, channels: Int) { started = true }
        override fun write(pcm: ShortArray, samples: Int) { synchronized(this) { System.arraycopy(pcm, 0, buf, count, samples * 2); count += samples * 2 } }
        override fun flush() {}
        override fun setVolume(level: Float) { this.level = level }
        override fun stop() {}
    }

    private class Events : RaopListener {
        @Volatile var title = ""
        @Volatile var artist = ""
        @Volatile var art: ByteArray? = null
        @Volatile var progress = Pair(0L, 0L)
        @Volatile var dacp = ""
        @Volatile var stopped = false
        override fun onMetadata(title: String, artist: String, album: String) { this.title = title; this.artist = artist }
        override fun onArtwork(bytes: ByteArray?) { art = bytes }
        override fun onProgress(positionMs: Long, durationMs: Long) { progress = positionMs to durationMs }
        override fun onRemote(dacpId: String, activeRemote: String, client: InetAddress) { dacp = "$dacpId/$activeRemote" }
        override fun onStreamStop() { stopped = true }
    }

    private val mac = byteArrayOf(0x02, 0x11, 0x22, 0x33, 0x44, 0x55)
    private val publicKey by lazy {
        val k = RaopKeys.privateKey
        KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(k.modulus, k.publicExponent))
    }

    private fun resource(name: String) = javaClass.classLoader!!.getResourceAsStream("alac/$name")!!.readBytes()

    @Test
    fun playsAnEncryptedStreamLikeAnIphone() {
        val sink = CollectSink()
        val events = Events()
        val server = RaopServer(mac, sink, events)
        val port = server.start()
        val sock = Socket(InetAddress.getLoopbackAddress(), port)
        val out = sock.getOutputStream()
        val reader = BufferedReader(InputStreamReader(sock.getInputStream()))
        var cseq = 0

        fun send(method: String, headers: Map<String, String> = emptyMap(), body: ByteArray = ByteArray(0), type: String? = null): Map<String, String> {
            val sb = StringBuilder("$method rtsp://127.0.0.1/1 RTSP/1.0\r\nCSeq: ${++cseq}\r\nDACP-ID: ABCDEF0123456789\r\nActive-Remote: 1234567\r\n")
            headers.forEach { (k, v) -> sb.append("$k: $v\r\n") }
            if (type != null) sb.append("Content-Type: $type\r\n")
            if (body.isNotEmpty()) sb.append("Content-Length: ${body.size}\r\n")
            sb.append("\r\n")
            out.write(sb.toString().toByteArray()); out.write(body); out.flush()
            val status = reader.readLine()
            assertTrue("$method: $status", status.startsWith("RTSP/1.0 200"))
            val h = HashMap<String, String>()
            var length = 0
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) break
                val i = line.indexOf(':')
                h[line.substring(0, i).lowercase()] = line.substring(i + 1).trim()
                if (line.startsWith("Content-Length")) length = line.substringAfter(':').trim().toInt()
            }
            repeat(length) { reader.read() }
            return h
        }

        // 1. The challenge: the answer must decrypt with the speaker's public key to challenge + address + MAC.
        val challenge = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val opt = send("OPTIONS", mapOf("Apple-Challenge" to Base64.getEncoder().withoutPadding().encodeToString(challenge)))
        val signed = Cipher.getInstance("RSA/ECB/PKCS1Padding").apply { init(Cipher.DECRYPT_MODE, publicKey) }
            .doFinal(Base64.getDecoder().decode(opt["apple-response"]!! + "=".repeat((4 - opt["apple-response"]!!.length % 4) % 4)))
        val expected = ByteArray(32)
        System.arraycopy(challenge, 0, expected, 0, 16)
        System.arraycopy(sock.inetAddress.address, 0, expected, 16, 4)
        System.arraycopy(mac, 0, expected, 20, 6)
        assertArrayEquals(expected, signed)

        // 2. The key exchange and format (the test file uses 4096-sample frames).
        val aesKey = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val iv = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val rsaKey = Cipher.getInstance("RSA/ECB/OAEPWithSHA-1AndMGF1Padding").apply { init(Cipher.ENCRYPT_MODE, publicKey) }.doFinal(aesKey)
        val b64 = Base64.getEncoder().withoutPadding()
        val sdp = "v=0\r\no=iTunes 1 0 IN IP4 127.0.0.1\r\ns=iTunes\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio 0 RTP/AVP 96\r\n" +
            "a=rtpmap:96 AppleLossless\r\na=fmtp:96 4096 0 16 40 10 14 2 255 0 0 44100\r\n" +
            "a=rsaaeskey:${b64.encodeToString(rsaKey)}\r\na=aesiv:${b64.encodeToString(iv)}\r\n"
        send("ANNOUNCE", body = sdp.toByteArray(), type = "application/sdp")

        val control = DatagramSocket(0)
        val timing = DatagramSocket(0)
        val setup = send("SETUP", mapOf("Transport" to "RTP/AVP/UDP;unicast;interleaved=0-1;mode=record;control_port=${control.localPort};timing_port=${timing.localPort}"))
        val serverPort = Regex("server_port=(\\d+)").find(setup["transport"]!!)!!.groupValues[1].toInt()
        val serverControl = Regex("control_port=(\\d+)").find(setup["transport"]!!)!!.groupValues[1].toInt()
        send("RECORD", mapOf("Range" to "npt=0-", "RTP-Info" to "seq=100;rtptime=0"))

        // 3. The song details.
        fun dmap(tag: String, v: ByteArray) = ByteBuffer.allocate(8 + v.size).put(tag.toByteArray()).putInt(v.size).put(v).array()
        val items = dmap("minm", "Blue Hour".toByteArray()) + dmap("asar", "Iris Vale".toByteArray()) + dmap("asal", "Night Drive".toByteArray())
        send("SET_PARAMETER", body = dmap("mlit", items), type = "application/x-dmap-tagged")
        send("SET_PARAMETER", body = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3), type = "image/jpeg")
        send("SET_PARAMETER", body = "volume: -15.000000\r\n".toByteArray(), type = "text/parameters")
        send("SET_PARAMETER", body = "progress: 1000/45100/221500\r\n".toByteArray(), type = "text/parameters")

        // 4. The audio: encrypted ALAC packets, shuffled, with packet 5 held back until the speaker asks.
        val caf = cafPackets(resource("test.caf"))
        val enc = Cipher.getInstance("AES/CBC/NoPadding")
        fun rtp(seq: Int, ts: Int, frame: ByteArray): ByteArray {
            val whole = frame.size / 16 * 16
            enc.init(Cipher.ENCRYPT_MODE, SecretKeySpec(aesKey, "AES"), IvParameterSpec(iv))
            val payload = frame.copyOf()
            if (whole > 0) enc.doFinal(frame, 0, whole, payload, 0)
            return ByteBuffer.allocate(12 + payload.size).put(0x80.toByte()).put(0x60).putShort(seq.toShort()).putInt(ts).putInt(0x1234).put(payload).array()
        }
        val packets = caf.mapIndexed { i, f -> rtp(100 + i, i * 4096, f) }
        val audio = DatagramSocket()
        val target = InetAddress.getLoopbackAddress()
        val order = packets.indices.filter { it != 5 }.toMutableList().apply { val a = this[2]; this[2] = this[3]; this[3] = a }
        order.forEach { i -> audio.send(DatagramPacket(packets[i], packets[i].size, target, serverPort)); Thread.sleep(3) }

        // The speaker should ask again for the missing packet on the control port; answer with a resend (0x56).
        control.soTimeout = 3000
        val req = DatagramPacket(ByteArray(64), 64)
        control.receive(req)
        assertEquals(0xD5, req.data[1].toInt() and 0xFF)
        val missing = ((req.data[4].toInt() and 0xFF) shl 8) or (req.data[5].toInt() and 0xFF)
        assertEquals(105, missing)
        val resend = byteArrayOf(0x80.toByte(), 0xD6.toByte(), 0, 1) + packets[5]
        control.send(DatagramPacket(resend, resend.size, target, serverControl))

        // 5. Wait for every sample, then compare with ffmpeg's decode.
        val want = ByteBuffer.wrap(resource("test.pcm")).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val deadline = System.currentTimeMillis() + 10_000
        while (sink.count < want.limit() && System.currentTimeMillis() < deadline) Thread.sleep(50)
        assertTrue("got ${sink.count} of ${want.limit()} samples", sink.count >= want.limit())
        for (i in 0 until want.limit()) assertEquals("sample $i", want.get(i), sink[i])

        assertEquals("Blue Hour", events.title)
        assertEquals("Iris Vale", events.artist)
        assertEquals(5, events.art!!.size)
        assertEquals(1000L, events.progress.first)
        assertEquals(5000L, events.progress.second)
        assertEquals(0.5f, sink.level, 0.001f) // -15 dB of the phone's -30..0 range is half volume
        assertEquals("ABCDEF0123456789/1234567", events.dacp)

        // The speaker asks the sender for its clock (0xD2) on the sender's timing port.
        timing.soTimeout = 4000
        val clock = DatagramPacket(ByteArray(64), 64)
        timing.receive(clock)
        assertEquals(0xD2, clock.data[1].toInt() and 0xFF)

        send("TEARDOWN")
        Thread.sleep(200)
        assertTrue(events.stopped)
        server.stop()
    }

    @Test
    fun answersTheChallengeWithThePlainIpv4Address() {
        // Android can report an IPv4 connection's address in its IPv6 form (::ffff:a.b.c.d); the
        // iPhone signs the plain four bytes, so both must give the same answer.
        val server = RaopServer(mac, CollectSink(), Events())
        val v4 = InetAddress.getByAddress(byteArrayOf(192.toByte(), 168.toByte(), 1, 50))
        val mapped = java.net.Inet6Address.getByAddress(null, ByteArray(10) + byteArrayOf(0xFF.toByte(), 0xFF.toByte(), 192.toByte(), 168.toByte(), 1, 50), -1)
        val challenge = Base64.getEncoder().encodeToString(ByteArray(16) { it.toByte() })
        assertEquals(server.appleResponse(challenge, v4), server.appleResponse(challenge, mapped))
    }

    private fun cafPackets(bytes: ByteArray): List<ByteArray> {
        val b = ByteBuffer.wrap(bytes)
        b.position(8)
        var data = ByteArray(0)
        val sizes = mutableListOf<Int>()
        while (b.remaining() >= 12) {
            val type = String(ByteArray(4).also { b.get(it) })
            val chunk = ByteArray(b.long.toInt()).also { b.get(it) }
            if (type == "data") data = chunk.copyOfRange(4, chunk.size)
            if (type == "pakt") {
                val p = ByteBuffer.wrap(chunk)
                val count = p.long.toInt(); p.long; p.int; p.int
                repeat(count) {
                    var v = 0
                    while (true) { val x = p.get().toInt() and 0xFF; v = (v shl 7) or (x and 0x7F); if (x and 0x80 == 0) break }
                    sizes.add(v)
                }
            }
        }
        var off = 0
        return sizes.map { s -> data.copyOfRange(off, off + s).also { off += s } }
    }
}
