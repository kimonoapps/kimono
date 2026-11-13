@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class, ExperimentalLayoutApi::class)

package app.kimono.screens

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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.FriendPerson
import app.kimono.data.Friends
import app.kimono.data.FriendsList
import app.kimono.data.KimonoProblem
import app.kimono.data.KimonoProfile
import app.kimono.data.Recommendation
import app.kimono.data.ShareItem
import app.kimono.theme.Kata
import app.kimono.theme.plumInk
import app.kimono.ui.GroupLabel
import app.kimono.ui.HoldMenu
import app.kimono.ui.InkBlot
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkDialog
import app.kimono.ui.InkLoader
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.MenuChoice
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * 友 Friends, profiles and recommendations (apps/portal/src/lib/friends has
 * the rules); the website's You › Friends has the same pages.
 */

private fun FriendPerson.first() = (name.ifBlank { username }).substringBefore(' ')

/** Rows of people, as a grouped list: a portrait, a name, a line under it, and what you can do. */
@Composable
private fun PeopleGroup(people: List<FriendPerson>, detail: (FriendPerson) -> String?, onOpen: ((FriendPerson) -> Unit)? = null, trailing: (@Composable (FriendPerson) -> Unit)? = null) {
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
        people.forEachIndexed { index, p ->
            SegmentedListItem(
                onClick = { onOpen?.invoke(p) },
                shapes = ListItemDefaults.segmentedShapes(index, people.size),
                colors = segmentColors(),
                leadingContent = { Portrait(p.picture, p.name, p.username, 44.dp) },
                supportingContent = detail(p)?.let { { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
                trailingContent = trailing?.let { { it(p) } } ?: if (onOpen != null) ({ Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp)) }) else null,
            ) { Text(p.name.ifBlank { p.username }, style = MaterialTheme.typography.bodyLarge) }
        }
    }
}

/** A title's cover, or its first letter in Mincho when it has none. */
@Composable
private fun Cover(item: ShareItem, modifier: Modifier = Modifier) {
    Box(modifier.aspectRatio(2f / 3f).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
        if (item.cover != null) AsyncImage(model = item.cover, contentDescription = item.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text(item.title.take(1), style = MaterialTheme.typography.headlineMedium, color = Kata.plum)
    }
}

/** A shelf of covers that scrolls sideways; each can say more under it. */
@Composable
private fun <T> Shelf(items: List<T>, key: (T) -> String, item: (T) -> ShareItem, menu: (T) -> List<MenuChoice>, drop: ((T) -> Unit)? = null, under: @Composable (T) -> Unit = {}) {
    LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        items(items, key = key) { entry ->
            val shown = item(entry)
            Column(Modifier.width(120.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Box {
                    HoldMenu(menu(entry), onClick = { menu(entry).firstOrNull()?.onClick?.invoke() }) { Cover(shown, Modifier.fillMaxWidth()) }
                    /* On your own profile: one tap takes it off the row. */
                    if (drop != null) Box(
                        Modifier.padding(6.dp).size(34.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface.copy(alpha = .88f))
                            .clickable { drop(entry) }.semantics { contentDescription = "Take ${shown.title} off" },
                        contentAlignment = Alignment.Center,
                    ) { Icon(kimonoIcon("close"), null, tint = Kata.plum, modifier = Modifier.size(18.dp)) }
                }
                Text(shown.title, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                shown.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
                under(entry)
            }
        }
    }
}

@Composable
fun FriendsScreen(friends: Friends, open: (String) -> Unit, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf(friends.known()) }
    var received by remember { mutableStateOf<List<Recommendation>>(emptyList()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<FriendPerson>>(emptyList()) }
    var recommending by remember { mutableStateOf<ShareItem?>(null) }
    suspend fun load() {
        try { list = friends.list(); received = friends.recommendations().received; problem = null } catch (p: KimonoProblem) { problem = p.message }
    }
    LaunchedEffect(Unit) { load() }
    LaunchedEffect(typed) {
        if (typed.trim().length < 2) { found = emptyList(); return@LaunchedEffect }
        delay(200)
        found = runCatching { friends.find(typed) }.getOrDefault(emptyList())
    }
    fun change(type: String, username: String) = scope.launch {
        try { friends.change(type, username); if (type == "ask") typed = ""; load() } catch (p: KimonoProblem) { problem = p.message }
    }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Friends", onBack = back) }) { padding ->
        KimonoRefresh(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, modifier = Modifier.padding(padding).fillMaxSize()) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Box(Modifier.padding(horizontal = 16.dp)) { Problem(problem) }
                val now: FriendsList? = list
                if (now == null && problem == null) Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { InkLoader() }
                if (now != null && now.asked.isNotEmpty()) {
                    GroupLabel("Asked to be friends")
                    PeopleGroup(now.asked, { "@${it.username}" }) { p ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Seal("Not now", compact = true, tone = SealTone.Quiet, onClick = { change("no", p.username) })
                            Seal("Accept", compact = true, onClick = { change("yes", p.username) })
                        }
                    }
                }
                if (received.isNotEmpty()) {
                    GroupLabel("For you")
                    Shelf(received, { it.id }, { it.item }, { r ->
                        listOf(
                            MenuChoice("Recommend to others") { recommending = r.item },
                            MenuChoice("Put away") { scope.launch { runCatching { friends.drop(r.id) }; received = received.filter { it.id != r.id } } },
                        )
                    }) { r ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Portrait(r.from.picture, r.from.name, r.from.username, 20.dp)
                            Text(r.from.first(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (!r.seen) Box(Modifier.size(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
                        }
                        r.note?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall, maxLines = 4, overflow = TextOverflow.Ellipsis) }
                    }
                }
                GroupLabel("Your friends")
                if (now != null) {
                    if (now.friends.isEmpty()) Text("No friends yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 28.dp))
                    else PeopleGroup(now.friends, { it.bio.ifBlank { "@${it.username}" } }, onOpen = { open("people/${it.username}") })
                }
                GroupLabel("Add friends")
                OutlinedTextField(
                    typed, { typed = it }, placeholder = { Text("Name") }, singleLine = true, colors = kataFieldColors(),
                    leadingIcon = { Icon(kimonoIcon("search"), null, modifier = Modifier.size(20.dp)) },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                )
                Spacer(Modifier.height(8.dp))
                val asking = now?.asking ?: emptyList()
                if (typed.trim().length >= 2 && found.isNotEmpty()) PeopleGroup(found, { "@${it.username}" }) { p -> Seal("Ask", compact = true, onClick = { change("ask", p.username) }) }
                if (asking.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    PeopleGroup(asking, { "Asked" }) { p -> Seal("Take back", compact = true, tone = SealTone.Quiet, onClick = { change("remove", p.username) }) }
                }
                Spacer(Modifier.height(32.dp))
            }
        }
    }
    recommending?.let { item -> RecommendDialog(friends, item, onDismiss = { recommending = null }) }
}

/**
 * What makes a profile the You screen: your portrait with its camera, renaming in place,
 * and a gear to Settings.
 */
class OwnProfile(
    val portrait: @Composable () -> Unit,
    val rename: suspend (String) -> Unit,
    val settings: () -> Unit,
)

/**
 * A profile as friends see it. Your own is also where you change it, in place: the bio (and with [own],
 * the portrait and name) are edited where they stand. With [own] and no [back], it's the You screen.
 */
@Composable
fun ProfileScreen(friends: Friends, username: String, still: Boolean = false, open: (String) -> Unit, own: OwnProfile? = null, back: (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    var profile by remember(username) { mutableStateOf(friends.knownProfile(username)) }
    var problem by remember { mutableStateOf<String?>(null) }
    var asked by remember { mutableStateOf(friends.known()?.asked?.size ?: 0) }
    var removing by remember { mutableStateOf(false) }
    var recommending by remember { mutableStateOf<ShareItem?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var privacyOpen by remember { mutableStateOf(false) }
    suspend fun load() { try { profile = friends.profile(username); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(username) { load() }
    val mine = profile?.you == true
    LaunchedEffect(mine) { if (mine) runCatching { asked = friends.list().asked.size } }
    fun change(type: String) = scope.launch { try { friends.change(type, username); load() } catch (p: KimonoProblem) { problem = p.message } }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        KimonoTopBar("", onBack = back) {
            if (own != null) app.kimono.ui.IconButton(onClick = own.settings) { Icon(kimonoIcon("gear"), "Settings") }
        }
    }) { padding ->
        KimonoRefresh(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, modifier = Modifier.padding(padding).fillMaxSize()) {
            val p: KimonoProfile? = profile
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                if (p == null) {
                    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { if (problem == null) InkLoader() else Problem(problem) }
                    return@Column
                }
                Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (own != null && p.you) own.portrait() else Portrait(p.picture, p.name, p.username, 128.dp)
                    if (own != null && p.you) InPlaceField(p.name, "Your name", MaterialTheme.typography.headlineMedium.copy(color = plumInk), single = true, limit = 80) { name ->
                        if (name.isBlank()) return@InPlaceField false
                        try { own.rename(name.trim()); profile = profile?.copy(name = name.trim()); problem = null; true } catch (e: KimonoProblem) { problem = e.message; false }
                    } else Text(p.name.ifBlank { p.username }, style = MaterialTheme.typography.headlineMedium, color = plumInk, textAlign = TextAlign.Center)
                    Text("@${p.username}" + if (p.open) " · ${if (p.friends == 1) "1 friend" else "${p.friends} friends"}" else "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (p.privacy?.invisible == true) Row(
                        Modifier.clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable { privacyOpen = true }.padding(horizontal = 12.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(kimonoIcon("lock"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                        Text("Invisible to friends", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    p.kimonoRead?.let { SilkscreenBadge(it.since, p.you, p.name.ifBlank { p.username }, still, friends.server) }
                    if (p.open && p.you) InPlaceField(p.bio, "A few words about you", MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface), limit = 280) { bio ->
                        try { val saved = friends.saveBio(bio); profile = profile?.copy(bio = saved); problem = null; true } catch (e: KimonoProblem) { problem = e.message; false }
                    } else if (p.open && p.bio.isNotBlank()) Text(p.bio, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                        when {
                            p.you -> Seal("Who sees what", compact = true, tone = SealTone.Quiet, onClick = { privacyOpen = true })
                            p.link == "friends" -> Seal("Friends", compact = true, tone = SealTone.Quiet, onClick = { removing = true })
                            p.link == "asked" -> { Seal("Not now", compact = true, tone = SealTone.Quiet, onClick = { change("no") }); Seal("Accept", compact = true, onClick = { change("yes") }) }
                            p.link == "asking" -> Seal("Asked", compact = true, tone = SealTone.Quiet, onClick = { change("remove") })
                            else -> Seal("Ask to be friends", compact = true, onClick = { change("ask") })
                        }
                    }
                    Problem(problem)
                }
                if (p.open && p.recommendations.isNotEmpty()) {
                    GroupLabel("Recommends")
                    Shelf(p.recommendations, { it.id }, { it.item }, { r ->
                        if (p.you) listOf(MenuChoice("Take off your profile", danger = true) { scope.launch { runCatching { friends.drop(r.id) }; load() } })
                        else listOf(MenuChoice("Recommend to others") { recommending = r.item })
                    }) { r -> r.note?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic), maxLines = 4, overflow = TextOverflow.Ellipsis) } }
                }
                /* Their friends, by portrait; on your own profile, whether friends see the list. */
                val list = p.friendList
                if (p.open && (!list.isNullOrEmpty() || p.you)) {
                    val listKept = p.you && (p.privacy?.invisible == true || p.privacy?.friends == false)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f)) { KeptLabel("Friends", listKept) }
                        /* Asks and finding people are on Friends. */
                        if (p.you) Row(
                            Modifier.padding(end = 16.dp, top = 16.dp).clip(RoundedCornerShape(12.dp)).clickable { open("friends") }.padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            if (asked > 0) Box(Modifier.size(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
                            Text(if (asked > 0) "$asked asking" else if (list.isNullOrEmpty()) "Find friends" else "All friends", style = MaterialTheme.typography.labelLarge, color = plumInk)
                        }
                    }
                    if (list.isNullOrEmpty()) Text("No friends yet.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 28.dp))
                    else LazyRow(Modifier.alpha(if (listKept) .5f else 1f), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        items(list, key = { it.username }) { f ->
                            Column(
                                Modifier.width(84.dp).clip(RoundedCornerShape(18.dp)).clickable { open("people/${f.username}") }.padding(vertical = 8.dp),
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Portrait(f.picture, f.name, f.username, 60.dp)
                                Text(f.first(), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
                /* Each app's rows together under its name; on your own profile, what friends see of them, which opens Who sees what. */
                if (p.open) p.sections.groupBy { it.app }.forEach { (app, rows) ->
                    val kept = app in p.hidden
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        InkBlot("app:$app", size = 40.dp) { Icon(kimonoIcon(if (app == "books") "book" else "film"), null, tint = Kata.plum, modifier = Modifier.size(20.dp)) }
                        Text(rows.first().appName, style = MaterialTheme.typography.headlineSmall, color = plumInk, modifier = Modifier.weight(1f))
                        if (p.you) {
                            val some = p.privacy?.apps?.firstOrNull { it.app == app }?.rows?.any { !it.shown } == true
                            Row(
                                Modifier.clip(RoundedCornerShape(12.dp, 8.dp, 12.dp, 8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable { privacyOpen = true }
                                    .heightIn(min = 40.dp).padding(horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Icon(kimonoIcon(if (kept) "lock" else "people"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                                Text(if (kept) "Only you" else if (some) "Friends see some" else "Friends see this", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    rows.forEach { s ->
                        val rowKept = !kept && p.you && "${s.app}:${s.kind}" in p.kept
                        KeptLabel(s.title, rowKept)
                        Box(Modifier.alpha(if (kept || rowKept) .5f else 1f)) {
                            Shelf(s.items, { "${s.app}:${it.itemId}" }, { it }, { listOf(MenuChoice("Recommend") { recommending = it }) }, drop = if (p.you) { item ->
                                /* Off the row at once (as its app would take it off); back if that fails. */
                                profile = p.copy(sections = p.sections.map { x -> if (x === s) x.copy(items = x.items.filter { it.itemId != item.itemId }) else x }.filter { it.items.isNotEmpty() })
                                scope.launch { try { friends.removeFromRow(s.app, s.kind, item.itemId) } catch (e: KimonoProblem) { problem = e.message; load() } }
                            } else null) { item ->
                                item.progress?.let { f -> androidx.compose.material3.LinearProgressIndicator(progress = { f.toFloat() }, modifier = Modifier.fillMaxWidth().padding(top = 2.dp)) }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(32.dp))
            }
        }
    }
    val p = profile
    val privacy = p?.privacy
    if (privacyOpen && p != null && privacy != null) PrivacyDialog(friends, privacy, onDismiss = { privacyOpen = false }) { now ->
        profile = profile?.copy(privacy = now.privacy, hidden = now.hidden, kept = now.privacy.kept)
    }
    if (removing && p != null) InkConfirm(
        title = "Remove ${p.name.substringBefore(' ')}?", text = "You'll stop seeing each other's profiles and what you watch.",
        action = "Remove", danger = true, icon = "people", onDismiss = { removing = false }, onConfirm = { removing = false; change("remove") },
    )
    recommending?.let { item -> RecommendDialog(friends, item, onDismiss = { recommending = null }) }
}

/** A row's label, with "Only you" beside it when friends don't see it. */
@Composable
private fun KeptLabel(text: String, kept: Boolean) {
    Row(Modifier.padding(start = 28.dp, top = 24.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        GroupLabel(text, Modifier)
        if (kept) Text("Only you", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

/**
 * Who sees what: going invisible (friends see your name and portrait, and no app shows them what you do),
 * then your friends list, each app and each of its rows. Every switch saves as it's flipped.
 */
@Composable
private fun PrivacyDialog(friends: Friends, privacy: app.kimono.data.Privacy, onDismiss: () -> Unit, onChanged: (app.kimono.data.PrivacyNow) -> Unit) {
    val scope = rememberCoroutineScope()
    var now by remember { mutableStateOf(privacy) }
    var problem by remember { mutableStateOf<String?>(null) }
    fun save(optimistic: app.kimono.data.Privacy, call: suspend () -> app.kimono.data.PrivacyNow) {
        val was = now
        now = optimistic
        scope.launch { try { val r = call(); now = r.privacy; onChanged(r); problem = null } catch (e: KimonoProblem) { now = was; problem = e.message } }
    }
    val off = now.invisible
    InkDialog(title = "Who sees what", icon = "lock", onDismiss = onDismiss, actions = { Seal("Done", compact = true, onClick = onDismiss) }) {
        PrivacySwitch("Invisible", now.invisible, bold = true, note = "Friends see only your name and portrait.") { on -> save(now.copy(invisible = on)) { friends.setInvisible(on) } }
        androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
        Column(Modifier.alpha(if (off) .45f else 1f)) {
            PrivacySwitch("Friends list", now.friends, bold = true, enabled = !off) { on -> save(now.copy(friends = on)) { friends.showPart("friends", on) } }
            now.apps.forEach { a ->
                PrivacySwitch(a.name, a.shown, bold = true, enabled = !off) { on ->
                    save(now.copy(apps = now.apps.map { if (it.app == a.app) it.copy(shown = on) else it })) { friends.showAppOf(a.app, on) }
                }
                Column(Modifier.padding(start = 18.dp).alpha(if (a.shown) 1f else .45f)) {
                    a.rows.forEach { r ->
                        PrivacySwitch(r.title, r.shown, enabled = !off && a.shown) { on ->
                            save(now.copy(apps = now.apps.map { if (it.app == a.app) it.copy(rows = it.rows.map { x -> if (x.kind == r.kind) x.copy(shown = on) else x }) else it })) { friends.showPart("${a.app}:${r.kind}", on) }
                        }
                    }
                }
            }
        }
        Problem(problem)
    }
}

@Composable
private fun PrivacySwitch(label: String, on: Boolean, bold: Boolean = false, enabled: Boolean = true, note: String? = null, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(label, style = if (bold) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge)
            note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Switch(on, change, enabled = enabled)
    }
}

/**
 * Text you change where it stands: no box until you're in it, saved when you leave it (or press Done
 * on a single line). [save] says whether it took; if not, the text goes back.
 */
@Composable
private fun InPlaceField(value: String, placeholder: String, style: androidx.compose.ui.text.TextStyle, single: Boolean = false, limit: Int, save: suspend (String) -> Boolean) {
    val scope = rememberCoroutineScope()
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    var text by remember(value) { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }
    fun commit() {
        if (text.trim() == value.trim()) return
        val was = value
        scope.launch { if (!save(text)) text = was }
    }
    val centred = style.copy(textAlign = TextAlign.Center)
    androidx.compose.foundation.text.BasicTextField(
        value = text,
        onValueChange = { if (it.length <= limit) text = it },
        textStyle = centred,
        singleLine = single,
        maxLines = if (single) 1 else 8,
        cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
            capitalization = if (single) androidx.compose.ui.text.input.KeyboardCapitalization.Words else androidx.compose.ui.text.input.KeyboardCapitalization.Sentences,
            imeAction = if (single) androidx.compose.ui.text.input.ImeAction.Done else androidx.compose.ui.text.input.ImeAction.Default,
        ),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { focus.clearFocus() }),
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder }
            .onFocusChanged { state -> if (focused && !state.isFocused) commit(); focused = state.isFocused },
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp, 8.dp, 12.dp, 8.dp))
                    .background(if (focused) MaterialTheme.colorScheme.surfaceContainerHigh else androidx.compose.ui.graphics.Color.Transparent)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                if (text.isEmpty()) Text(placeholder, style = centred.copy(color = MaterialTheme.colorScheme.onSurfaceVariant), modifier = Modifier.fillMaxWidth())
                inner()
            }
        },
    )
}

/** Recommend a title: to friends (picked by their portraits), or onto your profile, with a note if you like. */
@Composable
fun RecommendDialog(friends: Friends, item: ShareItem, onDismiss: () -> Unit, onSent: (String) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var people by remember { mutableStateOf(friends.known()?.friends) }
    var to by remember { mutableStateOf(setOf<String>()) }
    var onProfile by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { people = friends.list().friends } }
    InkDialog(title = "Recommend", icon = "send", onDismiss = onDismiss, actions = {
        Seal("Cancel", compact = true, tone = SealTone.Quiet, onClick = onDismiss)
        Seal("Send", compact = true, busy = busy, enabled = to.isNotEmpty() || onProfile, onClick = {
            busy = true; problem = null
            scope.launch {
                try {
                    if (to.isNotEmpty()) friends.recommend(item, to.toList(), note)
                    if (onProfile) friends.recommend(item, emptyList(), note)
                    val names = people.orEmpty().filter { it.username in to }.map { it.first() }
                    onSent(if (names.isEmpty()) "On your profile" else if (names.size > 2) "Sent to ${names.size} friends" else "Sent to ${names.joinToString(" and ")}")
                    onDismiss()
                } catch (p: KimonoProblem) { problem = p.message }
                busy = false
            }
        })
    }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Cover(item, Modifier.width(52.dp))
            Column {
                Text(item.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                item.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        Spacer(Modifier.height(16.dp))
        val shown = people
        when {
            shown == null -> Box(Modifier.fillMaxWidth().heightIn(min = 84.dp), contentAlignment = Alignment.Center) { InkLoader(size = 32.dp) }
            shown.isEmpty() -> Text("No friends yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                shown.forEach { f ->
                    val picked = f.username in to
                    Column(
                        Modifier.width(72.dp).clip(RoundedCornerShape(if (picked) 22.dp else 18.dp))
                            .background(if (picked) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerLow)
                            .clickable(onClickLabel = f.name) { to = if (picked) to - f.username else to + f.username }.padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Box {
                            Portrait(f.picture, f.name, f.username, 52.dp)
                            if (picked) Box(Modifier.align(Alignment.TopEnd).size(20.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                                Icon(kimonoIcon("check"), null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(13.dp))
                            }
                        }
                        Text(f.first(), style = MaterialTheme.typography.labelMedium, maxLines = 1)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("On my profile", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(onProfile, { onProfile = it })
        }
        OutlinedTextField(note, { if (it.length <= 500) note = it }, label = { Text("Note") }, minLines = 2, maxLines = 4, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Problem(problem)
    }
}
