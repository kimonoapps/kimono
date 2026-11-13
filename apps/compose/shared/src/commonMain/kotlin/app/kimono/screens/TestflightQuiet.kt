package app.kimono.screens

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.kimono.data.Platform
import app.kimono.ui.Seal
import app.kimono.ui.SealTone

/** The clip of turning TestFlight's notifications off for an app; the Portal serves it (public/help). */
private const val CLIP = "/help/testflight-notifications.mp4"

/**
 * On an iPhone, how to quiet TestFlight: Kimono already says when an update is ready, so its
 * alerts and emails for each build only repeat that. A short clip shows where the switches are.
 */
@Composable
fun TestflightQuiet(server: String?, platform: Platform, link: String = "itms-beta://") {
    if (platform.os != "ios" || server == null) return
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Kimono tells you when an update is ready. To stop TestFlight's alerts and emails too, turn them off in TestFlight.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
        val shape = RoundedCornerShape(22.dp)
        platform.LoopingVideo(
            server.trimEnd('/') + CLIP,
            Modifier.width(200.dp).aspectRatio(590f / 1278f).clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape),
        )
        Seal("Open TestFlight", onClick = { platform.openUrl(link) }, tone = SealTone.Quiet, compact = true)
    }
}
