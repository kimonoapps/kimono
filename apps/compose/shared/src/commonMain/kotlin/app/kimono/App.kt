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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.rememberUpdatedState
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
import app.kimono.screens.WorkspaceScreen
import app.kimono.screens.AiDrawer
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
    LaunchedEffect(Unit) { platform.readKept(app.kimono.theme.Appearance.KEY)?.let { app.kimono.theme.Appearance.choice.value = it } }
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

/** The screens someone was on, kept between launches. */
private const val WHERE = "kimono.where"

@Composable
private fun SignedIn(session: Session, platform: Platform, profile: AccountProfile?, offered: AppUpdate?, onLater: () -> Unit) {
    /*
     * Read through state, not captured: the screens below are drawn from the
     * nav graph's destinations, which keep the values they were first built
     * with. Your profile and an update both arrive after that.
     */
    val me by rememberUpdatedState(profile)
    val update by rememberUpdatedState(offered)
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val roomApp = appOfRoom(route)
    val tab = roomApp != null
    val model = remember(session) { DriveModel(Drive(session), platform) }
    val code = remember(session) { app.kimono.data.Code(session, platform) }
    code.appLink = model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID } ?: code.appLink
    val appAdmin = remember(session) { app.kimono.data.AppAdmin(session) }
    val vpn = remember(session) { app.kimono.data.Vpn(session) }
    val testflight = remember(session) { app.kimono.data.Testflight(session) }
    val notes = remember(session) { app.kimono.screens.NotesModel(app.kimono.data.Notes(session, platform), model.drive, platform) }
    /*
     * Where you were: every screen on the way there is kept as you move, and the app
     * opens on them again, so Back still leads where it did. A notification's screen wins.
     */
    LaunchedEffect(nav) {
        /* What was kept inside Kimono AI comes first, so the screens it reopens find it. */
        code.loadChoices()
        val kept = platform.readKept(WHERE)?.split('\n')?.filter { it.isNotBlank() && it != "home" }.orEmpty()
        if (Opening.route.value == null) for (to in kept) if (runCatching { nav.navigate(to) }.isFailure) break
        nav.currentBackStack.collect { stack ->
            val routes = stack.mapNotNull { e ->
                val pattern = e.destination.route ?: return@mapNotNull null
                Regex("\\{([^}]+)\\}").replace(pattern) { m -> e.arguments?.read { getStringOrNull(m.groupValues[1]) } ?: "" }
            }
            platform.keep(WHERE, routes.joinToString("\n"))
        }
    }
    /* Opened from a notification: go where it said. */
    LaunchedEffect(nav) { Opening.route.collect { to -> if (to != null) { nav.navigate(to); Opening.route.value = null } } }
    val admin by remember { derivedStateOf { me?.role == "owner" || me?.role == "admin" } }
    /* The bar's own action: the Apps grid that the bloom in the middle brings up. */
    var appsOpen by remember { mutableStateOf(false) }
    fun goTab(to: String) = nav.navigate(to) { popUpTo("home") { inclusive = to == "home" }; launchSingleTop = true }
    fun aiAccent() = model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent
    /* Within Kimono AI, a chat or a new chat takes the open one's place; anything else opens over it. */
    fun aiGo(to: String) {
        val chats = setOf("code", "ai/new", "ai/new/{in}", "code/{id}")
        val swap = to == "code" || to == "ai/new" || to.startsWith("ai/new/") || (to.startsWith("code/") && !to.endsWith("/app"))
        val here = nav.currentBackStackEntry?.destination?.route
        nav.navigate(to) { if (swap && here in chats) popUpTo(here!!) { inclusive = true }; launchSingleTop = true }
    }
    /* Kimono's own apps open their screens here when the phone has them; anything else, its phone app or its website. */
    fun openApp(target: app.kimono.data.LauncherApp) {
        when {
            target.id == "kimono-drive" -> goTab("drive")
            target.id == app.kimono.data.Code.APP_ID -> goTab("code")
            target.id == "kimono-vpn" -> goTab("vpn")
            target.id == app.kimono.data.Notes.APP_ID -> goTab("notes")
            /* An app with a phone app of its own: open it when it's here, and when it isn't, its page here to get it. Never its website. */
            target.phoneApp != null -> {
                if (!app.kimono.screens.openPhoneApp(target.phoneApp, platform)) nav.navigate("app/${target.id}")
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
        if (!on && route != null && route !in setOf("home", "you", "details", "devices", "password", "code", "code/{id}", "code/{id}/app", "ai/new", "ai/new/{in}", "ai/connections", "ai/connections/{app}", "ai/memory", "ai/archived", "ai/a/{token}", "manage", "manage/{id}", "vpn", "vpn/people", "vpn/connect", "app/{id}", "notes", "notes/{notebook}", "note/{id}")) goTab("home")
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        bottomBar = {
            if (roomApp != null) RoomBar(
                roomApp, route, launcherApp = model.drive.launcher.collectAsState().value?.firstOrNull { it.id == roomApp.id }, me = me,
                /* Notes' Home is all its notes. */
                go = { to -> if (to == "notes") notes.go(app.kimono.screens.NotePlace.All); goTab(to) },
                startTask = { if (roomApp.id == app.kimono.data.Notes.APP_ID) notes.askSearch() }, openApps = { appsOpen = true },
            )
        },
    ) { padding ->
        if (appsOpen) app.kimono.screens.AppsSheet(model.drive, here = { app.kimono.screens.phoneAppHere(it, platform) }, onDismiss = { appsOpen = false }, home = { appsOpen = false; goTab("home") }) { appsOpen = false; openApp(it) }
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
            composable("home") { app.kimono.screens.HomeScreen(me, platform, update, onLater, model.drive, code, vpn, admin, here = { app.kimono.screens.phoneAppHere(it, platform) }, open = ::openApp) { to -> if (to == "drive" || to == "code" || to == "vpn") goTab(to) else nav.navigate(to) } }
            /*
             * Kimono AI is one chat at a time with the rest in its drawer, as on the website. It opens
             * on a new chat; a chat chosen in the drawer takes the open one's place, so Back leaves it.
             */
            composable("code") {
                AppAccentTheme(aiAccent()) {
                    AiDrawer(code, admin, null, ::aiGo) { menu ->
                        app.kimono.screens.NewChatScreen(code, model.drive, platform, admin, null, back = { nav.popBackStack() }, menu = menu, open = ::aiGo) { made ->
                            nav.navigate("code/${made.id}") { popUpTo("code") { inclusive = true } }
                        }
                    }
                }
            }
            /* A new chat in one of the person's projects, or on a repository. */
            listOf("ai/new", "ai/new/{in}").forEach { room ->
                composable(room) { backStack ->
                    val folder = backStack.arguments?.read { getStringOrNull("in") }
                    AppAccentTheme(aiAccent()) {
                        AiDrawer(code, admin, null, ::aiGo) { menu ->
                            app.kimono.screens.NewChatScreen(code, model.drive, platform, admin, folder, back = { nav.popBackStack() }, menu = menu, open = ::aiGo) { made ->
                                nav.navigate("code/${made.id}") { popUpTo(room) { inclusive = true } }
                            }
                        }
                    }
                }
            }
            composable("ai/connections") {
                AppAccentTheme(model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent) {
                    app.kimono.screens.ConnectionsScreen(code, platform, back = { nav.popBackStack() }) { nav.navigate(it) }
                }
            }
            composable("ai/connections/{app}") { backStack ->
                val slug = backStack.arguments?.read { getStringOrNull("app") } ?: ""
                AppAccentTheme(model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent) {
                    app.kimono.screens.AppConnectionScreen(code, platform, slug) { nav.popBackStack() }
                }
            }
            composable("ai/archived") {
                AppAccentTheme(model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent) {
                    app.kimono.screens.ArchivedScreen(code, back = { nav.popBackStack() }) { nav.navigate(it) }
                }
            }
            composable("ai/memory") {
                AppAccentTheme(model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent) {
                    app.kimono.screens.MemoryScreen(code) { nav.popBackStack() }
                }
            }
            /* An artifact someone shared, by its link. */
            composable("ai/a/{token}") { backStack ->
                val token = backStack.arguments?.read { getStringOrNull("token") } ?: ""
                AppAccentTheme(model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent) {
                    app.kimono.screens.SharedArtifactScreen(code, platform, token) { nav.popBackStack() }
                }
            }
            composable("code/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                AppAccentTheme(aiAccent()) {
                    AiDrawer(code, admin, id, ::aiGo) { menu ->
                        WorkspaceScreen(code, model.drive, platform, id, chats = menu, open = ::aiGo) { nav.popBackStack() }
                    }
                }
            }
            composable("code/{id}/app") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                AppAccentTheme(model.drive.knownApps()?.firstOrNull { it.id == app.kimono.data.Code.APP_ID }?.accent) {
                    WorkspaceScreen(code, model.drive, platform, id, showApp = true, open = { nav.navigate(it) }) { nav.popBackStack() }
                }
            }
            /* Notes: the list with its drawer of notebooks, and a note full screen over it. */
            fun notesAccent() = model.drive.launcher.value?.firstOrNull { it.id == app.kimono.data.Notes.APP_ID }?.accent ?: "#b56d78"
            composable("notes") {
                AppAccentTheme(notesAccent()) {
                    app.kimono.screens.NotesScreen(notes, platform, notesAccent(), admin, me?.username, back = { goTab("home") }, open = { nav.navigate("note/$it") }) { nav.navigate(it) }
                }
            }
            /* A notebook opened from Drive. */
            composable("notes/{notebook}") { backStack ->
                val notebook = backStack.arguments?.read { getStringOrNull("notebook") } ?: ""
                LaunchedEffect(notebook) { notes.go(app.kimono.screens.NotePlace.InNotebook(notebook)) }
                AppAccentTheme(notesAccent()) {
                    app.kimono.screens.NotesScreen(notes, platform, notesAccent(), admin, me?.username, back = { nav.popBackStack() }, open = { nav.navigate("note/$it") }) { nav.navigate(it) }
                }
            }
            composable("note/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                AppAccentTheme(notesAccent()) {
                    app.kimono.screens.NoteEditorScreen(notes, platform, id, me?.username, back = { nav.popBackStack() }) { other -> nav.navigate("note/$other") }
                }
            }
            composable("drive") { DriveScreen(model, me?.username) { nav.navigate(it) } }
            composable("space/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                SpaceScreen(model, id, me?.username, back = { nav.popBackStack() }, left = { nav.popBackStack("drive", inclusive = false) })
            }
            composable("folder/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                FolderScreen(model, platform, id, me = me?.username, open = { nav.navigate(it) }, back = { nav.popBackStack() })
            }
            composable("drive/shared") { app.kimono.screens.SharedWithYouScreen(model, platform, me?.username, open = { nav.navigate(it) }) { nav.popBackStack() } }
            composable("trash") { TrashScreen(model) { nav.popBackStack() } }
            composable("you") { YouScreen(session, platform, me) { nav.navigate(it) } }
            composable("details") { DetailsScreen(session, me) { nav.popBackStack() } }
            composable("devices") { DevicesScreen(session) { nav.popBackStack() } }
            composable("password") { PasswordScreen(session, me) { nav.popBackStack() } }
            composable("app/{id}") { backStack ->
                val id = backStack.arguments?.read { getStringOrNull("id") } ?: ""
                model.drive.launcher.collectAsState().value?.firstOrNull { it.id == id }?.let { found -> app.kimono.screens.PhoneAppScreen(found, platform, testflight) { nav.popBackStack() } }
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
