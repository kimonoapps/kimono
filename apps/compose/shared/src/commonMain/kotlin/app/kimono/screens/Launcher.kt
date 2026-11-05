@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.Drive
import app.kimono.data.KimonoProblem
import app.kimono.data.LauncherApp
import app.kimono.data.Platform
import app.kimono.ui.GroupLabel
import app.kimono.ui.HoldMenu
import app.kimono.ui.InkBloom
import app.kimono.ui.InkLoader
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.MenuChoice
import app.kimono.ui.Problem
import app.kimono.ui.kimonoIcon
import coil3.compose.AsyncImage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * Apps pinned on this phone, in order. The website keeps its pins in each
 * browser too, so the phone's are its own: pinning here doesn't move the
 * website's rail. Until someone pins, the first two of Kimono's own apps,
 * as on the website.
 */
class Pins(private val platform: Platform, private val server: String?) {
    private val key get() = "pins:${server ?: ""}"
    private val list = ListSerializer(String.serializer())
    val pinned = MutableStateFlow<List<String>?>(null)

    suspend fun load() { pinned.value = platform.readKept(key)?.let { runCatching { Json.decodeFromString(list, it) }.getOrNull() } }

    fun orDefault(apps: List<LauncherApp>): List<String> = pinned.value ?: apps.filter { it.own }.take(2).map { it.id }

    suspend fun set(ids: List<String>) {
        pinned.value = ids
        platform.keep(key, Json.encodeToString(list, ids))
    }
}

/**
 * 庫 Apps: every app you can open, as the website's rail and Apps grid list
 * them. Each is its bloom, its name and a line of what it's for. Pinned apps
 * come first; hold one to pin or unpin it. Kimono's own apps open their
 * screens here, the rest their phone app or their website.
 */
@Composable
fun LauncherScreen(drive: Drive, pins: Pins, open: (LauncherApp) -> Unit) {
    val apps by drive.launcher.collectAsState()
    val pinned by pins.pinned.collectAsState()
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() { try { drive.otherApps(); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(Unit) { if (drive.launcher.value == null) drive.knownApps(); load() }
    Column(Modifier.fillMaxSize()) {
        KimonoTopBar("Apps")
        KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
            val all = apps
            when {
                all == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                all == null -> Box(Modifier.padding(24.dp)) { Problem(problem) }
                else -> {
                    val pinnedIds = (pinned ?: pins.orDefault(all)).filter { id -> all.any { it.id == id } }
                    val first = pinnedIds.mapNotNull { id -> all.firstOrNull { it.id == id } }
                    val rest = all.filter { it.id !in pinnedIds }
                    fun toggle(app: LauncherApp) = scope.launch { pins.set(if (app.id in pinnedIds) pinnedIds - app.id else pinnedIds + app.id) }
                    LazyVerticalGrid(
                        GridCells.Fixed(2),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        if (first.isNotEmpty()) {
                            item(span = { GridItemSpan(2) }) { Label("Pinned") }
                            items(first, key = { "pin-" + it.id }) { app -> AppTile(app, pinned = true, onPin = { toggle(app) }) { open(app) } }
                        }
                        if (rest.isNotEmpty()) {
                            item(span = { GridItemSpan(2) }) { Label(if (first.isEmpty()) "Your apps" else "Everything else") }
                            items(rest, key = { it.id }) { app -> AppTile(app, pinned = false, onPin = { toggle(app) }) { open(app) } }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 12.dp, top = 14.dp, bottom = 2.dp))
}

/** One app: its bloom, its name, one line; marked when it opens outside Kimono. Hold for Pin. */
@Composable
private fun AppTile(app: LauncherApp, pinned: Boolean, onPin: () -> Unit, onClick: () -> Unit) {
    HoldMenu(listOf(MenuChoice(if (pinned) "Unpin" else "Pin", onClick = onPin)), onClick = onClick, modifier = Modifier.fillMaxWidth().clip(MaterialTheme.shapes.extraLarge)) {
        Column(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Box(Modifier.size(58.dp), contentAlignment = Alignment.Center) {
                    InkBloom(app.id, app.accent, app.glyph, 58.dp)
                    /* An app without one of Kimono's glyphs wears its own icon in the heart, as on the website. */
                    if (app.glyph == null && app.icon != null) AsyncImage(model = app.icon, contentDescription = null, modifier = Modifier.size(58.dp * .3f))
                }
                Spacer(Modifier.weight(1f))
                if (!app.own) Icon(kimonoIcon("out"), "Opens outside Kimono", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
            }
            Column {
                Text(app.name, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(2.dp))
                Text(app.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
