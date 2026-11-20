package com.knikt.apllauncher

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/* The Sleep Timer: Android counts, so it works whatever app is in front. At the time chosen, the device
   goes to sleep through APL Launcher Home Button ("lock screen", which a TV takes as sleep). */
class SleepReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val at = Bridge.prefs(c).getLong("sleepAt", 0L)
        if (at == 0L || System.currentTimeMillis() < at - 60 * 1000L) return
        Bridge.prefs(c).edit().remove("sleepAt").apply()
        if (!HomeButton.sleep(c)) Log.w(Web.TAG, "sleep timer: APL Launcher Home Button is not on")
    }

    companion object {
        fun at(c: Context): Long {
            val at = Bridge.prefs(c).getLong("sleepAt", 0L)
            return if (at > System.currentTimeMillis()) at else 0L
        }

        fun schedule(c: Context, at: Long) {
            val app = c.applicationContext
            if (at > 0) Bridge.prefs(app).edit().putLong("sleepAt", at).apply() else Bridge.prefs(app).edit().remove("sleepAt").apply()
            val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
            val pi = PendingIntent.getBroadcast(app, 1, Intent(app, SleepReceiver::class.java), flags)
            am.cancel(pi)
            if (at <= 0) return
            try {
                when {
                    Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms() -> am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                    Build.VERSION.SDK_INT >= 23 -> am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                    else -> am.setExact(AlarmManager.RTC_WAKEUP, at, pi)
                }
            } catch (e: SecurityException) {
                am.set(AlarmManager.RTC_WAKEUP, at, pi)
            }
        }
    }
}
