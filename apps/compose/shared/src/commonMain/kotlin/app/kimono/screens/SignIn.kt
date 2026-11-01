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
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
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

@Composable
fun SignInScreen(session: Session, rememberedServer: String?) {
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf(rememberedServer?.removePrefix("https://") ?: "") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val go: () -> Unit = {
        busy = true
        problem = null
        scope.launch {
            try { session.signIn(address) } catch (p: KimonoProblem) { problem = p.message } catch (_: Exception) { problem = "Signing in didn't finish. Try again." }
            busy = false
        }
    }
    /* Kimono's branch on Material's flower, turning slowly: the bloom that greets you. */
    val turn = rememberInfiniteTransition()
    val angle by turn.animateFloat(0f, 360f, infiniteRepeatable(tween(24_000, easing = LinearEasing)))
    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
        Column(Modifier.fillMaxWidth().align(Alignment.Center).padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.size(148.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.fillMaxSize().graphicsLayer { rotationZ = angle }.background(MaterialTheme.colorScheme.primaryContainer, MaterialShapes.Flower.toShape()))
                KimonoBranch(size = 72.dp, tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Text("Kimono", style = MaterialTheme.typography.displayMedium)
            Text("Sign in with your Kimono account.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                label = { Text("Your Kimono's address") },
                placeholder = { Text("kimono.example") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onGo = { if (address.isNotBlank() && !busy) go() }),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            if (busy) LinearWavyProgressIndicator(modifier = Modifier.fillMaxWidth())
            Problem(problem)
            Seal(if (busy) "Opening sign-in" else "Continue", onClick = go, enabled = address.isNotBlank(), busy = busy, modifier = Modifier.fillMaxWidth())
        }
        Text("Only the people on your Kimono can sign in.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.align(Alignment.BottomCenter).padding(24.dp))
    }
}
