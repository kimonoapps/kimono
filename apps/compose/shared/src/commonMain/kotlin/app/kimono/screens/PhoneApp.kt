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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import app.kimono.data.LauncherApp
import app.kimono.data.Platform
import app.kimono.data.newerVersion
import app.kimono.theme.Kata
import app.kimono.ui.AppAccentTheme
import app.kimono.ui.InkBloom
import app.kimono.ui.InkDot
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.launch

/*
 * 携 An app with a phone app of its own, looked after from Kimono: whether
 * it's on this phone and which version, getting it, updating it when Kimono
 * hands out a newer one (Kimono Photos), and the website's steps for setting
 * it up. Looked at again whenever you come back, say from Android's installer.
 */

/** How an app's own phone app stands on this phone. Null fields: the phone won't say (an iPhone), or it has none. */
data class PhoneAppHere(val installed: Boolean?, val version: String?, val update: String?)

fun phoneAppHere(app: LauncherApp, platform: Platform): PhoneAppHere {
    val pkg = app.phoneApp?.androidPackage?.takeIf { platform.os == "android" } ?: return PhoneAppHere(null, null, null)
    val installed = platform.isInstalled(pkg)
    val version = if (installed == true) platform.installedVersion(pkg) else null
    val offered = app.phoneApp.release?.version
    return PhoneAppHere(installed, version, offered?.takeIf { version != null && newerVersion(it, version) })
}

/** Whether [app]'s own phone app is installed here; null when it has none, or the phone won't say. */
fun installedHere(app: LauncherApp, platform: Platform): Boolean? = phoneAppHere(app, platform).installed

@Composable
fun PhoneAppScreen(app: LauncherApp, platform: Platform, back: () -> Unit) {
    val phone = app.phoneApp ?: return
    var here by remember { mutableStateOf(phoneAppHere(app, platform)) }
    LifecycleResumeEffect(app.id) { here = phoneAppHere(app, platform); onPauseOrDispose {} }
    val scope = rememberCoroutineScope()
    var progress by remember { mutableStateOf<Float?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val store = if (platform.os == "ios") app.ios else app.android
    /* Kimono hands this one out itself on Android: it downloads and installs it, rather than sending you to a page. */
    val handOut = phone.release?.takeIf { platform.os == "android" && phone.androidPackage != null }

    fun get() {
        if (handOut == null) { store?.let(platform::openUrl); return }
        progress = 0f; problem = null
        scope.launch {
            problem = platform.installApp(handOut.url, phone.androidPackage!!) { progress = it }
            progress = null
        }
    }
    fun open() { if (phone.androidPackage == null || !platform.openInstalled(phone.androidPackage)) get() }

    AppAccentTheme(app.accent) {
        Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar(app.name, onBack = back) }) { padding ->
            Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    InkBloom(app.id, app.accent, app.glyph, 96.dp)
                    Spacer(Modifier.height(10.dp))
                    Text(app.fullName, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                    if (app.description.isNotBlank()) Text(app.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
                    here.installed?.let { on ->
                        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            InkDot(when { here.update != null -> Kata.suoDeep; on -> Kata.moss; else -> Color(0xFFB9A8A2) }, size = 11.dp, seed = app.id)
                            Text(
                                when {
                                    here.update != null -> "${phone.name} ${here.update} is ready"
                                    on -> listOfNotNull("${phone.name} is on this phone", here.version).joinToString(" · ")
                                    else -> "${phone.name} isn't on this phone"
                                },
                                style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    val going = progress
                    when {
                        going != null -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            LinearWavyProgressIndicator(progress = { going }, modifier = Modifier.width(200.dp))
                            Text(if (going < 1f) "Downloading ${phone.name}" else "Android will ask you to confirm", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        here.update != null -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Seal("Update to ${here.update}", onClick = ::get)
                            Seal("Open", onClick = ::open, tone = SealTone.Quiet)
                        }
                        here.installed == true -> Seal("Open ${phone.name}", onClick = ::open)
                        handOut != null || store != null -> Seal("Get ${phone.name}", onClick = ::get)
                    }
                    Problem(problem)
                }
                if (phone.steps.isNotEmpty()) Text("Set it up", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 24.dp, top = 22.dp, bottom = 6.dp))
                phone.steps.forEachIndexed { index, step ->
                    Step(index + 1, step.title) {
                        Text(step.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        when (step.kind) {
                            "download" -> if (here.installed == true) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(kimonoIcon("check"), null, tint = Kata.moss, modifier = Modifier.size(18.dp))
                                Text("Installed", style = MaterialTheme.typography.labelLarge, color = Kata.mossDeep)
                            } else if (handOut != null || store != null) Seal("Get ${phone.name}", onClick = ::get, tone = SealTone.Quiet, compact = true, enabled = progress == null)
                            "server" -> Copyable(app.web)
                            /* Hands the app this Kimono's address (kimono-photos://connect?server=…). */
                            "open" -> step.href?.let { href -> Seal(step.label ?: "Open ${phone.name}", onClick = { platform.openUrl(href) }, tone = SealTone.Quiet, compact = true, enabled = here.installed != false) }
                        }
                    }
                }
                Row(Modifier.padding(start = 16.dp, top = 12.dp)) {
                    TextButton(onClick = { platform.openUrl(app.web) }) { Text("Open in browser") }
                    if (phone.guide.isNotBlank()) TextButton(onClick = { platform.openUrl(phone.guide) }) { Text("Setup guide") }
                }
            }
        }
    }
}
