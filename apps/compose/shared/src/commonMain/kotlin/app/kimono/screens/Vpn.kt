@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.KimonoProblem
import app.kimono.data.LauncherApp
import app.kimono.data.Platform
import app.kimono.data.Vpn
import app.kimono.data.VpnDevice
import app.kimono.data.VpnKey
import app.kimono.data.VpnPerson
import app.kimono.data.VpnView
import app.kimono.theme.Kata
import app.kimono.ui.AppAccentTheme
import app.kimono.ui.InkBloom
import app.kimono.ui.InkBlot
import app.kimono.ui.InkDot
import app.kimono.ui.InkLoader
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import kotlinx.coroutines.launch

/*
 * 網 Kimono VPN on the phone: the website's /vpn rooms (Devices, People,
 * Connect), in the VPN's own colour. The phone only looks after the mesh;
 * this phone joins it through Tailscale, pointed at your Kimono.
 */

private const val VPN_ACCENT = "#2f6b7a"
private enum class VpnRoom(val title: String) { Devices("Devices"), People("People"), Connect("Connect") }

private const val TAILSCALE_ANDROID = "https://play.google.com/store/apps/details?id=com.tailscale.ipn"
private const val TAILSCALE_IOS = "https://apps.apple.com/app/tailscale/id1470499037"

@Composable
/** [room] is the bar's: "vpn" (Devices), "vpn/people" or "vpn/connect"; [go] moves between them. */
fun VpnScreen(vpn: Vpn, platform: Platform, app: LauncherApp?, roomRoute: String, go: (String) -> Unit, back: () -> Unit) {
    var view by remember { mutableStateOf(vpn.known()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val room = when (roomRoute) { "vpn/people" -> VpnRoom.People; "vpn/connect" -> VpnRoom.Connect; else -> VpnRoom.Devices }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    suspend fun load() { try { view = vpn.view(); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(Unit) { load() }
    fun change(done: String, work: suspend () -> VpnView) = scope.launch {
        try { view = work(); problem = null; snackbar.showSnackbar(done) } catch (p: KimonoProblem) { problem = p.message }
    }

    AppAccentTheme(app?.accent ?: VPN_ACCENT) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.surface,
            topBar = { KimonoTopBar(room.title, onBack = back, mark = { InkBloom(app?.id ?: "kimono-vpn", app?.accent ?: VPN_ACCENT, app?.glyph ?: "mesh", 32.dp) }) },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            val shown = view
            when {
                shown == null && problem == null -> Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                shown == null -> Box(Modifier.padding(padding).padding(24.dp)) { Problem(problem) }
                !shown.member -> Quietly(Modifier.padding(padding), "mesh", "Kimono VPN isn't on for you yet", "Ask whoever runs this Kimono to switch it on for you, and your devices will appear here.")
                else -> Column(Modifier.padding(padding).fillMaxSize()) {
                    KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
                            Problem(problem)
                            when (room) {
                                VpnRoom.Devices -> DevicesRoom(shown, onConnect = { go("vpn/connect") }, onPeople = { go("vpn/people") }) { device, intent ->
                                    change(if (intent == "remove") "${device.name} was removed." else "${device.name} was signed out.") { vpn.device(device.id, intent) }
                                }
                                VpnRoom.People -> PeopleRoom(shown) { person, invited ->
                                    change(if (invited) "@${person.username} can now reach your devices." else "@${person.username} no longer reaches your devices.") { vpn.guest(person.username, invited) }
                                }
                                VpnRoom.Connect -> ConnectRoom(shown, vpn, platform)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Heading(title: String, detail: String, meta: String? = null) {
    Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 22.dp, bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            if (meta != null) Text(meta, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
    }
}

/** An empty room: a blot, a line, and what to do about it. */
@Composable
private fun Quietly(modifier: Modifier, icon: String, title: String, detail: String, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        InkBlot("vpn-$icon", size = 72.dp) { Icon(kimonoIcon(icon), null, tint = Kata.plum, modifier = Modifier.size(30.dp)) }
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        action?.invoke()
    }
}

@Composable
private fun DevicesRoom(view: VpnView, onConnect: () -> Unit, onPeople: () -> Unit, act: (VpnDevice, String) -> Unit) {
    val connected = view.devices.count { it.online }
    Heading("Your devices", "These reach each other directly, wherever they are.", if (view.devices.isEmpty()) null else "$connected of ${view.devices.size} connected")
    when {
        !view.available -> Quietly(Modifier, "mesh", "Not connected to the mesh", view.reason ?: "Kimono can't reach the mesh right now.")
        view.devices.isEmpty() -> Quietly(Modifier, "phone", "No devices yet", "Nothing of yours has joined. Adding one takes about a minute.") { Seal("Connect a device", onClick = onConnect) }
        else -> Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
            view.devices.forEachIndexed { index, device -> DeviceRow(device, index, view.devices.size, act) }
        }
    }
    Heading("Meshes you can reach", "People who invited you. Their devices answer from yours.", view.hosts.size.takeIf { it > 0 }?.toString())
    if (view.hosts.isEmpty()) Quietly(Modifier, "person", "Nobody has invited you", "Your devices reach each other. Reaching someone else's takes an invitation.") { Seal("Invite someone", onClick = onPeople, tone = SealTone.Quiet, compact = true) }
    else People(view.hosts) { "@${it.username} invited you in." }
}

@Composable
private fun DeviceRow(device: VpnDevice, index: Int, count: Int, act: (VpnDevice, String) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf<String?>(null) }
    SegmentedListItem(
        onClick = { menu = true },
        shapes = ListItemDefaults.segmentedShapes(index, count),
        colors = segmentColors(),
        leadingContent = { InkDot(if (device.online) Kata.moss else Color(0xFFB9A8A2), size = 12.dp, seed = device.id) },
        supportingContent = {
            Column {
                Text(listOfNotNull(device.seen, device.expiry).joinToString(" · "))
                if (device.addresses.isNotEmpty()) Text(device.addresses.joinToString("  "), fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "Stop using ${device.name}") }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text("Sign out") }, onClick = { menu = false; asking = "disconnect" })
                    DropdownMenuItem(text = { Text("Remove", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; asking = "remove" })
                }
            }
        },
    ) { Text(device.name, style = MaterialTheme.typography.bodyLarge) }
    asking?.let { intent ->
        AlertDialog(
            onDismissRequest = { asking = null },
            title = { Text(if (intent == "remove") "Remove ${device.name}?" else "Sign out ${device.name}?") },
            text = { Text(if (intent == "remove") "It's forgotten entirely. Joining again makes it a new device." else "It keeps its address and its place here, and comes back when someone signs in on it again.") },
            confirmButton = { TextButton(onClick = { asking = null; act(device, intent) }) { Text(if (intent == "remove") "Remove" else "Sign out", color = if (intent == "remove") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary) } },
            dismissButton = { TextButton(onClick = { asking = null }) { Text("Keep it") } },
        )
    }
}

@Composable
private fun People(people: List<VpnPerson>, trailing: (@Composable (VpnPerson) -> Unit)? = null, line: (VpnPerson) -> String) {
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
        people.forEachIndexed { index, person ->
            SegmentedListItem(
                onClick = {},
                shapes = ListItemDefaults.segmentedShapes(index, people.size),
                colors = segmentColors(),
                leadingContent = { app.kimono.ui.Portrait(null, person.name, person.username, 40.dp) },
                supportingContent = { Text(line(person)) },
                trailingContent = trailing?.let { { it(person) } },
            ) { Text(person.name, style = MaterialTheme.typography.bodyLarge) }
        }
    }
}

@Composable
private fun PeopleRoom(view: VpnView, set: (VpnPerson, Boolean) -> Unit) {
    Heading("People you let in", "Your mesh is yours alone until you invite someone. Invitations go one way.", view.guests.size.takeIf { it > 0 }?.let { "$it ${if (it == 1) "guest" else "guests"}" })
    if (view.guests.isEmpty()) Quietly(Modifier, "lock", "Nobody else reaches your devices", "Invite someone and their devices can reach yours, not the other way round.")
    else People(view.guests, trailing = { person -> TextButton(onClick = { set(person, false) }) { Text("Remove", color = MaterialTheme.colorScheme.error) } }) { "Reaches your devices" }
    if (view.invitable.isNotEmpty()) {
        var open by remember { mutableStateOf(false) }
        Box(Modifier.padding(start = 24.dp, top = 14.dp)) {
            Seal("Invite someone", onClick = { open = true }, tone = SealTone.Quiet, compact = true)
            DropdownMenu(open, { open = false }) {
                view.invitable.forEach { person -> DropdownMenuItem(text = { Text("${person.name} · @${person.username}") }, onClick = { open = false; set(person, true) }) }
            }
        }
    }
    Heading("Meshes you can reach", "People who have invited you into theirs.", view.hosts.size.takeIf { it > 0 }?.toString())
    if (view.hosts.isEmpty()) Quietly(Modifier, "person", "Nobody has invited you", "When someone invites you into their mesh, their devices become reachable from yours.")
    else People(view.hosts) { "Invited you, so your devices reach theirs" }
}

/** A line to copy: the mesh's address, a key, a command. */
@Composable
internal fun Copyable(text: String) {
    @Suppress("DEPRECATION") val clipboard = LocalClipboardManager.current
    Row(
        Modifier.fillMaxWidth().background(Kata.urushi, RoundedCornerShape(16.dp)).padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Kata.urushiText, modifier = Modifier.weight(1f).padding(vertical = 10.dp))
        TextButton(onClick = { clipboard.setText(AnnotatedString(text)) }) { Text("Copy", color = Kata.urushiString) }
    }
}

@Composable
internal fun Step(number: Int, text: String, content: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        InkBlot("vpn-step-$number", size = 30.dp) { Text("$number", style = MaterialTheme.typography.labelLarge, color = Kata.plum) }
        Column(Modifier.weight(1f).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(text, style = MaterialTheme.typography.bodyLarge)
            content()
        }
    }
}

@Composable
private fun ConnectRoom(view: VpnView, vpn: Vpn, platform: Platform) {
    val scope = rememberCoroutineScope()
    var key by remember { mutableStateOf<VpnKey?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var making by remember { mutableStateOf(false) }
    Heading("Add this phone", "Tailscale joins it to your mesh. Kimono checks it's you.")
    Step(1, "Get Tailscale.") { Seal("Open Tailscale", onClick = { platform.openUrl(if (platform.os == "ios") TAILSCALE_IOS else TAILSCALE_ANDROID) }, compact = true) }
    Step(2, "Before signing in, open its account menu, choose a custom coordination server, and enter:") { Copyable("https://${view.mesh}") }
    Step(3, "Sign in with your Kimono account. The phone appears under Devices within seconds.")
    Heading("A machine with no browser", "A headless server can't open a sign-in page, so it joins with a key that works once and lasts thirty minutes.")
    Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val minted = key
        if (minted == null) Seal("Create a key", onClick = {
            making = true
            scope.launch { try { key = vpn.key(); problem = null } catch (p: KimonoProblem) { problem = p.message }; making = false }
        }, tone = SealTone.Quiet, compact = true, busy = making)
        else {
            Text("Run this on the machine you're adding:", style = MaterialTheme.typography.bodyMedium)
            Copyable(minted.command)
        }
        Problem(problem)
    }
}
