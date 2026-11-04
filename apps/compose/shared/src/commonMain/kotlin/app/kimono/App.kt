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
import androidx.savedstate.read
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.kimono.data.AccountProfile
import app.kimono.data.KimonoProblem
import app.kimono.data.Platform
import app.kimono.data.Session
import app.kimono.data.SessionState
import app.kimono.data.SharedItem
import app.kimono.data.Drive
import app.kimono.screens.DetailsScreen
import app.kimono.screens.DriveModel
import app.kimono.screens.DriveScreen
import app.kimono.screens.FolderScreen
import app.kimono.screens.HomeScreen
import app.kimono.screens.TrashScreen
import app.kimono.screens.UpdateScreen
import app.kimono.data.AppUpdate
import app.kimono.screens.SpaceScreen
import app.kimono.screens.DevicesScreen
import app.kimono.screens.PasswordScreen
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
        /* Asked again whenever the Kimono in use changes (signing in, say). */
        var update by remember { mutableStateOf<AppUpdate?>(null) }
        var later by remember { mutableStateOf(false) }
        val server = when (val s = state) { is SessionState.SignedIn -> s.server; is SessionState.SignedOut -> s.server ?: ""; SessionState.Loading -> null }
        LaunchedEffect(server) { if (server != null) update = session.checkUpdate() }
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
            val required = update?.takeIf { it.required }
            if (required != null) UpdateScreen(required, platform) else when (val s = state) {
                SessionState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
                is SessionState.SignedOut -> SignInScreen(session, s.server)
                is SessionState.SignedIn -> {
                    SignedIn(session, platform, s.me, update?.takeIf { !later }) { later = true }
                    if (shared != null) ShareSheet(session, s.me, shared, onSharedHandled)
                }
            }
        }
    }
}

@Composable
private fun SignedIn(session: Session, platform: Platform, me: AccountProfile?, update: AppUpdate?, onLater: () -> Unit) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val tab = route == "home" || route == "drive" || route == "you"
    val model = remember(session) { DriveModel(Drive(session), platform) }
    fun goTab(to: String) = nav.navigate(to) { popUpTo("home") { inclusive = to == "home" }; launchSingleTop = true }
    /* Drive is the server's to switch on: asked on opening, and the tab and the Files app entry follow. */
    val driveOn by model.drive.driveOn.collectAsState()
    LaunchedEffect(model) { runCatching { model.drive.otherApps() } }
    LaunchedEffect(driveOn) {
        val on = driveOn ?: return@LaunchedEffect
        platform.driveAvailable(on)
        if (!on && route != null && route !in setOf("home", "you", "details", "devices", "password")) goTab("home")
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        bottomBar = {
            if (tab) ShortNavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                val colors = ShortNavigationBarItemDefaults.colors(selectedIndicatorColor = MaterialTheme.colorScheme.secondaryContainer, selectedIconColor = MaterialTheme.colorScheme.primary, selectedTextColor = MaterialTheme.colorScheme.onSurface, unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant, unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant)
                ShortNavigationBarItem(selected = route == "home", onClick = { goTab("home") }, icon = { Icon(kimonoIcon("home"), null) }, label = { Text("Home") }, colors = colors)
                if (driveOn != false) ShortNavigationBarItem(selected = route == "drive", onClick = { goTab("drive") }, icon = { Icon(kimonoIcon("folder"), null) }, label = { Text("Drive") }, colors = colors)
                ShortNavigationBarItem(selected = route == "you", onClick = { goTab("you") }, icon = { Portrait(me?.picture, me?.name, me?.username, 24.dp) }, label = { Text("You") }, colors = colors)
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(bottom = if (tab) padding.calculateBottomPadding() else 0.dp)) {
            composable("home") { HomeScreen(me, model.drive, platform, update, onLater) { goTab("drive") } }
            composable("drive") { DriveScreen(model, me?.username) { nav.navigate(it) } }
            composable("space/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                SpaceScreen(model, id, me?.username, back = { nav.popBackStack() }, left = { nav.popBackStack("drive", inclusive = false) })
            }
            composable("folder/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                FolderScreen(model, platform, id, open = { nav.navigate(it) }, back = { nav.popBackStack() })
            }
            composable("trash") { TrashScreen(model) { nav.popBackStack() } }
            composable("you") { YouScreen(session, platform, me) { nav.navigate(it) } }
            composable("details") { DetailsScreen(session, me) { nav.popBackStack() } }
            composable("devices") { DevicesScreen(session) { nav.popBackStack() } }
            composable("password") { PasswordScreen(session, me) { nav.popBackStack() } }
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
    ModalBottomSheet(onDismissRequest = done, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surfaceContainerLow, shape = MaterialTheme.shapes.large, dragHandle = { androidx.compose.material3.BottomSheetDefaults.DragHandle(color = MaterialTheme.colorScheme.outline) }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(kimonoIcon(if (image) "image" else "folder"), null, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(28.dp))
                Column {
                    Text(item.name, style = MaterialTheme.typography.titleLarge, maxLines = 1)
                    Text(listOfNotNull(item.mimeType, item.sizeBytes?.let { formatBytes(it) }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
