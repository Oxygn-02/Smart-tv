package io.github.oxygn02.smarttv.airplay

/**
 * Apple Lossless (ALAC) decoder for 16-bit audio, the format iPhones send to
 * AirPlay speakers. Written from Apple's published ALAC format (adaptive
 * Golomb coding, an adaptive predictor and stereo matrixing). Plain Kotlin,
 * so it is tested on the computer against ffmpeg's own decoder.
 */
class AlacDecoder(
    private val frameLength: Int = 352,
    private val bitDepth: Int = 16,
    private val pb: Int = 40,
    private val mb: Int = 10,
    private val kb: Int = 14,
    private val channels: Int = 2,
    private val maxRun: Int = 255,
) {
    init {
        require(bitDepth == 16) { "Only 16-bit ALAC" }
        require(channels in 1..2) { "Mono or stereo only" }
    }

    private val predictor = IntArray(frameLength)
    private val mixU = IntArray(frameLength)
    private val mixV = IntArray(frameLength)

    /** Decodes one frame into [out] (interleaved 16-bit). Returns the number of samples per channel. */
    fun decode(frame: ByteArray, length: Int = frame.size, out: ShortArray): Int {
        val bits = Bits(frame, length)
        var produced = 0
        var channelIndex = 0
        while (true) {
            val tag = bits.read(3)
            if (tag == ID_END) break
            bits.read(4) // element instance tag
            when (tag) {
                ID_SCE -> { produced = element(bits, out, channelIndex, 1); channelIndex += 1 }
                ID_CPE -> { produced = element(bits, out, channelIndex, 2); channelIndex += 2 }
                ID_FIL -> { var count = bits.read(4); if (count == 15) count += bits.read(8) - 1; bits.skip(count * 8) }
                ID_DSE -> { val align = bits.read(1); var count = bits.read(8); if (count == 255) count += bits.read(8); if (align != 0) bits.alignByte(); bits.skip(count * 8) }
                else -> throw IllegalArgumentException("Unsupported ALAC element $tag")
            }
            if (channelIndex >= channels) break
        }
        return produced
    }

    private fun element(bits: Bits, out: ShortArray, firstChannel: Int, n: Int): Int {
        bits.read(12) // unused
        val partial = bits.read(1)
        val bytesShifted = bits.read(2)
        val escape = bits.read(1)
        var numSamples = frameLength
        if (partial != 0) numSamples = (bits.read(16) shl 16) or bits.read(16)
        require(numSamples in 1..frameLength) { "Bad frame size $numSamples" }
        val stride = channels

        if (escape == 0) {
            val mixBits = bits.read(8)
            val mixRes = bits.read(8).toByte().toInt()
            val mode = IntArray(n); val denShift = IntArray(n); val pbFactor = IntArray(n); val num = IntArray(n)
            val coefs = Array(n) { IntArray(32) }
            for (c in 0 until n) {
                mode[c] = bits.read(4); denShift[c] = bits.read(4); pbFactor[c] = bits.read(3); num[c] = bits.read(5)
                for (i in 0 until num[c]) coefs[c][i] = bits.read(16).toShort().toInt()
            }
            if (bytesShifted != 0) bits.skip(bytesShifted * 8 * n * numSamples)
            val chanBits = bitDepth - bytesShifted * 8 + (n - 1)
            for (c in 0 until n) {
                dynDecomp(bits, predictor, numSamples, chanBits, (pb * pbFactor[c]) / 4)
                val dest = if (c == 0) mixU else mixV
                if (mode[c] == 0) {
                    unpcBlock(predictor, dest, numSamples, coefs[c], num[c], chanBits, denShift[c])
                } else {
                    unpcBlock(predictor, predictor, numSamples, null, 31, chanBits, 0)
                    unpcBlock(predictor, dest, numSamples, coefs[c], num[c], chanBits, denShift[c])
                }
            }
            if (n == 2) {
                for (j in 0 until numSamples) {
                    val u = mixU[j]; val v = mixV[j]
                    val l: Int; val r: Int
                    if (mixRes != 0) { l = u + v - ((mixRes * v) shr mixBits); r = l - v } else { l = u; r = v }
                    out[j * stride + firstChannel] = l.toShort()
                    out[j * stride + firstChannel + 1] = r.toShort()
                }
            } else {
                for (j in 0 until numSamples) out[j * stride + firstChannel] = mixU[j].toShort()
            }
        } else {
            // Uncompressed: plain samples, interleaved by channel.
            for (j in 0 until numSamples) for (c in 0 until n) {
                out[j * stride + firstChannel + c] = bits.read(16).toShort()
            }
        }
        return numSamples
    }

    // ---------- Adaptive Golomb decoding ----------

    private fun dynDecomp(bits: Bits, outBuf: IntArray, numSamples: Int, maxSize: Int, pbArg: Int) {
        var mb = this.mb.toLong()
        val pb = pbArg.toLong()
        val wb = (1L shl kb) - 1
        var zmode = 0L
        var c = 0
        while (c < numSamples) {
            var m = (mb ushr QBSHIFT).toInt()
            var k = lg3a(m)
            if (k > kb) k = kb
            m = (1 shl k) - 1
            val n = dynGet32(bits, m, k, maxSize).toLong() and 0xFFFFFFFFL
            val ndecode = n + zmode
            val multiplier = if (ndecode and 1L == 1L) -1L else 1L
            outBuf[c++] = (((ndecode + 1) ushr 1) * multiplier).toInt()
            mb = (pb * (n + zmode) + mb - ((pb * mb) ushr QBSHIFT)) and 0xFFFFFFFFL
            if (n > N_MAX_MEAN_CLAMP) mb = N_MEAN_CLAMP_VAL
            zmode = 0
            if (((mb shl MMULSHIFT) < QB) && c < numSamples) {
                zmode = 1
                val kz = lead(mb.toInt()) - BITOFF + ((mb + MOFF) ushr MDENSHIFT).toInt()
                val mz = ((1L shl kz) - 1) and wb
                val run = dynGet(bits, mz.toInt(), kz)
                require(c + run <= numSamples) { "Bad run" }
                for (j in 0 until run) outBuf[c++] = 0
                if (run >= 65535) zmode = 0
                mb = 0
            }
        }
    }

    private fun dynGet(bits: Bits, m: Int, k: Int): Int {
        val stream = bits.peek32()
        var pre = Integer.numberOfLeadingZeros(stream.inv())
        val result: Int
        if (pre >= MAX_PREFIX_16) {
            pre = MAX_PREFIX_16
            bits.skip(pre)
            result = bits.read(MAX_DATATYPE_BITS_16)
        } else {
            bits.skip(pre + 1)
            val v = if (k == 0) 0 else bits.peekBits(k)
            bits.skip(k)
            var r = pre * m + v - 1
            if (v < 2) { r -= (v - 1); bits.skip(-1) }
            result = r
        }
        return result
    }

    private fun dynGet32(bits: Bits, m: Int, k: Int, maxBits: Int): Int {
        val stream = bits.peek32()
        var result = Integer.numberOfLeadingZeros(stream.inv())
        if (result >= MAX_PREFIX_32) {
            bits.skip(MAX_PREFIX_32)
            return bits.readLong(maxBits).toInt()
        }
        bits.skip(result + 1)
        if (k != 1) {
            val v = bits.peekBits(k)
            bits.skip(k - 1)
            result *= m
            if (v >= 2) { result += v - 1; bits.skip(1) }
        }
        return result
    }

    // ---------- The adaptive predictor ----------

    private fun unpcBlock(pc1: IntArray, out: IntArray, num: Int, coefs: IntArray?, numActive: Int, chanBits: Int, denShift: Int) {
        val chanShift = 32 - chanBits
        val denHalf = if (denShift > 0) 1 shl (denShift - 1) else 0
        out[0] = pc1[0]
        if (numActive == 0) {
            if (num > 1 && pc1 !== out) System.arraycopy(pc1, 1, out, 1, num - 1)
            return
        }
        if (numActive == 31) {
            var prev = out[0]
            for (j in 1 until num) {
                val del = pc1[j] + prev
                prev = (del shl chanShift) shr chanShift
                out[j] = prev
            }
            return
        }
        coefs!!
        for (j in 1..minOf(numActive, num - 1)) {
            val del = pc1[j] + out[j - 1]
            out[j] = (del shl chanShift) shr chanShift
        }
        val lim = numActive + 1
        for (j in lim until num) {
            var sum1 = 0
            val top = out[j - lim]
            for (k in 0 until numActive) sum1 += coefs[k] * (out[j - 1 - k] - top)
            var del = pc1[j]
            var del0 = del
            val sg = sign(del)
            del += top + ((sum1 + denHalf) shr denShift)
            out[j] = (del shl chanShift) shr chanShift
            if (sg > 0) {
                for (k in numActive - 1 downTo 0) {
                    val dd = top - out[j - 1 - k]
                    val sgn = sign(dd)
                    coefs[k] = (coefs[k] - sgn).toShort().toInt()
                    del0 -= (numActive - k) * ((sgn * dd) shr denShift)
                    if (del0 <= 0) break
                }
            } else if (sg < 0) {
                for (k in numActive - 1 downTo 0) {
                    val dd = top - out[j - 1 - k]
                    val sgn = sign(dd)
                    coefs[k] = (coefs[k] + sgn).toShort().toInt()
                    del0 -= (numActive - k) * ((-sgn * dd) shr denShift)
                    if (del0 >= 0) break
                }
            }
        }
    }

    private fun sign(i: Int) = if (i > 0) 1 else if (i < 0) -1 else 0
    private fun lead(x: Int) = Integer.numberOfLeadingZeros(x)
    private fun lg3a(x: Int) = 31 - Integer.numberOfLeadingZeros(x + 3)

    /** Big-endian bit reader. Reads past the end as zeros. */
    private class Bits(private val data: ByteArray, private val length: Int) {
        var pos = 0 // in bits

        private fun byteAt(i: Int) = if (i in 0 until length) data[i].toInt() and 0xFF else 0

        fun peek32(): Int {
            val b = pos ushr 3
            val word = (byteAt(b).toLong() shl 32) or (byteAt(b + 1).toLong() shl 24) or (byteAt(b + 2).toLong() shl 16) or
                (byteAt(b + 3).toLong() shl 8) or byteAt(b + 4).toLong()
            return ((word shl (pos and 7)) ushr 8).toInt()
        }

        fun peekBits(n: Int): Int = if (n == 0) 0 else peek32() ushr (32 - n)

        fun read(n: Int): Int { val v = peekBits(n); pos += n; return v }

        fun readLong(n: Int): Long {
            if (n <= 24) return read(n).toLong() and 0xFFFFFFFFL
            val hi = read(n - 16).toLong()
            return (hi shl 16) or read(16).toLong()
        }

        fun skip(n: Int) { pos += n }

        fun alignByte() { pos = (pos + 7) and 7.inv() }
    }

    companion object {
        private const val ID_SCE = 0
        private const val ID_CPE = 1
        private const val ID_DSE = 4
        private const val ID_FIL = 6
        private const val ID_END = 7
        private const val QBSHIFT = 9
        private const val QB = 1L shl QBSHIFT
        private const val MMULSHIFT = 2
        private const val MDENSHIFT = QBSHIFT - MMULSHIFT - 1
        private const val MOFF = 1L shl (MDENSHIFT - 2)
        private const val BITOFF = 24
        private const val MAX_PREFIX_16 = 9
        private const val MAX_PREFIX_32 = 9
        private const val MAX_DATATYPE_BITS_16 = 16
        private const val N_MAX_MEAN_CLAMP = 0xFFFFL
        private const val N_MEAN_CLAMP_VAL = 0xFFFFL
    }
}
