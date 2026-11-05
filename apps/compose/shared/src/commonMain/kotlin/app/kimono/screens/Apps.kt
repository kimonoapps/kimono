@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.AppAdmin
import app.kimono.data.AppField
import app.kimono.data.KimonoProblem
import app.kimono.data.ManagedApp
import app.kimono.data.ManagedAppSummary
import app.kimono.theme.Kata
import app.kimono.ui.AppAccentTheme
import app.kimono.ui.GroupLabel
import app.kimono.ui.InkBloom
import app.kimono.ui.InkDot
import app.kimono.ui.InkLoader
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/*
 * 管 The household's apps, for administrators: the website's /admin/apps and
 * /admin/apps/[id] on the phone. Each app's own page wears its colour.
 */

/** The dot that says how an app is doing: moss when it runs, suō when it wants you, grey otherwise. */
@Composable
private fun StateDot(state: String, seed: String) {
    val colour = when (state) { "public", "system", "private" -> Kata.moss; "problem" -> Kata.suoDeep; else -> Color(0xFFB9A8A2) }
    InkDot(colour, size = 11.dp, seed = seed)
}

@Composable
fun AppsScreen(admin: AppAdmin, back: () -> Unit, open: (String) -> Unit) {
    var list by remember { mutableStateOf(admin.knownApps()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() { try { list = admin.apps(); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(Unit) { load() }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Apps", onBack = back) }) { padding ->
        KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.padding(padding).fillMaxSize()) {
            val apps = list
            when {
                apps == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                apps == null -> Box(Modifier.padding(24.dp)) { Problem(problem) }
                else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                    itemsIndexed(apps, key = { _, app -> app.id }) { index, app -> AppRow(app, index, apps.size) { open("manage/${app.id}") } }
                }
            }
        }
    }
}

@Composable
private fun AppRow(app: ManagedAppSummary, index: Int, count: Int, onClick: () -> Unit) {
    SegmentedListItem(
        onClick = onClick,
        shapes = ListItemDefaults.segmentedShapes(index, count),
        colors = segmentColors(),
        leadingContent = { InkBloom(app.id, app.accent, app.glyph, 44.dp) },
        supportingContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StateDot(app.state, app.id)
                Text(listOf(app.stateLabel, app.stateDetail).filter { it.isNotBlank() }.joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
        trailingContent = { Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp)) },
    ) { Text(app.name, style = MaterialTheme.typography.bodyLarge) }
}

private enum class AppView(val label: String) { Setup("Setup"), Settings("Settings"), Advanced("Advanced"), Backups("Backups") }

@Composable
fun AppScreen(admin: AppAdmin, id: String, back: () -> Unit) {
    var app by remember { mutableStateOf(admin.knownApp(id)) }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(id) { try { app = admin.app(id); problem = null } catch (p: KimonoProblem) { problem = p.message } }

    /* Runs one change; the answer is the app as it now is. */
    fun change(saved: String = "Saved.", work: suspend () -> ManagedApp) = scope.launch {
        busy = true
        try { app = work(); problem = null; snackbar.showSnackbar(saved) } catch (p: KimonoProblem) { problem = p.message }
        busy = false
    }

    val shown = app
    AppAccentTheme(shown?.accent) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.surface,
            topBar = { KimonoTopBar(shown?.name ?: "", onBack = back) },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            when {
                shown == null && problem == null -> Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                shown == null -> Box(Modifier.padding(padding).padding(24.dp)) { Problem(problem) }
                else -> Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 48.dp)) {
                    AppHeader(shown)
                    if (!shown.configured || shown.setup == null) {
                        Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (shown.setupReady) {
                                Text("Not set up yet.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Seal("Start setup", onClick = { change("Setup started.") { admin.start(id) } }, busy = busy)
                            } else Text("Configuration coming soon.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Problem(problem)
                        }
                    } else {
                        val views = AppView.entries.filter {
                            when (it) { AppView.Setup -> true; AppView.Settings -> shown.settings.isNotEmpty(); AppView.Advanced -> shown.environment.isNotEmpty(); AppView.Backups -> shown.backups != null }
                        }
                        var view by remember { mutableStateOf(AppView.Setup) }
                        PrimaryTabRow(selectedTabIndex = views.indexOf(view).coerceAtLeast(0), containerColor = MaterialTheme.colorScheme.surface) {
                            views.forEach { each -> Tab(selected = view == each, onClick = { view = each }, text = { Text(each.label, style = MaterialTheme.typography.labelLarge) }) }
                        }
                        Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            /* Each view keeps its own answers until saved, and starts again from what was saved. */
                            when (view) {
                                AppView.Setup -> SetupView(shown, busy) { enabled, name, tunnelId, subdomain, zone, domain, internet ->
                                    change { admin.saveSetup(id, enabled, name, tunnelId, subdomain, zone, domain, internet) }
                                }
                                AppView.Settings -> FieldsView(shown.settings, showKeys = false, busy = busy) { values -> change { admin.saveFields(id, "settings", values) } }
                                AppView.Advanced -> FieldsView(shown.environment, showKeys = true, busy = busy) { values -> change { admin.saveFields(id, "environment", values) } }
                                AppView.Backups -> BackupsView(shown, busy) { enabled, items -> change { admin.saveBackups(id, enabled, items) } }
                            }
                            Problem(problem)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AppHeader(app: ManagedApp) {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp, start = 24.dp, end = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        InkBloom(app.id, app.accent, app.glyph, 96.dp)
        Spacer(Modifier.height(10.dp))
        Text(app.name, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        if (app.description.isNotBlank()) Text(app.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            StateDot(app.state, app.id)
            Text(listOf(app.stateLabel, app.stateDetail).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A labelled switch, the whole row pressable. */
@Composable
private fun SwitchRow(label: String, detail: String?, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled) { onChange(!checked) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (!detail.isNullOrBlank()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked, onChange, enabled = enabled)
    }
}

@Composable
private fun Choices(label: String, value: String, options: List<String>, modifier: Modifier = Modifier, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(open, { open = it }, modifier) {
        OutlinedTextField(
            value, {}, readOnly = true, singleLine = true, label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(open, { open = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { onPick(option); open = false }) }
        }
    }
}

@Composable
private fun SetupView(app: ManagedApp, busy: Boolean, save: (Boolean, String, String?, String?, String?, String?, Boolean) -> Unit) {
    val setup = app.setup ?: return
    var enabled by remember(setup) { mutableStateOf(setup.enabled) }
    var name by remember(setup) { mutableStateOf(setup.name) }
    var tunnelId by remember(setup) { mutableStateOf(setup.tunnelId) }
    var internet by remember(setup) { mutableStateOf(setup.internetAccess) }
    val subdomains = remember(setup) { mutableStateMapOf<String, String>().apply { setup.tunnels.forEach { put(it.id, it.subdomain) } } }
    val zones = remember(setup) { mutableStateMapOf<String, String>().apply { setup.tunnels.forEach { t -> t.zone?.let { put(t.id, it) } } } }
    val domains = remember(setup) { mutableStateMapOf<String, String>().apply { setup.tunnels.forEach { put(it.id, it.domain) } } }

    SwitchRow("On", if (app.setupReady) null else "Configuration isn't available yet.", enabled, enabled = app.setupReady) { enabled = it }
    OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    if (!setup.builtIn) {
        GroupLabelTight("Access")
        Column {
            AccessChoice("Keep private", "Reachable only inside your home", tunnelId == null) { tunnelId = null }
            setup.tunnels.forEach { tunnel -> AccessChoice(tunnel.name, tunnel.detail, tunnelId == tunnel.id) { tunnelId = tunnel.id } }
        }
        setup.tunnels.firstOrNull { it.id == tunnelId }?.let { tunnel ->
            if (tunnel.zones.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(subdomains[tunnel.id] ?: "", { subdomains[tunnel.id] = it }, label = { Text("Subdomain") }, singleLine = true, modifier = Modifier.weight(1f))
                Text(".", style = MaterialTheme.typography.titleMedium)
                Choices("Domain", zones[tunnel.id] ?: tunnel.zones.first(), tunnel.zones, Modifier.weight(1.3f)) { zones[tunnel.id] = it }
            } else OutlinedTextField(domains[tunnel.id] ?: "", { domains[tunnel.id] = it }, label = { Text("App name or full hostname") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        SwitchRow("Internet", "Let this app make outbound connections", internet) { internet = it }
    }
    Seal("Save", onClick = {
        val tunnel = setup.tunnels.firstOrNull { it.id == tunnelId }
        save(enabled, name.trim(), tunnelId, tunnel?.let { subdomains[it.id] }, tunnel?.let { zones[it.id] ?: it.zones.firstOrNull() }, tunnel?.let { domains[it.id] }, internet)
    }, busy = busy, modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun GroupLabelTight(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 10.dp))
}

@Composable
private fun AccessChoice(title: String, detail: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected, onClick)
        Spacer(Modifier.width(6.dp))
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The Settings and Advanced views: the app's questions, grouped as the website groups them. */
@Composable
private fun FieldsView(fields: List<AppField>, showKeys: Boolean, busy: Boolean, save: (Map<String, JsonElement>) -> Unit) {
    val edits = remember(fields) { mutableStateMapOf<String, JsonElement>() }
    fields.groupBy { it.group }.forEach { (group, inGroup) ->
        GroupLabelTight(group.replaceFirstChar { it.uppercase() })
        inGroup.forEach { field ->
            val key = if (showKeys) field.key else null
            when (field.kind) {
                "toggle" -> {
                    val on = (edits[field.key] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: (field.value == "on")
                    Column {
                        SwitchRow(field.label, field.description, on) { edits[field.key] = JsonPrimitive(it) }
                        FieldNote(null, key)
                    }
                }
                "select" -> Column {
                    Choices(field.label, (edits[field.key] as? JsonPrimitive)?.content ?: field.value.ifBlank { field.options.firstOrNull() ?: "" }, field.options, Modifier.fillMaxWidth()) { edits[field.key] = JsonPrimitive(it) }
                    FieldNote(field.description, key)
                }
                else -> Column {
                    val secret = field.kind == "secret"
                    OutlinedTextField(
                        (edits[field.key] as? JsonPrimitive)?.content ?: field.value,
                        { edits[field.key] = JsonPrimitive(it) },
                        label = { Text(field.label) },
                        placeholder = (if (secret) null else field.placeholder)?.let { { Text(it) } },
                        singleLine = true,
                        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                        keyboardOptions = KeyboardOptions(keyboardType = when (field.kind) { "number", "bytes" -> KeyboardType.Number; "email" -> KeyboardType.Email; "secret" -> KeyboardType.Password; else -> KeyboardType.Text }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    FieldNote(listOfNotNull(if (secret && field.configured) "Set. Leave blank to keep it." else null, field.description).joinToString(" ").ifBlank { null }, key)
                }
            }
        }
    }
    Seal("Save", onClick = { save(edits.toMap()) }, busy = busy, enabled = edits.isNotEmpty(), modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun FieldNote(description: String?, key: String?) {
    if (key != null) Text(key, fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 2.dp))
    if (!description.isNullOrBlank()) Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 2.dp))
}

@Composable
private fun BackupsView(app: ManagedApp, busy: Boolean, save: (Boolean, Map<String, Boolean>) -> Unit) {
    val backups = app.backups ?: return
    when {
        !backups.storage -> Text("No backup storage yet. Set it up in Backups on the website.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        backups.items.isEmpty() -> Text("This app keeps nothing to back up.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> {
            var enabled by remember(backups) { mutableStateOf(backups.enabled) }
            val kept = remember(backups) { mutableStateMapOf<String, Boolean>().apply { backups.items.forEach { put(it.id, it.kept) } } }
            SwitchRow("Back up this app", null, enabled) { enabled = it }
            GroupLabelTight("Keep")
            backups.items.forEach { item -> SwitchRow(item.label, item.description, kept[item.id] == true, enabled = enabled) { kept[item.id] = it } }
            Seal("Save", onClick = { save(enabled, kept.toMap()) }, busy = busy, modifier = Modifier.padding(top = 6.dp))
        }
    }
}
