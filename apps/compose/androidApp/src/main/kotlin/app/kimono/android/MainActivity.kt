package app.kimono.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import app.kimono.KimonoApp
import app.kimono.data.Session
import app.kimono.data.SharedItem
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp

class MainActivity : ComponentActivity() {
    private lateinit var platform: AndroidPlatform
    private val shared = mutableStateOf<SharedItem?>(null)

    private val picker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> platform.picked(uri) }
    private val filePicker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> platform.filesPicked(uris) }
    /* Upload progress shows as a notification; Android 13 asks once. */
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        platform = (application as KimonoApplication).platform
        platform.activity = this
        platform.launchPicker = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
        platform.launchFilePicker = {
            if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                notifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
            filePicker.launch(arrayOf("*/*"))
        }
        /* Updates and uploads are told as notifications; Android 13 asks once. */
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            notifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        handle(intent)
        val session = (application as KimonoApplication).session
        setContent { KimonoApp(session, platform, shared.value) { shared.value = null } }
    }

    override fun onDestroy() {
        if (platform.activity === this) platform.activity = null
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        (platform.uploads as? AndroidUploads)?.nudge()
        /* Back from the browser sheet with no kimono://auth: it was closed. The
           return, when there is one, arrives just before this, so wait a beat. */
        if (platform.signingIn) Handler(Looper.getMainLooper()).postDelayed({ platform.signInMaybeAbandoned() }, 600)
    }

    private fun handle(intent: Intent?) {
        intent ?: return
        /* From an update notification: the screen to open. */
        intent.getStringExtra(AppUpdates.ROUTE)?.let { app.kimono.Opening.route.value = it; intent.removeExtra(AppUpdates.ROUTE) }
        val data = intent.data
        if (intent.action == Intent.ACTION_VIEW && data?.scheme == "kimono" && data.host == "auth") {
            platform.signInReturned(data)
            return
        }
        if (intent.action == Intent.ACTION_SEND) {
            @Suppress("DEPRECATION")
            val uri = (intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri) ?: return
            val type = intent.type ?: contentResolver.getType(uri) ?: "application/octet-stream"
            var name = "Shared file"
            var size: Long? = null
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getString(0)?.let { name = it }
                    if (!cursor.isNull(1)) size = cursor.getLong(1)
                }
            }
            shared.value = SharedItem(name, type, size, uri) { platform.squarePicture(uri) }
        }
    }
}
