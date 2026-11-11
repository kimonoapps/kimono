@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import app.kimono.ui.InkDialog
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkTitle
import app.kimono.ui.InkSheet
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkMenu
import androidx.compose.foundation.background
import app.kimono.ui.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import app.kimono.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.KimonoProblem
import app.kimono.data.Person
import app.kimono.data.Platform
import app.kimono.data.Sharing
import app.kimono.ui.InkLoader
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.launch

/*
 * 共 Sharing something with people beyond its space: a notebook, a note, or
 * any folder or file in Drive. One sheet, like a document's: changes apply as
 * you make them, so the only button is Done.
 */

/** What a share sheet works on: how to read and change who has it, and (for Notes) its public link. */
class ShareTarget(
    val name: String,
    val known: Sharing?,
    val load: suspend () -> Sharing,
    val set: suspend (username: String, role: String?) -> Sharing?,
    val people: suspend () -> List<Person>,
    val knownPeople: List<Person>,
    /** Turns the public link on (giving it) or off; null where there's no public link (Drive). */
    val link: (suspend (on: Boolean) -> String?)? = null,
    /** Whether you may change it, when the answer doesn't say. */
    val canEdit: Boolean = true,
)

/** "Mina", "Mina and Ren", "Mina, Ren and Aki". */
internal fun namesOf(names: List<String>): String = when (names.size) {
    0 -> ""
    1 -> names[0]
    else -> names.dropLast(1).joinToString(", ") + " and " + names.last()
}

@Composable
fun ShareSheet(target: ShareTarget, me: String?, platform: Platform, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var sharing by remember { mutableStateOf(target.known) }
    var everyone by remember { mutableStateOf(target.knownPeople) }
    var problem by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    var linkBusy by remember { mutableStateOf(false) }
    val saving = remember { mutableStateListOf<String>() }
    LaunchedEffect(Unit) {
        try { sharing = target.load() } catch (_: KimonoProblem) { problem = DIDNT_WORK }
        runCatching { target.people() }.onSuccess { everyone = it }
    }
    val byName = everyone.associateBy { it.username.lowercase() }
    fun nameOf(username: String) = byName[username.lowercase()]?.name ?: username
    val canEdit = sharing?.role?.let { it == "owner" || it == "editor" } ?: target.canEdit

    /* Each change goes at once; its row shows a loader while it saves. */
    fun change(username: String, role: String?) {
        if (username in saving) return
        saving += username
        problem = null
        scope.launch {
            try {
                val after = target.set(username, role)
                sharing = after ?: target.load()
            } catch (p: KimonoProblem) { problem = p.message ?: DIDNT_WORK }
            saving -= username
        }
    }

    InkSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            InkTitle("Share ${target.name}", icon = "share")
            val shown = sharing
            if (shown == null && problem == null) Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { InkLoader(size = 32.dp) }
            if (shown != null) {
                /* Who has it already, without being on its list. */
                if (shown.space.members > 1 && shown.space.name.isNotBlank()) Quietly("Everyone in ${shown.space.name} can see this.")
                shown.inherited.groupBy { it.via.name }.forEach { (via, people) ->
                    Quietly("${namesOf(people.map { nameOf(it.username) })} ${if (people.size == 1) "has" else "have"} it through $via.")
                }
                shown.shares.forEach { share ->
                    val person = byName[share.username.lowercase()]
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Portrait(person?.picture, person?.name, share.username, 36.dp)
                        Text(nameOf(share.username), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        if (share.username in saving) InkLoader(size = 18.dp)
                        if (canEdit) {
                            RoleSwitch(share.role) { change(share.username, it) }
                            IconButton(onClick = { change(share.username, null) }, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("close"), "Take ${nameOf(share.username)} off", modifier = Modifier.size(18.dp)) }
                        } else Text(if (share.role == "editor") "Can edit" else "Can view", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (canEdit) {
                    Text("Add people", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                    OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Name or username") }, modifier = Modifier.fillMaxWidth())
                    /* Anyone who has it already, on its list or through a folder above, isn't offered again. */
                    val taken = (shown.shares.map { it.username } + shown.inherited.map { it.username }).map { it.lowercase() }.toSet()
                    val candidates = everyone.filter { it.username.lowercase() !in taken && !it.username.equals(me, ignoreCase = true) }
                        .filter { search.isBlank() || it.name.contains(search, ignoreCase = true) || it.username.contains(search, ignoreCase = true) }
                    if (candidates.isEmpty()) Quietly(if (search.isBlank()) "Everyone already has it." else "No one called that.")
                    candidates.forEach { person ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 52.dp).background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp))
                                .clickable { change(person.username, "editor") }.padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Portrait(person.picture, person.name, person.username, 32.dp)
                            Text(person.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            if (person.username in saving) InkLoader(size = 18.dp) else Icon(kimonoIcon("plus"), "Add ${person.name}", modifier = Modifier.size(20.dp))
                        }
                    }
                }
                /* The public link, at the foot: read-only, no sign-in. */
                val link = target.link
                if (link != null && canEdit) {
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Public link", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        if (linkBusy) InkLoader(size = 18.dp)
                        JointSwitch(listOf("off" to "Off", "on" to "On"), if (shown.link != null) "on" else "off") { choice ->
                            if (linkBusy || (choice == "on") == (shown.link != null)) return@JointSwitch
                            linkBusy = true
                            problem = null
                            scope.launch {
                                try { val url = link(choice == "on"); sharing = sharing?.copy(link = url) } catch (p: KimonoProblem) { problem = p.message ?: DIDNT_WORK }
                                linkBusy = false
                            }
                        }
                    }
                    shown.link?.let { url ->
                        Text(url, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Anyone with the link can read this.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            Seal("Copy", compact = true, tone = SealTone.Quiet, onClick = { platform.share(url) })
                        }
                    }
                }
            }
            Problem(problem)
            Seal("Done", modifier = Modifier.fillMaxWidth(), onClick = onDismiss)
        }
    }
}

@Composable
private fun Quietly(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

/** Edit or view: a joint switch. */
@Composable
private fun RoleSwitch(role: String, onPick: (String) -> Unit) = JointSwitch(listOf("editor" to "Edit", "viewer" to "View"), role, onPick)

@Composable
private fun JointSwitch(options: List<Pair<String, String>>, chosen: String, onPick: (String) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.width(140.dp)) {
        options.forEachIndexed { index, (value, label) ->
            SegmentedButton(selected = chosen == value, onClick = { onPick(value) }, shape = SegmentedButtonDefaults.itemShape(index, options.size), icon = {}) {
                Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1)
            }
        }
    }
}
