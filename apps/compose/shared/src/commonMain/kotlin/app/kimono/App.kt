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
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleIn
import androidx.compose.ui.unit.IntOffset
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
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
import app.kimono.screens.CodeScreen
import app.kimono.screens.WorkspaceScreen
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
import app.kimono.ui.InkLoader
import app.kimono.ui.AppAccentTheme

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
                SessionState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
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
    val roomApp = appOfRoom(route)
    val tab = roomApp != null
    val model = remember(session) { DriveModel(Drive(session), platform) }
    val code = remember(session) { app.kimono.data.Code(session) }
    val appAdmin = remember(session) { app.kimono.data.AppAdmin(session) }
    val vpn = remember(session) { app.kimono.data.Vpn(session) }
    val order = remember(session) { app.kimono.screens.AppOrder(platform, session.answers.server) }
    LaunchedEffect(order) { order.load() }
    /* Opened from a notification: go where it said. */
    LaunchedEffect(nav) { Opening.route.collect { to -> if (to != null) { nav.navigate(to); Opening.route.value = null } } }
    val admin = me?.role == "owner" || me?.role == "admin"
    /* The bar's own actions: Code's New task, and the Apps grid that the bloom in the middle brings up. */
    var codeStarting by remember { mutableStateOf(false) }
    var appsOpen by remember { mutableStateOf(false) }
    fun goTab(to: String) = nav.navigate(to) { popUpTo("home") { inclusive = to == "home" }; launchSingleTop = true }
    /* Kimono's own apps open their screens here when the phone has them; anything else, its phone app or its website. */
    fun openApp(target: app.kimono.data.LauncherApp) {
        when {
            target.id == "kimono-drive" -> goTab("drive")
            target.id == app.kimono.data.Code.APP_ID && admin -> goTab("code")
            target.id == "kimono-vpn" -> goTab("vpn")
            /* An app with a phone app of its own: open it when it's here, and when it isn't, its page here to get it. Never its website. */
            target.phoneApp != null -> {
                val pkg = target.phoneApp.androidPackage?.takeIf { platform.os == "android" }
                if (pkg == null || platform.isInstalled(pkg) != true || !platform.openInstalled(pkg)) nav.navigate("app/${target.id}")
            }
            else -> (if (platform.os == "ios") target.ios else target.android)?.let(platform::openUrl) ?: target.web.takeIf { it.isNotBlank() }?.let(platform::openUrl)
        }
    }
    /* Drive is the server's to switch on: asked on opening, and the tab and the Files app entry follow. */
    val driveOn by model.drive.driveOn.collectAsState()
    LaunchedEffect(model) { runCatching { model.drive.otherApps() } }
    LaunchedEffect(driveOn) {
        val on = driveOn ?: return@LaunchedEffect
        platform.driveAvailable(on)
        if (!on && route != null && route !in setOf("home", "you", "details", "devices", "password", "code", "code/{id}", "code/{id}/app", "manage", "manage/{id}", "vpn", "vpn/people", "vpn/connect", "app/{id}")) goTab("home")
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        bottomBar = {
            if (roomApp != null) RoomBar(roomApp, route, launcherApp = model.drive.launcher.collectAsState().value?.firstOrNull { it.id == roomApp.id }, me = me, go = ::goTab, startTask = { codeStarting = true }, openApps = { appsOpen = true })
        },
    ) { padding ->
        if (appsOpen) app.kimono.screens.AppsSheet(model.drive, order, here = { app.kimono.screens.phoneAppHere(it, platform) }, onDismiss = { appsOpen = false }) { appsOpen = false; openApp(it) }
        /*
         * Material's own motion between screens. Tabs fade through: the old one
         * fades quickly, the new one settles in from just smaller. A screen
         * opened from another moves along the shared x-axis: both slide a
         * short way and cross-fade, forward to the left and back to the right,
         * and Android's predictive back gesture scrubs the same motion.
         */
        fun between(from: String?, to: String?) = appOfRoom(from) != null && appOfRoom(to) != null
        val settle = CubicBezierEasing(.05f, .7f, .1f, 1f)
        val axis = tween<IntOffset>(400, easing = settle)
        val arrive = fadeIn(tween(250, delayMillis = 100, easing = LinearOutSlowInEasing))
        val leave = fadeOut(tween(100, easing = FastOutLinearInEasing))
        val throughIn = arrive + scaleIn(tween(300, delayMillis = 100, easing = settle), initialScale = .94f)
        NavHost(
            nav, startDestination = "home", modifier = Modifier.padding(bottom = if (tab) padding.calculateBottomPadding() else 0.dp),
            enterTransition = { if (between(initialState.destination.route, targetState.destination.route)) throughIn else slideInHorizontally(axis) { it / 8 } + arrive },
            exitTransition = { if (between(initialState.destination.route, targetState.destination.route)) leave else slideOutHorizontally(axis) { -it / 8 } + leave },
            popEnterTransition = { if (between(initialState.destination.route, targetState.destination.route)) throughIn else slideInHorizontally(axis) { -it / 8 } + arrive },
            popExitTransition = { if (between(initialState.destination.route, targetState.destination.route)) leave else slideOutHorizontally(axis) { it / 8 } + leave },
        ) {
            composable("home") { app.kimono.screens.HomeScreen(me, platform, update, onLater, model.drive, code, vpn, admin, here = { app.kimono.screens.phoneAppHere(it, platform) }) { to -> if (to == "drive" || to == "code" || to == "vpn") goTab(to) else nav.navigate(to) } }
            /* Code's screens wear Code's colour, as its pages do on the website. */
            composable("code") {
                val codeApp = model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }
                AppAccentTheme(codeApp?.accent) { CodeScreen(code, codeApp, starting = codeStarting, setStarting = { codeStarting = it }, back = { nav.popBackStack() }) { nav.navigate(it) } }
            }
            composable("code/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                AppAccentTheme(model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent) {
                    WorkspaceScreen(code, model.drive, platform, id, open = { nav.navigate(it) }) { nav.popBackStack() }
                }
            }
            composable("code/{id}/app") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                AppAccentTheme(model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent) {
                    WorkspaceScreen(code, model.drive, platform, id, showApp = true, open = { nav.navigate(it) }) { nav.popBackStack() }
                }
            }
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
            composable("app/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                model.drive.launcher.collectAsState().value?.firstOrNull { it.id == id }?.let { found -> app.kimono.screens.PhoneAppScreen(found, platform) { nav.popBackStack() } }
            }
            listOf("vpn", "vpn/people", "vpn/connect").forEach { room ->
                composable(room) { app.kimono.screens.VpnScreen(vpn, platform, model.drive.launcher.value?.firstOrNull { it.id == "kimono-vpn" }, room, go = { goTab(it) }) { nav.popBackStack() } }
            }
            composable("manage") { app.kimono.screens.AppsScreen(appAdmin, back = { nav.popBackStack() }) { nav.navigate(it) } }
            composable("manage/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                app.kimono.screens.AppScreen(appAdmin, id) { nav.popBackStack() }
            }
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
