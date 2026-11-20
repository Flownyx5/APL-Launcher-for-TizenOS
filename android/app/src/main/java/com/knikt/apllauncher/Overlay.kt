package com.knikt.apllauncher

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.WebView
import android.widget.FrameLayout

/* The Control Center over the app in front, like APL Overlay on Samsung: a window of its own with the
   launcher's Control Center (assets/app/cc.html), transparent around it.
   Asked by APL Launcher Home Button (Home held, or ⏯ in an app), it needs "draw over other apps"
   (Settings › Apps › Special app access, or adb: docs/android.md). Without it the module opens the
   launcher with its own Control Center instead.
   The page stays loaded a few minutes after it closes, so the next opening is immediate. */
object Overlay : Bridge.Host {
    private val h = Handler(Looper.getMainLooper())
    private var root: FrameLayout? = null
    private var web: WebView? = null
    private var owner: Context? = null
    private var shown = false
    @Volatile var ready = false       // the page answered (android.js, ccReady)
    private val release = Runnable { destroy() }

    override fun web() = web
    override fun isOverlay() = true
    fun isShown() = shown

    fun toggle(c: Context) { if (shown) hide() else show(c) }

    fun show(c: Context): Boolean {
        if (shown) return true
        val type = when {
            Build.VERSION.SDK_INT >= 26 && Settings.canDrawOverlays(c) -> WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            Build.VERSION.SDK_INT in 23..25 && Settings.canDrawOverlays(c) -> @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
            else -> return false
        }
        h.removeCallbacks(release)
        if (web == null || owner !== c) {
            destroy()
            owner = c
            val frame = object : FrameLayout(c) {
                override fun dispatchKeyEvent(e: KeyEvent): Boolean {
                    // The page did not start: Back still closes it
                    if (!ready && e.keyCode == KeyEvent.KEYCODE_BACK) { if (e.action == KeyEvent.ACTION_UP) hide(); return true }
                    if (Web.dispatch(web, e)) return true
                    return super.dispatchKeyEvent(e)
                }
            }
            val w = Web.create(c, "file:///android_asset/app/cc.html", Bridge(c, this))
            frame.addView(w, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            root = frame
            web = w
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, type,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED or
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
            PixelFormat.TRANSLUCENT)
        lp.gravity = Gravity.TOP or Gravity.START
        try {
            wm(c).addView(root, lp)
        } catch (e: Exception) {
            Log.w(Web.TAG, "overlay: $e")
            return false
        }
        shown = true
        web?.onResume()
        web?.evaluateJavascript("window.__aplCcOpen&&__aplCcOpen()", null)
        web?.requestFocus()
        return true
    }

    fun hide() {
        if (!shown) return
        shown = false
        try { wm(owner!!).removeView(root) } catch (e: Exception) { Log.w(Web.TAG, "overlay hide: $e") }
        web?.evaluateJavascript("window.__aplCcClosed&&__aplCcClosed()", null)
        h.postDelayed(release, 5 * 60 * 1000L)
    }

    /* The service stopped (turned off in Accessibility): its window goes with it. */
    fun destroy() {
        if (shown) hide()
        h.removeCallbacks(release)
        web?.let { it.removeJavascriptInterface("APLAndroid"); it.destroy() }
        web = null; root = null; owner = null; ready = false
    }

    private fun wm(c: Context) = c.getSystemService(Context.WINDOW_SERVICE) as WindowManager
}
