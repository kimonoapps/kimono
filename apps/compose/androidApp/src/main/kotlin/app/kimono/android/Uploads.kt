package app.kimono.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.kimono.data.Drive
import app.kimono.data.KimonoProblem
import app.kimono.data.PickedFile
import app.kimono.data.Replacing
import app.kimono.data.SessionState
import app.kimono.data.UploadStatus
import app.kimono.data.Uploads
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val TAG = "kimono-upload"

/**
 * Uploads handed to WorkManager: each file is a job that keeps going with
 * the app closed, waits for a connection, survives a restart, and picks up
 * where it stopped (the server remembers how much arrived).
 */
class AndroidUploads(private val context: Context) : Uploads {
    private val work = WorkManager.getInstance(context)
    private val state = MutableStateFlow<List<UploadStatus>>(emptyList())
    override val statuses: StateFlow<List<UploadStatus>> = state

    init {
        CoroutineScope(SupervisorJob() + Dispatchers.Main).launch {
            work.getWorkInfosByTagFlow(TAG).collect { infos -> state.value = infos.mapNotNull(::statusOf) }
        }
    }

    private val remembered = context.getSharedPreferences("uploads", Context.MODE_PRIVATE)

    override fun start(files: List<PickedFile>, folderId: String) {
        files.filterIsInstance<UriFile>().forEach { file ->
            enqueue(Picked(file.uri.toString(), file.name, file.size, file.mimeType, folderId))
        }
    }

    /** What a job needs to run again later: WorkManager doesn't hand a job's input back. */
    private data class Picked(val uri: String, val name: String, val size: Long, val mime: String?, val folder: String, val replaces: String? = null, val base: Int = 0) {
        fun encode() = listOf(uri, name, size.toString(), mime ?: "", folder, replaces ?: "", base.toString()).joinToString("\n")
        companion object {
            fun decode(text: String) = text.split("\n").takeIf { it.size >= 5 }?.let {
                Picked(it[0], it[1], it[2].toLong(), it[3].ifEmpty { null }, it[4], it.getOrNull(5)?.ifEmpty { null }, it.getOrNull(6)?.toIntOrNull() ?: 0)
            }
        }
    }

    /**
     * Sends a file saved through the Files app: a new version of [replacing]
     * (or of a new, empty file). The saved copy is Kimono's own and goes once sent.
     */
    fun startSaved(file: java.io.File, name: String, folderId: String, replacing: Replacing) {
        enqueue(Picked(android.net.Uri.fromFile(file).toString(), name, file.length(), null, folderId, replacing.fileId, replacing.contentVersion))
    }

    private fun enqueue(picked: Picked, location: String? = null) {
        val id = UUID.randomUUID()
        remembered.edit().putString("in:$id", picked.encode()).apply { if (location != null) putString(id.toString(), location) }.apply()
        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setId(id)
            .setInputData(workDataOf("uri" to picked.uri, "name" to picked.name, "size" to picked.size, "mime" to picked.mime, "folder" to picked.folder, "replaces" to picked.replaces, "base" to picked.base))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(TAG)
            .addTag("name:${picked.name}")
            .addTag("size:${picked.size}")
            .addTag("folder:${picked.folder}")
            .build()
        work.enqueueUniqueWork("upload-$id", ExistingWorkPolicy.KEEP, request)
    }

    /**
     * With Kimono in front, uploads that are waiting go now. Android otherwise
     * holds back a job that has tried before, for minutes, even once online.
     */
    fun nudge() {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            work.getWorkInfosByTag(TAG).get()
                .filter { it.state == WorkInfo.State.ENQUEUED && it.runAttemptCount > 0 }
                .forEach { info ->
                    val id = info.id.toString()
                    val picked = remembered.getString("in:$id", null)?.let(Picked::decode) ?: return@forEach
                    val location = remembered.getString(id, null)
                    work.cancelWorkById(info.id).result.get()
                    forget(id)
                    enqueue(picked, location)
                }
        }
    }

    /** A failed upload runs again as a new job, carrying on from the same upload on the server. */
    override fun retry(id: String) {
        val picked = remembered.getString("in:$id", null)?.let(Picked::decode) ?: return
        val location = remembered.getString(id, null)
        forget(id)
        enqueue(picked, location)
    }

    override fun dismiss(id: String) {
        work.cancelWorkById(UUID.fromString(id))
        remembered.getString("in:$id", null)?.let(Picked::decode)?.let { ownCopy(context, it.uri)?.delete() }
        forget(id)
    }

    private fun forget(id: String) {
        remembered.edit().remove(id).remove("in:$id").apply()
        work.pruneWork()
        state.value = state.value.filterNot { it.id == id }
    }

    private fun statusOf(info: WorkInfo): UploadStatus? {
        if (info.state == WorkInfo.State.CANCELLED) return null
        fun tag(prefix: String) = info.tags.firstOrNull { it.startsWith(prefix) }?.removePrefix(prefix)
        val size = tag("size:")?.toLongOrNull() ?: 0
        val sent = info.progress.getLong("sent", if (info.state == WorkInfo.State.SUCCEEDED) size else 0)
        return UploadStatus(
            id = info.id.toString(),
            name = tag("name:") ?: "File",
            size = size,
            sent = if (info.state == WorkInfo.State.SUCCEEDED) size else sent,
            folderId = tag("folder:") ?: "",
            waiting = info.state == WorkInfo.State.ENQUEUED || info.state == WorkInfo.State.BLOCKED,
            failed = if (info.state == WorkInfo.State.FAILED) info.outputData.getString("error") ?: "That file couldn't be uploaded." else null,
            done = info.state == WorkInfo.State.SUCCEEDED,
        )
    }
}

/** A picked file the uploader can reopen later, by its (persisted) address. */
interface UriFile : PickedFile { val uri: Uri }

class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val app = context.applicationContext as KimonoApplication
    private val notifications = context.getSystemService(NotificationManager::class.java)
    private val remembered = context.getSharedPreferences("uploads", Context.MODE_PRIVATE)

    override suspend fun doWork(): Result {
        val uri = Uri.parse(inputData.getString("uri") ?: return Result.failure())
        val name = inputData.getString("name") ?: "File"
        val folder = inputData.getString("folder") ?: return Result.failure()
        val key = id.toString()
        val replacing = inputData.getString("replaces")?.let { Replacing(it, inputData.getInt("base", 0)) }
        val own = ownCopy(applicationContext, uri.toString())
        val file = (if (own != null) own.takeIf { it.exists() }?.let { savedFile(it, name) } else app.platform.pickedFile(uri))
            ?: return Result.failure(workDataOf("error" to "That file isn't there any more."))
        /* Run as a foreground job: a long upload must not be cut off by the OS. */
        setForeground(foregroundInfo(name, 0, file.size))
        /* The process may have started just for this: load the saved sign-in. */
        app.ensureSession()
        var lastShown = 0L
        return try {
            Drive(app.session).upload(file, folder, resumeAt = remembered.getString(key, null), replaces = replacing, started = { remembered.edit().putString(key, it).apply() }) { sent ->
                setProgressAsync(workDataOf("sent" to sent))
                if (sent - lastShown > 4 * 1024 * 1024 || sent == file.size) {
                    lastShown = sent
                    notifications.notify(id.hashCode(), notification(name, sent, file.size))
                }
            }
            remembered.edit().remove(key).remove("in:$key").apply()
            own?.delete()
            KimonoDocuments.changed(applicationContext, folder)
            Result.success()
        } catch (problem: KimonoProblem) {
            /* Offline or signed out for now: WorkManager tries again later. A refusal won't change, so it fails. */
            val message = problem.message ?: ""
            if (message.startsWith("Kimono isn't answering") && runAttemptCount < 50) Result.retry()
            else Result.failure(workDataOf("error" to message))
        }
    }

    override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo(inputData.getString("name") ?: "File", 0, inputData.getLong("size", 0))

    private fun foregroundInfo(name: String, sent: Long, size: Long): ForegroundInfo {
        val note = notification(name, sent, size)
        return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(id.hashCode(), note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(id.hashCode(), note)
    }

    private fun notification(name: String, sent: Long, size: Long): android.app.Notification {
        if (Build.VERSION.SDK_INT >= 26 && notifications.getNotificationChannel("uploads") == null) {
            notifications.createNotificationChannel(NotificationChannel("uploads", "Uploads", NotificationManager.IMPORTANCE_LOW))
        }
        val percent = if (size > 0) (sent * 100 / size).toInt() else 0
        return NotificationCompat.Builder(applicationContext, "uploads")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(name)
            .setContentText("Uploading to Kimono · $percent%")
            .setProgress(100, percent, size == 0L)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .build()
    }
}

/** A copy Kimono made itself (a save from the Files app), as opposed to someone's picked file. */
internal fun ownCopy(context: Context, uri: String): java.io.File? {
    val parsed = Uri.parse(uri)
    if (parsed.scheme != "file") return null
    val file = java.io.File(parsed.path ?: return null)
    return file.takeIf { it.canonicalPath.startsWith(KimonoDocuments.savingDir(context).canonicalPath) }
}

private fun savedFile(file: java.io.File, name: String): PickedFile = object : PickedFile {
    override val name = name
    override val size = file.length()
    override val mimeType: String? = null
    override suspend fun read(offset: Long, max: Int): ByteArray = kotlinx.coroutines.withContext(Dispatchers.IO) {
        java.io.RandomAccessFile(file, "r").use { raf ->
            raf.seek(offset)
            val out = ByteArray(minOf(max.toLong(), size - offset).toInt())
            raf.readFully(out)
            out
        }
    }
}
