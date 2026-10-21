@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ShortNavigationBar
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.ShortNavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.kimono.data.AccountProfile
import app.kimono.data.KimonoProblem
import app.kimono.data.Platform
import app.kimono.data.Session
import app.kimono.data.SessionState
import app.kimono.data.SharedItem
import app.kimono.screens.DetailsScreen
import app.kimono.screens.DevicesScreen
import app.kimono.screens.SignInScreen
import app.kimono.screens.YouScreen
import app.kimono.screens.usePicture
import app.kimono.theme.Kata
import app.kimono.theme.KimonoTheme
import app.kimono.ui.KimonoBranch
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import app.kimono.ui.plumRule
import kotlinx.coroutines.launch

/**
 * The Kimono app. [shared] is whatever another app has just shared into
 * Kimono; the sheet for it rises over whichever screen is open.
 */
@Composable
fun KimonoApp(session: Session, platform: Platform, shared: SharedItem?, onSharedHandled: () -> Unit) {
    KimonoTheme {
        LaunchedEffect(Unit) { session.start() }
        val state by session.state.collectAsState()
        Box(Modifier.fillMaxSize().background(Kata.ground)) {
            when (val s = state) {
                SessionState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
                is SessionState.SignedOut -> SignInScreen(session, s.server)
                is SessionState.SignedIn -> {
                    SignedIn(session, platform, s.me)
                    if (shared != null) ShareSheet(session, s.me, shared, onSharedHandled)
                }
            }
        }
    }
}

@Composable
private fun SignedIn(session: Session, platform: Platform, me: AccountProfile?) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val tab = route == "home" || route == "you"
    Scaffold(
        containerColor = Kata.ground,
        bottomBar = {
            if (tab) ShortNavigationBar(containerColor = Kata.ground) {
                val colors = ShortNavigationBarItemDefaults.colors(selectedIndicatorColor = Kata.suoWash, selectedIconColor = Kata.suoDeep, selectedTextColor = Kata.plum, unselectedIconColor = Kata.inkSoft, unselectedTextColor = Kata.inkSoft)
                ShortNavigationBarItem(selected = route == "home", onClick = { nav.navigate("home") { popUpTo("home") { inclusive = true } } }, icon = { Icon(kimonoIcon("home"), null) }, label = { Text("Home") }, colors = colors)
                ShortNavigationBarItem(selected = route == "you", onClick = { nav.navigate("you") { popUpTo("home") } }, icon = { Portrait(me?.picture, me?.name, me?.username, 24.dp) }, label = { Text("You") }, colors = colors)
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(bottom = if (tab) padding.calculateBottomPadding() else 0.dp)) {
            composable("home") { Home(me) }
            composable("you") { YouScreen(session, platform, me) { nav.navigate(it) } }
            composable("details") { DetailsScreen(session, me) { nav.popBackStack() } }
            composable("devices") { DevicesScreen(session) { nav.popBackStack() } }
        }
    }
}

@Composable
private fun Home(me: AccountProfile?) {
    val first = me?.name?.split(" ")?.firstOrNull()?.takeIf { it.isNotBlank() } ?: me?.username ?: "home"
    Scaffold(containerColor = Kata.ground, topBar = {
        TopAppBar(
            title = { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { KimonoBranch(30.dp); Text("kimono", style = MaterialTheme.typography.titleLarge) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Kata.ground),
            modifier = Modifier.plumRule(),
        )
    }) { padding ->
        Column(Modifier.padding(padding).padding(horizontal = 20.dp, vertical = 22.dp)) {
            Text("Your household", style = MaterialTheme.typography.labelMedium, color = Kata.suoDeep)
            Text(buildAnnotatedString {
                append("Welcome home, ")
                withStyle(SpanStyle(color = Kata.suo)) { append("$first.") }
            }, style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

/** What to do with something shared into Kimono from another app. */
@Composable
private fun ShareSheet(session: Session, me: AccountProfile?, item: SharedItem, done: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val image = item.mimeType.startsWith("image/")
    ModalBottomSheet(onDismissRequest = done, sheetState = sheet, containerColor = Kata.lift, shape = MaterialTheme.shapes.large, dragHandle = { androidx.compose.material3.BottomSheetDefaults.DragHandle(color = Kata.hairDeep) }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(kimonoIcon(if (image) "image" else "folder"), null, tint = Kata.plum, modifier = Modifier.size(28.dp))
                Column {
                    Text(item.name, style = MaterialTheme.typography.titleLarge, maxLines = 1)
                    Text(listOfNotNull(item.mimeType, item.sizeBytes?.let { formatBytes(it) }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Kata.inkSoft)
                }
            }
            Problem(problem)
            if (image) Seal("Use as your picture", busy = busy, modifier = Modifier.fillMaxWidth(), onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        val png = item.pictureBytes() ?: throw KimonoProblem("That image couldn't be read.")
                        session.usePicture(png)
                        done()
                    } catch (p: KimonoProblem) { problem = p.message } catch (_: Exception) { problem = "Your picture could not be saved." }
                    busy = false
                }
            })
            Seal("Save to Drive", tone = SealTone.Quiet, enabled = false, modifier = Modifier.fillMaxWidth(), onClick = {})
        }
    }
}

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "${(bytes / 100_000_000) / 10.0} GB"
    bytes >= 1_000_000 -> "${(bytes / 100_000) / 10.0} MB"
    bytes >= 1_000 -> "${bytes / 1_000} KB"
    else -> "$bytes bytes"
}
