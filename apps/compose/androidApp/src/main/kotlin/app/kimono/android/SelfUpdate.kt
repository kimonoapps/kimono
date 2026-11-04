package app.kimono.android

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Kimono updating itself from a package published on the Portal: downloaded,
 * checked against the hash the Portal gave, and handed to Android's installer,
 * which asks the person to confirm (and, the first time, to let Kimono
 * install updates at all). Only a package signed like this one installs.
 */
internal object SelfUpdate {
    fun build(context: Context): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    }

    suspend fun install(context: Context, url: String, sha256: String?, progress: (Float) -> Unit): String? = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return@withContext "Allow Kimono to install updates, then tap Update again."
        }
        val file = File(context.cacheDir, "update.apk")
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            if (connection.responseCode != 200) return@withContext "The update isn't there any more. Try again later."
            val total = connection.contentLengthLong
            var received = 0L
            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(256 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        received += read
                        if (total > 0) progress((received.toFloat() / total).coerceAtMost(.99f))
                    }
                }
            }
        } catch (_: Exception) {
            file.delete()
            return@withContext "Kimono isn't answering. Check your connection and try again."
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        if (sha256 != null && !hex.equals(sha256, ignoreCase = true)) {
            file.delete()
            return@withContext "The update didn't arrive whole. Try again."
        }
        progress(1f)
        try {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(context.packageName)
                /* Kimono installed itself last time: Android can skip asking again. */
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                session.openWrite("kimono.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                session.commit(PendingIntent.getBroadcast(context, id, Intent(context, UpdateReceiver::class.java), flags).intentSender)
            }
            null
        } catch (_: Exception) {
            "Android wouldn't install the update. Try again."
        } finally {
            file.delete()
        }
    }
}

/** What the installer says: usually "ask the person", which shows Android's own prompt. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
            context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/** The new version is in: open it again where the person left off. */
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
