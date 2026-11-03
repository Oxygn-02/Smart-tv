package io.github.oxygn02.smarttv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.DataInputStream
import java.io.File
import java.net.ServerSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder

class HomeGuardTest {

    @Test
    fun rescuesAfterThreeFailedStarts() {
        assertFalse(HomeGuard.shouldRescue(0))
        assertFalse(HomeGuard.shouldRescue(2))
        assertTrue(HomeGuard.shouldRescue(3))
        assertTrue(HomeGuard.shouldRescue(7))
    }

    @Test
    fun commandsEnableGoogleHomeAndRestoreTheOldOne() {
        val c = HomeGuard.rescueCommands("com.google.android.tvlauncher/.MainActivity")
        assertTrue(c.contains("pm enable com.google.android.tvlauncher"))
        assertTrue(c.contains("pm enable com.google.android.tvrecommendations"))
        assertEquals("cmd package set-home-activity com.google.android.tvlauncher/.MainActivity", c.last())
    }

    @Test
    fun anOddSavedHomeIsNeverRun() {
        val c = HomeGuard.rescueCommands("evil; rm -rf /")
        assertTrue(c.none { it.startsWith("cmd package") })
    }

    // A stand-in for the TV that accepts the key and records every shell command it is sent.
    private fun pkt(out: java.io.OutputStream, cmd: Int, a0: Int, a1: Int, data: ByteArray = ByteArray(0)) {
        val h = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(cmd).putInt(a0).putInt(a1).putInt(data.size).putInt(data.sumOf { it.toInt() and 0xff }).putInt(cmd xor -1)
        out.write(h.array()); out.write(data); out.flush()
    }

    @Test
    fun runsTheRescueOverAConnection() {
        val server = ServerSocket(0)
        val seen = mutableListOf<String>()
        val t = Thread {
            server.accept().use { s ->
                val inp = DataInputStream(s.getInputStream().buffered())
                val out = s.getOutputStream()
                fun read(): Triple<Int, Int, ByteArray> {
                    val h = ByteArray(24); inp.readFully(h)
                    val b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN)
                    val cmd = b.int; val a0 = b.int; b.int; val len = b.int
                    val d = ByteArray(len); if (len > 0) inp.readFully(d)
                    return Triple(cmd, a0, d)
                }
                read() // CNXN
                pkt(out, AdbClient.A_AUTH, AdbClient.AUTH_TOKEN, 0, ByteArray(20) { 1 })
                read() // signature: this key is already trusted, so accept it
                pkt(out, AdbClient.A_CNXN, AdbClient.VERSION, 4096, "device::\u0000".toByteArray())
                while (true) {
                    val (cmd, a0, d) = try { read() } catch (_: Exception) { break }
                    if (cmd == AdbClient.A_OPEN) {
                        seen.add(String(d).trimEnd('\u0000').removePrefix("shell:"))
                        pkt(out, AdbClient.A_OKAY, 9, a0)
                        pkt(out, AdbClient.A_WRTE, 9, a0, "ok\n".toByteArray())
                        read() // OKAY
                        pkt(out, AdbClient.A_CLSE, 9, a0)
                        read() // CLSE
                    }
                }
            }
        }
        t.start()
        val dir = File.createTempFile("guard", "").apply { delete(); mkdirs() }
        val client = AdbClient(dir)
        client.connect("127.0.0.1", server.localPort)
        val ran = HomeGuard.runRescue(client, "com.google.android.tvlauncher/.MainActivity")
        client.close()
        t.join(3000)
        server.close()
        assertEquals(4, ran)
        assertEquals("pm enable com.google.android.tvlauncher", seen.first())
        assertEquals("cmd package set-home-activity com.google.android.tvlauncher/.MainActivity", seen.last())
    }
}
