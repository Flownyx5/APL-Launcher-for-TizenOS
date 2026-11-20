package com.knikt.apllauncher

import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.media.tv.TvContract
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/* What the apps put in Android TV's "Play Next" row (Watch Next): Nuvio's Continue Watching, the next episode…
   The Top Shelf shows it as the app's cards (android.js, widgets.js), like APL TV's.
   Reading the other apps' rows needs READ_TV_LISTINGS (Android 11+, a "dangerous" permission: Android asks once,
   or APL Launcher Setup gives it with adb). TvProvider then answers the rows an app made "searchable", which is
   the default. It accepts no free selection: everything is read and sorted here. */
object WatchNext {
    const val PERMISSION = "android.permission.READ_TV_LISTINGS"

    fun supported(): Boolean = Build.VERSION.SDK_INT >= 30

    fun allowed(ctx: Context): Boolean =
        supported() && ctx.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

    private val COLUMNS = arrayOf(
        TvContract.WatchNextPrograms._ID,
        TvContract.WatchNextPrograms.COLUMN_PACKAGE_NAME,
        TvContract.WatchNextPrograms.COLUMN_WATCH_NEXT_TYPE,
        TvContract.WatchNextPrograms.COLUMN_TITLE,
        TvContract.WatchNextPrograms.COLUMN_EPISODE_TITLE,
        TvContract.WatchNextPrograms.COLUMN_SEASON_DISPLAY_NUMBER,
        TvContract.WatchNextPrograms.COLUMN_EPISODE_DISPLAY_NUMBER,
        TvContract.WatchNextPrograms.COLUMN_POSTER_ART_URI,
        TvContract.WatchNextPrograms.COLUMN_THUMBNAIL_URI,
        TvContract.WatchNextPrograms.COLUMN_LAST_PLAYBACK_POSITION_MILLIS,
        TvContract.WatchNextPrograms.COLUMN_DURATION_MILLIS,
        TvContract.WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS,
        TvContract.WatchNextPrograms.COLUMN_BROWSABLE)

    /* Every app's rows, most recently watched first: [{ id, pkg, kind, title, episode, season, number, image,
       position, duration, last }]. Pictures: web addresses only (the page can't open another app's files). */
    fun read(ctx: Context): String {
        val out = JSONArray()
        if (!allowed(ctx)) return out.toString()
        val rows = ArrayList<JSONObject>()
        try {
            ctx.contentResolver.query(TvContract.WatchNextPrograms.CONTENT_URI, COLUMNS, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    if (int(c, TvContract.WatchNextPrograms.COLUMN_BROWSABLE, 1) == 0) continue
                    val pkg = str(c, TvContract.WatchNextPrograms.COLUMN_PACKAGE_NAME)
                    val title = str(c, TvContract.WatchNextPrograms.COLUMN_TITLE)
                    if (pkg.isEmpty() || title.isEmpty() || pkg == ctx.packageName) continue
                    val o = JSONObject()
                    o.put("id", c.getLong(c.getColumnIndexOrThrow(TvContract.WatchNextPrograms._ID)))
                    o.put("pkg", pkg)
                    o.put("kind", int(c, TvContract.WatchNextPrograms.COLUMN_WATCH_NEXT_TYPE, 0))
                    o.put("title", title.take(120))
                    o.put("episode", str(c, TvContract.WatchNextPrograms.COLUMN_EPISODE_TITLE).take(120))
                    o.put("season", str(c, TvContract.WatchNextPrograms.COLUMN_SEASON_DISPLAY_NUMBER).take(8))
                    o.put("number", str(c, TvContract.WatchNextPrograms.COLUMN_EPISODE_DISPLAY_NUMBER).take(8))
                    val pic = listOf(str(c, TvContract.WatchNextPrograms.COLUMN_POSTER_ART_URI), str(c, TvContract.WatchNextPrograms.COLUMN_THUMBNAIL_URI))
                        .firstOrNull { WEB.matches(it) } ?: ""
                    o.put("image", pic)
                    o.put("position", long(c, TvContract.WatchNextPrograms.COLUMN_LAST_PLAYBACK_POSITION_MILLIS))
                    o.put("duration", long(c, TvContract.WatchNextPrograms.COLUMN_DURATION_MILLIS))
                    o.put("last", long(c, TvContract.WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS))
                    rows.add(o)
                }
            }
        } catch (e: Exception) {
            Log.w(Web.TAG, "watch next: $e")
        }
        rows.sortByDescending { it.optLong("last") }
        rows.forEach { out.put(it) }
        return out.toString()
    }

    /* OK on a card: the program's own intent (intent_uri), only inside the app that wrote it, with no access
       granted to anything. False: the caller opens the app as usual. */
    fun open(ctx: Context, pkg: String, id: Long): Boolean {
        if (!allowed(ctx)) return false
        try {
            val uri = ContentUris.withAppendedId(TvContract.WatchNextPrograms.CONTENT_URI, id)
            val cols = arrayOf(TvContract.WatchNextPrograms.COLUMN_PACKAGE_NAME, TvContract.WatchNextPrograms.COLUMN_INTENT_URI)
            val (owner, link) = ctx.contentResolver.query(uri, cols, null, null, null)?.use { c ->
                if (!c.moveToFirst()) null else Pair(str(c, cols[0]), str(c, cols[1]))
            } ?: return false
            if (owner != pkg || link.isEmpty()) return false
            val i = Intent.parseUri(link, Intent.URI_INTENT_SCHEME)
            i.selector = null
            if (i.`package` != null && i.`package` != pkg) return false
            if (i.component != null && i.component!!.packageName != pkg) return false
            i.`package` = pkg
            i.flags = (i.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION).inv()) or
                Intent.FLAG_ACTIVITY_NEW_TASK
            val target = ctx.packageManager.resolveActivity(i, 0)?.activityInfo ?: return false
            if (target.packageName != pkg || !target.exported) return false
            ctx.startActivity(i)
            return true
        } catch (e: Exception) {
            Log.w(Web.TAG, "watch next open: $e")
            return false
        }
    }

    private val WEB = Regex("^https?://[^\\s'\"<>]+$")
    private fun str(c: Cursor, col: String): String { val i = c.getColumnIndex(col); return if (i < 0 || c.isNull(i)) "" else c.getString(i) ?: "" }
    private fun long(c: Cursor, col: String): Long { val i = c.getColumnIndex(col); return if (i < 0 || c.isNull(i)) 0L else c.getLong(i) }
    private fun int(c: Cursor, col: String, def: Int): Int { val i = c.getColumnIndex(col); return if (i < 0 || c.isNull(i)) def else c.getInt(i) }
}
