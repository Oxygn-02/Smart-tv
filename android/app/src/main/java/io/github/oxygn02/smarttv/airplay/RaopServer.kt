package io.github.oxygn02.smarttv.airplay

import java.io.BufferedInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.Base64
import java.util.TreeMap
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Where decoded audio goes: AudioTrack on the TV, a buffer in tests. */
interface AudioSink {
    fun start(sampleRate: Int, channels: Int)
    fun write(pcm: ShortArray, samples: Int)
    fun flush()
    /** 0 (silent) to 1 (full). */
    fun setVolume(level: Float)
    fun stop()
}

/** What the iPhone tells the speaker, for Now playing and the remote control. */
interface RaopListener {
    fun onStreamStart(client: InetAddress) {}
    fun onStreamStop() {}
    fun onMetadata(title: String, artist: String, album: String) {}
    fun onArtwork(bytes: ByteArray?) {}
    /** Position and length in milliseconds, from the iPhone's progress report. */
    fun onProgress(positionMs: Long, durationMs: Long) {}
    fun onVolume(level: Float) {}
    fun onRemote(dacpId: String, activeRemote: String, client: InetAddress) {}
    /** One line for the AirPlay log (Diagnostics), e.g. each request and anything that went wrong. */
    fun onLog(line: String) {}
}

/**
 * An AirPlay (version 1, "RAOP") speaker: the RTSP conversation an iPhone has
 * with a speaker, the RSA/AES key exchange, the RTP audio stream over UDP,
 * Apple Lossless decoding, a short jitter buffer, and the song details the
 * iPhone sends (title, artist, artwork, progress, volume). Audio only.
 *
 * [mac] is the six-byte address in the speaker's advertised name; the
 * iPhone's challenge is answered with it. One sender at a time: a new one
 * replaces the last.
 */
class RaopServer(
    private val mac: ByteArray,
    private val sink: AudioSink,
    private val listener: RaopListener,
    private val port: Int = 0,
) {
    private var server: ServerSocket? = null
    @Volatile private var session: Session? = null
    @Volatile private var running = false

    val localPort: Int get() = server?.localPort ?: 0

    fun start(): Int {
        val s = ServerSocket()
        s.reuseAddress = true
        s.bind(InetSocketAddress(port))
        server = s
        running = true
        Thread({
            while (running) {
                val socket = try { s.accept() } catch (_: SocketException) { break }
                Thread({ serve(socket) }, "raop-rtsp").apply { isDaemon = true }.start()
            }
        }, "raop-accept").apply { isDaemon = true }.start()
        return s.localPort
    }

    fun stop() {
        running = false
        runCatching { server?.close() }
        session?.close()
        session = null
    }

    // ---------- RTSP ----------

    private class Request(val method: String, val uri: String, val headers: Map<String, String>, val body: ByteArray) {
        fun header(name: String) = headers[name.lowercase()]
    }

    private fun readRequest(input: InputStream): Request? {
        val head = StringBuilder()
        var last4 = 0
        while (true) {
            val b = input.read()
            if (b < 0) return null
            head.append(b.toChar())
            last4 = (last4 shl 8) or b
            if (last4 == 0x0D0A0D0A) break
            if (head.length > 16384) return null
        }
        val lines = head.toString().split("\r\n").filter { it.isNotEmpty() }
        val first = lines.firstOrNull()?.split(" ") ?: return null
        if (first.size < 2) return null
        val headers = HashMap<String, String>()
        lines.drop(1).forEach { line ->
            val i = line.indexOf(':')
            if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
        }
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        require(length in 0..4_000_000) { "Body too large" }
        val body = ByteArray(length)
        var got = 0
        while (got < length) {
            val n = input.read(body, got, length - got)
            if (n < 0) return null
            got += n
        }
        return Request(first[0], first[1], headers, body)
    }

    private fun log(line: String) = runCatching { listener.onLog(line) }

    private fun serve(socket: Socket) {
        log("Connection from ${socket.inetAddress.hostAddress}")
        socket.tcpNoDelay = true
        val input = BufferedInputStream(socket.getInputStream())
        val output = socket.getOutputStream()
        var mine: Session? = null
        try {
            while (true) {
                val req = readRequest(input) ?: break
                log("${req.method} ${req.uri.substringAfterLast('/')}" + (req.header("Content-Type")?.let { " ($it)" } ?: ""))
                val extra = LinkedHashMap<String, String>()
                var body: ByteArray? = null
                var status = "200 OK"

                req.header("Apple-Challenge")?.let {
                    extra["Apple-Response"] = appleResponse(it, socket.localAddress)
                    log("Answered the challenge for ${plainAddress(socket.localAddress).hostAddress}")
                }
                val dacp = req.header("DACP-ID")
                val remote = req.header("Active-Remote")
                if (dacp != null && remote != null) listener.onRemote(dacp, remote, socket.inetAddress)

                when (req.method) {
                    "OPTIONS" -> extra["Public"] = "ANNOUNCE, SETUP, RECORD, PAUSE, FLUSH, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER, POST, GET"
                    "ANNOUNCE" -> {
                        session?.close()
                        val sdp = parseSdp(String(req.body))
                        log("Stream: ${if (sdp.format.alac) "Apple Lossless" else "PCM"}, ${sdp.format.frameLength} per packet, ${if (sdp.key != null) "encrypted" else "not encrypted"}")
                        val s = Session(socket.inetAddress, sdp)
                        session = s
                        mine = s
                    }
                    "SETUP" -> {
                        val s = mine ?: session
                        if (s == null) status = "455 Method Not Valid in This State" else {
                            val t = req.header("Transport").orEmpty()
                            val ports = s.setup(
                                Regex("control_port=(\\d+)").find(t)?.groupValues?.get(1)?.toInt() ?: 0,
                                Regex("timing_port=(\\d+)").find(t)?.groupValues?.get(1)?.toInt() ?: 0,
                            )
                            log("Ports: audio ${ports[0]}, control ${ports[1]}, timing ${ports[2]}")
                            extra["Transport"] = "RTP/AVP/UDP;unicast;mode=record;server_port=${ports[0]};control_port=${ports[1]};timing_port=${ports[2]}"
                            extra["Session"] = "1"
                        }
                    }
                    "RECORD" -> {
                        try { (mine ?: session)?.record() } catch (e: Throwable) { log("Couldn't start playing: ${e.javaClass.simpleName} ${e.message.orEmpty()}") }
                        extra["Audio-Latency"] = "11025"
                    }
                    "FLUSH" -> (mine ?: session)?.flush()
                    "TEARDOWN" -> {
                        val s = mine ?: session
                        s?.close()
                        if (session === s) session = null
                        extra["Connection"] = "close"
                    }
                    "SET_PARAMETER" -> setParameter(req)
                    "GET_PARAMETER" -> body = "volume: %.6f\r\n".format(java.util.Locale.ROOT, currentVolumeDb).toByteArray()
                    // AirPlay 2 pages (/info, /auth-setup, ...) aren't offered; senders then fall back to AirPlay 1.
                    "GET" -> status = "404 Not Found"
                    "POST" -> if (!req.uri.endsWith("/feedback")) status = "404 Not Found"
                    "PAUSE" -> {}
                    else -> status = "501 Not Implemented"
                }
                respond(output, status, req.header("CSeq") ?: "0", extra, body)
                if (!status.startsWith("200")) log("  answered $status")
                if (req.method == "TEARDOWN") break
            }
        } catch (e: Throwable) {
            log("Stopped: ${e.javaClass.simpleName} ${e.message.orEmpty()}".trim())
        } finally {
            log("Connection closed")
            runCatching { socket.close() }
            if (mine != null && session === mine) { mine.close(); session = null }
        }
    }

    private fun respond(out: OutputStream, status: String, cseq: String, extra: Map<String, String>, body: ByteArray?) {
        val sb = StringBuilder("RTSP/1.0 $status\r\nCSeq: $cseq\r\nServer: AirTunes/105.1\r\nAudio-Jack-Status: connected; type=analog\r\n")
        extra.forEach { (k, v) -> sb.append(k).append(": ").append(v).append("\r\n") }
        if (body != null) sb.append("Content-Type: text/parameters\r\nContent-Length: ${body.size}\r\n")
        sb.append("\r\n")
        synchronized(out) {
            out.write(sb.toString().toByteArray())
            if (body != null) out.write(body)
            out.flush()
        }
    }

    /** Signs the iPhone's challenge with this speaker's address, proving it holds the speaker key. */
    internal fun appleResponse(challengeB64: String, local: InetAddress): String {
        val challenge = b64(challengeB64)
        val ip = plainAddress(local).address
        val data = ByteArray(maxOf(32, challenge.size + ip.size + mac.size))
        System.arraycopy(challenge, 0, data, 0, challenge.size)
        System.arraycopy(ip, 0, data, challenge.size, ip.size)
        System.arraycopy(mac, 0, data, challenge.size + ip.size, mac.size)
        val c = Cipher.getInstance("RSA/ECB/PKCS1Padding")
        c.init(Cipher.ENCRYPT_MODE, RaopKeys.privateKey)
        return Base64.getEncoder().withoutPadding().encodeToString(c.doFinal(data))
    }

    /** An IPv4 address that Android reports in its IPv6 form (::ffff:a.b.c.d) as plain IPv4, as the iPhone expects. */
    private fun plainAddress(a: InetAddress): InetAddress {
        val b = a.address
        if (b.size == 16 && (0 until 10).all { b[it].toInt() == 0 } && b[10] == 0xFF.toByte() && b[11] == 0xFF.toByte()) {
            return InetAddress.getByAddress(b.copyOfRange(12, 16))
        }
        return a
    }

    // ---------- Song details and volume ----------

    @Volatile private var currentVolumeDb = 0.0

    private fun setParameter(req: Request) {
        val type = req.header("Content-Type").orEmpty()
        when {
            type.startsWith("text/parameters") -> String(req.body).lines().forEach { line ->
                val (k, v) = line.split(":", limit = 2).map { it.trim() }.let { if (it.size == 2) it[0] to it[1] else return@forEach }
                if (k == "volume") {
                    val db = v.toDoubleOrNull() ?: return@forEach
                    currentVolumeDb = db
                    val level = if (db <= -144.0) 0f else ((db + 30.0) / 30.0).coerceIn(0.0, 1.0).toFloat()
                    sink.setVolume(level)
                    listener.onVolume(level)
                }
                if (k == "progress") {
                    val p = v.split("/").mapNotNull { it.trim().toLongOrNull() }
                    if (p.size == 3) {
                        val pos = ((p[1] - p[0]) * 1000 / SAMPLE_RATE).coerceAtLeast(0)
                        val dur = ((p[2] - p[0]) * 1000 / SAMPLE_RATE).coerceAtLeast(0)
                        listener.onProgress(pos, dur)
                    }
                }
            }
            type.startsWith("application/x-dmap-tagged") -> {
                val tags = HashMap<String, String>()
                parseDmap(req.body, 0, req.body.size, tags, 0)
                listener.onMetadata(tags["minm"].orEmpty(), tags["asar"].orEmpty(), tags["asal"].orEmpty())
            }
            type.startsWith("image/") -> listener.onArtwork(if (type.startsWith("image/none") || req.body.isEmpty()) null else req.body)
        }
    }

    private fun parseDmap(b: ByteArray, start: Int, end: Int, into: MutableMap<String, String>, depth: Int) {
        var i = start
        while (i + 8 <= end) {
            val tag = String(b, i, 4, Charsets.ISO_8859_1)
            val len = ((b[i + 4].toInt() and 0xFF) shl 24) or ((b[i + 5].toInt() and 0xFF) shl 16) or ((b[i + 6].toInt() and 0xFF) shl 8) or (b[i + 7].toInt() and 0xFF)
            val dataStart = i + 8
            if (len < 0 || dataStart + len > end) return
            when (tag) {
                "mlit", "cmst", "mlcl" -> if (depth < 4) parseDmap(b, dataStart, dataStart + len, into, depth + 1)
                "minm", "asar", "asal", "asaa", "asgn" -> into[tag] = String(b, dataStart, len, Charsets.UTF_8).take(200)
            }
            i = dataStart + len
        }
    }

    // ---------- One stream ----------

    private class Format(val frameLength: Int, val pb: Int, val mb: Int, val kb: Int, val channels: Int, val sampleRate: Int, val alac: Boolean)

    private class Sdp(val key: ByteArray?, val iv: ByteArray?, val format: Format)

    private fun parseSdp(text: String): Sdp {
        var key: ByteArray? = null
        var iv: ByteArray? = null
        var fmtp: List<Int>? = null
        var alac = true
        text.lines().forEach { raw ->
            val line = raw.trim()
            when {
                line.startsWith("a=rsaaeskey:") -> {
                    val c = Cipher.getInstance("RSA/ECB/OAEPWithSHA-1AndMGF1Padding")
                    c.init(Cipher.DECRYPT_MODE, RaopKeys.privateKey)
                    key = c.doFinal(b64(line.substringAfter(':')))
                }
                line.startsWith("a=aesiv:") -> iv = b64(line.substringAfter(':'))
                line.startsWith("a=fmtp:") -> fmtp = line.substringAfter(':').trim().split(Regex("\\s+")).mapNotNull { it.toIntOrNull() }
                line.startsWith("a=rtpmap:") -> alac = line.contains("AppleLossless", ignoreCase = true)
            }
        }
        // fmtp: payload, frameLength, compatibleVersion, bitDepth, pb, mb, kb, channels, maxRun, maxFrameBytes, avgBitRate, sampleRate
        val f = fmtp
        val format = if (f != null && f.size >= 12) Format(f[1], f[4], f[5], f[6], f[7], f[11], alac)
        else Format(352, 40, 10, 14, 2, SAMPLE_RATE, alac)
        return Sdp(key, iv, format)
    }

    private inner class Session(val client: InetAddress, val sdp: Sdp) {
        private val audio = DatagramSocket(0)
        private val control = DatagramSocket(0)
        private val timing = DatagramSocket(0)
        private var clientControlPort = 0
        private var clientTimingPort = 0
        private var packets = 0
        private var decodeErrors = 0
        private val decoder = if (sdp.format.alac) AlacDecoder(sdp.format.frameLength, 16, sdp.format.pb, sdp.format.mb, sdp.format.kb, sdp.format.channels) else null
        private val aes = sdp.key?.let { SecretKeySpec(it, "AES") }
        private val cipher = Cipher.getInstance("AES/CBC/NoPadding")
        private val buffer = TreeMap<Int, ShortArray>(Comparator { a, b -> seqCompare(a, b) })
        private val lock = Object()
        private var nextSeq = -1
        private var firstArrival = 0L
        @Volatile private var open = true
        @Volatile private var playing = false
        private val frameSamples = sdp.format.frameLength * sdp.format.channels
        private val decoderLock = Object()

        fun setup(controlPort: Int, timingPort: Int): IntArray {
            clientControlPort = controlPort
            clientTimingPort = timingPort
            listOf(audio to "raop-audio", control to "raop-control").forEach { (sock, name) ->
                Thread({ receive(sock) }, name).apply { isDaemon = true }.start()
            }
            Thread({ timingReplies() }, "raop-timing").apply { isDaemon = true }.start()
            Thread({ timingRequests() }, "raop-clock").apply { isDaemon = true }.start()
            return intArrayOf(audio.localPort, control.localPort, timing.localPort)
        }

        fun record() {
            if (playing) return
            playing = true
            listener.onStreamStart(client)
            sink.start(sdp.format.sampleRate, sdp.format.channels)
            log("Playing")
            Thread({ play() }, "raop-play").apply { isDaemon = true }.start()
        }

        fun flush() {
            synchronized(lock) { buffer.clear(); nextSeq = -1; firstArrival = 0L }
            sink.flush()
        }

        fun close() {
            if (!open) return
            open = false
            playing = false
            synchronized(lock) { (lock as Object).notifyAll() }
            listOf(audio, control, timing).forEach { runCatching { it.close() } }
            sink.stop()
            listener.onStreamStop()
        }

        /** Audio packets (type 0x60) on the audio port, resent ones (0x56) on the control port. */
        private fun receive(sock: DatagramSocket) {
            val buf = ByteArray(16384)
            val pcm = ShortArray(frameSamples)
            while (open) {
                val pkt = DatagramPacket(buf, buf.size)
                try { sock.receive(pkt) } catch (_: Exception) { break }
                if (pkt.length < 12) continue
                var off = 0
                var type = buf[1].toInt() and 0x7F
                if (type == 0x56) { off = 4; type = buf[off + 1].toInt() and 0x7F }
                if (type != 0x60) continue
                val seq = ((buf[off + 2].toInt() and 0xFF) shl 8) or (buf[off + 3].toInt() and 0xFF)
                val payload = buf.copyOfRange(off + 12, pkt.length)
                // One packet at a time through the key and the decoder (the audio and control ports share them).
                val samples = synchronized(decoderLock) {
                    try {
                        val frame = decrypt(payload)
                        if (decoder != null) decoder.decode(frame, frame.size, pcm) else bigEndianPcm(frame, pcm)
                    } catch (e: Throwable) {
                        if (decodeErrors++ < 3) log("Couldn't decode a packet: ${e.javaClass.simpleName} ${e.message.orEmpty()}")
                        -1
                    }
                }
                packets++
                if (packets == 1) log("First audio arrived")
                if (packets % 2000 == 0) log("$packets audio packets, $decodeErrors couldn't be decoded")
                if (samples <= 0) continue
                val copy = pcm.copyOf(samples * sdp.format.channels)
                synchronized(lock) {
                    if (nextSeq != -1 && seqCompare(seq, nextSeq) < 0) return@synchronized // too late
                    if (buffer.isEmpty() && nextSeq == -1) firstArrival = System.currentTimeMillis()
                    if (buffer.size < MAX_BUFFER) buffer[seq] = copy
                    (lock as Object).notifyAll()
                }
            }
        }

        private fun decrypt(data: ByteArray): ByteArray {
            val key = aes ?: return data
            val whole = data.size / 16 * 16
            if (whole == 0) return data
            cipher.init(Cipher.DECRYPT_MODE, key, IvParameterSpec(sdp.iv ?: ByteArray(16)))
            val out = data.copyOf()
            cipher.doFinal(data, 0, whole, out, 0)
            return out
        }

        private fun bigEndianPcm(frame: ByteArray, out: ShortArray): Int {
            val n = minOf(frame.size / 2, out.size)
            for (i in 0 until n) out[i] = (((frame[2 * i].toInt() and 0xFF) shl 8) or (frame[2 * i + 1].toInt() and 0xFF)).toShort()
            return n / sdp.format.channels
        }

        /**
         * Plays in sequence order once a short buffer has built up. A packet
         * that hasn't arrived is asked for again once, then replaced by
         * silence so the music keeps time.
         */
        private fun play() {
            val silence = ShortArray(frameSamples)
            val asked = HashSet<Int>()
            while (open) {
                var chunk: ShortArray? = null
                synchronized(lock) {
                    if (nextSeq == -1) {
                        // Start once half a second is buffered (or the first packet has waited that long).
                        if (buffer.isEmpty() || (buffer.size < START_PACKETS && System.currentTimeMillis() - firstArrival < START_WAIT_MS)) { (lock as Object).wait(50); return@synchronized }
                        nextSeq = buffer.firstKey()
                    }
                    val got = buffer.remove(nextSeq)
                    if (got != null) {
                        chunk = got
                        nextSeq = (nextSeq + 1) and 0xFFFF
                    } else if (buffer.isEmpty()) {
                        (lock as Object).wait(50)
                    } else {
                        if (asked.add(nextSeq)) requestResend(nextSeq, seqDistance(nextSeq, buffer.firstKey()))
                        if (buffer.size >= LATE_PACKETS) {
                            chunk = silence
                            nextSeq = (nextSeq + 1) and 0xFFFF
                        } else (lock as Object).wait(20)
                    }
                    if (asked.size > 512) asked.clear()
                }
                chunk?.let { sink.write(it, it.size / sdp.format.channels) }
            }
        }

        private fun requestResend(seq: Int, count: Int) {
            if (clientControlPort == 0 || count <= 0) return
            val p = byteArrayOf(0x80.toByte(), 0xD5.toByte(), 0, 1, (seq ushr 8).toByte(), seq.toByte(), (count ushr 8).toByte(), count.toByte())
            runCatching { control.send(DatagramPacket(p, p.size, client, clientControlPort)) }
        }

        /** Asks the sender for its clock every 3 seconds, as AirPlay speakers do (type 0x52); it answers on the timing port. */
        private fun timingRequests() {
            while (open && clientTimingPort != 0) {
                val req = ByteArray(32)
                req[0] = 0x80.toByte(); req[1] = 0xD2.toByte(); req[3] = 7
                System.arraycopy(ntpNow(), 0, req, 24, 8)
                runCatching { timing.send(DatagramPacket(req, req.size, client, clientTimingPort)) }
                try { Thread.sleep(3000) } catch (_: InterruptedException) { break }
            }
        }

        /** Answers the sender's clock questions (type 0x52) so it can keep time. */
        private fun timingReplies() {
            val buf = ByteArray(128)
            while (open) {
                val pkt = DatagramPacket(buf, buf.size)
                try { timing.receive(pkt) } catch (_: Exception) { break }
                if (pkt.length < 32 || (buf[1].toInt() and 0x7F) != 0x52) continue
                val reply = ByteArray(32)
                reply[0] = 0x80.toByte(); reply[1] = 0xD3.toByte(); reply[3] = 7
                System.arraycopy(buf, 24, reply, 8, 8) // their send time becomes the origin
                val now = ntpNow()
                System.arraycopy(now, 0, reply, 16, 8)
                System.arraycopy(now, 0, reply, 24, 8)
                runCatching { timing.send(DatagramPacket(reply, reply.size, pkt.address, pkt.port)) }
            }
        }
    }

    companion object {
        const val SAMPLE_RATE = 44100
        private const val START_PACKETS = 60 // about 0.5 s with 352-sample packets
        private const val LATE_PACKETS = 30
        private const val START_WAIT_MS = 500L
        private const val MAX_BUFFER = 1024

        private fun seqCompare(a: Int, b: Int): Int {
            val d = (a - b) and 0xFFFF
            return if (d == 0) 0 else if (d < 0x8000) 1 else -1
        }

        private fun seqDistance(from: Int, to: Int) = ((to - from) and 0xFFFF).coerceIn(1, 64)

        private fun b64(s: String): ByteArray {
            val clean = s.trim().replace("\\s".toRegex(), "")
            val padded = clean + "=".repeat((4 - clean.length % 4) % 4)
            return Base64.getDecoder().decode(padded)
        }

        private fun ntpNow(): ByteArray {
            val ms = System.currentTimeMillis()
            val seconds = ms / 1000 + 2208988800L
            val fraction = ((ms % 1000) shl 32) / 1000
            val out = ByteArray(8)
            for (i in 0 until 4) out[i] = (seconds ushr (24 - 8 * i)).toByte()
            for (i in 0 until 4) out[4 + i] = (fraction ushr (24 - 8 * i)).toByte()
            return out
        }
    }
}
