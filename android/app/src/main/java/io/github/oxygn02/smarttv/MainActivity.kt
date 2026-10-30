package io.github.oxygn02.smarttv

import android.Manifest
import android.annotation.SuppressLint
import android.app.role.RoleManager
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * The home screen. It shows the launcher UI from launcher/ (bundled as app
 * assets) in a full-screen WebView and gives it [LauncherBridge] as
 * `window.Android` for the TV's real apps, media, volume, HDMI and lights.
 *
 * D-pad presses reach the page as arrow and Enter keys, so the UI's own focus
 * navigation (launcher/app.js) works unchanged.
 */
class MainActivity : ComponentActivity(), BridgeHost {

    private lateinit var web: WebView
    private lateinit var bridge: LauncherBridge

    // The system's location question, and its "make this the home app" question.
    // After either, the page re-reads what changed.
    private val locationQuestion = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPage() }
    private val homeQuestion = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { refreshPage() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bridge = LauncherBridge(this, this)

        // Serve the bundled UI from a https:// origin rather than file://, plus
        // app icons, the current album cover and photos sent from a phone,
        // loaded by the page on demand.
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/icons/") { path ->
                bridge.iconPng(path.removeSuffix(".png"))?.let { image("image/png", it, cache = true) }
            }
            .addPathHandler("/art/") { _ ->
                bridge.artJpeg()?.let { image("image/jpeg", it, cache = false) }
            }
            .addPathHandler("/wall/") { path ->
                bridge.wallpaperBytes(path)?.let { image("image/jpeg", it, cache = true) }
            }
            .build()

        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Lay the page out at the real screen size, without zoom or the
            // TV's font scaling; the page scales itself to fit (launcher/app.js).
            settings.useWideViewPort = false
            settings.loadWithOverviewMode = false
            settings.textZoom = 100
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isFocusable = true
            isFocusableInTouchMode = true
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = assets.shouldInterceptRequest(request.url)
            }
            addJavascriptInterface(bridge, "Android")
            loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
        }
        setContentView(web)
        web.requestFocus()

        // A launcher never closes on Back: the UI decides what Back means
        // (close a panel, or return to Home).
        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("window.launcherBack && window.launcherBack()", null)
        }
    }

    // The remote's Home button while the launcher is already showing.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) {
            web.evaluateJavascript("window.launcherHome && window.launcherHome()", null)
        }
    }

    // Back from an app: refresh what's playing and the recent apps.
    override fun onResume() {
        super.onResume()
        refreshPage()
    }

    private fun refreshPage() {
        if (::web.isInitialized) web.evaluateJavascript("window.launcherResume && window.launcherResume()", null)
    }

    // ---------- BridgeHost ----------

    override fun emit(name: String, json: String) {
        runOnUiThread {
            if (::web.isInitialized) {
                web.evaluateJavascript("window.onNative && window.onNative(${JSONObject.quote(name)}, $json)", null)
            }
        }
    }

    override fun requestLocationPermission() {
        runOnUiThread { runCatching { locationQuestion.launch(Manifest.permission.ACCESS_COARSE_LOCATION) } }
    }

    override fun requestHomeRole(): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        val roles = getSystemService(RoleManager::class.java) ?: return false
        if (!roles.isRoleAvailable(RoleManager.ROLE_HOME)) return false
        runOnUiThread { runCatching { homeQuestion.launch(roles.createRequestRoleIntent(RoleManager.ROLE_HOME)) } }
        return true
    }

    private fun image(mime: String, bytes: ByteArray, cache: Boolean) =
        WebResourceResponse(mime, null, bytes.inputStream()).apply {
            responseHeaders = mapOf("Cache-Control" to if (cache) "max-age=86400" else "no-store")
        }

    override fun onDestroy() {
        bridge.close()
        web.destroy()
        super.onDestroy()
    }
}
