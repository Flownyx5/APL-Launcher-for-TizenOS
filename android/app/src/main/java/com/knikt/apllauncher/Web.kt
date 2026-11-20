package com.knikt.apllauncher

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.SparseIntArray
import android.view.KeyEvent
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebViewClient
import java.io.File
import java.io.FileInputStream
import org.json.JSONObject

/* What the two pages have in common: the Home Screen (MainActivity) and the Control Center over the
   apps (Overlay). Both are the launcher's web code in a WebView, given window.APLAndroid (Bridge.kt). */
object Web {
    const val TAG = "APL"

    /* The remote, with Samsung's key codes: the launcher's code (navigation.js) is the same everywhere. */
    private val KEYS = SparseIntArray().apply {
        put(KeyEvent.KEYCODE_DPAD_UP, 38)
        put(KeyEvent.KEYCODE_DPAD_DOWN, 40)
        put(KeyEvent.KEYCODE_DPAD_LEFT, 37)
        put(KeyEvent.KEYCODE_DPAD_RIGHT, 39)
        put(KeyEvent.KEYCODE_DPAD_CENTER, 13)
        put(KeyEvent.KEYCODE_ENTER, 13)
        put(KeyEvent.KEYCODE_NUMPAD_ENTER, 13)
        put(KeyEvent.KEYCODE_BUTTON_A, 13)
        put(KeyEvent.KEYCODE_BACK, 10009)
        put(KeyEvent.KEYCODE_BUTTON_B, 10009)
        put(KeyEvent.KEYCODE_ESCAPE, 10009)
        put(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 10252)
        put(KeyEvent.KEYCODE_HEADSETHOOK, 10252)
        put(KeyEvent.KEYCODE_MEDIA_PLAY, 415)
        put(KeyEvent.KEYCODE_MEDIA_PAUSE, 19)
        put(KeyEvent.KEYCODE_MEDIA_STOP, 413)
        put(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, 417)
        put(KeyEvent.KEYCODE_MEDIA_REWIND, 412)
        put(KeyEvent.KEYCODE_PROG_RED, 403)
        put(KeyEvent.KEYCODE_PROG_GREEN, 404)
        put(KeyEvent.KEYCODE_PROG_YELLOW, 405)
        put(KeyEvent.KEYCODE_PROG_BLUE, 406)
        put(KeyEvent.KEYCODE_INFO, 457)
        put(KeyEvent.KEYCODE_GUIDE, 458)
        // The remote's Menu / Options button: the Control Center, like the red button on Samsung
        put(KeyEvent.KEYCODE_MENU, 403)
        for (i in 0..9) put(KeyEvent.KEYCODE_0 + i, 48 + i)
    }

    fun code(keyCode: Int): Int = KEYS.get(keyCode, 0)

    private val PNG = Regex("^[A-Za-z0-9._-]+[.]png$")

    fun isDebuggable(ctx: Context) = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    @SuppressLint("SetJavaScriptEnabled")
    fun create(ctx: Context, url: String, bridge: Bridge): WebView {
        val web = WebView(ctx)
        web.setBackgroundColor(Color.TRANSPARENT)
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        @Suppress("DEPRECATION")
        s.databaseEnabled = true
        // The page comes from the app (file://)
        s.allowFileAccess = true
        @Suppress("DEPRECATION")
        s.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        s.allowUniversalAccessFromFileURLs = true
        s.mediaPlaybackRequiresUserGesture = false     // the Aerial screen saver's videos
        s.useWideViewPort = true                       // the page is 1920 x 1080 (its viewport): scaled to the screen
        s.loadWithOverviewMode = true
        s.setSupportZoom(false)
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.userAgentString = s.userAgentString + " APLLauncher-Android"
        s.textZoom = 100
        web.setInitialScale(0)
        web.webViewClient = object : WebViewClient() {
            // The apps' icons and banners (AppList.kt), from the app's own folder
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val u = request.url
                // The trailer's relay page (android/web/yt.html), at an https address so YouTube's player has an origin (#56)
                if (u.host == "apl.app" && u.path == "/yt.html")
                    return WebResourceResponse("text/html", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-cache"), ctx.assets.open("app/yt.html"))
                if (u.host != "apl.apps") return null
                val name = u.lastPathSegment ?: return null
                val f = File(File(ctx.filesDir, "apps"), name)
                if (!PNG.matches(name) || !f.isFile) return WebResourceResponse("text/plain", null, 404, "Not Found", null, null)
                return WebResourceResponse("image/png", null, 200, "OK",
                    mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "max-age=31536000"), FileInputStream(f))
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR || m.messageLevel() == ConsoleMessage.MessageLevel.WARNING)
                    Log.w(TAG, "page: " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")")
                return true
            }
        }
        if (isDebuggable(ctx)) WebView.setWebContentsDebuggingEnabled(true)
        web.addJavascriptInterface(bridge, "APLAndroid")
        web.loadUrl(url)
        return web
    }

    /* A key for the page: window.__aplKey (android.js) makes it a keydown / keyup the launcher reads. */
    fun sendKey(web: WebView?, type: String, code: Int, repeat: Boolean) {
        web?.evaluateJavascript("window.__aplKey&&__aplKey('$type',$code,$repeat)", null)
    }

    /* Sends the remote's key to the page. False: not a key of the launcher (volume, power…), Android has it. */
    fun dispatch(web: WebView?, e: KeyEvent): Boolean {
        val code = code(e.keyCode)
        if (code == 0 || web == null) return false
        if (e.action == KeyEvent.ACTION_DOWN) sendKey(web, "keydown", code, e.repeatCount > 0)
        else if (e.action == KeyEvent.ACTION_UP) sendKey(web, "keyup", code, false)
        return true
    }

    private val main = Handler(Looper.getMainLooper())
    fun onMain(r: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) r() else main.post(r) }

    /* An event for the page: window.__aplEvent(name, data), data being JSON. */
    fun event(web: WebView?, name: String, json: String?) {
        if (web == null) return
        val js = "window.__aplEvent&&__aplEvent(" + JSONObject.quote(name) + "," + (json ?: "null") + ")"
        onMain { web.evaluateJavascript(js, null) }
    }
}
