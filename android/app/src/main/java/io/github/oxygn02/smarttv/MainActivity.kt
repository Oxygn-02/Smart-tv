package io.github.oxygn02.smarttv

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.webkit.WebViewAssetLoader

/**
 * The home screen. It shows the launcher UI from launcher/ (bundled as app
 * assets) in a full-screen WebView and gives it [LauncherBridge] as
 * `window.Android` for the TV's real apps, media, volume, HDMI and lights.
 *
 * D-pad presses reach the page as arrow and Enter keys, so the UI's own focus
 * navigation (launcher/app.js) works unchanged.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var bridge: LauncherBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Serve the bundled UI from a https:// origin rather than file://.
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        bridge = LauncherBridge(this)
        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
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
        web.evaluateJavascript("window.launcherResume && window.launcherResume()", null)
    }

    override fun onDestroy() {
        bridge.close()
        web.destroy()
        super.onDestroy()
    }
}
