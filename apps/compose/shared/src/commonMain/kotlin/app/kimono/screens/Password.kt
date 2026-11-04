@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.kimono.data.AccountProfile
import app.kimono.data.KimonoProblem
import app.kimono.data.PASSWORD_MIN_LENGTH
import app.kimono.data.Session
import app.kimono.data.passwordRules
import app.kimono.theme.Kata
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.kimonoIcon
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import app.kimono.ui.InkRing

@Composable
fun PasswordScreen(session: Session, me: AccountProfile?, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var signOutOthers by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val rules = passwordRules(next, me?.username ?: "", me?.name)
    val ready = current.isNotEmpty() && rules.met && next == again
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        KimonoTopBar("Password", onBack = back) {
            Seal("Change", compact = true, busy = busy, enabled = ready, onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        val body = buildJsonObject { put("current", current); put("next", next); put("confirm", again); put("signOutOthers", signOutOthers) }
                        session.call("/api/v1/me/password", HttpMethod.Post) { contentType(ContentType.Application.Json); setBody(Json.encodeToString(JsonObject.serializer(), body)) }
                        /* Signing out everywhere includes this phone. */
                        if (signOutOthers) session.signOut() else back()
                    } catch (p: KimonoProblem) { problem = p.message }
                    busy = false
                }
            })
        }
    }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            OutlinedTextField(current, { current = it }, label = { Text("Current password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(next, { next = it }, label = { Text("New password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Rule(rules.long, "At least $PASSWORD_MIN_LENGTH characters")
                Rule(rules.notName, "Not your name or username")
            }
            OutlinedTextField(again, { again = it }, label = { Text("Type it again") }, singleLine = true, isError = again.isNotEmpty() && again != next, visualTransformation = PasswordVisualTransformation(), colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
            if (again.isNotEmpty() && again != next) Problem("The two new passwords don’t match.")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Sign out everywhere, this phone too", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Switch(
                    checked = signOutOthers,
                    onCheckedChange = { signOutOthers = it },
                    colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.colorScheme.primary, checkedThumbColor = MaterialTheme.colorScheme.surfaceContainerLow, uncheckedTrackColor = MaterialTheme.colorScheme.surfaceContainerHigh, uncheckedThumbColor = MaterialTheme.colorScheme.outline, uncheckedBorderColor = MaterialTheme.colorScheme.outline),
                )
            }
            Problem(problem)
        }
    }
}

/* A rule changes form when met: the brushed ring fills with moss and gains a brushed tick. */
@Composable
private fun Rule(met: Boolean, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        InkRing(met, size = 24.dp, seed = text)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = if (met) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
