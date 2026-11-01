@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.kimono.data.AccountProfile
import app.kimono.data.KimonoProblem
import app.kimono.data.Platform
import app.kimono.data.Session
import app.kimono.data.SessionList
import app.kimono.theme.Kata
import app.kimono.ui.GroupLabel
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.ListRow
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.HoldMenu
import app.kimono.ui.HoldSeal
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.MenuChoice
import app.kimono.ui.SwipeRow
import app.kimono.ui.kimonoIcon
import app.kimono.ui.plumRule
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Uploads a 512×512 PNG as the signed-in person's picture. */
suspend fun Session.usePicture(png: ByteArray) {
    /* Bytes carry their type themselves; a bare ByteArray would go as octet-stream. */
    call("/api/v1/me/picture", HttpMethod.Put) { setBody(ByteArrayContent(png, ContentType.Image.PNG)) }
    refreshMe()
}

@Composable
fun YouScreen(session: Session, platform: Platform, me: AccountProfile?, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        containerColor = Kata.ground,
        topBar = {
            /* Expressive's flexible bar: your name large, shrinking to the bar as you scroll. */
            LargeFlexibleTopAppBar(
                title = { Text(me?.name ?: "You", style = MaterialTheme.typography.headlineMedium) },
                subtitle = { Text("@${me?.username ?: ""}", style = MaterialTheme.typography.bodyMedium, color = Kata.inkSoft) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Kata.ground, scrolledContainerColor = Kata.ground),
                scrollBehavior = scroll,
                modifier = Modifier.plumRule(),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val choose: () -> Unit = {
                    problem = null
                    scope.launch {
                        try {
                            val png = platform.pickPicture() ?: return@launch
                            busy = true
                            session.usePicture(png)
                        } catch (p: KimonoProblem) { problem = p.message } catch (_: Exception) { problem = "Your picture could not be saved." }
                        busy = false
                    }
                }
                val remove: () -> Unit = {
                    problem = null
                    scope.launch {
                        try { busy = true; session.call("/api/v1/me/picture", HttpMethod.Delete); session.refreshMe() } catch (p: KimonoProblem) { problem = p.message }
                        busy = false
                    }
                }
                /* Long-press your picture for everything you can do with it. */
                HoldMenu(listOfNotNull(MenuChoice("Choose a photo", onClick = choose), if (me?.picture != null) MenuChoice("Remove picture", danger = true, onClick = remove) else null), onClick = choose) {
                    Portrait(me?.picture, me?.name, me?.username, 104.dp)
                    if (busy) Box(Modifier.size(104.dp), contentAlignment = Alignment.Center) { LoadingIndicator() }
                    FilledIconButton(
                        onClick = choose,
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = Kata.lift, contentColor = Kata.ink),
                        modifier = Modifier.align(Alignment.BottomEnd).offset(x = 6.dp, y = 2.dp).size(38.dp).border(1.dp, Kata.hairDeep, CircleShape),
                    ) { Icon(kimonoIcon("camera"), "Change picture", modifier = Modifier.size(18.dp)) }
                }
                Text(me?.email ?: "", style = MaterialTheme.typography.bodyMedium, color = Kata.inkSoft)
                Problem(problem)
            }
            GroupLabel("Account")
            Column(Modifier.background(Kata.sheet)) {
                HorizontalDivider(color = Kata.hair)
                ListRow("Name and email") { open("details") }
                ListRow("Password") { open("password") }
                ListRow("Signed-in devices") { open("devices") }
            }
            GroupLabel("This phone")
            Column(Modifier.background(Kata.sheet)) {
                HorizontalDivider(color = Kata.hair)
                ListRow("Sign out", danger = true) { scope.launch { session.signOut() } }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
fun DetailsScreen(session: Session, me: AccountProfile?, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(me?.name ?: "") }
    var email by remember { mutableStateOf(me?.email ?: "") }
    var current by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val emailChanged = email.trim().lowercase() != (me?.email ?: "").trim().lowercase()
    val changed = name.trim() != (me?.name ?: "") || emailChanged
    Scaffold(containerColor = Kata.ground, topBar = {
        KimonoTopBar("Name and email", onBack = back) {
            Seal("Save", compact = true, busy = busy, enabled = changed && (!emailChanged || current.isNotEmpty()), onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        val body = buildJsonObject {
                            put("name", name)
                            put("email", email)
                            if (emailChanged) put("currentPassword", current)
                        }
                        session.call("/api/v1/me", HttpMethod.Patch) { contentType(ContentType.Application.Json); setBody(Json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), body)) }
                        session.refreshMe()
                        back()
                    } catch (p: KimonoProblem) { problem = p.message }
                    busy = false
                }
            })
        }
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, colors = kataFieldColors(), shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, colors = kataFieldColors(), shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth())
            if (emailChanged) OutlinedTextField(current, { current = it }, label = { Text("Current password") }, singleLine = true, visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), colors = kataFieldColors(), shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(me?.username ?: "", {}, label = { Text("Username") }, enabled = false, singleLine = true, colors = kataFieldColors(), shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth())
            Problem(problem)
        }
    }
}

@Composable
fun DevicesScreen(session: Session, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<SessionList?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    suspend fun load() {
        try { list = session.decode(session.call("/api/v1/me/sessions"), SessionList.serializer()); problem = null } catch (p: KimonoProblem) { problem = p.message }
    }
    LaunchedEffect(Unit) { load() }
    Scaffold(containerColor = Kata.ground, topBar = { KimonoTopBar("Signed-in devices", onBack = back) }) { padding ->
        KimonoRefresh(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, modifier = Modifier.padding(padding).fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize()) {
                item { Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { Problem(problem) } }
                if (list == null && problem == null) item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { LoadingIndicator() } }
                items(list?.sessions ?: emptyList(), key = { it.id }) { item ->
                    val on = listOf(item.device, item.os).filter { it.isNotBlank() }.joinToString(", ")
                    val title = if (on.isEmpty()) item.browser else "${item.browser} on $on"
                    /* Swipe a device away to sign it out. */
                    SwipeRow("Sign out", onAction = {
                        try {
                            session.call("/api/v1/me/sessions/${item.id}", HttpMethod.Delete)
                            list = list?.copy(sessions = list!!.sessions.filter { it.id != item.id })
                            true
                        } catch (p: KimonoProblem) { problem = p.message; false }
                    }, modifier = Modifier.animateItem()) {
                        Column {
                            Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                Box(Modifier.size(40.dp).background(Kata.fold, MaterialTheme.shapes.small), contentAlignment = Alignment.Center) {
                                    Icon(kimonoIcon(if (Regex("iphone|ipad|android|mobile", RegexOption.IGNORE_CASE).containsMatchIn("${item.device} ${item.os}")) "phone" else "laptop"), null, tint = Kata.ink, modifier = Modifier.size(22.dp))
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(title, style = MaterialTheme.typography.titleSmall)
                                    Text(listOfNotNull(item.place, item.ip).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Kata.inkSoft)
                                }
                            }
                            HorizontalDivider(color = Kata.hair, modifier = Modifier.padding(horizontal = 16.dp))
                        }
                    }
                }
                item {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Swipe a device left to sign it out.", style = MaterialTheme.typography.bodySmall, color = Kata.inkSoft)
                        /* Signing everything out can't be undone, so it is held, not tapped. */
                        HoldSeal("Hold to sign out everywhere", onConfirm = {
                            scope.launch {
                                try { session.call("/api/v1/me/sessions", HttpMethod.Delete); session.signOut() } catch (p: KimonoProblem) { problem = p.message }
                            }
                        })
                    }
                }
            }
        }
    }
}
