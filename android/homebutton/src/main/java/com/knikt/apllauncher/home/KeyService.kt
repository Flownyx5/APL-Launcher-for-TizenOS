package com.knikt.apllauncher.home

import android.accessibilityservice.AccessibilityService
import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/* The remote over every app, for APL Launcher, without root (turned on in Settings › Accessibility, or with adb):
   - Home held: APL Launcher's Control Center over the app in front (with "draw over other apps"), else the
     launcher with its Control Center; with the launcher in front, its own Control Center.
   - ⏯ in an app: the Control Center too, unless the launcher's Settings › Remote say "Play and Pause".
   - Home pressed: APL Launcher. Android TV 12+ and Google TV keep their own launcher on the Home button
     whatever the default (tried on Android TV 14), so this service opens APL Launcher itself ("catchHome",
     the user's choice), and again whenever the device's own home comes up on its own (an app closed, the
     device started), unless the launcher's Smart Hub tile asked for it.
   - The app in front: told to the launcher (App Switcher), and Close Unused Apps (10 minutes in the background).
   Only key presses and the name of the app in front are seen: no window content (key_service.xml). */
class KeyService : AccessibilityService() {
    companion object {
        @Volatile var instance: KeyService? = null
        private const val LONG_MS = 600L
        private const val IDLE_MS = 10 * 60 * 1000L
    }

    private val h = Handler(Looper.getMainLooper())
    private var front = ""
    private var homeLong = false
    private var ownHomeUntil = 0L
    private var stockUntil = 0L
    private var homes = setOf<String>()
    private val activities = HashMap<String, Boolean>()
    private val leftAt = HashMap<String, Long>()
    private val longHome = Runnable { homeLong = true; onLongHome() }
    private val idleCheck = object : Runnable {
        override fun run() { closeIdle(); h.postDelayed(this, 60 * 1000L) }
    }
    private val debug get() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        homes = Link.otherHomes(this)
        h.postDelayed(idleCheck, 60 * 1000L)
        Link.call(this, "connected")
        Log.i(Link.TAG, "on (other launchers: $homes)")
    }

    override fun onDestroy() {
        instance = null
        h.removeCallbacksAndMessages(null)
        Link.call(this, "disconnected")
        super.onDestroy()
    }

    override fun onInterrupt() {}

    /* ---------- what the launcher asks (CommandReceiver) ---------- */
    fun command(c: String) {
        when {
            c == "sleep" -> if (Build.VERSION.SDK_INT >= 28) performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
            c.startsWith("global:") -> performGlobalAction(when (c.substring(7)) {
                "home" -> GLOBAL_ACTION_HOME
                "back" -> GLOBAL_ACTION_BACK
                "recents" -> GLOBAL_ACTION_RECENTS
                "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
                "power" -> GLOBAL_ACTION_POWER_DIALOG
                else -> return
            })
            // The launcher's Smart Hub tile opens the device's own home on purpose: it stays there that long
            c.startsWith("allowStock:") -> c.substring(11).toLongOrNull()?.let { stockUntil = SystemClock.uptimeMillis() + Math.min(it, 3600 * 1000L) }
        }
    }

    /* ---------- the app in front ---------- */
    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = e.packageName?.toString() ?: return
        val cls = e.className?.toString() ?: return
        if (pkg == front || !isActivity(pkg, cls)) return       // a toast, a dialog, the keyboard…
        val now = SystemClock.uptimeMillis()
        if (front.isNotEmpty()) leftAt[front] = now
        leftAt.remove(pkg)
        front = pkg
        val home = homes.contains(pkg)
        Link.call(this, "front", pkg, Bundle().apply { putBoolean("home", home) })
        // The device's own home came up by itself (an app closed, the device started): APL Launcher instead
        if (home && now > stockUntil) {
            val st = Link.state(this)
            if (st.ok && st.catchHome && st.homeReturn) h.postDelayed({ if (front == pkg) Link.open(this, true) }, 120)
        }
    }

    private fun isActivity(pkg: String, cls: String): Boolean {
        val key = "$pkg/$cls"
        activities[key]?.let { return it }
        val yes = try { packageManager.getActivityInfo(ComponentName(pkg, cls), 0); true } catch (e: Exception) { false }
        activities[key] = yes
        return yes
    }

    /* ---------- the remote ---------- */
    override fun onKeyEvent(e: KeyEvent): Boolean {
        return when (e.keyCode) {
            KeyEvent.KEYCODE_HOME -> onHome(e)
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> onPlayPause(e)
            else -> false
        }
    }

    private fun onHome(e: KeyEvent): Boolean {
        if (debug) Log.d(Link.TAG, "home action=${e.action} repeat=${e.repeatCount} flags=${Integer.toHexString(e.flags)} long=$homeLong")
        // Android's own Home, sent just now by this service: through, or it would come back here forever
        if (SystemClock.uptimeMillis() < ownHomeUntil) return false
        // No APL Launcher to talk to: Home is Android's
        if (!Link.installed(this)) return false
        if (e.action == KeyEvent.ACTION_DOWN) {
            if (e.repeatCount == 0) { homeLong = false; h.removeCallbacks(longHome); h.postDelayed(longHome, LONG_MS) }
            // Android marks the held key itself (its long-press delay): no need to wait for the timer
            else if (!homeLong && (e.flags and KeyEvent.FLAG_LONG_PRESS) != 0) { h.removeCallbacks(longHome); longHome.run() }
            return true
        }
        if (e.action == KeyEvent.ACTION_UP) {
            h.removeCallbacks(longHome)
            if (!homeLong) shortHome()
            homeLong = false
        }
        return true
    }

    private fun shortHome() {
        val st = Link.state(this)
        if (st.overlay) Link.call(this, "hideOverlay")
        if (st.ok && st.catchHome && !Link.launcherIsHome(this)) { Link.open(this, true); return }
        androidHome()
    }

    private fun androidHome() {
        ownHomeUntil = SystemClock.uptimeMillis() + 700
        performGlobalAction(GLOBAL_ACTION_HOME)
    }

    private fun onLongHome() {
        val st = Link.state(this)
        if (!st.ok) return
        if (st.resumed) { Link.call(this, "key", "403"); return }        // the launcher's own Control Center
        controlCenter()
    }

    /* Over the app in front when the launcher may draw over apps, else the launcher with its Control Center */
    private fun controlCenter() {
        val r = Link.call(this, "cc")?.getString("result")
        if (r != "ok") Link.open(this, false, "controlcenter")
    }

    private fun onPlayPause(e: KeyEvent): Boolean {
        if (front.isEmpty() || front == Link.LAUNCHER || homes.contains(front)) return false
        val st = Link.state(this)
        if (!st.ok || st.resumed || st.overlay || st.playPause) return false   // the page in front has it, or the app
        if (e.action == KeyEvent.ACTION_UP) controlCenter()
        return true
    }

    /* ---------- Close Unused Apps ---------- */
    private fun closeIdle() {
        // Android 14 lets an app close only its own processes (tried: "Invalid packageName"): root's job there
        if (Build.VERSION.SDK_INT >= 34 || !Link.state(this).idleClose) return
        val now = SystemClock.uptimeMillis()
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val old = leftAt.filter { now - it.value > IDLE_MS && it.key != front && it.key != Link.LAUNCHER && it.key != packageName && !homes.contains(it.key) }.keys
        for (pkg in old) {
            leftAt.remove(pkg)
            try { am.killBackgroundProcesses(pkg); Log.i(Link.TAG, "closed after 10 min in the background: $pkg") } catch (e: Exception) {}
        }
    }
}
