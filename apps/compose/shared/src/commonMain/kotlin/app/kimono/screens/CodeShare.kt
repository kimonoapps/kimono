@file:OptIn(ExperimentalMaterial3Api::class)

package app.kimono.screens

import app.kimono.ui.InkDialog
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkTitle
import app.kimono.ui.InkSheet
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkMenu
import app.kimono.ui.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import app.kimono.ui.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.ArtifactSharing
import app.kimono.data.ChatSharing
import app.kimono.data.Code
import app.kimono.data.CodeWorkspace
import app.kimono.data.KimonoProblem
import app.kimono.data.Person
import app.kimono.data.Platform
import app.kimono.theme.Kata
import app.kimono.ui.InkLoader
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * Sharing in Kimono AI (docs/kimono-ai.md, "Sharing"): a chat with people in
 * the household, to read or to write in, or by its link; an artifact by a
 * link of its own, for the people it's shared with or for anyone.
 */

/** Everyone with a Kimono account, by lowercased username: names and faces for usernames. */
@Composable
internal fun rememberPeople(code: Code): Map<String, Person> {
    val people by produceState(code.knownPeople().orEmpty()) { value = runCatching { code.people() }.getOrDefault(value) }
    return remember(people) { people.associateBy { it.username.lowercase() } }
}

internal fun Map<String, Person>.nameOf(username: String) = this[username.lowercase()]?.name ?: username

/** A link copied: says so for a moment. */
@Composable
private fun rememberCopied(): Pair<Boolean, (String) -> Unit> {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1600); copied = false } }
    return copied to { url -> clipboard.setText(AnnotatedString(url)); copied = true }
}

/** One person: their face, name, a word under it, and what can be done about them. */
@Composable
private fun PersonRow(person: Person?, username: String, note: String, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Portrait(person?.picture, person?.name, username, 40.dp)
        Column(Modifier.weight(1f)) {
            Text(person?.name ?: username, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        trailing()
    }
}

/** Finding someone in the household to share with, by name or username. */
@Composable
private fun PeopleFinder(people: Map<String, Person>, leave: Set<String>, pick: (Person) -> Unit) {
    var find by remember { mutableStateOf("") }
    val words = find.trim().lowercase().removePrefix("@")
    val found = if (words.isEmpty()) emptyList() else people.values
        .filter { it.username.lowercase() !in leave && (it.name.lowercase().contains(words) || it.username.lowercase().contains(words)) }
        .sortedBy { it.name.lowercase() }.take(6)
    Column {
        OutlinedTextField(
            find, { find = it }, placeholder = { Text("Add people") }, singleLine = true,
            leadingIcon = { Icon(kimonoIcon("search"), null, modifier = Modifier.size(18.dp)) },
            shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
        )
        if (words.isNotEmpty()) Column(Modifier.padding(top = 4.dp)) {
            found.forEach { p ->
                Box(Modifier.clip(RoundedCornerShape(14.dp)).clickable { find = ""; pick(p) }.padding(horizontal = 4.dp)) {
                    PersonRow(p, p.username, "@${p.username}")
                }
            }
            if (found.isEmpty()) Text("No one by that name.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp))
        }
    }
}

/** A quiet chip that opens a menu: what someone may do. */
@Composable
private fun CanChip(label: String, content: @Composable (close: () -> Unit) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Surface(onClick = { open = true }, shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Row(Modifier.padding(start = 12.dp, end = 8.dp, top = 7.dp, bottom = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(label, style = MaterialTheme.typography.labelLarge)
                Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(14.dp))
            }
        }
        InkMenu(expanded = open, onDismissRequest = { open = false }) { content { open = false } }
    }
}

/** The lock or the link, in an ink disc: whether the link opens it. */
@Composable
private fun LinkMark(open: Boolean) {
    Surface(shape = CircleShape, color = if (open) Kata.moss.copy(alpha = .18f) else MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.size(40.dp)) {
        Box(contentAlignment = Alignment.Center) { Icon(kimonoIcon(if (open) "link" else "lock"), null, modifier = Modifier.size(18.dp), tint = if (open) Kata.moss else MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun ShareSheet(title: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    InkSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            InkTitle("Share “$title”", icon = "share")
            content()
        }
    }
}

private val generalWords = mapOf("off" to "Only people invited", "read" to "Anyone with the link can view", "edit" to "Anyone can view, signed-in people can write")
/* With public links switched off, a link opens only for people signed in to this Kimono. */
private val signedInWords = mapOf("off" to "Only people invited", "read" to "People in this Kimono with the link can view", "edit" to "People in this Kimono with the link can write")
private val canWords = mapOf("read" to "Can view", "edit" to "Can write")

/** Sharing a chat: the people invited and what each may do, who the link is for, and the link. */
@Composable
internal fun ChatShareSheet(code: Code, platform: Platform, w: CodeWorkspace, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val people = rememberPeople(code)
    var sharing by remember { mutableStateOf<ChatSharing?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val (copied, copy) = rememberCopied()
    LaunchedEffect(w.id) { try { sharing = code.chatSharing(w.id) } catch (p: KimonoProblem) { problem = p.message } }
    fun change(work: suspend () -> ChatSharing) { problem = null; scope.launch { try { sharing = work() } catch (p: KimonoProblem) { problem = p.message } } }
    val owner = w.owner.ifEmpty { code.me ?: "" }
    ShareSheet(w.title, onDismiss) {
        val s = sharing
        if (s == null) { if (problem == null) Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { InkLoader() } }
        else {
            PeopleFinder(people, s.people.map { it.username.lowercase() }.toSet() + owner.lowercase()) { p -> change { code.shareChat(w.id, p.username, "read") } }
            Column {
                PersonRow(people[owner.lowercase()], owner, "Owner")
                s.people.forEach { invite ->
                    PersonRow(people[invite.username.lowercase()], invite.username, "@${invite.username}") {
                        CanChip(canWords[invite.access] ?: "Can view") { close ->
                            canWords.forEach { (access, word) ->
                                InkMenuItem(word, chosen = access == invite.access, onClick = { close(); if (access != invite.access) change { code.shareChat(w.id, invite.username, access) } })
                            }
                            HorizontalDivider()
                            InkMenuItem("Remove", danger = true, onClick = { close(); change { code.shareChat(w.id, invite.username, null) } })
                        }
                    }
                }
            }
            Text("General access", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 4.dp))
            val general = s.link?.access ?: "off"
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LinkMark(general != "off")
                Box(Modifier.weight(1f)) {
                    val words = if (s.publicLinks) generalWords else signedInWords
                    Picker("Who can open it", words.getValue(general), words.map { (v, word) -> Option(v, word) }) { next ->
                        if (next != general) change { code.setChatLink(w.id, next.takeIf { it != "off" }) }
                    }
                }
            }
            if (s.people.any { it.access == "edit" } || s.link?.access == "edit") Text("Someone who can write uses your files and apps.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            /* With the link off, the address still opens it for the people invited. */
            val url = s.link?.let { code.chatLink(it.token) } ?: "${code.server}/code#w=${w.id}"
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Seal(if (copied) "Copied" else "Copy link", compact = true, tone = SealTone.Quiet, onClick = { copy(url) })
                Seal("Share", compact = true, onClick = { platform.share(url) })
            }
        }
        Problem(problem)
    }
}

/** Sharing an artifact: who it's shared with, whether anyone with the link can open it, and the link. */
@Composable
internal fun ArtifactShareSheet(code: Code, platform: Platform, workspaceId: String, name: String, title: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val people = rememberPeople(code)
    var sharing by remember { mutableStateOf<ArtifactSharing?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val (copied, copy) = rememberCopied()
    LaunchedEffect(workspaceId, name) { try { sharing = code.artifactSharing(workspaceId, name) } catch (p: KimonoProblem) { problem = p.message } }
    suspend fun change(work: suspend () -> ArtifactSharing): ArtifactSharing? { problem = null; return try { work().also { sharing = it } } catch (p: KimonoProblem) { problem = p.message; null } }
    /* The link exists once it's first shared; copying or sharing before that makes it, for the people it's shared with. */
    fun withLink(then: (String) -> Unit) = scope.launch {
        val token = sharing?.token ?: change { code.setArtifactPublic(workspaceId, name, sharing?.public ?: false) }?.token
        if (token != null) then(code.artifactLink(token))
    }
    ShareSheet(title, onDismiss) {
        val s = sharing
        if (s == null) { if (problem == null) Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { InkLoader() } }
        else {
            val on = s.people.map { it.lowercase() }.toSet()
            val me = code.me?.lowercase()
            /* Everyone but the owner, the ones it's shared with first. */
            val everyone = people.values.filter { it.username.lowercase() != me }.sortedWith(compareBy({ it.username.lowercase() !in on }, { it.name.lowercase() }))
            Column {
                everyone.forEach { p ->
                    val shared = p.username.lowercase() in on
                    PersonRow(p, p.username, "@${p.username}") {
                        Switch(shared, { next -> scope.launch { change { code.shareArtifact(workspaceId, name, p.username, next) } } })
                    }
                }
            }
            /* Public links switched off: no making it public (one made public before can still be closed). */
            if (s.publicLinks || s.public) Text("General access", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 4.dp))
            if (s.publicLinks || s.public) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LinkMark(s.public)
                Column(Modifier.weight(1f)) {
                    Text("Anyone with the link", style = MaterialTheme.typography.bodyLarge)
                    Text(if (s.public) "Can view, without signing in" else "Only the people it’s shared with", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(s.public, { next -> scope.launch { change { code.setArtifactPublic(workspaceId, name, next) } } })
            }
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Seal(if (copied) "Copied" else "Copy link", compact = true, tone = SealTone.Quiet, onClick = { withLink(copy) })
                Seal("Share", compact = true, onClick = { withLink { platform.share(it) } })
            }
        }
        Problem(problem)
    }
}
