@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.toShape
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
import androidx.compose.foundation.border
import androidx.compose.runtime.produceState
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil3.compose.AsyncImage
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.Drive
import app.kimono.data.DriveFolder
import app.kimono.data.DriveNode
import app.kimono.data.DriveSpace
import app.kimono.data.KimonoProblem
import app.kimono.data.InAppUploads
import app.kimono.data.UploadStatus
import app.kimono.data.Uploads
import app.kimono.data.Platform
import app.kimono.data.readableSize
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SwipeRow
import app.kimono.ui.kimonoIcon
import app.kimono.ui.SvgMark
import app.kimono.ui.segmentColors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Drive's state that outlives a screen: uploads keep going while you move
 * between folders (and, where the OS allows, after the app closes), and an
 * open folder reloads when one lands.
 */
class DriveModel(val drive: Drive, platform: Platform) {
    private val scope = CoroutineScope(SupervisorJob())
    val uploads: Uploads = platform.uploads ?: InAppUploads(drive)
    /** Goes up whenever an upload finishes, so open folders reload. */
    var landed by mutableStateOf(0)
    private var peopleKnown: List<app.kimono.data.Person>? = null

    /** Everyone with a Kimono account: asked afresh each time, the last answer standing in when offline. */
    suspend fun people(): List<app.kimono.data.Person> =
        try { drive.people().also { peopleKnown = it } } catch (p: app.kimono.data.KimonoProblem) { peopleKnown ?: throw p }

    init {
        scope.launch {
            val seen = mutableSetOf<String>()
            uploads.statuses.collect { list ->
                list.filter { it.done && seen.add(it.id) }.forEach { finished ->
                    landed += 1
                    /* A moment to see it reach 100%, then out of the way. */
                    launch { kotlinx.coroutines.delay(1500); uploads.dismiss(finished.id) }
                }
            }
        }
    }
}


/** Your spaces: the top of Drive. */
@Composable
fun DriveScreen(model: DriveModel, me: String?, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var spaces by remember { mutableStateOf<List<DriveSpace>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf(false) }
    suspend fun load() {
        try { spaces = model.drive.spaces(); problem = null } catch (p: KimonoProblem) { problem = p.message }
    }
    LaunchedEffect(model.landed) { load() }
    /* Drive's bloom comes with the list of apps; fetch it if Home hasn't. */
    LaunchedEffect(Unit) { if (model.drive.driveBloom.value == null) runCatching { model.drive.otherApps() } }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = { KimonoTopBar("Drive", mark = { SvgMark(model.drive.driveBloom.collectAsState().value, 32.dp) }) { IconButton(onClick = { open("trash") }) { Icon(kimonoIcon("trash"), "Recently deleted") } } },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { naming = true }, icon = { Icon(kimonoIcon("plus"), null) }, text = { Text("New space") }, containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer)
        },
    ) { padding ->
        KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.padding(padding).fillMaxSize()) {
            val list = spaces
            when {
                list == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
                list.isNullOrEmpty() -> Empty(problem ?: "Spaces hold your files. Make one, or ask someone to add you to theirs.")
                else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                    itemsIndexed(list, key = { _, s -> s.id }) { index, space ->
                        SegmentedListItem(
                            onClick = { open("folder/${space.rootId}") },
                            onLongClick = { open("space/${space.id}") },
                            shapes = ListItemDefaults.segmentedShapes(index, list.size),
                            colors = segmentColors(),
                            leadingContent = { SvgMark(space.mark, 44.dp) },
                            supportingContent = { Text(listOf(roleWord(space.role), if (space.members == 1) "Just you" else "${space.members} people").joinToString(" · ")) },
                            trailingContent = { Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp)) },
                        ) { Text(space.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
    if (naming) NewSpaceSheet(model, me, onDismiss = { naming = false }) { rootId ->
        naming = false
        open("folder/$rootId")
    }
}

private fun roleWord(role: String) = when (role) { "owner" -> "Yours"; "editor" -> "You can edit"; else -> "You can view" }

/** One folder: its files and folders, uploads on their way, and what you can do with each. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FolderScreen(model: DriveModel, platform: Platform, folderId: String, open: (String) -> Unit, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val snackbar = remember { SnackbarHostState() }
    var folder by remember { mutableStateOf<DriveFolder?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<DriveNode?>(null) }
    var opening by remember { mutableStateOf<Pair<DriveNode, Long>?>(null) }
    var canEdit by remember { mutableStateOf(true) }
    /* The space's crest stays beside the name, however deep in it you go. */
    var crest by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val loaded = model.drive.folder(folderId)
            folder = loaded
            problem = null
            val space = model.drive.spaces().firstOrNull { it.id == loaded.folder.spaceId }
            canEdit = space?.role != "viewer"
            crest = space?.mark
        } catch (p: KimonoProblem) { problem = p.message }
    }
    fun act(done: String? = null, work: suspend () -> Unit) = scope.launch {
        try { work(); load(); done?.let { snackbar.showSnackbar(it) } } catch (p: KimonoProblem) { snackbar.showSnackbar(p.message ?: "That didn't work.") }
    }
    fun openFile(node: DriveNode): kotlinx.coroutines.Job = scope.launch {
        opening = node to 0L
        try {
            val path = model.drive.download(node, platform.cacheDir()) { opening = node to it }
            platform.openFile(path, node.mime)
        } catch (p: KimonoProblem) {
            opening = null
            /* What arrived is kept, so trying again carries on from there. */
            if (snackbar.showSnackbar(p.message ?: "That file couldn't be opened.", actionLabel = "Try again") == SnackbarResult.ActionPerformed) openFile(node)
        }
        opening = null
    }
    LaunchedEffect(folderId, model.landed) { load() }

    val here = folder
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            KimonoTopBar(here?.folder?.name ?: "", onBack = back, mark = crest?.let { { SvgMark(it, 30.dp) } }) {
                /* At the top of a space: who's in it, and its settings. */
                if (here != null && here.path.isEmpty()) IconButton(onClick = { open("space/${here.folder.spaceId}") }) { Icon(kimonoIcon("person"), "People and settings") }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            if (canEdit && here != null) ExtendedFloatingActionButton(onClick = { adding = true }, icon = { Icon(kimonoIcon("plus"), null) }, text = { Text("Add") }, containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer)
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            val uploads by model.uploads.statuses.collectAsState()
            uploads.filter { it.folderId == folderId || it.failed != null }.forEach { task -> UploadRow(task, retry = { model.uploads.retry(task.id) }) { model.uploads.dismiss(task.id) } }
            KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                val children = here?.children
                when {
                    here == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
                    children.isNullOrEmpty() -> Empty(problem ?: if (canEdit) "Nothing here yet. Add files with the button below." else "Nothing here yet.")
                    else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                        itemsIndexed(children, key = { _, n -> n.id }) { index, node ->
                            val row = @Composable {
                                NodeRow(
                                    node = node,
                                    thumbnail = { pixels -> platform.thumbnail(node, pixels) },
                                    index = index,
                                    count = children.size,
                                    busy = opening?.first?.id == node.id,
                                    progress = opening?.takeIf { it.first.id == node.id }?.let { if (node.size > 0) it.second.toFloat() / node.size else null },
                                    choices = if (!canEdit) emptyList() else buildList {
                                        add(NodeChoice("Rename") { renaming = node })
                                        if (!node.isFolder) {
                                            add(NodeChoice("Share link") { act { platform.share(model.drive.link(node.id)) } })
                                            if (node.link == null) add(NodeChoice("Copy public link") { act("Link copied. Anyone with it can open the file.") { clipboard.setText(AnnotatedString(model.drive.link(node.id))) } })
                                            else {
                                                add(NodeChoice("Copy public link") { act("Link copied.") { clipboard.setText(AnnotatedString(model.drive.link(node.id))) } })
                                                add(NodeChoice("Turn off public link") { act("The link no longer works.") { model.drive.unlink(node.id) } })
                                            }
                                        }
                                        add(NodeChoice("Move to trash", danger = true) { act("Moved to Recently deleted.") { model.drive.moveToTrash(node.id) } })
                                    },
                                    onClick = { if (node.isFolder) open("folder/${node.id}") else openFile(node) },
                                )
                            }
                            if (canEdit) SwipeRow("Move to trash", onAction = {
                                try { model.drive.moveToTrash(node.id); load(); snackbar.showSnackbar("Moved to Recently deleted."); true }
                                catch (p: KimonoProblem) { snackbar.showSnackbar(p.message ?: "That didn't work."); false }
                            }) { row() } else row()
                        }
                    }
                }
            }
        }
    }

    if (adding) AddSheet(onDismiss = { adding = false }, onUpload = {
        adding = false
        scope.launch {
            val files = platform.pickFiles()
            if (files.isNotEmpty() && here != null) model.uploads.start(files, here.folder.id)
        }
    }, onFolder = { adding = false; naming = true })
    if (naming && here != null) NameDialog(title = "New folder", action = "Make it", initial = "", onDismiss = { naming = false }) { name ->
        model.drive.createFolder(here.folder.id, name)
        /* Reload before closing: the dialog's work stops when it goes. */
        load()
        naming = false
    }
    renaming?.let { node ->
        NameDialog(title = "Rename", action = "Rename", initial = node.name, onDismiss = { renaming = null }) { name ->
            model.drive.rename(node.id, name)
            load()
            renaming = null
        }
    }
}

class NodeChoice(val label: String, val danger: Boolean = false, val onClick: () -> Unit)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NodeRow(node: DriveNode, thumbnail: suspend (Int) -> String?, index: Int, count: Int, busy: Boolean, progress: Float?, choices: List<NodeChoice>, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    val pixels = with(LocalDensity.current) { 40.dp.roundToPx() }
    /* A photo, video or PDF shows a small picture of itself once one is ready; until then, its icon. */
    val picture by produceState<String?>(null, node.id, node.contentVersion) {
        if (node.mayHaveThumbnail) value = runCatching { thumbnail(pixels) }.getOrNull()
    }
    Box {
        SegmentedListItem(
            onClick = onClick,
            onLongClick = if (choices.isEmpty()) null else ({ haptics.performHapticFeedback(HapticFeedbackType.LongPress); menu = true }),
            shapes = ListItemDefaults.segmentedShapes(index, count),
            colors = segmentColors(),
            leadingContent = {
                Box(Modifier.size(40.dp).background(if (node.isFolder) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.tertiaryContainer, RoundedCornerShape(if (node.isFolder) 12.dp else 20.dp)), contentAlignment = Alignment.Center) {
                    if (busy) LoadingIndicator(Modifier.size(28.dp))
                    else if (picture != null) AsyncImage(
                        model = "file://$picture",
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        /* A page reads from its top; a photo from its middle. */
                        alignment = if (node.name.endsWith(".pdf", ignoreCase = true) || node.mime == "application/pdf") Alignment.TopCenter else Alignment.Center,
                        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp)),
                    )
                    else Icon(kimonoIcon(iconFor(node)), null, modifier = Modifier.size(20.dp), tint = if (node.isFolder) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onTertiaryContainer)
                }
            },
            supportingContent = {
                Column {
                    Text(detailOf(node), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (progress != null) LinearWavyProgressIndicator(progress = { progress }, modifier = Modifier.padding(top = 6.dp).fillMaxWidth())
                }
            },
            trailingContent = if (node.isFolder) ({ Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp)) }) else null,
        ) { Text(node.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = MaterialTheme.shapes.large) {
            choices.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(choice.label, color = if (choice.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface) },
                    onClick = { menu = false; choice.onClick() },
                )
            }
        }
    }
}

private fun iconFor(node: DriveNode) = when {
    node.isFolder -> "folder"
    node.mime?.startsWith("image/") == true -> "image"
    node.mime?.startsWith("video/") == true -> "video"
    else -> "file"
}

private fun detailOf(node: DriveNode): String = buildList {
    if (!node.isFolder) add(readableSize(node.size))
    if (node.link != null) add("Public link on")
    node.guest?.let { add("Added by $it") }
}.joinToString(" · ").ifEmpty { "Folder" }

@Composable
private fun UploadRow(task: UploadStatus, retry: () -> Unit, dismiss: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(20.dp), modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(task.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (task.failed != null) TextButton(onClick = retry) { Text("Try again") }
                if (task.failed != null || !task.done) TextButton(onClick = dismiss) { Text(if (task.failed != null) "Dismiss" else "Cancel") }
            }
            if (task.failed != null) Problem(task.failed)
            else {
                Spacer(Modifier.height(4.dp))
                val share = if (task.size > 0) task.sent.toFloat() / task.size else if (task.done) 1f else 0f
                LinearWavyProgressIndicator(progress = { share }, modifier = Modifier.fillMaxWidth())
                Text(
                    when {
                        task.done -> "Uploaded"
                        task.waiting -> "Waiting for a connection · ${readableSize(task.sent)} of ${readableSize(task.size)}"
                        else -> "${readableSize(task.sent)} of ${readableSize(task.size)}"
                    },
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun AddSheet(onDismiss: () -> Unit, onUpload: () -> Unit, onFolder: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
            listOf(Triple("Upload files", "upload", onUpload), Triple("New folder", "folder", onFolder)).forEachIndexed { index, (label, icon, action) ->
                SegmentedListItem(
                    onClick = action,
                    shapes = ListItemDefaults.segmentedShapes(index, 2),
                    colors = ListItemDefaults.segmentedColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
                    leadingContent = { Icon(kimonoIcon(icon), null) },
                ) { Text(label, style = MaterialTheme.typography.bodyLarge) }
            }
        }
    }
}

/** Asks for a name, and keeps the dialog open with the reason if it's refused. */
@Composable
private fun NameDialog(title: String, action: String, initial: String, onDismiss: () -> Unit, onConfirm: suspend (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(initial) }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it; problem = null }, singleLine = true, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
                Problem(problem)
            }
        },
        confirmButton = {
            Seal(action, compact = true, busy = busy, enabled = name.isNotBlank(), onClick = {
                scope.launch {
                    busy = true
                    try { onConfirm(name.trim()) } catch (p: KimonoProblem) { problem = p.message }
                    busy = false
                }
            })
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
    )
}

/** Recently deleted: kept for 30 days, then gone for good. */
@Composable
fun TrashScreen(model: DriveModel, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var items by remember { mutableStateOf<List<DriveNode>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    suspend fun load() { try { items = model.drive.trash(); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(Unit) { load() }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Recently deleted", onBack = back) }, snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        val list = items
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                list == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
                list.isNullOrEmpty() -> Empty(problem ?: "Nothing deleted. What you delete stays here for 30 days.")
                else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                    itemsIndexed(list, key = { _, n -> n.id }) { index, node ->
                        SegmentedListItem(
                            onClick = {},
                            shapes = ListItemDefaults.segmentedShapes(index, list.size),
                            colors = segmentColors(),
                            leadingContent = { Icon(kimonoIcon(iconFor(node)), null) },
                            supportingContent = { Text(detailOf(node)) },
                            trailingContent = {
                                TextButton(onClick = {
                                    scope.launch {
                                        try { model.drive.restore(node.id); load(); snackbar.showSnackbar("Put back where it was.") }
                                        catch (p: KimonoProblem) { snackbar.showSnackbar(p.message ?: "That didn't work.") }
                                    }
                                }) { Text("Restore") }
                            },
                        ) { Text(node.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Empty(text: String) {
    /* A scrollable column, so pull-to-refresh still works on an empty page. */
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 40.dp, vertical = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        item {
            Box(Modifier.size(96.dp).background(MaterialTheme.colorScheme.secondaryContainer, MaterialShapes.Cookie9Sided.toShape()), contentAlignment = Alignment.Center) {
                Icon(kimonoIcon("folder"), null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Spacer(Modifier.height(20.dp))
            Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(280.dp))
        }
    }
}
