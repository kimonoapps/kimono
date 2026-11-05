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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.runtime.mutableStateListOf
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
import app.kimono.ui.InkProgress
import app.kimono.ui.CodeView
import app.kimono.ui.FileTypeMark
import app.kimono.ui.Urushi
import app.kimono.ui.codeLanguage
import app.kimono.ui.fileMarkUri
import app.kimono.ui.readsAsText
import kotlinx.io.buffered
import kotlinx.io.readByteArray
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SwipeRow
import app.kimono.ui.kimonoIcon
import app.kimono.ui.InkBloom
import app.kimono.ui.InkCrest
import app.kimono.ui.segmentColors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import app.kimono.ui.InkLoader
import app.kimono.ui.InkBlot

/**
 * Drive's state that outlives a screen: uploads keep going while you move
 * between folders (and, where the OS allows, after the app closes), and an
 * open folder reloads when one lands.
 */
class DriveModel(val drive: Drive, val platform: Platform) {
    private val scope = CoroutineScope(SupervisorJob())
    val uploads: Uploads = platform.uploads ?: InAppUploads(drive)
    /** Goes up whenever an upload finishes, so open folders reload. */
    var landed by mutableStateOf(0)
    /** Everyone with a Kimono account: asked afresh each time, the last answer standing in when offline. */
    suspend fun people(): List<app.kimono.data.Person> =
        try { drive.people() } catch (p: app.kimono.data.KimonoProblem) { drive.knownPeople() ?: throw p }

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
    var spaces by remember { mutableStateOf(model.drive.knownSpaces()) }
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
        topBar = { KimonoTopBar("Drive", mark = { model.drive.driveBloom.collectAsState().value?.let { InkBloom(it.id, it.accent, it.glyph, 32.dp) } }) },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { naming = true }, icon = { Icon(kimonoIcon("plus"), null) }, text = { Text("New space") }, containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer)
        },
    ) { padding ->
        KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.padding(padding).fillMaxSize()) {
            val list = spaces
            when {
                list == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                list.isNullOrEmpty() -> Empty(problem ?: "Spaces hold your files. Make one, or ask someone to add you to theirs.")
                else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                    itemsIndexed(list, key = { _, s -> s.id }) { index, space ->
                        SegmentedListItem(
                            onClick = { open("folder/${space.rootId}") },
                            onLongClick = { open("space/${space.id}") },
                            shapes = ListItemDefaults.segmentedShapes(index, list.size),
                            colors = segmentColors(),
                            leadingContent = { InkCrest(space.crest, space.color, 44.dp) },
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
    var folder by remember { mutableStateOf(model.drive.knownFolder(folderId)) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<DriveNode?>(null) }
    var opening by remember { mutableStateOf<Pair<DriveNode, Long>?>(null) }
    /* A text or code file Kimono shows itself: the file, where it was saved, and its opening. */
    var reading by remember { mutableStateOf<Triple<DriveNode, String, String>?>(null) }
    val knownSpace = remember { folder?.let { f -> model.drive.knownSpaces()?.firstOrNull { it.id == f.folder.spaceId } } }
    var canEdit by remember { mutableStateOf(knownSpace?.role != "viewer") }
    /* The space's crest stays beside the name, however deep in it you go. */
    var crest by remember { mutableStateOf(knownSpace?.let { it.crest to it.color }) }
    /* Long-press picks things; while any are picked, a tap adds or drops one. */
    val selected = remember { mutableStateListOf<String>() }
    var acting by remember { mutableStateOf<DriveNode?>(null) }
    var moving by remember { mutableStateOf<List<DriveNode>?>(null) }
    val haptics = LocalHapticFeedback.current

    suspend fun load() {
        try {
            val loaded = model.drive.folder(folderId)
            folder = loaded
            problem = null
            selected.retainAll(loaded.children.map { it.id }.toSet())
            val space = model.drive.spaces().firstOrNull { it.id == loaded.folder.spaceId }
            canEdit = space?.role != "viewer"
            crest = space?.let { it.crest to it.color }
        } catch (p: KimonoProblem) { problem = p.message }
    }
    fun act(done: String? = null, work: suspend () -> Unit) = scope.launch {
        try { work(); load(); done?.let { snackbar.showSnackbar(it) } } catch (p: KimonoProblem) { load(); snackbar.showSnackbar(p.message ?: "That didn't work.") }
    }
    fun openFile(node: DriveNode): kotlinx.coroutines.Job = scope.launch {
        opening = node to 0L
        try {
            val path = model.drive.download(node, platform.cacheDir()) { opening = node to it }
            val text = if (readsAsText(node.name, node.mime)) readText(path) else null
            if (text != null) reading = Triple(node, path, text) else platform.openFile(path, node.mime)
        } catch (p: KimonoProblem) {
            opening = null
            /* What arrived is kept, so trying again carries on from there. */
            if (snackbar.showSnackbar(p.message ?: "That file couldn't be opened.", actionLabel = "Try again") == SnackbarResult.ActionPerformed) openFile(node)
        }
        opening = null
    }
    fun count(n: Int, one: String) = if (n == 1) "1 $one" else "$n ${one}s"
    fun trash(nodes: List<DriveNode>) = act("${count(nodes.size, "item")} moved to Recently deleted.") {
        nodes.forEach { model.drive.moveToTrash(it.id) }
        selected.clear()
    }
    fun shareLinks(nodes: List<DriveNode>) = act { platform.share(nodes.filter { !it.isFolder }.map { model.drive.link(it.id) }.joinToString("\n")) }
    LaunchedEffect(folderId, model.landed) { load() }

    val here = folder
    val picked = here?.children.orEmpty().filter { it.id in selected }
    val selecting = selected.isNotEmpty()
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            if (selecting) TopAppBar(
                title = { Text("${selected.size} selected", style = MaterialTheme.typography.titleLarge) },
                navigationIcon = { IconButton(onClick = { selected.clear() }) { Icon(kimonoIcon("close"), "Stop selecting") } },
                actions = {
                    val all = here?.children.orEmpty()
                    if (selected.size < all.size) TextButton(onClick = { selected.clear(); selected.addAll(all.map { it.id }) }) { Text("Select all") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
            ) else KimonoTopBar(here?.folder?.name ?: "", onBack = back, mark = crest?.let { { InkCrest(it.first, it.second, 30.dp) } }) {
                /* Wherever you are in a space: who's in it, what each can do, and its settings. */
                if (here != null) IconButton(onClick = { open("space/${here.folder.spaceId}") }) { Icon(kimonoIcon("person"), "People and settings") }
            }
        },
        bottomBar = {
            if (selecting) Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                    if (canEdit) BarAction("Move", "move") { moving = picked }
                    if (canEdit && picked.any { !it.isFolder }) BarAction("Share", "share") { shareLinks(picked) }
                    if (canEdit) BarAction("Trash", "trash", danger = true) { trash(picked) }
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            if (canEdit && here != null && !selecting) ExtendedFloatingActionButton(onClick = { adding = true }, icon = { Icon(kimonoIcon("plus"), null) }, text = { Text("Add") }, containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer)
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            val uploads by model.uploads.statuses.collectAsState()
            uploads.filter { it.folderId == folderId || it.failed != null }.forEach { task -> UploadRow(task, retry = { model.uploads.retry(task.id) }) { model.uploads.dismiss(task.id) } }
            KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                val children = here?.children
                when {
                    here == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                    children.isNullOrEmpty() -> Empty(problem ?: if (canEdit) "Nothing here yet. Add files with the button below." else "Nothing here yet.")
                    else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                        itemsIndexed(children, key = { _, n -> n.id }) { index, node ->
                            val isPicked = node.id in selected
                            val row = @Composable {
                                NodeRow(
                                    node = node,
                                    thumbnail = { pixels -> platform.thumbnail(node, pixels) },
                                    index = index,
                                    count = children.size,
                                    busy = opening?.first?.id == node.id,
                                    progress = opening?.takeIf { it.first.id == node.id }?.let { if (node.size > 0) it.second.toFloat() / node.size else null },
                                    selecting = selecting,
                                    selected = isPicked,
                                    onClick = {
                                        when {
                                            selecting -> if (isPicked) selected.remove(node.id) else selected.add(node.id)
                                            node.isFolder -> open("folder/${node.id}")
                                            else -> openFile(node)
                                        }
                                    },
                                    onLongClick = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); if (!isPicked) selected.add(node.id) },
                                    onMore = { acting = node },
                                )
                            }
                            if (canEdit && !selecting) SwipeRow("Move to trash", onAction = {
                                try { model.drive.moveToTrash(node.id); load(); snackbar.showSnackbar("Moved to Recently deleted."); true }
                                catch (p: KimonoProblem) { snackbar.showSnackbar(p.message ?: "That didn't work."); false }
                            }) { row() } else row()
                        }
                    }
                }
            }
        }
    }

    acting?.let { node ->
        ItemSheet(
            node = node,
            thumbnail = { pixels -> platform.thumbnail(node, pixels) },
            choices = buildList {
                if (!node.isFolder) add(NodeChoice("Open", "file") { openFile(node) })
                if (canEdit && !node.isFolder) add(NodeChoice("Share link", "share") { shareLinks(listOf(node)) })
                if (!node.isFolder && (canEdit || node.link != null)) add(NodeChoice(if (node.link == null) "Copy public link" else "Copy link", "link") {
                    act(if (node.link == null) "Link copied. Anyone with it can open the file." else "Link copied.") { clipboard.setText(AnnotatedString(model.drive.link(node.id))) }
                })
                if (canEdit && node.link != null) add(NodeChoice("Turn off public link", "close") { act("The link no longer works.") { model.drive.unlink(node.id) } })
                if (canEdit) add(NodeChoice("Rename", "edit") { renaming = node })
                if (canEdit) add(NodeChoice("Move to…", "move") { moving = listOf(node) })
                add(NodeChoice("Select", "select") { selected.add(node.id) })
                if (canEdit) add(NodeChoice("Move to trash", "trash", danger = true) { trash(listOf(node)) })
            },
            onDismiss = { acting = null },
        )
    }
    moving?.let { nodes ->
        if (here != null) MovePicker(model, platform, nodes, start = here.folder.id, onDismiss = { moving = null }) { target ->
            act("${count(nodes.size, "item")} moved.") {
                nodes.forEach { model.drive.move(it.id, target) }
                selected.clear()
            }
            moving = null
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
    reading?.let { (node, path, text) ->
        TextReader(node, text, onOpenElsewhere = { platform.openFile(path, node.mime) }, onClose = { reading = null })
    }
    renaming?.let { node ->
        NameDialog(title = "Rename", action = "Rename", initial = node.name, onDismiss = { renaming = null }) { name ->
            model.drive.rename(node.id, name)
            load()
            renaming = null
        }
    }
}

/** Up to 256 KB of a downloaded file as text, or null when it isn't text after all. */
private fun readText(path: String): String? = runCatching {
    val file = kotlinx.io.files.Path(path)
    val size = kotlinx.io.files.SystemFileSystem.metadataOrNull(file)?.size ?: return null
    val bytes = kotlinx.io.files.SystemFileSystem.source(file).buffered().use { it.readByteArray(minOf(size, 256L * 1024).toInt()) }
    if (bytes.any { it == 0.toByte() }) return null
    bytes.decodeToString().let { if (size > bytes.size) it.substringBeforeLast('\n') else it }
}.getOrNull()

/** A text or code file, read in Kimono: numbered and coloured, with a way to open it in another app. */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
private fun TextReader(node: DriveNode, text: String, onOpenElsewhere: () -> Unit, onClose: () -> Unit) {
    /* Over the folder, edge to edge; back closes it rather than leaving the folder. */
    androidx.compose.ui.backhandler.BackHandler(onBack = onClose)
    run {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = Urushi,
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(node.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(codeLanguage(node.name), readableSize(node.size)).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                    navigationIcon = { IconButton(onClick = onClose) { Icon(kimonoIcon("close"), "Close") } },
                    actions = { IconButton(onClick = onOpenElsewhere) { Icon(kimonoIcon("share"), "Open in another app") } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                )
            },
        ) { padding -> CodeView(text, node.name, Modifier.padding(padding).fillMaxSize()) }
    }
}

class NodeChoice(val label: String, val icon: String, val danger: Boolean = false, val onClick: () -> Unit)

@Composable
private fun BarAction(label: String, icon: String, danger: Boolean = false, onClick: () -> Unit) {
    val tint = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    Column(
        Modifier.clip(RoundedCornerShape(16.dp)).combinedClickable(onClick = onClick).padding(horizontal = 18.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Icon(kimonoIcon(icon), null, tint = tint, modifier = Modifier.size(22.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = tint)
    }
}

/** A file or folder's picture: its thumbnail once one is ready, its icon until then. */
@Composable
private fun NodeIcon(node: DriveNode, thumbnail: suspend (Int) -> String?, size: androidx.compose.ui.unit.Dp = 40.dp, busy: Boolean = false) {
    val pixels = with(LocalDensity.current) { size.roundToPx() }
    val picture by produceState<String?>(null, node.id, node.contentVersion) {
        if (node.mayHaveThumbnail) value = runCatching { thumbnail(pixels) }.getOrNull()
    }
    /* A file with a type mark (TypeScript, Android, Excel…) sits on paper, like the website's rows. */
    val marked = !node.isFolder && picture == null && !busy && remember(node.name) { fileMarkUri(node.name) != null }
    val shape = RoundedCornerShape(if (node.isFolder || marked) size * .3f else size / 2)
    Box(
        Modifier.size(size)
            .background(if (node.isFolder) MaterialTheme.colorScheme.secondaryContainer else if (marked) MaterialTheme.colorScheme.surfaceContainerLowest else MaterialTheme.colorScheme.tertiaryContainer, shape)
            .then(if (marked) Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) InkLoader(size = size * .7f)
        else if (picture != null) AsyncImage(
            model = "file://$picture",
            contentDescription = null,
            contentScale = ContentScale.Crop,
            /* A page reads from its top; a photo from its middle. */
            alignment = if (node.name.endsWith(".pdf", ignoreCase = true) || node.mime == "application/pdf") Alignment.TopCenter else Alignment.Center,
            modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(size * .3f)).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(size * .3f)),
        )
        else {
            val plain = @Composable { Icon(kimonoIcon(iconFor(node)), null, modifier = Modifier.size(size / 2), tint = if (node.isFolder) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onTertiaryContainer) }
            if (node.isFolder) plain() else FileTypeMark(node.name, Modifier.size(size * .58f), fallback = plain)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NodeRow(
    node: DriveNode, thumbnail: suspend (Int) -> String?, index: Int, count: Int, busy: Boolean, progress: Float?,
    selecting: Boolean, selected: Boolean, enabled: Boolean = true,
    onClick: () -> Unit, onLongClick: (() -> Unit)?, onMore: (() -> Unit)?,
) {
    SegmentedListItem(
        onClick = onClick,
        onLongClick = onLongClick,
        enabled = enabled,
        shapes = ListItemDefaults.segmentedShapes(index, count),
        colors = if (selected) ListItemDefaults.segmentedColors(containerColor = MaterialTheme.colorScheme.secondaryContainer) else segmentColors(),
        leadingContent = {
            Box {
                NodeIcon(node, thumbnail, busy = busy)
                if (selected) Box(Modifier.size(40.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                    Icon(kimonoIcon("check"), "Selected", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(22.dp))
                }
            }
        },
        supportingContent = {
            Column {
                Text(detailOf(node), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (progress != null) InkProgress(progress = { progress }, modifier = Modifier.padding(top = 6.dp).fillMaxWidth())
            }
        },
        trailingContent = when {
            selecting -> null
            onMore != null -> ({ IconButton(onClick = onMore) { Icon(kimonoIcon("more"), "More for ${node.name}") } })
            node.isFolder -> ({ Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp)) })
            else -> null
        },
    ) { Text(node.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis) }
}

/** Everything you can do with one file or folder, under its picture and name. */
@Composable
private fun ItemSheet(node: DriveNode, thumbnail: suspend (Int) -> String?, choices: List<NodeChoice>, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 32.dp)) {
            Row(Modifier.padding(start = 4.dp, bottom = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                NodeIcon(node, thumbnail, size = 56.dp)
                Column(Modifier.weight(1f)) {
                    Text(node.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(detailOf(node), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                choices.forEachIndexed { index, choice ->
                    val tint = if (choice.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
                    SegmentedListItem(
                        onClick = { onDismiss(); choice.onClick() },
                        shapes = ListItemDefaults.segmentedShapes(index, choices.size),
                        colors = ListItemDefaults.segmentedColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
                        leadingContent = { Icon(kimonoIcon(choice.icon), null, tint = tint) },
                    ) { Text(choice.label, style = MaterialTheme.typography.bodyLarge, color = tint) }
                }
            }
        }
    }
}

/**
 * Where to move things: the space's folders as the folder view shows them,
 * opened the same way, with Move here at the bottom. What's being moved
 * can't be opened, so a folder can't go inside itself.
 */
@Composable
private fun MovePicker(model: DriveModel, platform: Platform, moving: List<DriveNode>, start: String, onDismiss: () -> Unit, onMove: (String) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var at by remember { mutableStateOf(start) }
    var folder by remember { mutableStateOf<DriveFolder?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var naming by remember { mutableStateOf(false) }
    suspend fun load() {
        try { folder = model.drive.folder(at); problem = null } catch (p: KimonoProblem) { problem = p.message }
    }
    LaunchedEffect(at) { folder = model.drive.knownFolder(at); load() }
    val movingIds = moving.map { it.id }.toSet()
    val alreadyHere = moving.all { it.parentId == at }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.88f)) {
            val here = folder
            Row(Modifier.padding(horizontal = 8.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                val parent = here?.path?.lastOrNull()
                if (parent != null) IconButton(onClick = { at = parent.id }) { Icon(kimonoIcon("back"), "Up to ${parent.name}") } else Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (moving.size == 1) "Move “${moving[0].name}”" else "Move ${moving.size} items", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(here?.folder?.name ?: "", style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { naming = true }) { Icon(kimonoIcon("plus"), "New folder") }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                val children = here?.children
                when {
                    here == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                    children.isNullOrEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                        Text(problem ?: "No folders here. Move things here, or make a new folder.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                        itemsIndexed(children, key = { _, n -> n.id }) { index, node ->
                            /* Folders open; files and what's being moved are shown but stay put. */
                            val opens = node.isFolder && node.id !in movingIds
                            NodeRow(
                                node = node, thumbnail = { pixels -> platform.thumbnail(node, pixels) }, index = index, count = children.size,
                                busy = false, progress = null, selecting = false, selected = false, enabled = opens,
                                onClick = { if (opens) at = node.id }, onLongClick = null, onMore = null,
                            )
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Spacer(Modifier.weight(1f))
                Seal(if (alreadyHere) "Already here" else "Move here", enabled = here != null && !alreadyHere, onClick = { onMove(at) })
            }
        }
    }
    if (naming) NameDialog(title = "New folder", action = "Make it", initial = "", onDismiss = { naming = false }) { name ->
        val made = model.drive.createFolder(at, name)
        naming = false
        at = made.id
        scope.launch { load() }
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
                InkProgress(progress = { share }, modifier = Modifier.fillMaxWidth())
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
    var items by remember { mutableStateOf(model.drive.knownTrash()) }
    var problem by remember { mutableStateOf<String?>(null) }
    suspend fun load() { try { items = model.drive.trash(); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(Unit) { load() }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Recently deleted", onBack = back) }, snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        val list = items
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                list == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
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
            InkBlot("drive-empty", size = 96.dp) {
                Icon(kimonoIcon("folder"), null, modifier = Modifier.size(40.dp), tint = app.kimono.theme.Kata.plum)
            }
            Spacer(Modifier.height(20.dp))
            Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(280.dp))
        }
    }
}
