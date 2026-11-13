@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.kimono.data.KimonoProblem
import app.kimono.data.Session
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * 携 Set up Kimono Read: an e-reader joins Kimono with nothing typed on it.
 *
 * The reader opens its own Wi-Fi ("Kimono Read-…") and serves a setup page.
 * This screen asks the Portal for a one-time setup link carrying this Kimono's
 * address and a ticket; once the phone has joined the reader's Wi-Fi, opening
 * the link shows that page, where the person only picks their home Wi-Fi and
 * types its password. The reader then joins it and pairs itself with the
 * ticket. A reader that shows a pairing code instead is paired from here too.
 */

@Serializable
private data class SetupLink(val setupUrl: String, val expiresIn: Int = 0)

@Serializable
private data class PairedReader(val id: String, val name: String, val model: String, val pairedAt: String, val lastSeen: String? = null)

@Serializable
private data class PairedReaders(val devices: List<PairedReader> = emptyList())

private val readJson = Json { ignoreUnknownKeys = true }

@Composable
fun KimonoReadScreen(session: Session, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    var link by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var readers by remember { mutableStateOf<List<PairedReader>>(emptyList()) }

    suspend fun reload() {
        readers = runCatching { readJson.decodeFromString(PairedReaders.serializer(), session.call("/api/v1/devices")).devices }.getOrDefault(readers)
    }
    LaunchedEffect(Unit) {
        reload()
        /* The link is made while the phone still has its own Wi-Fi: on the reader's there's no Kimono. */
        link = runCatching { readJson.decodeFromString(SetupLink.serializer(), session.call("/api/v1/devices/tickets", HttpMethod.Post)).setupUrl }
            .onFailure { problem = (it as? KimonoProblem)?.message ?: "Kimono couldn't make a setup link." }.getOrNull()
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Kimono Read", onBack = back) }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Your phone does the typing. The reader never asks for anything.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Step(1, "Open Kimono Read on the reader. It shows “Set up with your phone” and a Wi-Fi called Kimono Read-….")
            Step(2, "Join that Wi-Fi on this phone: scan the QR code on the reader, or pick it in Wi-Fi settings. If a sign-in sheet opens, close it.")
            Step(3, "Come back here and tap Continue on the reader. Pick your home Wi-Fi and type its password. The reader joins it and pairs itself.")
            Seal("Continue on the reader", enabled = link != null, onClick = { link?.let { uri.openUri(it) } })

            Text("Reader showing a code?", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(code, { code = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(6) }, label = { Text("Pairing code") }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.weight(1f))
                Seal("Pair", compact = true, busy = busy, enabled = code.length == 6, onClick = {
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            val body = buildJsonObject { put("code", code) }
                            session.call("/api/v1/devices/pair", HttpMethod.Post) { contentType(ContentType.Application.Json); setBody(Json.encodeToString(JsonObject.serializer(), body)) }
                            notice = "Paired. The reader shows your shelf in a moment."
                            code = ""
                            reload()
                        } catch (p: KimonoProblem) { problem = p.message }
                        busy = false
                    }
                })
            }
            notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary) }
            Problem(problem)

            if (readers.isNotEmpty()) {
                Text("Paired readers", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
                readers.forEach { reader ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.weight(1f)) {
                            Text(reader.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                            Text(reader.lastSeen?.let { "Last synced ${it.take(10)}" } ?: "Not synced yet", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Seal("Unpair", compact = true, onClick = {
                            scope.launch {
                                try { session.call("/api/v1/devices/${reader.id}", HttpMethod.Delete); reload() }
                                catch (p: KimonoProblem) { problem = p.message }
                            }
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun Step(number: Int, text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("$number", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}
