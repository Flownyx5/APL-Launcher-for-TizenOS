package com.knikt.apllauncher

import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.media.AudioManager
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Environment
import android.os.Process
import android.os.StatFs
import android.provider.Settings
import android.util.Log
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface

/* window.APLAndroid: what the launcher's page asks of Android (android/web/android.js turns it into the
   calls the launcher makes on Samsung). Called on the WebView's own thread, never the main one. */
class Bridge(private val ctx: Context, private val host: Host) {
    interface Host {
        fun web(): WebView?
        fun setEditing(on: Boolean) {}
        fun isOverlay(): Boolean = false
    }

    private val app = ctx.applicationContext

    @JavascriptInterface fun platform() = "android"
    @JavascriptInterface fun overlay() = host.isOverlay()
    @JavascriptInterface fun log(msg: String) { Log.i(Web.TAG, "page: $msg") }

    /* ---------- the device ---------- */
    @JavascriptInterface
    fun info(): String {
        val o = JSONObject()
        o.put("manufacturer", Build.MANUFACTURER)
        o.put("brand", Build.BRAND)
        o.put("model", Build.MODEL)
        o.put("device", Build.DEVICE)
        o.put("release", Build.VERSION.RELEASE)
        o.put("sdk", Build.VERSION.SDK_INT)
        o.put("build", Build.DISPLAY)
        o.put("version", try { app.packageManager.getPackageInfo(app.packageName, 0).versionName } catch (e: Exception) { "" })
        o.put("googleTv", AppList.isGoogleTv(app))
        o.put("tv", app.packageManager.hasSystemFeature("android.software.leanback"))
        o.put("emulator", Build.FINGERPRINT.contains("generic") || Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"))
        o.put("defaultHome", AppList.isDefaultHome(app))
        o.put("chosenHome", AppList.isChosenHome(app))
        o.put("homeBlocked", AppList.stockHomeWins(app))
        o.put("module", HomeButton.installed(app))           // APL Launcher Home Button (HomeButton.kt)
        o.put("accessibility", HomeButton.isOn(app))
        o.put("oldService", HomeButton.oldServiceWasOn(app))   // 1.1.3 and before: the service was in the launcher itself
        o.put("overlayAllowed", if (Build.VERSION.SDK_INT >= 23) Settings.canDrawOverlays(app) else true)
        o.put("usageAccess", usageAccess())
        o.put("root", hasSu())
        o.put("canClose", Build.VERSION.SDK_INT < 34)     // Android 14: killBackgroundProcesses only for the app's own processes
        return o.toString()
    }

    /* ---------- apps ---------- */
    /* The list takes a moment the first time (every icon is written once): it comes back as an event. */
    @JavascriptInterface
    fun requestApps() {
        Thread {
            val json = try { AppList.load(app) } catch (e: Exception) { Log.w(Web.TAG, "apps: $e"); "[]" }
            Web.event(host.web(), "apps", json)
        }.start()
    }

    @JavascriptInterface
    fun launch(pkg: String): Boolean {
        val i = AppList.launchIntent(app, pkg) ?: return false
        return start(i)
    }

    @JavascriptInterface fun installed(pkg: String) = AppList.isInstalled(app, pkg)

    /* Opens an app with one piece of data, as Samsung's app control does (APL TV from the Top Shelf:
       resume=<title>, channel=<channel>): an Intent extra. */
    @JavascriptInterface
    fun launchWith(pkg: String, key: String, value: String): Boolean {
        if (!Regex("^[a-z]{1,20}$").matches(key) || !Regex("^[A-Za-z0-9_.:|-]{1,80}$").matches(value)) return false
        val i = AppList.launchIntent(app, pkg) ?: return false
        return start(i.putExtra(key, value))
    }

    /* ---------- Android TV's Watch Next row (WatchNext.kt): the Top Shelf's cards for every app ---------- */
    @JavascriptInterface fun watchNextAllowed(): Boolean = WatchNext.allowed(app)
    @JavascriptInterface fun watchNextSupported(): Boolean = WatchNext.supported()
    @JavascriptInterface fun watchNext(): String = WatchNext.read(app)
    @JavascriptInterface fun openWatchNext(pkg: String, id: String): Boolean = id.toLongOrNull()?.let { WatchNext.open(app, pkg, it) } ?: false
    /* Android's own question, once ("Allow APL Launcher to access your TV listings?"); the answer comes back as
       the event "listings" */
    @JavascriptInterface
    fun requestWatchNext(): Boolean {
        val a = MainActivity.current ?: return false
        if (!WatchNext.supported() || WatchNext.allowed(app)) return false
        Web.onMain { try { a.requestPermissions(arrayOf(WatchNext.PERMISSION), MainActivity.REQUEST_LISTINGS) } catch (e: Exception) { Log.w(Web.TAG, "listings: $e") } }
        return true
    }

    /* APL TV's Top Shelf: what you were watching and your last channel. On Samsung and LG it is the file
       /tmp/apltv-shelf.json; on Android APL TV keeps it and hands it to APL Launcher only (its ShelfProvider
       checks this app's signing certificate). "" without APL TV, with an older APL TV, or before it wrote one. */
    @JavascriptInterface
    fun appShelf(): String = try {
        app.contentResolver.query(Uri.parse("content://com.knikt.apltv.shelf/shelf"), null, null, null, null)?.use { c ->
            if (c.moveToFirst()) (c.getString(0) ?: "").take(60000) else ""
        } ?: ""
    } catch (e: Exception) { Log.w(Web.TAG, "APL TV shelf: $e"); "" }

    /* Android's own "Uninstall this app?" */
    @JavascriptInterface
    fun uninstall(pkg: String): Boolean {
        if (!AppList.isInstalled(app, pkg)) return false
        @Suppress("DEPRECATION")
        return start(Intent(Intent.ACTION_UNINSTALL_PACKAGE, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    @JavascriptInterface
    fun openUrl(url: String): Boolean {
        if (!Regex("^https?://\\S+$").matches(url)) return false
        return start(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /* The app in front, as APL Launcher Home Button last saw it ("" without it). */
    @JavascriptInterface fun foreground(): String = HomeButton.front

    /* The apps used lately, most recent first: from the accessibility service, and from Android's usage
       statistics when that access was given (adb, docs/android.md). */
    @JavascriptInterface
    fun running(): String {
        val out = LinkedHashSet<String>()
        HomeButton.recent().forEach { out.add(it) }
        if (usageAccess()) {
            try {
                val um = app.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
                val now = System.currentTimeMillis()
                um.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 4 * 3600 * 1000L, now)
                    .filter { it.lastTimeUsed > now - 4 * 3600 * 1000L && it.packageName != app.packageName }
                    .sortedByDescending { it.lastTimeUsed }
                    .forEach { out.add(it.packageName) }
            } catch (e: Exception) {}
        }
        out.remove(app.packageName)
        return JSONArray(out.toList()).toString()
    }

    /* Free Up Memory: Android closes the given apps if they are in the background (never the one in
       front, nor what plays music in the background with a notification). Answers what was freed. */
    @JavascriptInterface
    fun freeMemory(pkgsJson: String): String {
        val am = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val before = memAvail(am)
        val arr = try { JSONArray(pkgsJson) } catch (e: Exception) { JSONArray() }
        var n = 0
        val front = HomeButton.front
        for (i in 0 until arr.length()) {
            val pkg = arr.optString(i)
            if (pkg.isEmpty() || pkg == app.packageName || pkg == front) continue
            try { am.killBackgroundProcesses(pkg); n++ } catch (e: Exception) {}
        }
        try { Thread.sleep(800) } catch (e: InterruptedException) {}
        val after = memAvail(am)
        return JSONObject().put("closed", n).put("freed", Math.max(0L, (after - before) / (1024 * 1024))).toString()
    }

    @JavascriptInterface
    fun memory(): String {
        val am = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        return JSONObject().put("avail", mi.availMem).put("total", mi.totalMem).toString()
    }

    private fun memAvail(am: ActivityManager): Long {
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        return mi.availMem
    }

    /* ---------- sound ---------- */
    private val audio get() = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    @JavascriptInterface
    fun volume(): String {
        val a = audio
        val max = Math.max(1, a.getStreamMaxVolume(AudioManager.STREAM_MUSIC))
        val muted = if (Build.VERSION.SDK_INT >= 23) a.isStreamMute(AudioManager.STREAM_MUSIC) else false
        return JSONObject().put("level", Math.round(100f * a.getStreamVolume(AudioManager.STREAM_MUSIC) / max))
            .put("muted", muted).put("fixed", if (Build.VERSION.SDK_INT >= 21) a.isVolumeFixed else false).toString()
    }

    /* 0 to 100, as on Samsung: Android has its own steps (often 15 to 100), the nearest one is taken. */
    @JavascriptInterface
    fun setVolume(level: Int): Int {
        val a = audio
        val max = Math.max(1, a.getStreamMaxVolume(AudioManager.STREAM_MUSIC))
        val cur = a.getStreamVolume(AudioManager.STREAM_MUSIC)
        var step = Math.round(Math.max(0, Math.min(100, level)) * max / 100f)
        // A small press always moves at least one of Android's steps
        if (step == cur && level != Math.round(100f * cur / max)) step = if (level > 100f * cur / max) Math.min(max, cur + 1) else Math.max(0, cur - 1)
        try { a.setStreamVolume(AudioManager.STREAM_MUSIC, step, 0) } catch (e: Exception) { Log.w(Web.TAG, "volume: $e") }
        return Math.round(100f * a.getStreamVolume(AudioManager.STREAM_MUSIC) / max)
    }

    @JavascriptInterface
    fun setMute(on: Boolean) {
        try {
            if (Build.VERSION.SDK_INT >= 23) audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, if (on) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE, 0)
            else @Suppress("DEPRECATION") audio.setStreamMute(AudioManager.STREAM_MUSIC, on)
        } catch (e: Exception) { Log.w(Web.TAG, "mute: $e") }
    }

    /* ---------- network ---------- */
    @JavascriptInterface
    fun network(): String {
        val o = JSONObject()
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        var type = ""
        var lp: LinkProperties? = null
        if (Build.VERSION.SDK_INT >= 23) {
            val n = cm.activeNetwork
            val caps = if (n != null) cm.getNetworkCapabilities(n) else null
            lp = if (n != null) cm.getLinkProperties(n) else null
            if (caps != null) type = when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Mobile"
                else -> "Other"
            }
        } else {
            @Suppress("DEPRECATION")
            val ni = cm.activeNetworkInfo
            @Suppress("DEPRECATION")
            if (ni != null && ni.isConnected) type = when (ni.type) {
                ConnectivityManager.TYPE_ETHERNET -> "Ethernet"; ConnectivityManager.TYPE_WIFI -> "Wi-Fi"; else -> "Other"
            }
        }
        o.put("connected", type.isNotEmpty())
        o.put("type", type)
        if (type == "Wi-Fi") {
            try {
                val wm = app.getSystemService(Context.WIFI_SERVICE) as WifiManager
                @Suppress("DEPRECATION")
                val wi = wm.connectionInfo
                // Android hides the network name from apps without the location permission: "—" then
                val ssid = wi?.ssid?.trim('"') ?: ""
                o.put("ssid", if (ssid.isEmpty() || ssid == "<unknown ssid>") "" else ssid)
                @Suppress("DEPRECATION")
                o.put("signal", if (wi != null) WifiManager.calculateSignalLevel(wi.rssi, 6) else 0)
            } catch (e: Exception) {}
        }
        if (lp != null) {
            lp.linkAddresses.firstOrNull { it.address is Inet4Address }?.let { o.put("ip", it.address.hostAddress) }
            // IPv4 first: an IPv6 link-local address (fe80::…) tells nobody anything
            val gws = lp.routes.filter { it.isDefaultRoute && it.gateway != null }.mapNotNull { it.gateway }
            (gws.firstOrNull { it is Inet4Address } ?: gws.firstOrNull())?.let { o.put("gateway", it.hostAddress) }
            (lp.dnsServers.firstOrNull { it is Inet4Address } ?: lp.dnsServers.firstOrNull())?.let { o.put("dns", it.hostAddress) }
            lp.interfaceName?.let { name ->
                try {
                    val mac = NetworkInterface.getByName(name)?.hardwareAddress
                    if (mac != null && mac.isNotEmpty()) o.put("mac", mac.joinToString(":") { String.format("%02X", it) })
                } catch (e: Exception) {}
            }
        }
        return o.toString()
    }

    /* ---------- storage, picture ---------- */
    @JavascriptInterface
    fun storage(): String {
        val s = StatFs(Environment.getDataDirectory().path)
        return JSONObject().put("free", s.availableBytes).put("total", s.totalBytes).toString()
    }

    /* The panel's real size, and the size apps are drawn in when it differs ("3840 × 2160 (interface 1920 × 1080)"). */
    @JavascriptInterface
    fun display(): String {
        val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        @Suppress("DEPRECATION")
        val d = wm.defaultDisplay
        val o = JSONObject()
        if (Build.VERSION.SDK_INT >= 23) {
            val m = d.mode
            o.put("panel", "${m.physicalWidth} × ${m.physicalHeight}")
            o.put("hz", Math.round(m.refreshRate))
        }
        val p = android.graphics.Point()
        @Suppress("DEPRECATION")
        d.getRealSize(p)
        o.put("ui", "${p.x} × ${p.y}")
        if (Build.VERSION.SDK_INT >= 24) {
            val hdr = d.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)
            o.put("hdr", hdr.size > 0)
        }
        return o.toString()
    }

    /* ---------- the TV's inputs: Sources (android.js) ----------
       A Google TV or Android TV television lists its HDMI ports through TvInputManager: one passthrough input per
       port, plus one per HDMI-CEC device found on a port (its parent is that port). A box (Shield, Chromecast, the
       emulator) has none, or no TvInputManager at all: "[]". Listing and opening them need no permission.
       [{ id, number, label }]: number = the one in the port's own name ("HDMI 2"), else its place in the list;
       label = the name given in Android's Inputs settings, else the CEC device's (PlayStation 5…), else the port's. */
    @JavascriptInterface
    fun tvInputs(): String = try {
        val tm = app.getSystemService(Context.TV_INPUT_SERVICE) as? TvInputManager
        // Inputs hidden in Android's Inputs settings stay hidden here too
        val all = tm?.tvInputList.orEmpty().filter { it.type == TvInputInfo.TYPE_HDMI && it.isPassthroughInput && !hidden(it) }
        val ports = all.filter { it.parentId == null }
        val taken = HashSet<Int>()
        val named = ports.map { p ->
            val n = portNumber(text { p.loadLabel(app) }) ?: portNumber(p.id)
            if (n != null && taken.add(n)) n else null          // two ports named alike: the second one is counted below
        }
        val out = JSONArray()
        ports.forEachIndexed { i, p ->
            var n = named[i]
            if (n == null) { n = i + 1; while (!taken.add(n)) n++ }
            val own = text { p.loadCustomLabel(app) }
            val cec = all.firstOrNull { it.parentId == p.id }?.let { d -> text { d.loadCustomLabel(app) }.ifEmpty { text { d.loadLabel(app) } } } ?: ""
            out.put(JSONObject().put("id", p.id).put("number", n).put("label", own.ifEmpty { cec }.ifEmpty { text { p.loadLabel(app) } }))
        }
        out.toString()
    } catch (e: Exception) { Log.w(Web.TAG, "inputs: $e"); "[]" }

    /* Shows one of those inputs: the TV's own app for its inputs opens on it, as from Android's Inputs menu. Only an
       input the TV lists: the page never hands Android an address of its own. */
    @JavascriptInterface
    fun openInput(id: String): Boolean = try {
        val tm = app.getSystemService(Context.TV_INPUT_SERVICE) as? TvInputManager
        val input = tm?.getTvInputInfo(id)
        if (input == null || !input.isPassthroughInput) false
        else {
            val uri = TvContract.buildChannelUriForPassthroughInput(id)
            start(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) ||
                // Android finds the TV app from the address's type (TvProvider's): a TV that doesn't give it, the type written out
                start(Intent(Intent.ACTION_VIEW).setDataAndType(uri, TvContract.Channels.CONTENT_ITEM_TYPE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    } catch (e: Exception) { Log.w(Web.TAG, "input: $e"); false }

    /* "HDMI 3", "HDMI3 (eARC)", or a service named so (…/.Hdmi2InputService/HW5); one digit only, so that an id like
       "HDMI100004" doesn't read as port 1 */
    private fun portNumber(s: String): Int? = Regex("(?i)hdmi[\\s_-]*(\\d)(?!\\d)").find(s)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it > 0 }
    private fun text(f: () -> CharSequence?): String = try { f()?.toString()?.trim() ?: "" } catch (e: Exception) { "" }
    // Android 12+ lets an app read only some of Android's settings: if the hidden list is refused, the input is shown
    private fun hidden(i: TvInputInfo): Boolean = try { i.isHidden(app) } catch (e: Exception) { false }

    /* ---------- Android's own screens ---------- */
    @JavascriptInterface
    fun openSettings(which: String): Boolean {
        val action = when (which) {
            "wifi", "network" -> Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "display", "picture" -> Settings.ACTION_DISPLAY_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "date" -> Settings.ACTION_DATE_SETTINGS
            "language" -> Settings.ACTION_LOCALE_SETTINGS
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            "storage" -> Settings.ACTION_INTERNAL_STORAGE_SETTINGS
            "home" -> Settings.ACTION_HOME_SETTINGS
            "inputs" -> "android.settings.TV_INPUT_SETTINGS"
            "about" -> Settings.ACTION_DEVICE_INFO_SETTINGS
            "overlay" -> if (Build.VERSION.SDK_INT >= 23) Settings.ACTION_MANAGE_OVERLAY_PERMISSION else Settings.ACTION_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        val i = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (which == "overlay" || which.startsWith("app:")) {
            val pkg = if (which.startsWith("app:")) which.substring(4) else app.packageName
            val details = Intent(if (which == "overlay") action else Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (start(details)) return true
        }
        if (start(i)) return true
        // A TV without that screen: Settings itself
        return which != "settings" && start(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /* Make APL Launcher the Home app: Android's own question (Android 10+), else its Home settings.
       "role" / "settings" / "" (nothing on this device: docs/android.md has the adb command). */
    @JavascriptInterface
    fun requestHome(): String {
        val a = MainActivity.current
        if (Build.VERSION.SDK_INT >= 29 && a != null) {
            try {
                val rm = app.getSystemService(android.app.role.RoleManager::class.java)
                if (rm != null && rm.isRoleAvailable(android.app.role.RoleManager.ROLE_HOME)) {
                    if (rm.isRoleHeld(android.app.role.RoleManager.ROLE_HOME)) return if (AppList.isDefaultHome(app)) "held" else "kept"
                    val i = rm.createRequestRoleIntent(android.app.role.RoleManager.ROLE_HOME)
                    Web.onMain { try { a.startActivityForResult(i, MainActivity.REQUEST_HOME) } catch (e: Exception) { Log.w(Web.TAG, "role: $e") } }
                    return "role"
                }
            } catch (e: Exception) { Log.w(Web.TAG, "role: $e") }
        }
        if (start(Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))) return "settings"
        return ""
    }

    /* The device's own launcher (Google TV's, Android TV's): the "Smart Hub" tile. The accessibility
       service lets it stay on screen for a while instead of putting APL Launcher back over it. */
    @JavascriptInterface
    fun openSystemHome(): Boolean {
        val homes = AppList.otherHomes(app)
        val c = homes.firstOrNull { it.packageName == AppList.GOOGLE_TV_HOME } ?: homes.firstOrNull() ?: return false
        HomeButton.send(app, "allowStock:" + 10 * 60 * 1000L)
        return start(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setComponent(c)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED))
    }

    @JavascriptInterface fun systemHomeName(): String {
        val homes = AppList.otherHomes(app)
        if (homes.any { it.packageName == AppList.GOOGLE_TV_HOME }) return "Google TV"
        val c = homes.firstOrNull() ?: return ""
        return try { app.packageManager.getApplicationLabel(app.packageManager.getApplicationInfo(c.packageName, 0)).toString() } catch (e: Exception) { "" }
    }

    /* ---------- sleep, the remote ---------- */
    /* Asleep now: through APL Launcher Home Button's "lock screen" (Android 9+), which a TV takes as sleep. */
    @JavascriptInterface fun sleep(): Boolean = HomeButton.sleep(app)

    @JavascriptInterface fun sleepAt(): Double = SleepReceiver.at(app).toDouble()
    @JavascriptInterface fun setSleepAt(at: Double) { SleepReceiver.schedule(app, at.toLong()) }

    @JavascriptInterface
    fun globalAction(name: String): Boolean {
        if (name !in listOf("home", "back", "recents", "notifications", "power")) return false
        return HomeButton.send(app, "global:$name")
    }

    /* Launcher settings APL Launcher Home Button reads too (HomeButtonProvider): pauseKey, catchHome, idleClose, homeReturn. */
    @JavascriptInterface
    fun setNativePref(key: String, value: String) {
        if (!Regex("^[A-Za-z]{1,40}$").matches(key)) return
        prefs(app).edit().putString(key, value).apply()
    }
    @JavascriptInterface fun nativePref(key: String): String = prefs(app).getString(key, "") ?: ""

    /* The API keys (TMDB, YouTube, Fanart.tv). The published .apk has none: they are typed in Settings ›
       Appearance › Top Shelf › Online Services, or sent by APL Launcher Setup with adb (KeysReceiver.kt).
       Kept in the app's own storage, never in a log. */
    @JavascriptInterface fun keys(): String = Keys.json(app)
    @JavascriptInterface fun setKey(name: String, value: String): Boolean = Keys.set(app, name, value)

    /* ---------- typing ---------- */
    @JavascriptInterface fun editing(on: Boolean) { host.setEditing(on) }

    /* What the launcher was opened for, once its page has started ("" most of the time). */
    @JavascriptInterface fun takeAction(): String = MainActivity.current?.takeAction() ?: ""

    /* ---------- the Control Center over the apps (Overlay.kt) ---------- */
    @JavascriptInterface fun ccReady() { Overlay.ready = true }
    @JavascriptInterface fun overlayShown(): Boolean = Overlay.isShown()
    @JavascriptInterface fun closeOverlay() { Web.onMain { Overlay.hide() } }

    /* The Control Center asks for a launcher page (Settings, Search…): the launcher comes to the front with it. */
    @JavascriptInterface
    fun launcherAction(action: String) {
        if (action.isEmpty() || action.length > 160 || action.any { it == '"' || it == '\\' || it < ' ' }) return
        Web.onMain {
            Overlay.hide()
            start(Intent(app, MainActivity::class.java).putExtra(MainActivity.EXTRA_ACTION, action)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        }
    }

    /* ---------- helpers ---------- */
    /* Is su on this device? Only looked for, never run: root is a second phase (docs/android.md). */
    private fun hasSu(): Boolean = listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su", "/debug_ramdisk/su")
        .any { try { java.io.File(it).exists() } catch (e: Exception) { false } }

    private fun start(i: Intent): Boolean = try {
        app.startActivity(i); true
    } catch (e: ActivityNotFoundException) { false } catch (e: SecurityException) { Log.w(Web.TAG, "start: $e"); false }

    private fun usageAccess(): Boolean {
        return try {
            val ops = app.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            @Suppress("DEPRECATION")
            val mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), app.packageName)
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) { false }
    }

    companion object {
        fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("apl", Context.MODE_PRIVATE)
    }
}
