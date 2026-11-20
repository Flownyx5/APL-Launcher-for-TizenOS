package com.knikt.apllauncher

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject

/* The API keys of the launcher's Top Shelf (TMDB, YouTube, Fanart.tv). On Samsung, APL Launcher Setup writes them into
   the package before signing it; the Android .apk is signed with APL Launcher's own key and can't be changed on the
   user's PC, so the published one has none. They are kept here instead, in the app's own storage:
   - typed on the TV, Settings › Appearance › Top Shelf › Online Services (android/web/android.js);
   - or sent by APL Launcher Setup over adb (scripts/install-android.ps1), through KeysReceiver below.
   The page reads them at start (android.js); a key in the package's keys.local.js (your own build) is used when none
   is kept here. */
object Keys {
    val NAMES = listOf("tmdb", "youtube", "fanart")
    private val VALUE = Regex("^[A-Za-z0-9_-]{8,100}$")

    fun json(ctx: Context): String {
        val p = Bridge.prefs(ctx)
        val o = JSONObject()
        for (n in NAMES) p.getString("key.$n", null)?.let { if (it.isNotEmpty()) o.put(n, it) }
        return o.toString()
    }

    /* An empty value removes the key. Anything else must look like a key. */
    fun set(ctx: Context, name: String, value: String): Boolean {
        if (name !in NAMES) return false
        val v = value.trim()
        if (v.isNotEmpty() && !VALUE.matches(v)) return false
        Bridge.prefs(ctx).edit().apply { if (v.isEmpty()) remove("key.$name") else putString("key.$name", v) }.apply()
        return true
    }
}

/* adb shell am broadcast -a com.knikt.apllauncher.SET_KEYS -n com.knikt.apllauncher/.KeysReceiver --es tmdb <key> …
   Only the shell (adb) and the system may send it: the manifest asks the sender for WRITE_SECURE_SETTINGS, which
   ordinary apps can't have. The launcher reloads its page when it is open, so the Top Shelf uses them at once. */
class KeysReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != ACTION) return
        var n = 0
        for (name in Keys.NAMES) {
            val v = intent.getStringExtra(name) ?: continue
            if (Keys.set(ctx, name, v)) n++ else Log.w(Web.TAG, "keys: $name refused")
        }
        Log.i(Web.TAG, "keys: $n saved")
        resultCode = if (n > 0) 1 else 0
        resultData = "saved $n"
        if (n > 0) MainActivity.current?.let { a -> Web.onMain { a.reloadPage() } }
    }

    companion object { const val ACTION = "com.knikt.apllauncher.SET_KEYS" }
}
