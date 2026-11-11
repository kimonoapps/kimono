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
import app.kimono.ui.InkProgress
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import app.kimono.ui.TextButton
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import app.kimono.data.LauncherApp
import app.kimono.data.PhoneApp
import app.kimono.data.Testflight
import app.kimono.data.TestflightApp
import app.kimono.data.appFor
import app.kimono.data.KimonoProblem
import app.kimono.data.Platform
import app.kimono.data.connectLink
import app.kimono.data.phoneAppNewer
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
    /* An iPhone says only whether something answers the app's own link (kimono-photos://); never its version. */
    if (platform.os == "ios") return PhoneAppHere(app.phoneApp?.connectLink?.let { platform.canOpen(it.substringBefore("://") + "://") }, null, null)
    val pkg = app.phoneApp?.androidPackage?.takeIf { platform.os == "android" } ?: return PhoneAppHere(null, null, null)
    val installed = platform.isInstalled(pkg)
    val version = if (installed == true) platform.installedVersion(pkg) else null
    val offered = app.phoneApp.release?.version
    return PhoneAppHere(installed, version, offered?.takeIf { version != null && phoneAppNewer(it, version) })
}

/** Whether [app]'s own phone app is installed here; null when it has none, or the phone won't say. */
fun installedHere(app: LauncherApp, platform: Platform): Boolean? = phoneAppHere(app, platform).installed

@Composable
fun PhoneAppScreen(app: LauncherApp, platform: Platform, testflight: Testflight? = null, back: () -> Unit) {
    val phone = app.phoneApp ?: return
    var here by remember { mutableStateOf(phoneAppHere(app, platform)) }
    LifecycleResumeEffect(app.id) { here = phoneAppHere(app, platform); onPauseOrDispose {} }
    val scope = rememberCoroutineScope()
    var progress by remember { mutableStateOf<Float?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val store = if (platform.os == "ios") app.ios else app.android
    /* Kimono hands this one out itself on Android: it downloads and installs it, rather than sending you to a page. Only with a hash to check it by. */
    val handOut = phone.release?.takeIf { platform.os == "android" && phone.androidPackage != null && it.sha256 != null }

    fun get() {
        if (handOut == null) { store?.let(platform::openUrl); return }
        progress = 0f; problem = null
        scope.launch {
            problem = platform.installApp(handOut.url, phone.androidPackage!!, handOut.sha256!!) { progress = it }
            progress = null
        }
    }
    fun open() { if (!openPhoneApp(phone, platform)) get() }

    /* On an iPhone, an app this Kimono hands out through TestFlight is theirs as soon as they ask. */
    var beta by remember { mutableStateOf<TestflightApp?>(null) }
    var betaEmail by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf(false) }
    /* One of Kimono's own that the last sync hadn't seen in App Store Connect yet: still asked for here, never on the website. */
    fun unseen() = phone.androidPackage?.takeIf { it.startsWith("app.kimono.") }?.let { TestflightApp(it, phone.name, "idle") }
    /* Looked at again on coming back, say from Mail or TestFlight. */
    var looks by remember { mutableStateOf(0) }
    LifecycleResumeEffect(app.id) { looks++; onPauseOrDispose {} }
    if (platform.os == "ios" && testflight != null) LaunchedEffect(app.id, looks) {
        if (!asking) testflight.mine()?.let { mine -> beta = mine.appFor(phone, app.fullName) ?: unseen(); betaEmail = mine.email }
    }
    fun ask(bundleId: String) {
        val flight = testflight ?: return
        asking = true; problem = null
        scope.launch {
            try {
                val mine = flight.ask(bundleId); betaEmail = mine.email
                beta = mine.appFor(phone, app.fullName) ?: unseen().also { problem = "${phone.name} isn't on TestFlight yet. Try again later." }
            }
            catch (failure: KimonoProblem) { problem = failure.message }
            catch (_: Exception) { problem = "Kimono isn't answering. Try again in a moment." }
            asking = false
        }
    }

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
                    val flight = beta
                    when {
                        going != null -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            InkProgress(progress = { going }, modifier = Modifier.width(200.dp))
                            Text(if (going < 1f) "Downloading ${phone.name}" else "Android will ask you to confirm", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        here.update != null -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Seal("Update to ${here.update}", onClick = ::get)
                            Seal("Open", onClick = ::open, tone = SealTone.Quiet)
                        }
                        here.installed == true -> Seal("Open ${phone.name}", onClick = ::open)
                        flight != null -> TestflightAsk(flight, betaEmail, asking, ask = { ask(flight.bundleId) }, openTestflight = { platform.openUrl("itms-beta://") })
                        handOut != null || store != null -> Seal("Get ${phone.name}", onClick = ::get)
                    }
                    Problem(problem)
                }
                /* On an iPhone, until it's installed: the steps to get it through TestFlight. Its own steps after. */
                val flight = beta?.takeIf { here.installed != true }
                if (flight != null) {
                    Text("Get it", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 24.dp, top = 22.dp, bottom = 6.dp))
                    TestflightSteps(flight, betaEmail)
                }
                val steps = if (flight != null) emptyList() else phone.steps
                if (steps.isNotEmpty()) Text("Set it up", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 24.dp, top = 22.dp, bottom = 6.dp))
                steps.forEachIndexed { index, step ->
                    Step(index + 1, step.title) {
                        Text(step.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        when (step.kind) {
                            "download" -> if (here.installed == true) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(kimonoIcon("check"), null, tint = Kata.moss, modifier = Modifier.size(18.dp))
                                Text("Installed", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.tertiary)
                            } else if (beta == null && (handOut != null || store != null)) Seal("Get ${phone.name}", onClick = ::get, tone = SealTone.Quiet, compact = true, enabled = progress == null)
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

/**
 * Opens an app's own phone app when it's here: through its connect link when it has one, so it
 * starts already pointed at its server (it ignores the link once signed in), else plainly.
 * False when it isn't installed (or this phone can't tell).
 */
fun openPhoneApp(phone: PhoneApp, platform: Platform): Boolean {
    if (platform.os == "ios") {
        val link = phone.connectLink ?: return false
        if (platform.canOpen(link.substringBefore("://") + "://") != true) return false
        platform.openUrl(link); return true
    }
    val pkg = phone.androidPackage?.takeIf { platform.os == "android" } ?: return false
    if (platform.isInstalled(pkg) != true) return false
    val link = phone.connectLink ?: return platform.openInstalled(pkg)
    return runCatching { platform.openUrl(link) }.isSuccess || platform.openInstalled(pkg)
}

/** Asking for an iPhone app through TestFlight, and where that stands. */
@Composable
private fun TestflightAsk(app: TestflightApp, email: String?, asking: Boolean, ask: () -> Unit, openTestflight: () -> Unit) {
    val inbox = email?.let { "Check $it" } ?: "Check your email"
    val line = when {
        asking && app.status in setOf("idle", "declined") -> "Sending your request"
        app.status == "idle" || app.status == "declined" -> "Apple emails you an invite to install it with TestFlight"
        app.status == "requested" -> "Waiting for approval"
        app.status == "waiting" -> "Sent. $inbox for Apple's invite"
        app.status == "invited" || app.status == "stuck" -> "$inbox, accept Apple's invite, then open TestFlight"
        app.status == "tester" -> "You're in. Install it from TestFlight"
        app.status == "problem" -> "Apple didn't take your email. Ask whoever runs your Kimono"
        app.status == "none" -> "Your Kimono account needs an email first"
        else -> null
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        line?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center) }
        when (app.status) {
            "idle", "declined" -> Seal("Get ${app.name}", onClick = ask, busy = asking)
            "waiting" -> Seal("Check again", onClick = ask, tone = SealTone.Quiet, busy = asking)
            "invited", "stuck" -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Seal("Open TestFlight", onClick = openTestflight)
                Seal("Check again", onClick = ask, tone = SealTone.Quiet, busy = asking)
            }
            "tester" -> Seal("Open TestFlight", onClick = openTestflight)
        }
    }
}


/** Getting an iPhone app through TestFlight, one step at a time, each ticked once it's done. */
@Composable
private fun TestflightSteps(app: TestflightApp, email: String?) {
    val asked = app.status !in setOf("idle", "declined", "problem", "none")
    val joined = app.status == "tester"
    val steps = listOf(
        Triple("Get access", "Ask for ${app.name} above.", asked),
        Triple("Accept Apple's invite", "Apple emails ${email ?: "you"} an invite to TestFlight.", joined),
        Triple("Install from TestFlight", "Open TestFlight and install ${app.name}, then come back here.", false),
    )
    steps.forEachIndexed { index, (title, description, done) ->
        Step(index + 1, title) {
            if (done) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(kimonoIcon("check"), null, tint = Kata.moss, modifier = Modifier.size(18.dp))
                Text("Done", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.tertiary)
            } else Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
