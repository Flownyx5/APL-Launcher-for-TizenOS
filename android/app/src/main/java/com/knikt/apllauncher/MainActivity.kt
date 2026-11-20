package com.knikt.apllauncher

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONObject

/* The Home Screen: APL Launcher's web code (assets/app, the same as on Samsung) in a WebView.
   - Android TV can make it its Home app (the HOME intent filter): Home on the remote brings it back,
     and the page gets the press (event "home", which the launcher reads like Samsung's Home).
   - The remote's keys go to the page with Samsung's key codes (Web.kt); while text is typed, they go
     to the keyboard instead.
   - window.APLAndroid (Bridge.kt): the apps, the sound, the network, Android's settings… */
class MainActivity : Activity(), Bridge.Host {
    companion object {
        const val EXTRA_ACTION = "apl_action"
        const val EXTRA_HOME = "apl_home"          // Home pressed (APL Launcher Home Button), where Android keeps its own launcher on it
        const val REQUEST_HOME = 7
        const val REQUEST_LISTINGS = 8         // READ_TV_LISTINGS: the apps' Watch Next row (WatchNext.kt)
        @Volatile var current: MainActivity? = null
        @Volatile var resumed = false

        /* A key pressed for the page (the accessibility service: Home held with the launcher in front). */
        fun pressKey(code: Int) {
            val a = current ?: return
            Web.onMain { Web.sendKey(a.web, "keydown", code, false); Web.sendKey(a.web, "keyup", code, false) }
        }
        fun event(name: String, json: String?) { current?.let { Web.event(it.web, name, json) } }
    }

    private var web: WebView? = null
    @Volatile private var editing = false
    @Volatile private var pendingAction: String? = null
    private var packages: BroadcastReceiver? = null

    override fun web() = web

    override fun setEditing(on: Boolean) {
        editing = on
        runOnUiThread {
            val im = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            val w = web ?: return@runOnUiThread
            // requestFocus on a WebView that already has it moved the page's focus away from the text field
            if (on) { if (!w.hasFocus()) w.requestFocus(); im.showSoftInput(w, InputMethodManager.SHOW_IMPLICIT) }
            else im.hideSoftInputFromWindow(w.windowToken, 0)
        }
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        // One launcher at a time: opened as Android's Home and as an app, there could be two pages in memory
        current?.let { if (it !== this) it.finish() }
        current = this
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        // The page is 16:9 (1920 x 1080): on a stage of that shape, as large as the screen allows and centred
        val stage = FrameLayout(this)
        root.addView(stage, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        root.addOnLayoutChangeListener { _, l, t, r, b, _, _, _, _ ->
            val w = r - l; val h = b - t
            if (w <= 0 || h <= 0) return@addOnLayoutChangeListener
            val sw = Math.min(w, Math.round(h * 16f / 9f)); val sh = Math.min(h, Math.round(sw * 9f / 16f))
            val p = stage.layoutParams as FrameLayout.LayoutParams
            if (p.width == sw && p.height == sh) return@addOnLayoutChangeListener
            p.width = sw; p.height = sh; p.gravity = Gravity.CENTER
            stage.post { stage.layoutParams = p }
        }
        pendingAction = intent?.getStringExtra(EXTRA_ACTION)
        val w = Web.create(this, "file:///android_asset/app/index.html", Bridge(this, this))
        web = w
        stage.addView(w, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        w.requestFocus()
        watchPackages()
    }

    /* The page, once started, takes what it was opened for (the Control Center over an app asked for Settings…). */
    fun takeAction(): String { val a = pendingAction ?: ""; pendingAction = null; return a }

    /* New API keys (KeysReceiver.kt): the page starts again with them */
    fun reloadPage() { web?.reload() }

    /* ---------- Home and the launcher's pages ---------- */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        Overlay.hide()
        val action = intent.getStringExtra(EXTRA_ACTION)
        if (action != null) {
            Web.event(web, "action", JSONObject.quote(action))
        } else if (intent.hasCategory(Intent.CATEGORY_HOME) || intent.getBooleanExtra(EXTRA_HOME, false)) {
            Web.event(web, "home", null)
        }
    }

    /* ---------- the remote ---------- */
    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        // Typing: the keyboard and the text field have the keys (Back closes the keyboard, through the page)
        if (editing && e.keyCode != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(e)
        if (Web.dispatch(web, e)) return true
        return super.dispatchKeyEvent(e)
    }

    @Deprecated("Back goes to the page (dispatchKeyEvent): a launcher never closes")
    override fun onBackPressed() {}

    /* ---------- apps installed, updated or removed: the Home Screen updates by itself ---------- */
    private fun watchPackages() {
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addDataScheme("package")
        }
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (i.data?.schemeSpecificPart == packageName) return
                Web.event(web, "packages", null)
            }
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(r, f)
        packages = r
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == REQUEST_LISTINGS) Web.event(web, "listings", if (WatchNext.allowed(this)) "true" else "false")
    }

    @Deprecated("Android's own result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_HOME) Web.event(web, "homeRole", if (resultCode == RESULT_OK) "true" else "false")
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        Overlay.hide()
        web?.onResume()
    }

    override fun onPause() {
        super.onPause()
        resumed = false
        web?.onPause()
    }

    override fun onDestroy() {
        packages?.let { try { unregisterReceiver(it) } catch (e: Exception) {} }
        web?.let { it.removeJavascriptInterface("APLAndroid"); it.destroy() }
        web = null
        if (current === this) current = null
        super.onDestroy()
    }
}
