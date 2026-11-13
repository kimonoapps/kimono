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
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.draw.drawBehind
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
                        Modifier.align(Alignment.TopEnd).padding(6.dp).size(34.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = .92f))
                            .clickable { drop(entry) }.semantics { contentDescription = "Take ${shown.title} off" },
                        contentAlignment = Alignment.Center,
                    ) { Icon(kimonoIcon("close"), null, tint = plumInk, modifier = Modifier.size(18.dp)) }
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
    /* What the × is about to take off, waiting on a yes. */
    var dropping by remember { mutableStateOf<Pair<app.kimono.data.ProfileSection, ShareItem>?>(null) }
    var unrecommending by remember { mutableStateOf<Recommendation?>(null) }
    var recommending by remember { mutableStateOf<ShareItem?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    /* Which app's rows are open to choose what friends see of them. */
    var privacyOpen by remember { mutableStateOf<String?>(null) }
    suspend fun load() { try { profile = friends.profile(username); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(username) { load() }
    val mine = profile?.you == true
    LaunchedEffect(mine) { if (mine) runCatching { asked = friends.list().asked.size } }
    fun change(type: String) = scope.launch { try { friends.change(type, username); load() } catch (p: KimonoProblem) { problem = p.message } }
    val toSettings: () -> Unit = { own?.settings?.invoke() ?: open("settings") }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        KimonoTopBar("", onBack = back) { if (profile?.you == true) Seal("Settings", onClick = toSettings, tone = SealTone.Quiet, compact = true, icon = "cog") }
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
                    p.kimonoRead?.let { SilkscreenBadge(it.since, p.you, p.name.ifBlank { p.username }, still, friends.server) }
                    if (p.open && p.you) InPlaceField(p.bio, "A few words about you", MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface), limit = 280) { bio ->
                        try { val saved = friends.saveBio(bio); profile = profile?.copy(bio = saved); problem = null; true } catch (e: KimonoProblem) { problem = e.message; false }
                    } else if (p.open && p.bio.isNotBlank()) Text(p.bio, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                    /* Invisible is Settings'; while it's on, it says so here. */
                    if (p.you) { if (p.privacy?.invisible == true) SeenTag(true, label = "Invisible", onClick = toSettings) }
                    else Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                        when {
                            p.link == "friends" -> Seal("Friends", compact = true, tone = SealTone.Quiet, onClick = { removing = true })
                            p.link == "asked" -> { Seal("Not now", compact = true, tone = SealTone.Quiet, onClick = { change("no") }); Seal("Accept", compact = true, onClick = { change("yes") }) }
                            p.link == "asking" -> Seal("Asked", compact = true, tone = SealTone.Quiet, onClick = { change("remove") })
                            else -> Seal("Ask to be friends", compact = true, onClick = { change("ask") })
                        }
                    }
                    Problem(problem)
                }
                if (p.open && p.recommendations.isNotEmpty()) {
                    SectionHead("recommends", "send", "Recommends")
                    Shelf(p.recommendations, { it.id }, { it.item }, { r ->
                        if (p.you) listOf(MenuChoice("Take off your profile", danger = true) { unrecommending = r })
                        else listOf(MenuChoice("Recommend to others") { recommending = r.item })
                    }) { r -> r.note?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic), maxLines = 4, overflow = TextOverflow.Ellipsis) } }
                }
                /* Their friends, by portrait; on your own profile, whether friends see the list. */
                val list = p.friendList
                if (p.open && (!list.isNullOrEmpty() || p.you)) {
                    val listKept = p.you && (p.privacy?.invisible == true || p.privacy?.friends == false)
                    SectionHead("friends", "people", "Friends") { if (p.you) SeenTag(listKept) {
                        if (p.privacy?.invisible == true) toSettings()
                        /* The friends list flips at once. */
                        else scope.launch { try { val now = friends.showPart("friends", listKept); profile = profile?.copy(privacy = now.privacy, hidden = now.hidden, kept = now.privacy.kept) } catch (e: KimonoProblem) { problem = e.message } }
                    } }
                    if (!list.isNullOrEmpty()) LazyRow(Modifier.alpha(if (listKept) .5f else 1f), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
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
                if (p.open && p.you) Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    /* Asks and finding people are on Friends. */
                    if (asked > 0) Seal("$asked asking", onClick = { open("friends") }, compact = true)
                    if (p.friendList.isNullOrEmpty()) Seal("Find friends", onClick = { open("friends") }, compact = true, icon = "search")
                    else Seal("All friends", onClick = { open("friends") }, compact = true, tone = SealTone.Quiet)
                }
                /* Each app's rows together under its name; on your own profile, what friends see of them, which opens Who sees what. */
                if (p.open) p.sections.groupBy { it.app }.forEach { (app, rows) ->
                    val kept = app in p.hidden
                    val some = p.privacy?.apps?.firstOrNull { it.app == app }?.rows?.any { !it.shown } == true
                    SectionHead("app:$app", if (app == "books") "book" else "film", rows.first().appName) { if (p.you) SeenTag(kept, some) { if (p.privacy?.invisible == true) toSettings() else privacyOpen = app } }
                    rows.forEach { s ->
                        val rowKept = !kept && p.you && "${s.app}:${s.kind}" in p.kept
                        KeptLabel(s.title, rowKept) { privacyOpen = app }
                        Box(Modifier.alpha(if (kept || rowKept) .5f else 1f)) {
                            Shelf(s.items, { "${s.app}:${it.itemId}" }, { it }, { listOf(MenuChoice("Recommend") { recommending = it }) }, drop = if (p.you) { item -> dropping = s to item } else null) { item ->
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
    val openApp = privacyOpen
    if (openApp != null && p != null && privacy != null) AppPrivacyDialog(friends, openApp, privacy, onDismiss = { privacyOpen = null }) { now ->
        profile = profile?.copy(privacy = now.privacy, hidden = now.hidden, kept = now.privacy.kept)
    }
    if (removing && p != null) InkConfirm(
        title = "Remove ${p.name.substringBefore(' ')}?", text = "You'll stop seeing each other's profiles and what you watch.",
        action = "Remove", danger = true, icon = "people", onDismiss = { removing = false }, onConfirm = { removing = false; change("remove") },
    )
    dropping?.let { (s, item) ->
        InkConfirm(
            title = "Take ${item.title} off ${s.title}?", text = dropLoses(s.app, s.kind, s.appName), action = "Take off", danger = true, icon = "trash",
            onDismiss = { dropping = null },
            onConfirm = {
                dropping = null
                /* Off the row at once (as its app would take it off); back if that fails. */
                profile = profile?.let { now -> now.copy(sections = now.sections.map { x -> if (x.app == s.app && x.kind == s.kind) x.copy(items = x.items.filter { it.itemId != item.itemId }) else x }.filter { it.items.isNotEmpty() }) }
                scope.launch { try { friends.removeFromRow(s.app, s.kind, item.itemId) } catch (e: KimonoProblem) { problem = e.message; load() } }
            },
        )
    }
    unrecommending?.let { r ->
        InkConfirm(
            title = "Take ${r.title} off your profile?", text = if (r.note != null) "Your note goes with it." else "Friends stop seeing you recommend it.",
            action = "Take off", danger = true, icon = "trash", onDismiss = { unrecommending = null },
            onConfirm = { unrecommending = null; scope.launch { runCatching { friends.drop(r.id) }; load() } },
        )
    }
    recommending?.let { item -> RecommendDialog(friends, item, onDismiss = { recommending = null }) }
}

/** What taking a title off a row means, said before it's done (apps/portal lib/friends removeFromRow): only the profile forgets it. */
private fun dropLoses(app: String, kind: String, appName: String) = when {
    app == "watch" && kind == "watched" -> "Friends stop seeing it until you watch it again. What you've watched stays."
    app == "books" && kind == "reading" -> "Friends stop seeing it until you read on. Your progress stays."
    kind == "loved" || kind == "liked" -> "Friends stop seeing it until you rate it again. Your rating stays."
    else -> "Friends stop seeing it here. It stays in $appName."
}

/** A row's label, with "Only you" beside it when friends don't see it. */
@Composable
private fun KeptLabel(text: String, kept: Boolean, onTag: () -> Unit) {
    Row(Modifier.padding(start = 28.dp, top = 20.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        GroupLabel(text, Modifier)
        if (kept) SeenTag(true, onClick = onTag)
    }
}

/** Every section's head: its mark in a puddle, its name in Mincho, and what friends see of it. */
@Composable
private fun SectionHead(seed: String, icon: String, title: String, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 32.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        InkBlot(seed, size = 40.dp) { Icon(kimonoIcon(icon), null, tint = Kata.plum, modifier = Modifier.size(20.dp)) }
        Text(title, style = MaterialTheme.typography.headlineSmall, color = plumInk, modifier = Modifier.weight(1f))
        trailing()
    }
}

/** What friends see of a part of you, one tag everywhere; it opens Who sees what. */
@Composable
private fun SeenTag(kept: Boolean, some: Boolean = false, label: String? = null, onClick: () -> Unit) {
    val ink = if (kept) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        Modifier.clip(RoundedCornerShape(10.dp, 6.dp, 10.dp, 6.dp))
            .background(if (kept) MaterialTheme.colorScheme.primary.copy(alpha = .14f) else MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable { onClick() }.heightIn(min = 32.dp).padding(start = 10.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(kimonoIcon(if (kept) "lock" else "eye"), null, tint = ink, modifier = Modifier.size(16.dp))
        Text(label ?: if (kept) "Only you" else if (some) "Friends see some" else "Friends see this", style = MaterialTheme.typography.labelLarge, color = ink)
    }
}

/** What friends see of one app: the app itself, then each of its rows. Every switch saves as it's flipped. */
@Composable
private fun AppPrivacyDialog(friends: Friends, app: String, privacy: app.kimono.data.Privacy, onDismiss: () -> Unit, onChanged: (app.kimono.data.PrivacyNow) -> Unit) {
    val scope = rememberCoroutineScope()
    var now by remember { mutableStateOf(privacy) }
    var problem by remember { mutableStateOf<String?>(null) }
    fun save(optimistic: app.kimono.data.Privacy, call: suspend () -> app.kimono.data.PrivacyNow) {
        val was = now
        now = optimistic
        scope.launch { try { val r = call(); now = r.privacy; onChanged(r); problem = null } catch (e: KimonoProblem) { now = was; problem = e.message } }
    }
    val a = now.apps.firstOrNull { it.app == app } ?: return
    InkDialog(title = a.name, icon = if (app == "books") "book" else "film", onDismiss = onDismiss, actions = { Seal("Done", compact = true, onClick = onDismiss) }) {
        PrivacySwitch("Friends see your ${a.name}", a.shown, bold = true) { on ->
            save(now.copy(apps = now.apps.map { if (it.app == a.app) it.copy(shown = on) else it })) { friends.showAppOf(a.app, on) }
        }
        Column(Modifier.padding(start = 18.dp).alpha(if (a.shown) 1f else .45f)) {
            a.rows.forEach { r ->
                PrivacySwitch(r.title, r.shown, enabled = a.shown) { on ->
                    save(now.copy(apps = now.apps.map { if (it.app == a.app) it.copy(rows = it.rows.map { x -> if (x.kind == r.kind) x.copy(shown = on) else x }) else it })) { friends.showPart("${a.app}:${r.kind}", on) }
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
    val rule = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .55f)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
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
            modifier = (if (single) Modifier.widthIn(min = 120.dp, max = 300.dp) else Modifier.weight(1f, fill = false).widthIn(min = 200.dp))
                .semantics { contentDescription = placeholder }
                .onFocusChanged { state -> if (focused && !state.isFocused) commit(); focused = state.isFocused },
            decorationBox = { inner ->
                Box(
                    Modifier.clip(RoundedCornerShape(12.dp, 8.dp, 12.dp, 8.dp))
                        .background(if (focused) MaterialTheme.colorScheme.surfaceContainerHigh else androidx.compose.ui.graphics.Color.Transparent)
                        /* At rest, a dotted ink rule under what you can change. */
                        .drawBehind {
                            if (!focused) {
                                val y = size.height - 3.dp.toPx()
                                var x = 10.dp.toPx()
                                while (x < size.width - 10.dp.toPx()) { drawLine(rule, androidx.compose.ui.geometry.Offset(x, y), androidx.compose.ui.geometry.Offset(x + 3.dp.toPx(), y), 1.dp.toPx()); x += 6.dp.toPx() }
                            }
                        }
                        .padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (text.isEmpty()) Text(placeholder, style = centred.copy(color = MaterialTheme.colorScheme.onSurfaceVariant))
                    inner()
                }
            },
        )
        /* 筆 the brush: you can change this, here. */
        if (!focused) Icon(kimonoIcon("brush"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 4.dp).size(18.dp))
    }
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
