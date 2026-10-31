package io.github.oxygn02.smarttv

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.math.BigInteger
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.RSAPrivateCrtKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.RSAPublicKeySpec

/**
 * A small ADB client: lets the launcher run shell commands on this TV through
 * its own network debugging port (the Debugging check in Settings finds out
 * whether the port is open). The TV asks, on screen, to allow this app the first
 * time. Nothing here runs a command by itself; callers choose what to run.
 */
class AdbClient(private val keyDir: File) {

    class AdbException(message: String) : IOException(message)

    private var socket: Socket? = null
    private var input: DataInputStream? = null
    private var maxData = 4096
    private var nextId = 1

    private val keys: KeyPair by lazy { loadOrCreateKeys() }

    /** True once the TV has accepted the connection. */
    val connected get() = socket?.isConnected == true && socket?.isClosed == false

    /**
     * Connects and authenticates. [onNeedApproval] is called when the TV is
     * showing its "Allow USB debugging?" question (this app is new to it).
     */
    @Synchronized
    fun connect(host: String, port: Int, onNeedApproval: () -> Unit = {}) {
        close()
        val s = Socket()
        s.connect(InetSocketAddress(host, port), 4000)
        s.soTimeout = 8000
        socket = s
        input = DataInputStream(s.getInputStream().buffered())
        send(A_CNXN, VERSION, MAX_PAYLOAD, "host::\u0000".toByteArray())
        var signed = false
        while (true) {
            val p = read()
            when (p.cmd) {
                A_CNXN -> {
                    maxData = minOf(p.arg1.coerceAtLeast(1024), MAX_PAYLOAD)
                    return
                }
                A_AUTH -> {
                    if (p.arg0 != AUTH_TOKEN) throw AdbException("Unexpected answer from the TV")
                    if (!signed) {
                        signed = true
                        send(A_AUTH, AUTH_SIGNATURE, 0, sign(p.data))
                    } else {
                        // The TV doesn't know our key yet: offer it, and wait for the person.
                        send(A_AUTH, AUTH_RSAPUBLICKEY, 0, publicKeyBlob(keys.public as RSAPublicKey))
                        s.soTimeout = 60_000
                        onNeedApproval()
                    }
                }
                else -> throw AdbException("Unexpected answer from the TV")
            }
        }
    }

    /** Runs a shell command and returns what it printed. */
    @Synchronized
    fun shell(command: String): String {
        if (!connected) throw AdbException("Not connected to the TV")
        val local = nextId++
        send(A_OPEN, local, 0, "shell:$command\u0000".toByteArray())
        val out = ByteArrayOutputStream()
        var remote = 0
        while (true) {
            val p = read()
            if (p.arg1 != local && p.cmd != A_CNXN) continue
            when (p.cmd) {
                A_OKAY -> remote = p.arg0
                A_WRTE -> {
                    out.write(p.data)
                    send(A_OKAY, local, p.arg0, ByteArray(0))
                }
                A_CLSE -> {
                    if (remote == 0) throw AdbException("The TV refused that command")
                    send(A_CLSE, local, p.arg0, ByteArray(0))
                    return out.toString("UTF-8")
                }
            }
        }
    }

    @Synchronized
    fun close() {
        runCatching { socket?.close() }
        socket = null
        input = null
    }

    // ---------- Packets ----------

    private class Packet(val cmd: Int, val arg0: Int, val arg1: Int, val data: ByteArray)

    private fun send(cmd: Int, arg0: Int, arg1: Int, data: ByteArray) {
        val out = socket?.getOutputStream() ?: throw AdbException("Not connected to the TV")
        var sum = 0
        for (b in data) sum += b.toInt() and 0xff
        val header = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(cmd).putInt(arg0).putInt(arg1).putInt(data.size).putInt(sum).putInt(cmd xor -1)
        out.write(header.array())
        if (data.isNotEmpty()) out.write(data)
        out.flush()
    }

    private fun read(): Packet {
        val inp = input ?: throw AdbException("Not connected to the TV")
        val h = ByteArray(24)
        try {
            inp.readFully(h)
            val b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN)
            val cmd = b.int
            val a0 = b.int
            val a1 = b.int
            val len = b.int
            b.int // checksum (not checked: the TV doesn't require it)
            val magic = b.int
            if (magic != (cmd xor -1) || len < 0 || len > MAX_PAYLOAD) throw AdbException("Garbled answer from the TV")
            val data = ByteArray(len)
            if (len > 0) inp.readFully(data)
            return Packet(cmd, a0, a1, data)
        } catch (e: java.net.SocketTimeoutException) {
            throw AdbException("The TV didn't answer in time")
        }
    }

    // ---------- Keys ----------

    private fun loadOrCreateKeys(): KeyPair {
        val file = File(keyDir, "adbkey")
        val kf = KeyFactory.getInstance("RSA")
        if (file.exists()) {
            runCatching {
                val priv = kf.generatePrivate(PKCS8EncodedKeySpec(file.readBytes())) as RSAPrivateCrtKey
                val pub = kf.generatePublic(RSAPublicKeySpec(priv.modulus, priv.publicExponent))
                return KeyPair(pub, priv)
            }
        }
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        keyDir.mkdirs()
        file.writeBytes(pair.private.encoded)
        return pair
    }

    /** The TV hashes a random 20-byte token; we sign it as if it were a SHA-1 digest. */
    private fun sign(token: ByteArray): ByteArray {
        val s = Signature.getInstance("NONEwithRSA")
        s.initSign(keys.private)
        s.update(SHA1_PREFIX + token)
        return s.sign()
    }

    companion object {
        const val A_CNXN = 0x4e584e43
        const val A_AUTH = 0x48545541
        const val A_OPEN = 0x4e45504f
        const val A_OKAY = 0x59414b4f
        const val A_CLSE = 0x45534c43
        const val A_WRTE = 0x45545257
        const val AUTH_TOKEN = 1
        const val AUTH_SIGNATURE = 2
        const val AUTH_RSAPUBLICKEY = 3
        const val VERSION = 0x01000001
        const val MAX_PAYLOAD = 256 * 1024

        private val SHA1_PREFIX = byteArrayOf(
            0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14,
        )

        private fun littleEndian(x: BigInteger, size: Int): ByteArray {
            val be = x.toByteArray().let { if (it.size > 1 && it[0].toInt() == 0) it.copyOfRange(1, it.size) else it }
            val out = ByteArray(size)
            for (i in be.indices) out[i] = be[be.size - 1 - i]
            return out
        }

        /** The public key in the layout the TV expects, as sent after the token (base64 text, NUL ended). */
        fun publicKeyBlob(key: RSAPublicKey): ByteArray {
            val n = key.modulus
            val two32 = BigInteger.ONE.shiftLeft(32)
            val n0inv = n.mod(two32).modInverse(two32).negate().mod(two32)
            val rr = BigInteger.ONE.shiftLeft(4096).mod(n)
            val blob = ByteBuffer.allocate(524).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(64).putInt(n0inv.toInt())
                .put(littleEndian(n, 256)).put(littleEndian(rr, 256))
                .putInt(key.publicExponent.toInt())
            val text = java.util.Base64.getEncoder().encodeToString(blob.array()) + " smarttv@launcher\u0000"
            return text.toByteArray()
        }
    }
}
