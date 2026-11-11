@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import app.kimono.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.kimono.data.AppUpdate
import app.kimono.data.Platform
import app.kimono.data.readableSize
import app.kimono.ui.InkProgress
import app.kimono.ui.KimonoBranch
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import kotlinx.coroutines.launch

/** Runs an update and says how it's going. */
private class Installing {
    var progress by mutableStateOf<Float?>(null)
    var problem by mutableStateOf<String?>(null)
}

@Composable
private fun rememberInstall(platform: Platform, update: AppUpdate): Pair<Installing, () -> Unit> {
    val scope = rememberCoroutineScope()
    val state = remember(update.build) { Installing() }
    return state to {
        state.problem = null
        state.progress = 0f
        scope.launch {
            state.problem = platform.installUpdate(update.url ?: "", update.sha256) { state.progress = it }
            state.progress = null
        }
    }
}

/** The download's progress bar, with how far it has come. */
@Composable
private fun Progress(progress: Float, update: AppUpdate) {
    InkProgress(progress = { progress }, modifier = Modifier.fillMaxWidth())
    val percent = (progress * 100).toInt()
    val text = when {
        progress >= 1f -> "Installing…"
        update.size != null && update.size > 0 -> "$percent% · ${readableSize((update.size * progress).toLong())} of ${readableSize(update.size)}"
        else -> "$percent%"
    }
    Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun what(update: AppUpdate, platform: Platform) =
    listOfNotNull("Kimono ${update.version ?: ""}".trim(), update.size?.takeIf { platform.os == "android" }?.let { readableSize(it) }).joinToString(" · ")

/** A version that must be installed before Kimono can be used again. */
@Composable
fun UpdateScreen(update: AppUpdate, platform: Platform) {
    val (installing, start) = rememberInstall(platform, update)
    Box(Modifier.fillMaxSize().systemBarsPadding().padding(24.dp)) {
        Column(Modifier.align(Alignment.Center).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            KimonoBranch(72.dp)
            Text("Update Kimono", style = MaterialTheme.typography.displaySmall)
            Text(
                if (platform.os == "ios") "This version of Kimono is needed to keep going. It's waiting in TestFlight." else "This version of Kimono is needed to keep going.",
                style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            )
            Text(what(update, platform), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            if (update.notes.isNotBlank()) Text(update.notes, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            installing.progress?.let { Progress(it, update) }
            Problem(installing.problem)
            Seal(
                when { installing.progress == null -> if (platform.os == "ios") "Open TestFlight" else "Update"; installing.progress!! < 1f -> "Downloading"; else -> "Installing" },
                onClick = start, busy = installing.progress != null, modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** A newer version, offered on Home. */
@Composable
fun UpdateCard(update: AppUpdate, platform: Platform, onLater: () -> Unit) {
    val (installing, start) = rememberInstall(platform, update)
    Card(
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer, contentColor = MaterialTheme.colorScheme.onSecondaryContainer),
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("A new version is ready", style = MaterialTheme.typography.titleMedium)
            Text(listOf(what(update, platform), update.notes).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
            installing.progress?.let { Progress(it, update) }
            Problem(installing.problem)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Seal(if (installing.progress == null) (if (platform.os == "ios") "Open TestFlight" else "Update") else "Downloading", onClick = start, busy = installing.progress != null, compact = true)
                if (installing.progress == null) TextButton(onClick = onLater) { Text("Later") }
            }
        }
    }
}
