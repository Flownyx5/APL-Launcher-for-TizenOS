package com.knikt.apllauncher

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/* The apps for the Home Screen: what Android TV's own launcher shows (LEANBACK_LAUNCHER), then the
   phone apps installed by hand (LAUNCHER, not part of the system). Each app gives its name, its icon and,
   for TV apps, its banner (320 x 180): both written once as PNG files in the app's own folder, which
   the page reads at https://apl.apps/<file> (Web.kt serves them: WebView reads no file:// from that
   folder). A new version of the app writes them again. */
object AppList {
    const val URL = "https://apl.apps/"

    private val lock = Any()

    fun load(ctx: Context): String = synchronized(lock) {
        val pm = ctx.packageManager
        val out = JSONArray()
        val seen = HashSet<String>()
        val dir = File(ctx.filesDir, "apps").apply { mkdirs() }
        val keep = HashSet<String>()
        for (category in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            val tv = category == Intent.CATEGORY_LEANBACK_LAUNCHER
            val intent = Intent(Intent.ACTION_MAIN).addCategory(category)
            val list: List<ResolveInfo> = try { pm.queryIntentActivities(intent, 0) } catch (e: Exception) { emptyList() }
            for (ri in list) {
                val ai = ri.activityInfo ?: continue
                val pkg = ai.packageName
                if (pkg == ctx.packageName || pkg == HomeButton.PKG || !seen.add(pkg)) continue
                val app = ai.applicationInfo
                val system = (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                // A phone app on a TV: only the ones installed by hand (sideloaded IPTV players…), not the
                // system's own phone screens
                if (!tv && system) continue
                try {
                    val stamp = try { pm.getPackageInfo(pkg, 0).lastUpdateTime } catch (e: Exception) { 0L }
                    val base = safe(pkg) + "-" + stamp
                    val o = JSONObject()
                    o.put("id", pkg)
                    o.put("name", ri.loadLabel(pm).toString().trim())
                    o.put("tv", tv)
                    o.put("system", system)
                    val icon = File(dir, "$base-icon.png")
                    if (!ok(icon)) write(ri.loadIcon(pm), icon, 192, 192)
                    if (ok(icon)) { o.put("icon", URL + icon.name); keep.add(icon.name) }
                    if (tv) {
                        val banner = File(dir, "$base-banner.png")
                        val none = File(dir, "$base-banner.none")
                        if (!ok(banner) && !none.exists()) {
                            val d = ai.loadBanner(pm) ?: app.loadBanner(pm)
                            if (d != null) write(d, banner, 640, 360) else none.createNewFile()
                        }
                        if (ok(banner)) { o.put("banner", URL + banner.name); keep.add(banner.name) }
                        else keep.add(none.name)
                    }
                    out.put(o)
                } catch (e: Exception) {
                    Log.w(Web.TAG, "app $pkg: $e")
                }
            }
        }
        // Old versions' pictures and uninstalled apps
        dir.listFiles()?.forEach { if (!keep.contains(it.name)) it.delete() }
        out.toString()
    }

    /* A picture cut short (the device turned off while it was written) is written again */
    private fun ok(f: File) = f.isFile && f.length() > 0

    private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9._-]"), "_")

    private fun write(d: Drawable, file: File, w: Int, h: Int) {
        try {
            val bmp: Bitmap
            if (d is BitmapDrawable && d.bitmap != null && d.bitmap.width >= w / 2) {
                bmp = d.bitmap
            } else {
                // Adaptive and vector icons: drawn at the size the launcher shows them
                val iw = if (d.intrinsicWidth > 0) d.intrinsicWidth else w
                val ih = if (d.intrinsicHeight > 0) d.intrinsicHeight else h
                val scale = Math.max(w.toFloat() / iw, h.toFloat() / ih)
                val bw = Math.max(1, Math.round(iw * Math.max(1f, scale)))
                val bh = Math.max(1, Math.round(ih * Math.max(1f, scale)))
                bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
                val c = Canvas(bmp)
                d.setBounds(0, 0, bw, bh)
                d.draw(c)
            }
            val tmp = File(file.parentFile, file.name + ".tmp")
            FileOutputStream(tmp).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            tmp.renameTo(file)
        } catch (e: Exception) {
            Log.w(Web.TAG, "icon ${file.name}: $e")
        }
    }

    /* How the app opens: its TV entry, otherwise its phone entry. */
    fun launchIntent(ctx: Context, pkg: String): Intent? {
        val pm = ctx.packageManager
        val i = (if (Build.VERSION.SDK_INT >= 21) pm.getLeanbackLaunchIntentForPackage(pkg) else null)
            ?: pm.getLaunchIntentForPackage(pkg) ?: return null
        // As any launcher does: an app already open comes back as it was
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        return i
    }

    fun isInstalled(ctx: Context, pkg: String): Boolean = try {
        ctx.packageManager.getApplicationInfo(pkg, 0); true
    } catch (e: PackageManager.NameNotFoundException) { false }

    /* The other launchers on the device (Google TV's, Android TV's): the "Smart Hub" tile's way out. */
    fun otherHomes(ctx: Context): List<ComponentName> {
        val pm = ctx.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return pm.queryIntentActivities(intent, 0).mapNotNull { it.activityInfo }
            .filter { it.packageName != ctx.packageName && it.packageName != "com.android.settings" &&
                      !it.packageName.startsWith("com.android.tv.settings") && !it.name.contains("FallbackHome") }
            .map { ComponentName(it.packageName, it.name) }
    }

    /* Does Home on the remote really open APL Launcher? Being chosen is not enough: Android TV 12+ and
       Google TV keep their own launcher first (a system priority), even when Android's question or adb
       made APL Launcher the "default". APL Launcher Home Button then takes the button (catchHome). */
    fun isDefaultHome(ctx: Context): Boolean {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val ri = ctx.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        return ri?.activityInfo?.packageName == ctx.packageName
    }

    /* Does the device's own launcher have a system priority on Home (Android TV 12+, Google TV: priority 2
       against 0 for any other app)? Then choosing APL Launcher as the Home app changes nothing: after
       Android's question the device even goes back to its own home. */
    fun stockHomeWins(ctx: Context): Boolean {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val list = ctx.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        val mine = list.firstOrNull { it.activityInfo?.packageName == ctx.packageName }?.priority ?: 0
        return list.any { val a = it.activityInfo; a != null && a.packageName != ctx.packageName && it.priority > mine }
    }

    /* Was APL Launcher chosen as the Home app (Android 10+: the Home role)? */
    fun isChosenHome(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                val rm = ctx.getSystemService(android.app.role.RoleManager::class.java)
                if (rm != null && rm.isRoleAvailable(android.app.role.RoleManager.ROLE_HOME)) return rm.isRoleHeld(android.app.role.RoleManager.ROLE_HOME)
            } catch (e: Exception) {}
        }
        return isDefaultHome(ctx)
    }

    const val GOOGLE_TV_HOME = "com.google.android.apps.tv.launcherx"
    fun isGoogleTv(ctx: Context): Boolean = isInstalled(ctx, GOOGLE_TV_HOME)
}
