package app.kimono.watch.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.watch.data.Accounts
import app.kimono.watch.data.Profile
import app.kimono.watch.data.SignInNext
import app.kimono.watch.model.WatchProblem
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import kotlinx.coroutines.launch

const val DEFAULT_SERVER = "https://www.kimonolabs.dev"

/**
 * "Who's watching?": everyone signed in on this device. Picking a face spins
 * the ring round it while their Kimono is reached; the last face adds someone.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProfilesScreen(accounts: Accounts, tv: Boolean, onChosen: (Profile) -> Unit, onAdd: () -> Unit) {
    val profiles by accounts.profiles.collectAsState()
    var busy by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Profile?>(null) }
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    val face = if (tv) 132.dp else 104.dp
    Box(Modifier.fillMaxSize().background(Night.bg).systemBarsPadding(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 16.dp, vertical = 48.dp)) {
            Seal(44.dp)
            Spacer(Modifier.height(28.dp))
            Text("Who's watching?", style = display(if (tv) 44 else 32, FontWeight.SemiBold).copy(letterSpacing = androidx.compose.ui.unit.TextUnit.Unspecified))
            Spacer(Modifier.height(36.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(if (tv) 32.dp else 20.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                profiles.orEmpty().forEachIndexed { i, p ->
                    FaceButton(p.shown, face, loading = busy == p.key, dim = busy != null && busy != p.key, modifier = if (i == 0) Modifier.focusRequester(first) else Modifier,
                        onLong = { confirm = p },
                        onClick = {
                            if (busy != null) return@FaceButton
                            busy = p.key; problem = null
                            scope.launch {
                                try {
                                    accounts.ready(p)
                                    accounts.choose(p)
                                    onChosen(p)
                                } catch (e: WatchProblem) { problem = e.message }
                                busy = null
                            }
                        }) { Face(p, face, corner = 0f) }
                }
                FaceButton("Add", face, loading = false, dim = busy != null, modifier = if (profiles.isNullOrEmpty()) Modifier.focusRequester(first) else Modifier, onClick = onAdd) {
                    Box(Modifier.size(face).background(Night.surface3), contentAlignment = Alignment.Center) { I(Ic.add, face * 0.38f, Night.fg2) }
                }
            }
            problem?.let { Text(it, style = ui(14, color = Night.blush), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 24.dp)) }
        }
        confirm?.let { p ->
            Dialog(onDismiss = { confirm = null }) {
                Text("Sign ${p.shown} out of Watch?", style = ui(18, FontWeight.Bold))
                Spacer(Modifier.height(18.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PaperButton("Cancel", null, { confirm = null }, tonal = true)
                    PaperButton("Sign out", null, { scope.launch { accounts.remove(p); confirm = null } })
                }
            }
        }
    }
    LaunchedEffect(profiles != null) { runCatching { first.requestFocus() } }
}

/** A face that grows and rounds into a circle with a paper ring when pointed at, as in the demo. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FaceButton(name: String, size: Dp, loading: Boolean, dim: Boolean, modifier: Modifier = Modifier, onLong: (() -> Unit)? = null, onClick: () -> Unit, face: @Composable () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val hovered by source.collectIsHoveredAsState()
    val pressed by source.collectIsPressedAsState()
    val on = focused || hovered || pressed
    val scale by animateFloatAsState(if (on) 1.06f else 1f, spring(dampingRatio = 0.5f, stiffness = 400f), label = "s")
    val corner by animateDpAsState(if (on) size / 2 else size * 0.28f, spring(dampingRatio = 0.6f, stiffness = 400f), label = "c")
    Column(modifier.alpha(if (dim) 0.35f else 1f).combinedClickable(source, null, onLongClick = onLong, onClick = onClick), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(contentAlignment = Alignment.Center) {
            Box(Modifier.graphicsLayer { scaleX = scale; scaleY = scale }.clip(RoundedCornerShape(corner)).then(if (on) Modifier.border(3.dp, Night.paper, RoundedCornerShape(corner)) else Modifier)) { face() }
            if (loading) WavyRing(size + 28.dp, Night.paper, radius = 32f, amp = 2.2f, waves = 9, stroke = 3f, periodMs = 1400)
        }
        Text(name, style = ui(16, color = if (on) Night.fg else Night.fg3))
    }
}

/** A small dialog in the night palette. */
@Composable
fun Dialog(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.clip(RoundedCornerShape(14.dp)).background(Night.surface).padding(22.dp), horizontalAlignment = Alignment.Start) { content() }
    }
}

/** Signing in with a Kimono account: the address, username and password, and a code when the account uses one. */
@Composable
fun SignInScreen(accounts: Accounts, tv: Boolean, onDone: (Profile) -> Unit, onCancel: (() -> Unit)?) {
    val known = accounts.profiles.value.orEmpty().lastOrNull()?.server
    var address by remember { mutableStateOf(known ?: DEFAULT_SERVER) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var needCode by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    val firstField = remember { FocusRequester() }
    fun go() {
        if (working) return
        working = true; problem = null
        scope.launch {
            try {
                val next = if (needCode) accounts.signInCode(code) else accounts.signIn(address, username, password)
                if (next == SignInNext.Code) { needCode = true } else { keyboard?.hide(); focusManager.clearFocus(); accounts.active.value?.let(onDone) }
            } catch (e: WatchProblem) { problem = e.message }
            working = false
        }
    }
    Box(Modifier.fillMaxSize().background(Night.bg).systemBarsPadding().imePadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Seal(44.dp)
            Spacer(Modifier.height(24.dp))
            Text(if (needCode) "Enter your code" else "Sign in to Kimono", style = display(if (tv) 36 else 30, FontWeight.SemiBold))
            Spacer(Modifier.height(28.dp))
            if (needCode) {
                Field(code, { code = it }, "Code from your authenticator app", KeyboardType.Number, done = ::go, modifier = Modifier.focusRequester(firstField))
            } else {
                Field(address, { address = it }, "Kimono address", KeyboardType.Uri, modifier = Modifier.focusRequester(firstField))
                Spacer(Modifier.height(10.dp))
                Field(username, { username = it }, "Username", KeyboardType.Text)
                Spacer(Modifier.height(10.dp))
                Field(password, { password = it }, "Password", KeyboardType.Password, secret = true, done = ::go)
            }
            problem?.let { Text(it, style = ui(14, color = Night.blush), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp)) }
            Spacer(Modifier.height(22.dp))
            Box(contentAlignment = Alignment.Center) {
                PaperButton(if (working) "" else if (needCode) "Continue" else "Sign in", null, ::go, Modifier.fillMaxWidth())
                if (working) WavyRing(26.dp, Night.ink, stroke = 6f)
            }
            if (onCancel != null) {
                Spacer(Modifier.height(10.dp))
                PaperButton("Cancel", null, { accounts.cancelSignIn(); onCancel() }, Modifier.fillMaxWidth(), tonal = true)
            }
        }
    }
    LaunchedEffect(needCode) { runCatching { firstField.requestFocus() } }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, type: KeyboardType, secret: Boolean = false, done: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    BasicTextField(value, onChange, modifier.fillMaxWidth(), singleLine = true, interactionSource = source,
        textStyle = ui(17), cursorBrush = SolidColor(Night.suo),
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = if (done != null) ImeAction.Done else ImeAction.Next, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { done?.invoke() }),
        decorationBox = { inner ->
            Column(Modifier.clip(RoundedCornerShape(12.dp)).background(Night.surface2).border(if (focused) 2.dp else 0.dp, if (focused) Night.blush else Color.Transparent, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 10.dp)) {
                Text(label, style = ui(12, color = Night.fg3))
                inner()
            }
        })
}

