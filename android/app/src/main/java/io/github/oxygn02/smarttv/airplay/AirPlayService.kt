package io.github.oxygn02.smarttv.airplay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.IBinder
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom

/**
 * The TV as an AirPlay speaker. While switched on (Settings > Apps > AirPlay
 * speaker) it is announced on the Wi-Fi as "Living Room TV"; an iPhone or iPad
 * can then play any app's sound to it, and the sound plays inside the launcher
 * so no other app opens. A foreground service keeps it alive while another app
 * is in front.
 */
class AirPlayService : Service() {
    private var server: RaopServer? = null
    private var nsd: NsdManager? = null
    private var registration: NsdManager.RegistrationListener? = null
    private val sink by lazy { TrackSink(this) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        goForeground()
        val mac = AirPlayState.mac(this)
        val s = RaopServer(mac, sink, AirPlayState.listener, PREFERRED_PORT).also { server = it }
        val port = runCatching { s.start() }.getOrElse { RaopServer(mac, sink, AirPlayState.listener, 0).also { server = it }.start() }
        announce(mac, port)
        AirPlayState.running = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        AirPlayState.running = false
        registration?.let { runCatching { nsd?.unregisterService(it) } }
        server?.stop()
        server = null
        super.onDestroy()
    }

    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "AirPlay speaker", NotificationManager.IMPORTANCE_MIN))
        val n = Notification.Builder(this, CHANNEL)
            .setContentTitle("AirPlay speaker is on")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIFICATION_ID, n)
    }

    /** Announces "<mac>@<name>" as an AirPlay (RAOP) speaker on the local network. */
    private fun announce(mac: ByteArray, port: Int) {
        val info = NsdServiceInfo().apply {
            serviceName = mac.joinToString("") { "%02X".format(it) } + "@" + AirPlayState.name(this@AirPlayService)
            serviceType = "_raop._tcp"
            setPort(port)
            mapOf(
                "txtvers" to "1", "ch" to "2", "cn" to "0,1", "et" to "0,1", "md" to "0,1,2", "pw" to "false",
                "sr" to "44100", "ss" to "16", "tp" to "UDP", "vn" to "3", "vs" to "130.14", "am" to "AirPort10,115",
                "sf" to "0x4", "da" to "true", "sv" to "false",
            ).forEach { (k, v) -> setAttribute(k, v) }
        }
        val l = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(s: NsdServiceInfo) {}
            override fun onRegistrationFailed(s: NsdServiceInfo, code: Int) { AirPlayState.error = "Couldn't announce on Wi-Fi ($code)" }
            override fun onServiceUnregistered(s: NsdServiceInfo) {}
            override fun onUnregistrationFailed(s: NsdServiceInfo, code: Int) {}
        }
        nsd = getSystemService(NsdManager::class.java)
        registration = l
        nsd?.registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
    }

    /** Plays the stream through the TV, and holds audio focus while it plays. */
    private class TrackSink(private val context: Context) : AudioSink {
        private var track: AudioTrack? = null
        private var level = 1f
        private val audio = context.getSystemService(AudioManager::class.java)
        private var focus: AudioFocusRequest? = null

        override fun start(sampleRate: Int, channels: Int) {
            stop()
            val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
            val mask = if (channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
            val min = AudioTrack.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
            track = AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(AudioFormat.Builder().setSampleRate(sampleRate).setChannelMask(mask).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(maxOf(min * 4, sampleRate * channels * 2 / 2))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build().also { it.setVolume(level); it.play() }
            focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener { change ->
                    // Another app started playing (a film, YouTube): pause the phone.
                    if (change == AudioManager.AUDIOFOCUS_LOSS) AirPlayState.remote("pause")
                }
                .build().also { audio?.requestAudioFocus(it) }
        }

        override fun write(pcm: ShortArray, samples: Int) {
            AirPlayState.lastAudioAt = System.currentTimeMillis()
            track?.write(pcm, 0, samples * 2)
        }

        override fun flush() {
            track?.let { runCatching { it.pause(); it.flush(); it.play() } }
        }

        override fun setVolume(level: Float) {
            this.level = level
            track?.setVolume(level)
        }

        override fun stop() {
            track?.let { runCatching { it.stop() }; it.release() }
            track = null
            focus?.let { audio?.abandonAudioFocusRequest(it) }
            focus = null
        }
    }

    companion object {
        private const val CHANNEL = "airplay"
        private const val NOTIFICATION_ID = 42
        private const val PREFERRED_PORT = 5000

        fun sync(context: Context) {
            val intent = Intent(context, AirPlayService::class.java)
            if (AirPlayState.enabled(context)) runCatching { context.startForegroundService(intent) }
            else context.stopService(intent)
        }
    }
}

/**
 * What the AirPlay speaker is doing, for Now playing in the launcher, and the
 * way back to the phone: DACP, the remote-control service each iPhone runs
 * while it plays to a speaker (play, pause, next, previous).
 */
object AirPlayState {
    @Volatile var running = false
    @Volatile var streaming = false
    @Volatile var error = ""
    @Volatile var title = ""
    @Volatile var artist = ""
    @Volatile var album = ""
    @Volatile var artwork: ByteArray? = null
    @Volatile var artworkVersion = 0
    @Volatile var positionMs = 0L
    @Volatile var durationMs = 0L
    @Volatile var progressAt = 0L
    @Volatile var lastAudioAt = 0L
    @Volatile private var dacpId = ""
    @Volatile private var activeRemote = ""
    @Volatile private var client: InetAddress? = null
    @Volatile private var dacpPort = 0
    private var appContext: Context? = null

    /** Music is coming in now (the phone pauses by stopping the stream). */
    val playing get() = streaming && System.currentTimeMillis() - lastAudioAt < 1500

    /** Where the song is now, counting on from the last progress report while it plays. */
    fun position(): Long = if (playing && progressAt > 0) (positionMs + System.currentTimeMillis() - progressAt).coerceAtMost(durationMs.takeIf { it > 0 } ?: Long.MAX_VALUE) else positionMs

    fun enabled(context: Context) = context.getSharedPreferences("airplay", Context.MODE_PRIVATE).getBoolean("on", true)

    fun setEnabled(context: Context, on: Boolean) {
        context.getSharedPreferences("airplay", Context.MODE_PRIVATE).edit().putBoolean("on", on).apply()
        AirPlayService.sync(context)
    }

    fun name(context: Context): String = context.getSharedPreferences("airplay", Context.MODE_PRIVATE).getString("name", "Living Room TV")!!

    /** A made-up but fixed address for this speaker (Android doesn't give apps the real one). */
    fun mac(context: Context): ByteArray {
        appContext = context.applicationContext
        val prefs = context.getSharedPreferences("airplay", Context.MODE_PRIVATE)
        prefs.getString("mac", null)?.let { hex -> return ByteArray(6) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }
        val m = ByteArray(6).also { SecureRandom().nextBytes(it) }
        m[0] = ((m[0].toInt() and 0xFC) or 0x02).toByte() // locally administered, unicast
        prefs.edit().putString("mac", m.joinToString("") { "%02x".format(it) }).apply()
        return m
    }

    val listener = object : RaopListener {
        override fun onStreamStart(client: InetAddress) {
            this@AirPlayState.client = client
            streaming = true
            title = ""; artist = ""; album = ""; artwork = null; positionMs = 0; durationMs = 0; progressAt = 0
            artworkVersion++
        }

        override fun onStreamStop() { streaming = false }

        override fun onMetadata(title: String, artist: String, album: String) {
            this@AirPlayState.title = title
            this@AirPlayState.artist = artist
            this@AirPlayState.album = album
        }

        override fun onArtwork(bytes: ByteArray?) { artwork = bytes; artworkVersion++ }

        override fun onProgress(positionMs: Long, durationMs: Long) {
            this@AirPlayState.positionMs = positionMs
            this@AirPlayState.durationMs = durationMs
            progressAt = System.currentTimeMillis()
        }

        override fun onRemote(dacpId: String, activeRemote: String, client: InetAddress) {
            if (dacpId != this@AirPlayState.dacpId) dacpPort = 0
            this@AirPlayState.dacpId = dacpId
            this@AirPlayState.activeRemote = activeRemote
            this@AirPlayState.client = client
        }
    }

    /**
     * Sends play, pause, next or previous to the phone. Its remote-control port
     * is found once on the network (it is announced as iTunes_Ctrl_<DACP-ID>).
     */
    fun remote(action: String, context: Context? = appContext) {
        val cmd = when (action) { "play" -> "play"; "pause" -> "pause"; "next" -> "nextitem"; "prev" -> "previtem"; "toggle" -> "playpause"; else -> return }
        val host = client ?: return
        if (dacpId.isEmpty() || activeRemote.isEmpty()) return
        Thread {
            if (dacpPort == 0 && context != null) dacpPort = findDacpPort(context, dacpId)
            if (dacpPort == 0) return@Thread
            runCatching {
                Socket().use { s ->
                    s.connect(InetSocketAddress(host, dacpPort), 3000)
                    s.soTimeout = 3000
                    s.getOutputStream().write("GET /ctrl-int/1/$cmd HTTP/1.1\r\nHost: ${host.hostAddress}:$dacpPort\r\nActive-Remote: $activeRemote\r\nConnection: close\r\n\r\n".toByteArray())
                    s.getInputStream().read(ByteArray(256))
                }
            }.onFailure { dacpPort = 0 }
        }.start()
    }

    private fun findDacpPort(context: Context, id: String): Int {
        val nsd = context.getSystemService(NsdManager::class.java) ?: return 0
        val lock = Object()
        var port = 0
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(s: NsdServiceInfo) {
                if (!s.serviceName.equals("iTunes_Ctrl_$id", ignoreCase = true)) return
                @Suppress("DEPRECATION")
                nsd.resolveService(s, object : NsdManager.ResolveListener {
                    override fun onServiceResolved(r: NsdServiceInfo) { synchronized(lock) { port = r.port; lock.notifyAll() } }
                    override fun onResolveFailed(r: NsdServiceInfo, code: Int) {}
                })
            }
            override fun onDiscoveryStarted(t: String) {}
            override fun onDiscoveryStopped(t: String) {}
            override fun onServiceLost(s: NsdServiceInfo) {}
            override fun onStartDiscoveryFailed(t: String, code: Int) {}
            override fun onStopDiscoveryFailed(t: String, code: Int) {}
        }
        runCatching { nsd.discoverServices("_dacp._tcp", NsdManager.PROTOCOL_DNS_SD, discovery) }
        synchronized(lock) { if (port == 0) lock.wait(4000) }
        runCatching { nsd.stopServiceDiscovery(discovery) }
        return port
    }
}
