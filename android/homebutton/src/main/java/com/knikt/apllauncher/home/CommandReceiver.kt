package com.knikt.apllauncher.home

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings

/* What APL Launcher asks (HomeButton.send in the launcher): only apps signed with its key can send it. */
class CommandReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val cmd = i.getStringExtra("do") ?: return
        KeyService.instance?.command(cmd)
    }
}

/* Opened after installing the module (Downloader's Open, the app list): Android's Accessibility screen, where
   "APL Launcher Home Button" is turned on; once on, APL Launcher itself. No screen of its own. */
class SetupActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (KeyService.instance != null && Link.installed(this)) Link.open(this, true)
        else try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {}
        finish()
    }
}
