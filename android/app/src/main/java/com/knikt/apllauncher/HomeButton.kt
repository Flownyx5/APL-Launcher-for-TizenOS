package com.knikt.apllauncher

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import org.json.JSONObject

/* APL Launcher Home Button (android/homebutton): the optional second app that holds the accessibility service
   for the remote's Home and play/pause buttons. It is a separate .apk because Google Play Protect blocks any
   app installed outside the Play Store that declares an accessibility service (a Nvidia Shield on Reddit): the
   launcher itself now installs without a warning, and only who wants the Home button installs the module.
   The two talk only to each other, both signed with APL Launcher's key: the module calls HomeButtonProvider
   below, the launcher sends it commands (CommandReceiver there), both protected by the HOME_BUTTON permission,
   which Android gives only to apps signed with the same key. */
object HomeButton {
    const val PKG = "com.knikt.apllauncher.home"
    const val PERMISSION = "com.knikt.apllauncher.permission.HOME_BUTTON"
    const val COMMAND = "com.knikt.apllauncher.home.COMMAND"
    /* Where the module is downloaded from: a fixed name in every release, for Downloader */
    const val URL = "https://github.com/Knikt/APL-Launcher/releases/latest/download/apl-launcher-home-button.apk"

    /* The app in front, as the module last saw it ("" without the module) */
    @Volatile var front: String = ""
    private val recentApps = ArrayList<String>()

    fun recent(): List<String> = synchronized(recentApps) { ArrayList(recentApps) }

    fun installed(ctx: Context): Boolean = AppList.isInstalled(ctx, PKG)

    /* Its accessibility service turned on (Settings › Accessibility › APL Launcher Home Button) */
    fun isOn(ctx: Context): Boolean {
        val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return list.split(':').any { it.startsWith("$PKG/") }
    }

    /* Up to 1.1.3 the launcher had the service itself: still in Android's list after the update, it does nothing now */
    fun oldServiceWasOn(ctx: Context): Boolean {
        val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return list.split(':').any { it.startsWith(ctx.packageName + "/") }
    }

    fun noteFront(ctx: Context, pkg: String, home: Boolean) {
        front = pkg
        if (!home && pkg != ctx.packageName && pkg != PKG) synchronized(recentApps) {
            recentApps.remove(pkg); recentApps.add(0, pkg)
            while (recentApps.size > 12) recentApps.removeAt(recentApps.size - 1)
        }
        MainActivity.event("front", JSONObject.quote(pkg))
    }

    /* A command for the module: "sleep", "global:home|back|recents|notifications|power", "allowStock:<ms>".
       False when it is not installed or not turned on. */
    fun send(ctx: Context, command: String): Boolean {
        if (!isOn(ctx)) return false
        return try {
            ctx.sendBroadcast(Intent(COMMAND).setPackage(PKG).putExtra("do", command), PERMISSION); true
        } catch (e: Exception) { Log.w(Web.TAG, "home button: $e"); false }
    }

    /* Asleep now: the module's "lock screen" (Android 9+), which a TV takes as sleep */
    fun sleep(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 28 || !isOn(ctx)) return false
        Web.onMain { Overlay.hide() }
        return send(ctx, "sleep")
    }
}

/* What the module asks of the launcher. call() is not protected by Android on its own: the permission is
   checked here, so only an app signed with APL Launcher's key gets an answer. */
class HomeButtonProvider : ContentProvider() {
    override fun onCreate() = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        val ctx = context ?: return null
        if (ctx.checkCallingPermission(HomeButton.PERMISSION) != PackageManager.PERMISSION_GRANTED)
            throw SecurityException("APL Launcher Home Button only")
        val out = Bundle()
        when (method) {
            // What the module needs to decide a press: the launcher in front, its Control Center open, settings
            "state" -> {
                val p = Bridge.prefs(ctx)
                out.putBoolean("resumed", MainActivity.resumed)
                out.putBoolean("overlay", Overlay.isShown())
                for (k in listOf("catchHome", "pauseKey", "homeReturn", "idleClose")) out.putString(k, p.getString(k, "") ?: "")
            }
            "front" -> if (arg != null) HomeButton.noteFront(ctx, arg, extras?.getBoolean("home") == true)
            // Home held with the launcher in front: its own Control Center (red key)
            "key" -> arg?.toIntOrNull()?.let { MainActivity.pressKey(it) }
            // The Control Center over the app in front: needs "draw over other apps". Without it the module opens
            // the launcher with its Control Center instead.
            "cc" -> {
                val can = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)
                if (can) Web.onMain { Overlay.toggle(ctx.applicationContext) }
                out.putString("result", if (can) "ok" else "denied")
            }
            "hideOverlay" -> Web.onMain { Overlay.hide() }
            "connected", "disconnected" -> MainActivity.event("accessibility", if (method == "connected") "true" else "false")
        }
        return out
    }

    override fun query(u: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun getType(u: Uri): String? = null
    override fun insert(u: Uri, v: ContentValues?): Uri? = null
    override fun delete(u: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0
}
