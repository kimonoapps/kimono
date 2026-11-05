@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import app.kimono.data.Drive
import app.kimono.data.KimonoProblem
import app.kimono.data.LauncherApp
import app.kimono.data.Platform
import app.kimono.theme.Kata
import app.kimono.ui.InkBloom
import app.kimono.ui.InkLoader
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.KimonoBranch
import app.kimono.ui.Problem
import app.kimono.ui.kimonoIcon
import coil3.compose.AsyncImage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * The order of your apps, as you dragged them, kept on this phone. Until
 * you move one: the apps inside Kimono, then those with a phone app of
 * their own, then those that are a website only.
 */
class AppOrder(private val platform: Platform, private val server: String?) {
    private val key get() = "app-order:${server ?: ""}"
    private val list = ListSerializer(String.serializer())
    val saved = MutableStateFlow<List<String>?>(null)

    suspend fun load() { saved.value = platform.readKept(key)?.let { runCatching { Json.decodeFromString(list, it) }.getOrNull() } }

    suspend fun set(ids: List<String>) {
        saved.value = ids
        platform.keep(key, Json.encodeToString(list, ids))
    }

    companion object {
        private fun kind(app: LauncherApp) = when { app.own -> 0; app.phoneApp != null -> 1; else -> 2 }

        /** [apps] in [saved] order; any not placed yet keep the default order, after them. */
        fun arrange(apps: List<LauncherApp>, saved: List<String>?): List<LauncherApp> {
            val byDefault = apps.withIndex().sortedWith(compareBy({ kind(it.value) }, { it.index })).map { it.value }
            if (saved == null) return byDefault
            val placed = saved.mapNotNull { id -> apps.firstOrNull { it.id == id } }
            return placed + byDefault.filter { app -> placed.none { it.id == app.id } }
        }
    }
}

/**
 * 庫 Every app you can open, as the website's rail lists them: its bloom,
 * its name and what it's for. Hold one and drag it to move it. With [home],
 * Kimono itself comes first, always, to go back to Home from any app.
 */
@Composable
fun LauncherScreen(
    drive: Drive, order: AppOrder, here: (LauncherApp) -> PhoneAppHere = { PhoneAppHere(null, null, null) },
    /* What sits above the apps, scrolling with them. */
    header: @Composable () -> Unit = { KimonoTopBar("Apps") },
    home: (() -> Unit)? = null,
    open: (LauncherApp) -> Unit,
) {
    val apps by drive.launcher.collectAsState()
    val saved by order.saved.collectAsState()
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val grid = rememberLazyGridState()
    suspend fun load() { try { drive.otherApps(); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(Unit) { if (drive.launcher.value == null) drive.knownApps(); load() }

    /* While a tile is held: the list as it is being rearranged, which tile, and how far it has moved. */
    var moving by remember { mutableStateOf<List<LauncherApp>?>(null) }
    var held by remember { mutableStateOf<String?>(null) }
    var drift by remember { mutableStateOf(Offset.Zero) }
    val shown = moving ?: apps?.let { AppOrder.arrange(it, saved) }

    KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            GridCells.Fixed(2),
            state = grid,
            modifier = Modifier.fillMaxSize().pointerInput(shown != null) {
                if (shown == null) return@pointerInput
                fun tileAt(point: Offset, except: String? = null) = grid.layoutInfo.visibleItemsInfo.firstOrNull { item ->
                    val key = item.key as? String ?: return@firstOrNull false
                    key.startsWith("app:") && key != except &&
                        point.x >= item.offset.x && point.x < item.offset.x + item.size.width && point.y >= item.offset.y && point.y < item.offset.y + item.size.height
                }
                /* Watched ahead of the tiles (the first pass), so a held tile is picked up even though tiles take taps. */
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    val letGo = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                        while (true) {
                            val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: return@withTimeoutOrNull true
                            if (!change.pressed || (change.position - down.position).getDistance() > viewConfiguration.touchSlop) return@withTimeoutOrNull true
                        }
                        @Suppress("UNREACHABLE_CODE") true
                    }
                    if (letGo != null) return@awaitEachGesture
                    val hit = tileAt(down.position) ?: return@awaitEachGesture
                    val id = (hit.key as String).removePrefix("app:")
                    moving = AppOrder.arrange(drive.launcher.value.orEmpty(), order.saved.value)
                    held = id
                    drift = Offset.Zero
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    while (true) {
                        val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: break
                        val amount = change.positionChange()
                        change.consume()
                        if (!change.pressed) break
                        drift += amount
                        val mine = grid.layoutInfo.visibleItemsInfo.firstOrNull { it.key == "app:$id" } ?: continue
                        val centre = Offset(mine.offset.x + mine.size.width / 2f + drift.x, mine.offset.y + mine.size.height / 2f + drift.y)
                        val over = tileAt(centre, except = "app:$id") ?: continue
                        val list = moving ?: break
                        val from = list.indexOfFirst { it.id == id }
                        val to = list.indexOfFirst { "app:${it.id}" == over.key }
                        if (from < 0 || to < 0) continue
                        moving = list.toMutableList().apply { add(to, removeAt(from)) }
                        /* The tile now sits where the other one was: keep it under the finger. */
                        drift -= Offset((over.offset.x - mine.offset.x).toFloat(), (over.offset.y - mine.offset.y).toFloat())
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    }
                    moving?.let { done -> scope.launch { order.set(done.map { it.id }) } }
                    moving = null; held = null; drift = Offset.Zero
                }
            },
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(span = { GridItemSpan(2) }, key = "header") { header() }
            when {
                shown == null && problem == null -> item(span = { GridItemSpan(2) }) { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { InkLoader() } }
                shown == null -> item(span = { GridItemSpan(2) }) { Problem(problem) }
                else -> {
                if (home != null) item(key = "home") { HomeTile(onClick = home) }
                items(shown, key = { "app:" + it.id }) { app ->
                    val tileShape = MaterialTheme.shapes.extraLarge
                    val lifted = held == app.id
                    AppTile(
                        app, here(app),
                        modifier = if (lifted) Modifier.zIndex(1f).graphicsLayer { translationX = drift.x; translationY = drift.y; scaleX = 1.05f; scaleY = 1.05f; shadowElevation = 12f; shape = tileShape; clip = false }
                        else Modifier.animateItem(),
                    ) { open(app) }
                }
                }
            }
        }
    }
}

/** Kimono itself, first among the apps: its branch, and the way back Home. */
@Composable
private fun HomeTile(onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(MaterialTheme.shapes.extraLarge).background(MaterialTheme.colorScheme.surfaceContainer).clickable(onClick = onClick).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(58.dp), contentAlignment = Alignment.Center) { KimonoBranch(50.dp) }
        Column {
            Text("Kimono", style = MaterialTheme.typography.titleLarge, maxLines = 1)
            Spacer(Modifier.height(2.dp))
            Text("Home", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

/** One app: its bloom, its name, one line; and whether it's on this phone, needs updating, or opens in the browser. */
@Composable
private fun AppTile(app: LauncherApp, here: PhoneAppHere, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(MaterialTheme.shapes.extraLarge).background(MaterialTheme.colorScheme.surfaceContainer).clickable(onClick = onClick).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(58.dp), contentAlignment = Alignment.Center) {
                InkBloom(app.id, app.accent, app.glyph, 58.dp)
                /* An app without one of Kimono's glyphs wears its own icon in the heart, as on the website. */
                if (app.glyph == null && app.icon != null) AsyncImage(model = app.icon, contentDescription = null, modifier = Modifier.size(58.dp * .3f))
            }
            Spacer(Modifier.weight(1f))
            when {
                here.update != null -> Text("Update", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                here.installed == false -> Text("Not installed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                here.installed == true -> Text("Installed", style = MaterialTheme.typography.labelSmall, color = Kata.mossDeep)
                !app.own && app.phoneApp == null -> Icon(kimonoIcon("out"), "Opens in the browser", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
            }
        }
        Column {
            Text(app.name, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Text(app.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Every app, risen from the flower in the middle of the bar: pick one to go there. */
@Composable
fun AppsSheet(drive: Drive, order: AppOrder, here: (LauncherApp) -> PhoneAppHere, onDismiss: () -> Unit, home: () -> Unit, open: (LauncherApp) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Box(Modifier.fillMaxWidth().fillMaxHeight(.9f)) { LauncherScreen(drive, order, here, home = home, open = open) }
    }
}
