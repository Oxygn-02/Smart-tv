package io.github.oxygn02.smarttv.airplay

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Decodes ALAC files made by ffmpeg and compares every sample with ffmpeg's own decode. */
class AlacDecoderTest {
    private fun resource(name: String) = javaClass.classLoader!!.getResourceAsStream("alac/$name")!!.readBytes()

    private class Caf(val frameLength: Int, val pb: Int, val mb: Int, val kb: Int, val channels: Int, val packets: List<ByteArray>)

    private fun readCaf(bytes: ByteArray): Caf {
        val b = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
        b.position(8)
        var cookie: ByteArray? = null
        var data: ByteArray? = null
        val sizes = mutableListOf<Int>()
        while (b.remaining() >= 12) {
            val type = String(ByteArray(4).also { b.get(it) })
            val size = b.long.toInt()
            val chunk = ByteArray(size).also { b.get(it) }
            when (type) {
                "kuki" -> cookie = chunk
                "data" -> data = chunk.copyOfRange(4, chunk.size)
                "pakt" -> {
                    val p = ByteBuffer.wrap(chunk)
                    val count = p.long.toInt(); p.long; p.int; p.int
                    repeat(count) {
                        var v = 0
                        while (true) { val x = p.get().toInt() and 0xFF; v = (v shl 7) or (x and 0x7F); if (x and 0x80 == 0) break }
                        sizes.add(v)
                    }
                }
            }
        }
        // ALACSpecificConfig follows the 'alac' atom's 4-byte version inside the cookie.
        val c = cookie!!
        var at = 0
        for (i in 0 until c.size - 4) if (c[i] == 'a'.code.toByte() && c[i + 1] == 'l'.code.toByte() && c[i + 2] == 'a'.code.toByte() && c[i + 3] == 'c'.code.toByte()) at = i
        val cfg = ByteBuffer.wrap(c, at + 8, 24)
        val frameLength = cfg.int; cfg.get(); val depth = cfg.get().toInt()
        val pb = cfg.get().toInt(); val mb = cfg.get().toInt(); val kb = cfg.get().toInt(); val ch = cfg.get().toInt()
        assertEquals(16, depth)
        val packets = mutableListOf<ByteArray>()
        var off = 0
        for (s in sizes) { packets.add(data!!.copyOfRange(off, off + s)); off += s }
        return Caf(frameLength, pb, mb, kb, ch, packets)
    }

    private fun check(name: String) {
        val caf = readCaf(resource("$name.caf"))
        val expected = ByteBuffer.wrap(resource("$name.pcm")).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val dec = AlacDecoder(frameLength = caf.frameLength, pb = caf.pb, mb = caf.mb, kb = caf.kb, channels = caf.channels)
        val out = ShortArray(caf.frameLength * caf.channels)
        var index = 0
        caf.packets.forEachIndexed { p, pkt ->
            val n = dec.decode(pkt, pkt.size, out)
            for (i in 0 until n * caf.channels) {
                if (index >= expected.limit()) return
                assertEquals("$name: packet $p, sample ${i / caf.channels}", expected.get(index), out[i])
                index++
            }
        }
        assertEquals("$name: all samples decoded", expected.limit(), index)
    }

    @Test fun tonesAndNoise() = check("test")

    @Test fun pinkNoise() = check("noise")
}
