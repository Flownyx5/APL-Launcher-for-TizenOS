package com.knikt.apllauncher.home

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log

/* The module's line to APL Launcher: its HomeButtonProvider (HomeButton.kt in the launcher), which answers only
   apps signed with APL Launcher's key, and its Home Screen. Every call can fail (launcher not installed,
   signed with another key): the module then lets Android handle the buttons as if it weren't there. */
object Link {
    const val TAG = "APLHome"
    const val LAUNCHER = "com.knikt.apllauncher"
    private val PROVIDER = Uri.parse("content://com.knikt.apllauncher.homebutton")
    const val EXTRA_ACTION = "apl_action"
    const val EXTRA_HOME = "apl_home"

    fun call(ctx: Context, method: String, arg: String? = null, extras: Bundle? = null): Bundle? = try {
        ctx.contentResolver.call(PROVIDER, method, arg, extras)
    } catch (e: Exception) {
        Log.w(TAG, "launcher $method: $e"); null
    }

    /* The launcher's state and settings, read at each Home or ⏯ press (a few milliseconds) */
    class State(b: Bundle?) {
        val ok = b != null
        val resumed = b?.getBoolean("resumed") == true          // the launcher is in front
        val overlay = b?.getBoolean("overlay") == true          // its Control Center is over an app
        val catchHome = (b?.getString("catchHome") ?: "") != "0"
        val homeReturn = (b?.getString("homeReturn") ?: "") != "0"
        val idleClose = (b?.getString("idleClose") ?: "") != "0"
        val playPause = b?.getString("pauseKey") == "playpause"
    }
    fun state(ctx: Context) = State(call(ctx, "state"))

    fun installed(ctx: Context): Boolean = try {
        ctx.packageManager.getApplicationInfo(LAUNCHER, 0); true
    } catch (e: PackageManager.NameNotFoundException) { false }

    /* APL Launcher to the front: as Home (it reads it like Samsung's Home), or for one of its pages ("controlcenter") */
    fun open(ctx: Context, home: Boolean, action: String? = null): Boolean {
        val i = Intent().setComponent(ComponentName(LAUNCHER, "$LAUNCHER.MainActivity"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        // Not as a HOME intent: Android would start a second launcher next to the one already open
        if (home) i.putExtra(EXTRA_HOME, true)
        if (action != null) i.putExtra(EXTRA_ACTION, action)
        return try { ctx.startActivity(i); true } catch (e: Exception) { Log.w(TAG, "launcher: $e"); false }
    }

    /* The device's other launchers (Google TV's, Android TV's), not APL Launcher */
    fun otherHomes(ctx: Context): Set<String> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return ctx.packageManager.queryIntentActivities(intent, 0).mapNotNull { it.activityInfo }
            .filter { it.packageName != LAUNCHER && it.packageName != "com.android.settings" &&
                      !it.packageName.startsWith("com.android.tv.settings") && !it.name.contains("FallbackHome") }
            .map { it.packageName }.toSet()
    }

    /* Does Home on the remote really open APL Launcher (it is the Home app and nothing outranks it)? */
    fun launcherIsHome(ctx: Context): Boolean {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val ri = ctx.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        return ri?.activityInfo?.packageName == LAUNCHER
    }
}
