@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import app.kimono.data.LauncherApp
import app.kimono.data.Platform
import app.kimono.theme.Kata
import app.kimono.ui.AppAccentTheme
import app.kimono.ui.InkBloom
import app.kimono.ui.InkDot
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon

/*
 * 携 An app with a phone app of its own (Photos is Immich), looked after
 * from Kimono: whether it's on this phone, getting it, and the website's
 * steps for setting it up against your Kimono. Checked again whenever you
 * come back, say from the store.
 */

/** Whether [app]'s own phone app is installed here; null when it has none, or the phone won't say. */
fun installedHere(app: LauncherApp, platform: Platform): Boolean? =
    app.phoneApp?.androidPackage?.takeIf { platform.os == "android" }?.let(platform::isInstalled)

@Composable
fun PhoneAppScreen(app: LauncherApp, platform: Platform, back: () -> Unit) {
    val phone = app.phoneApp ?: return
    var installed by remember { mutableStateOf(installedHere(app, platform)) }
    LifecycleResumeEffect(app.id) { installed = installedHere(app, platform); onPauseOrDispose {} }
    val store = if (platform.os == "ios") app.ios else app.android
    fun get() { store?.let(platform::openUrl) }
    fun open() { if (phone.androidPackage == null || !platform.openInstalled(phone.androidPackage)) get() }

    AppAccentTheme(app.accent) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.surface,
            topBar = { KimonoTopBar(app.name, onBack = back) },
        ) { padding ->
            Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    InkBloom(app.id, app.accent, app.glyph, 96.dp)
                    Spacer(Modifier.height(10.dp))
                    Text(app.fullName, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                    if (app.description.isNotBlank()) Text(app.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
                    installed?.let { on ->
                        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            InkDot(if (on) Kata.moss else Color(0xFFB9A8A2), size = 11.dp, seed = app.id)
                            Text(if (on) "${phone.name} is on this phone" else "${phone.name} isn't on this phone", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    when {
                        installed == true -> Seal("Open ${phone.name}", onClick = ::open)
                        store != null -> Seal("Get ${phone.name}", onClick = ::get)
                    }
                }
                Text("Set it up", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 24.dp, top = 22.dp, bottom = 6.dp))
                phone.steps.forEachIndexed { index, step ->
                    Step(index + 1, step.title) {
                        Text(step.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        when (step.kind) {
                            "download" -> if (installed == true) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(kimonoIcon("check"), null, tint = Kata.moss, modifier = Modifier.size(18.dp))
                                Text("Installed", style = MaterialTheme.typography.labelLarge, color = Kata.mossDeep)
                            } else if (store != null) Seal("Get ${phone.name}", onClick = ::get, tone = SealTone.Quiet, compact = true)
                            "server" -> Copyable(app.web)
                        }
                    }
                }
                Row(Modifier.padding(start = 16.dp, top = 12.dp)) {
                    TextButton(onClick = { platform.openUrl(app.web) }) { Text("Open in browser") }
                    if (phone.guide.isNotBlank()) TextButton(onClick = { platform.openUrl(phone.guide) }) { Text("${phone.name}'s guide") }
                }
            }
        }
    }
}
