@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.toShape
import androidx.compose.ui.graphics.graphicsLayer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import app.kimono.data.SignInNext
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.kimono.data.KimonoProblem
import app.kimono.data.Session
import app.kimono.theme.Kata
import app.kimono.ui.KimonoBranch
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import kotlinx.coroutines.launch

@Composable
fun kataFieldColors() = OutlinedTextFieldDefaults.colors()

/** Where Kimono lives unless you run your own. */
const val DEFAULT_SERVER = "https://www.kimonolabs.dev"

@Composable
fun SignInScreen(session: Session, rememberedServer: String?) {
    val scope = rememberCoroutineScope()
    /* Your own Kimono, if you signed in to one before; kimonolabs.dev otherwise. */
    var custom by remember { mutableStateOf(rememberedServer != null && rememberedServer.trimEnd('/') != DEFAULT_SERVER) }
    var address by remember { mutableStateOf(rememberedServer?.takeIf { custom }?.removePrefix("https://") ?: "") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var askingCode by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val target = if (custom) address else DEFAULT_SERVER
    val ready = if (askingCode) code.length >= 6 else target.isNotBlank() && username.isNotBlank() && password.isNotEmpty()
    val go: () -> Unit = {
        busy = true
        problem = null
        scope.launch {
            try {
                val next = if (askingCode) session.signInCode(code) else session.signIn(target, username, password)
                askingCode = next == SignInNext.Code
                if (askingCode) code = ""
            } catch (p: KimonoProblem) { problem = p.message } catch (_: Exception) { problem = "Signing in didn't finish. Try again." }
            busy = false
        }
    }
    /* Kimono's branch on Material's flower, turning slowly: the bloom that greets you. */
    val turn = rememberInfiniteTransition()
    val angle by turn.animateFloat(0f, 360f, infiniteRepeatable(tween(24_000, easing = LinearEasing)))
    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
        Column(
            Modifier.fillMaxWidth().align(Alignment.Center).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(128.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.fillMaxSize().graphicsLayer { rotationZ = angle }.background(MaterialTheme.colorScheme.primaryContainer, MaterialShapes.Flower.toShape()))
                KimonoBranch(size = 64.dp, tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Text("Kimono", style = MaterialTheme.typography.displayMedium)
            Text(
                if (askingCode) "Enter the code from your authenticator app." else "Sign in with your Kimono account.",
                style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            )
            if (askingCode) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.filter { c -> c.isLetterOrDigit() }.take(12) },
                    label = { Text("Code") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { if (ready && !busy) go() }),
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            } else {
                if (custom) OutlinedTextField(
                    value = address,
                    onValueChange = { address = it },
                    label = { Text("Your Kimono's address") },
                    placeholder = { Text("kimono.example") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    label = { Text("Username or email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false, capitalization = KeyboardCapitalization.None),
                    modifier = Modifier.fillMaxWidth().padding(top = if (custom) 0.dp else 8.dp),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onGo = { if (ready && !busy) go() }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (busy) LinearWavyProgressIndicator(modifier = Modifier.fillMaxWidth())
            Problem(problem)
            Seal(if (busy) "Signing in" else "Continue", onClick = go, enabled = ready, busy = busy, modifier = Modifier.fillMaxWidth())
            if (askingCode) TextButton(onClick = { session.cancelSignIn(); askingCode = false; problem = null }, enabled = !busy) {
                Text("Start again", style = MaterialTheme.typography.labelMedium)
            } else TextButton(onClick = { custom = !custom; problem = null }, enabled = !busy) {
                Text(if (custom) "Use kimonolabs.dev" else "Use a different address", style = MaterialTheme.typography.labelMedium)
            }
            Text("Only the people on your Kimono can sign in.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 24.dp, bottom = 24.dp))
        }
    }
}
