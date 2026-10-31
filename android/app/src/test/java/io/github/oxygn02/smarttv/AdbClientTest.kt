package io.github.oxygn02.smarttv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.DataInputStream
import java.io.File
import java.math.BigInteger
import java.net.ServerSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyFactory
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.RSAPublicKeySpec
import java.security.interfaces.RSAPrivateCrtKey
import java.util.Base64

class AdbClientTest {

    private fun resource(name: String) = javaClass.classLoader!!.getResourceAsStream(name)!!.readBytes()

    /** A key made by the real `adb keygen`: our public key text must match its .pub file exactly. */
    @Test
    fun publicKeyMatchesRealAdb() {
        val pem = String(resource("adbkey.pem")).lines().filter { !it.startsWith("-----") }.joinToString("")
        val kf = KeyFactory.getInstance("RSA")
        val priv = kf.generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem))) as RSAPrivateCrtKey
        val pub = kf.generatePublic(RSAPublicKeySpec(priv.modulus, priv.publicExponent)) as RSAPublicKey
        val mine = String(AdbClient.publicKeyBlob(pub)).trimEnd('\u0000').substringBefore(' ')
        val real = String(resource("adbkey.pub")).trim().substringBefore(' ')
        assertEquals(real, mine)
    }

    // ---- A stand-in for the TV's adbd, following the protocol, to check the client end to end ----

    private class P(val cmd: Int, val a0: Int, val a1: Int, val data: ByteArray)

    private fun DataInputStream.packet(): P {
        val h = ByteArray(24)
        readFully(h)
        val b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN)
        val cmd = b.int; val a0 = b.int; val a1 = b.int; val len = b.int; b.int
        val magic = b.int
        assertEquals(cmd xor -1, magic)
        val d = ByteArray(len)
        if (len > 0) readFully(d)
        return P(cmd, a0, a1, d)
    }

    private fun java.io.OutputStream.packet(cmd: Int, a0: Int, a1: Int, data: ByteArray = ByteArray(0)) {
        val h = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(cmd).putInt(a0).putInt(a1).putInt(data.size).putInt(data.sumOf { it.toInt() and 0xff }).putInt(cmd xor -1)
        write(h.array()); write(data); flush()
    }

    @Test
    fun connectsApprovesAndRunsAShellCommand() {
        val server = ServerSocket(0)
        var approvalAsked = false
        var shellSeen = ""
        val t = Thread {
            server.accept().use { s ->
                val inp = DataInputStream(s.getInputStream().buffered())
                val out = s.getOutputStream()
                val cnxn = inp.packet()
                assertEquals(AdbClient.A_CNXN, cnxn.cmd)
                val token = ByteArray(20) { (it * 7 + 3).toByte() }
                out.packet(AdbClient.A_AUTH, AdbClient.AUTH_TOKEN, 0, token)
                val sig = inp.packet()          // signature with a key we don't know yet
                assertEquals(AdbClient.AUTH_SIGNATURE, sig.a0)
                out.packet(AdbClient.A_AUTH, AdbClient.AUTH_TOKEN, 0, token)
                val key = inp.packet()          // the public key offered for approval
                assertEquals(AdbClient.AUTH_RSAPUBLICKEY, key.a0)
                // Decode the offered key (adb layout) and check the earlier signature against it.
                val text = String(key.data).trimEnd('\u0000').substringBefore(' ')
                val raw = ByteBuffer.wrap(Base64.getDecoder().decode(text)).order(ByteOrder.LITTLE_ENDIAN)
                raw.int; raw.int
                val nBytes = ByteArray(256).also { raw.get(it) }.reversedArray()
                raw.position(raw.position() + 256)
                val e = raw.int
                val pub = KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(BigInteger(1, nBytes), BigInteger.valueOf(e.toLong())))
                val v = Signature.getInstance("NONEwithRSA")
                v.initVerify(pub)
                v.update(byteArrayOf(0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14) + token)
                assertTrue("signature must verify with the offered key", v.verify(sig.data))
                out.packet(AdbClient.A_CNXN, AdbClient.VERSION, 4096, "device::\u0000".toByteArray())
                val open = inp.packet()
                assertEquals(AdbClient.A_OPEN, open.cmd)
                shellSeen = String(open.data).trimEnd('\u0000')
                out.packet(AdbClient.A_OKAY, 5, open.a0)
                out.packet(AdbClient.A_WRTE, 5, open.a0, "hi\n".toByteArray())
                assertEquals(AdbClient.A_OKAY, inp.packet().cmd)
                out.packet(AdbClient.A_CLSE, 5, open.a0)
                assertEquals(AdbClient.A_CLSE, inp.packet().cmd)
            }
        }
        t.start()
        val dir = File.createTempFile("adbtest", "").apply { delete(); mkdirs() }
        val client = AdbClient(dir)
        client.connect("127.0.0.1", server.localPort) { approvalAsked = true }
        assertTrue(approvalAsked)
        assertEquals("hi\n", client.shell("echo hi"))
        client.close()
        t.join(3000)
        assertEquals("shell:echo hi", shellSeen)
        server.close()
    }
}
