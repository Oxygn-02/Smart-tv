package io.github.oxygn02.smarttv.airplay

import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/**
 * Streams a file to the speaker with pyatv, an independent AirPlay sender.
 * Runs only where PYATV_ATVREMOTE points at pyatv's atvremote and
 * PYATV_WAV at a 44.1 kHz stereo WAV file; skipped otherwise.
 */
class PyatvInteropTest {
    @Test
    fun pyatvCanStreamToTheSpeaker() {
        val atv = System.getenv("PYATV_ATVREMOTE")
        val wav = System.getenv("PYATV_WAV")
        assumeTrue(atv != null && wav != null && File(atv).canExecute() && File(wav).exists())
        val sink = object : AudioSink {
            override fun start(sampleRate: Int, channels: Int) {}
            override fun write(pcm: ShortArray, samples: Int) { synchronized(this) { total += samples } }
            override fun flush() {}
            override fun setVolume(level: Float) {}
            override fun stop() {}
        }
        val server = RaopServer(byteArrayOf(2, 0x11, 0x22, 0x33, 0x44, 0x55), sink, object : RaopListener {
            override fun onMetadata(title: String, artist: String, album: String) { if (title.isNotEmpty()) titleOf = title }
        })
        val port = server.start()
        val p = ProcessBuilder(atv, "--manual", "--address", "127.0.0.1", "--port", port.toString(), "--protocol", "raop",
            "--id", "02:11:22:33:44:55", "--name", "Test speaker",
            "--service-properties", ";et=0,1;cn=0,1;md=0,1,2;sr=44100;ss=16;ch=2;tp=UDP;vn=3;pw=false;txtvers=1;am=AirPort10,115",
            "stream_file=$wav")
            .redirectErrorStream(true).start()
        val log = p.inputStream.bufferedReader().readText()
        p.waitFor(60, TimeUnit.SECONDS)
        Thread.sleep(1500)
        server.stop()
        println(log.takeLast(2000))
        println("samples: $total title: $titleOf")
        assertTrue("pyatv streamed only $total samples. Log:\n${log.takeLast(1500)}", total > 44100L * 2)
    }

    companion object {
        @Volatile var titleOf = ""
        @Volatile var total = 0L
    }
}
