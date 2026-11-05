package app.kimono.android

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.kimono.data.Drive
import app.kimono.data.newerVersion
import java.util.concurrent.TimeUnit

/*
 * 報 Updates, told: twice a day, while signed in, Kimono asks your Kimono
 * whether there's a newer Kimono, and a newer version of any of Kimono's own
 * apps it hands out that's on this phone (Kimono Photos). Each new version is
 * told once, as a notification; tapping it opens where it can be installed.
 * Installing still asks Android, as every app outside a store must.
 */
object AppUpdates {
    private const val CHANNEL = "updates"
    /** The notification's way back in: which screen to open. */
    const val ROUTE = "kimono.route"

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<AppUpdatesWorker>(12, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        val work = WorkManager.getInstance(context)
        work.enqueueUniquePeriodicWork("app-updates", ExistingPeriodicWorkPolicy.KEEP, request)
        /* And once now, as Kimono starts: a version that came out since is noticed without waiting half a day. */
        /* Half a minute in, so it never renews the sign-in at the same moment the app does. */
        work.enqueueUniqueWork("app-updates-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<AppUpdatesWorker>()
            .setInitialDelay(30, TimeUnit.SECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }

    /** Tells of one new version, once: [key] names it, so the same one isn't told twice. */
    fun tell(context: Context, key: String, title: String, text: String, route: String?) {
        val told = context.getSharedPreferences("kimono-updates", Context.MODE_PRIVATE)
        if (told.getBoolean(key, false)) return
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (route != null) open.putExtra(ROUTE, route)
        val tap = PendingIntent.getActivity(context, key.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(key.hashCode(), NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build())
        told.edit().putBoolean(key, true).apply()
    }
}

class AppUpdatesWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as KimonoApplication
        if (!app.ensureSession()) return Result.success()
        app.session.checkUpdate()?.let { update ->
            AppUpdates.tell(applicationContext, "kimono:${update.build}", "Kimono ${update.version ?: ""} is ready".replace("  ", " "), "Tap to update.", null)
        }
        /* The apps Kimono hands out that are on this phone, and whether a newer one is offered. */
        val drive = Drive(app.session)
        runCatching { drive.otherApps() }
        for (each in drive.launcher.value.orEmpty()) {
            val phone = each.phoneApp ?: continue
            val release = phone.release ?: continue
            val pkg = phone.androidPackage ?: continue
            val installed = app.platform.installedVersion(pkg) ?: continue
            if (newerVersion(release.version, installed)) {
                AppUpdates.tell(applicationContext, "$pkg:${release.version}", "${phone.name} ${release.version} is ready", "Tap to update it from Kimono.", "app/${each.id}")
            }
        }
        return Result.success()
    }
}
