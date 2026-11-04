@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class, ExperimentalLayoutApi::class)

package app.kimono.screens

import androidx.compose.foundation.border
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.CrestCatalogue
import app.kimono.data.KimonoProblem
import app.kimono.data.Person
import app.kimono.data.SpaceDetail
import app.kimono.data.SpaceMember
import app.kimono.ui.SvgMark
import app.kimono.ui.GroupLabel
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import kotlinx.coroutines.launch

/* Roles, as the website words them. */
private val roleOrder = listOf("owner", "editor", "viewer")
private fun roleLabel(role: String) = when (role) { "owner" -> "Owner"; "editor" -> "Can edit"; else -> "Can view" }

/**
 * A space's people and settings. Everyone sees who is in it; owners rename
 * it, change its crest, add people and set what each can do. Anyone can leave.
 */
@Composable
fun SpaceScreen(model: DriveModel, spaceId: String, me: String?, back: () -> Unit, left: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var space by remember { mutableStateOf<SpaceDetail?>(null) }
    var people by remember { mutableStateOf<Map<String, Person>>(emptyMap()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(spaceId) {
        try {
            val loaded = model.drive.space(spaceId)
            space = loaded
            name = loaded.name
            people = runCatching { model.people() }.getOrDefault(emptyList()).associateBy { it.username.lowercase() }
        } catch (p: KimonoProblem) { problem = p.message }
    }
    fun change(done: String? = null, work: suspend () -> SpaceDetail?) = scope.launch {
        try {
            val next = work()
            if (next == null) left() else { space = next; done?.let { snackbar.showSnackbar(it) } }
        } catch (p: KimonoProblem) { snackbar.showSnackbar(p.message ?: "That didn't work.") }
    }

    val here = space
    val owner = here?.role == "owner"
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = { KimonoTopBar(here?.name ?: "", onBack = back) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        when {
            here == null && problem == null -> Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
            here == null -> Box(Modifier.padding(padding).padding(24.dp)) { Problem(problem) }
            else -> LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(bottom = 48.dp)) {
                item {
                    Column(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        SvgMark(here.mark, 88.dp)
                        Spacer(Modifier.height(12.dp))
                        Text(here.name, style = MaterialTheme.typography.headlineSmall)
                        Text(if (here.memberList.size == 1) "Only you" else "${here.memberList.size} people", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (owner) {
                    item { GroupLabel("Space") }
                    item {
                        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Name") }, modifier = Modifier.weight(1f))
                                if (name.trim() != here.name && name.isNotBlank()) Seal("Save", compact = true, busy = saving, onClick = {
                                    saving = true
                                    change("Renamed.") { model.drive.editSpace(spaceId, name = name.trim()).also { saving = false } }
                                })
                            }
                            CrestPicker(model, here.crest, here.color) { crest, colour ->
                                change { model.drive.editSpace(spaceId, crest = crest.takeIf { it != here.crest }, colour = colour.takeIf { it != here.color }) }
                            }
                        }
                    }
                }
                if (owner) {
                    item { GroupLabel("Share by link") }
                    item {
                        val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
                        val current = if (here.link == null) null else here.linkAccess ?: "view"
                        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            val options = listOf(null to "Off", "view" to "Can view", "add" to "Can add")
                            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                                options.forEachIndexed { index, (access, label) ->
                                    SegmentedButton(
                                        selected = current == access,
                                        onClick = {
                                            if (current != access) change(when (access) { null -> "The link no longer works."; "view" -> "Anyone with the link can see this space."; else -> "Anyone with the link can see and add files." }) {
                                                model.drive.setSpaceLink(spaceId, access)
                                            }
                                        },
                                        shape = SegmentedButtonDefaults.itemShape(index, options.size),
                                    ) { Text(label) }
                                }
                            }
                            here.link?.let { token ->
                                val url = model.drive.spaceLinkUrl(token)
                                Text(url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Seal("Share", compact = true, onClick = { model.platform.share(url) })
                                    Seal("Copy", tone = SealTone.Quiet, compact = true, onClick = {
                                        clipboard.setText(androidx.compose.ui.text.AnnotatedString(url))
                                        scope.launch { snackbar.showSnackbar("Link copied.") }
                                    })
                                }
                            }
                        }
                    }
                }
                item { GroupLabel("People") }
                itemsIndexed(here.memberList, key = { _, m -> m.username }) { index, member ->
                    val person = people[member.username.lowercase()]
                    val isMe = member.username.equals(me, ignoreCase = true)
                    var menu by remember { mutableStateOf(false) }
                    Box(Modifier.padding(horizontal = 16.dp)) {
                        SegmentedListItem(
                            onClick = { if (owner && !isMe) menu = true },
                            shapes = ListItemDefaults.segmentedShapes(index, here.memberList.size),
                            colors = segmentColors(),
                            leadingContent = { Portrait(person?.picture, person?.name, member.username, 40.dp) },
                            supportingContent = { Text(roleLabel(member.role) + if (isMe) " · you" else "") },
                            trailingContent = if (owner && !isMe) ({ Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp)) }) else null,
                        ) { Text(person?.name ?: member.username, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = MaterialTheme.shapes.large) {
                            roleOrder.filter { it != member.role }.forEach { role ->
                                DropdownMenuItem(text = { Text(roleLabel(role)) }, onClick = {
                                    menu = false
                                    change("${person?.name ?: member.username} ${if (role == "owner") "is now an owner" else roleLabel(role).lowercase()}.") { model.drive.setMember(spaceId, member.username, role) }
                                })
                            }
                            DropdownMenuItem(text = { Text("Take out of this space", color = MaterialTheme.colorScheme.error) }, onClick = {
                                menu = false
                                change("${person?.name ?: member.username} is out of this space.") { model.drive.setMember(spaceId, member.username, null) }
                            })
                        }
                    }
                }
                if (owner) item {
                    Box(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) { Seal("Add people", tone = SealTone.Quiet, onClick = { adding = true }) }
                }
                item { GroupLabel("Leave") }
                item {
                    Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (owner) "Owners can leave once someone else is an owner too. The files stay with the space."
                            else "You'll stop seeing this space. Someone who owns it can add you back.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Seal("Leave this space", tone = SealTone.Danger, onClick = { change { model.drive.setMember(spaceId, me ?: "", null) } })
                    }
                }
            }
        }
    }
    if (adding && here != null) PeopleSheet(
        model = model,
        already = here.memberList.map { it.username.lowercase() }.toSet(),
        me = me,
        onDismiss = { adding = false },
    ) { person, role ->
        change("${person.name} ${roleLabel(role).lowercase()}.") { model.drive.setMember(spaceId, person.username, role) }
    }
}

/** The colours, then the seven crests in the chosen colour; the chosen ones ringed. */
@Composable
fun CrestPicker(model: DriveModel, crest: String, colour: String, onPick: (crest: String, colour: String) -> Unit) {
    var catalogue by remember { mutableStateOf<CrestCatalogue?>(null) }
    LaunchedEffect(Unit) { catalogue = runCatching { model.drive.crests() }.getOrNull() }
    val choices = catalogue ?: return Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) { LoadingIndicator() }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            choices.colors.forEach { each ->
                val on = each.id == colour
                Box(
                    Modifier.size(40.dp).clip(CircleShape).clickable { if (!on) onPick(crest, each.id) }
                        .then(if (on) Modifier.border(2.5.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
                        .padding(5.dp).clip(CircleShape).background(hex(each.hex)),
                )
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            choices.crests.forEach { kind ->
                val on = kind.id == crest
                Column(
                    Modifier.clip(RoundedCornerShape(16.dp)).clickable { if (!on) onPick(kind.id, colour) }.padding(6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.size(52.dp).then(if (on) Modifier.border(2.5.dp, MaterialTheme.colorScheme.primary, CircleShape) else Modifier),
                        contentAlignment = Alignment.Center,
                    ) { SvgMark(choices.mark(kind.id, colour), 44.dp) }
                    Text(kind.jp, style = MaterialTheme.typography.labelMedium, color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

private fun hex(value: String): Color = Color(0xFF000000 or value.removePrefix("#").toLong(16))

/** People with Kimono accounts who aren't in the space yet, to add with a role. */
@Composable
private fun PeopleSheet(model: DriveModel, already: Set<String>, me: String?, onDismiss: () -> Unit, onAdd: (Person, String) -> Unit) {
    /* Who was in it when the sheet opened: people added from here stay listed, ticked. */
    val before = remember { already }
    var everyone by remember { mutableStateOf<List<Person>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("viewer") }
    val added = remember { mutableStateListOf<String>() }
    LaunchedEffect(Unit) { try { everyone = model.people() } catch (p: KimonoProblem) { problem = p.message } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(horizontal = 20.dp).heightIn(min = 320.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Add people", style = MaterialTheme.typography.titleLarge)
            RolePicker(role, includeOwner = false) { role = it }
            OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Name or username") }, modifier = Modifier.fillMaxWidth())
            Problem(problem)
            val list = everyone?.filter { it.username.lowercase() !in before && !it.username.equals(me, ignoreCase = true) }
                ?.filter { search.isBlank() || it.name.contains(search, ignoreCase = true) || it.username.contains(search, ignoreCase = true) }
            when {
                everyone == null && problem == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { LoadingIndicator() }
                list.isNullOrEmpty() -> Text(
                    if (search.isBlank()) "Everyone with a Kimono account is already here." else "No one called that has a Kimono account.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 16.dp),
                )
                else -> LazyColumn(Modifier.heightIn(max = 420.dp), contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                    itemsIndexed(list, key = { _, p -> p.username }) { index, person ->
                        val done = person.username in added
                        SegmentedListItem(
                            onClick = { if (!done) { added += person.username; onAdd(person, role) } },
                            shapes = ListItemDefaults.segmentedShapes(index, list.size),
                            colors = segmentColors(),
                            leadingContent = { Portrait(person.picture, person.name, person.username, 40.dp) },
                            supportingContent = { Text(if (done) "Added" else "@${person.username}") },
                            trailingContent = { if (done) Icon(kimonoIcon("check"), null, tint = MaterialTheme.colorScheme.primary) else Icon(kimonoIcon("plus"), null) },
                        ) { Text(person.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
}

@Composable
private fun RolePicker(role: String, includeOwner: Boolean, onPick: (String) -> Unit) {
    val roles = if (includeOwner) roleOrder else roleOrder.drop(1)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        roles.forEachIndexed { index, each ->
            SegmentedButton(selected = role == each, onClick = { onPick(each) }, shape = SegmentedButtonDefaults.itemShape(index, roles.size)) { Text(roleLabel(each)) }
        }
    }
}

/** A new space: name, crest and the people it starts with, in one go. */
@Composable
fun NewSpaceSheet(model: DriveModel, me: String?, onDismiss: () -> Unit, onMade: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var crest by remember { mutableStateOf("sakura") }
    var colour by remember { mutableStateOf("plum") }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var everyone by remember { mutableStateOf<Map<String, Person>>(emptyMap()) }
    val members = remember { mutableStateListOf<SpaceMember>() }
    LaunchedEffect(Unit) { everyone = runCatching { model.people() }.getOrDefault(emptyList()).associateBy { it.username } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        LazyColumn(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 32.dp)) {
            item { Text("New space", style = MaterialTheme.typography.titleLarge) }
            item { OutlinedTextField(name, { name = it; problem = null }, singleLine = true, label = { Text("Name") }, modifier = Modifier.fillMaxWidth()) }
            item { Text("Crest", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary) }
            item { CrestPicker(model, crest, colour) { pickedCrest, pickedColour -> crest = pickedCrest; colour = pickedColour } }
            item { Text("People", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary) }
            if (members.isEmpty()) item { Text("Just you, for now. You can add people later too.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(members.toList(), key = { it.username }) { member ->
                val person = everyone[member.username]
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Portrait(person?.picture, person?.name, member.username, 36.dp)
                    Text(person?.name ?: member.username, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    TextButton(onClick = {
                        val at = members.indexOf(member)
                        members[at] = member.copy(role = if (member.role == "viewer") "editor" else "viewer")
                    }) { Text(roleLabel(member.role)) }
                    TextButton(onClick = { members.remove(member) }) { Text("Remove") }
                }
            }
            item { Seal("Add people", tone = SealTone.Quiet, compact = true, onClick = { picking = true }) }
            item { Problem(problem) }
            item {
                Seal("Make it", busy = busy, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
                    scope.launch {
                        busy = true
                        try { onMade(model.drive.createSpace(name.trim(), crest, colour, members.toList()).rootId) } catch (p: KimonoProblem) { problem = p.message }
                        busy = false
                    }
                })
            }
        }
    }
    if (picking) PeopleSheet(model, already = members.map { it.username.lowercase() }.toSet(), me = me, onDismiss = { picking = false }) { person, role ->
        members += SpaceMember(person.username, role)
    }
}
