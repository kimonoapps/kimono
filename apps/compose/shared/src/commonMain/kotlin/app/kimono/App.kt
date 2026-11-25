@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono

import app.kimono.ui.InkDialog
import io.ktor.http.decodeURLPart
import app.kimono.data.appFor
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkTitle
import app.kimono.ui.InkSheet
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkMenu
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.unit.coerceIn
import androidx.compose.foundation.layout.navigationBarsPadding
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
import app.kimono.ui.Surface
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
import app.kimono.screens.KimonoReadScreen
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
import app.kimono.ui.LocalWindowWidth
import app.kimono.ui.ProvideWindowWidth
import app.kimono.ui.WidthClass

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
        /* Pulling Home down asks again, and shows what it finds even after Later; no answer keeps what was offered. */
        suspend fun recheck() { session.checkUpdate()?.let { update = it; later = false } }
        /* A surface, not a painted box: it also hands text its on-surface ink, which a bare Text would leave black in dark mode. */
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            /* How wide the window is, measured here so rotation, Split View and Stage Manager all reach every screen. */
            ProvideWindowWidth {
            val required = update?.takeIf { it.required }
            if (required != null) UpdateScreen(required, platform) else when (val s = state) {
                SessionState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                is SessionState.SignedOut -> SignInScreen(session, s.server)
                is SessionState.SignedIn -> {
                    SignedIn(session, platform, s.me, update?.takeIf { !later }, ::recheck) { later = true }
                    if (shared != null) ShareSheet(session, s.me, shared, onSharedHandled)
                }
            }
            }
        }
    }
}

/** The screens someone was on, kept between launches. */
private const val WHERE = "kimono.where"

/** Open on Home: whether a fresh start opens on Home rather than where you were. On unless it's "off". */
object OpenOnHome {
    const val KEY = "kimono.openOnHome"
    /** Set once this run of the app has opened, so only a fresh start goes Home, not a turned screen. */
    internal var started = false
}

@Composable
private fun SignedIn(session: Session, platform: Platform, profile: AccountProfile?, offered: AppUpdate?, recheck: suspend () -> Unit, onLater: () -> Unit) {
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
    val friends = remember(session) { app.kimono.data.Friends(session) }
    val testflight = remember(session) { app.kimono.data.Testflight(session) }
    /* On an iPhone, TestFlight's newest builds: an app older than its build shows Update, as on Android. Asked again on coming back. */
    var flights by remember(session) { mutableStateOf<app.kimono.data.TestflightStanding?>(null) }
    var flightLooks by remember { mutableStateOf(0) }
    androidx.lifecycle.compose.LifecycleResumeEffect(session) { flightLooks++; onPauseOrDispose {} }
    if (platform.os == "ios") LaunchedEffect(session, flightLooks) { testflight.mine()?.let { flights = it } }
    fun here(target: app.kimono.data.LauncherApp) =
        app.kimono.screens.phoneAppHere(target, platform, target.phoneApp?.let { phone -> flights?.let { it.appFor(phone, target.fullName)?.latest } })
    val notes = remember(session) { app.kimono.screens.NotesModel(app.kimono.data.Notes(session, platform), model.drive, platform) }
    val books = remember(session) { app.kimono.data.Books(session) }
    val prayers = remember(session) { app.kimono.prayer.Prayers(session, platform) }
    /* Books downloaded to read offline: kept as long as you're signed in, carrying on in the background of the app. */
    val booksScope = rememberCoroutineScope()
    remember(books) { app.kimono.data.BookKeep(books, platform, booksScope) }
    /* Music's player lives as long as you're signed in, so a song plays on wherever you go in the app. */
    val musicScope = rememberCoroutineScope()
    val player = remember(session) {
        val music = app.kimono.data.Music(session)
        app.kimono.music.MusicPlayer(music, platform, app.kimono.music.MusicDownloads(music, platform, musicScope), musicScope)
    }
    androidx.compose.runtime.DisposableEffect(player) { onDispose { player.stop() } }
    player.me = me?.username
    val inMusic = route?.startsWith("music") == true
    LaunchedEffect(inMusic) { if (inMusic) player.restore() }
    /* The song's bar stays at the bottom wherever you go in Kimono, except over a full-screen reader or a built app. */
    val musicBar = player.current != null && route !in setOf("kimono-read", "code/{id}/app")
    /*
     * Where you were: every screen on the way there is kept as you move, and the app
     * opens on them again, so Back still leads where it did. A notification's screen wins.
     * With Open on Home (Settings; on unless turned off), a fresh start opens on Home instead,
     * even where the system brought the screens back itself; turning the screen doesn't count.
     */
    LaunchedEffect(nav) {
        /* What was kept inside Kimono AI comes first, so the screens it reopens find it. */
        code.loadChoices()
        val fresh = !OpenOnHome.started
        OpenOnHome.started = true
        val homeFirst = platform.readKept(OpenOnHome.KEY) != "off"
        val kept = platform.readKept(WHERE)?.split('\n')?.filter { it.isNotBlank() && it != "home" }.orEmpty()
        if (Opening.route.value == null && fresh && homeFirst) { if (nav.currentDestination?.route != "home") nav.navigate("home") { popUpTo("home") { inclusive = true }; launchSingleTop = true } }
        else if (Opening.route.value == null && !homeFirst) for (to in kept) if (runCatching { nav.navigate(to) }.isFailure) break
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
            target.id == app.kimono.data.Books.APP_ID -> goTab("books")
            target.id == app.kimono.data.Music.APP_ID -> goTab("music")
            target.id == app.kimono.prayer.Prayers.APP_ID -> goTab("prayer")
            /* An app with a phone app of its own: open it when it's here, and when it isn't, its page here to get it. Never its website. */
            /* With a newer version waiting (its tile says Update), its page, which has the update. */
            target.phoneApp != null -> {
                if (here(target).update != null || !app.kimono.screens.openPhoneApp(target.phoneApp, platform)) nav.navigate("app/${target.id}")
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
        if (!on && route != null && route !in setOf("home", "you", "details", "devices", "password", "code", "code/{id}", "code/{id}/app", "ai/new", "ai/new/{in}", "ai/connections", "ai/connections/{app}", "ai/memory", "ai/archived", "ai/a/{token}", "ai/c/{token}", "manage", "manage/{id}", "friends", "people/{username}", "vpn", "vpn/people", "vpn/connect", "app/{id}", "notes", "notes/{notebook}", "note/{id}", "books", "books/shelf", "books/search", "books/downloads", "prayer", "prayer/days") && !route.startsWith("music")) goTab("home")
    }
    /*
     * A wide window (an iPad, or a big Split View half) stands the rooms up the left edge
     * instead of across the bottom; the song's bar stays at the bottom either way.
     */
    val wide = LocalWindowWidth.current != WidthClass.Compact
    val rail = wide && roomApp != null
    val chrome = (tab && !wide) || musicBar
    val launcherOfRoom = model.drive.launcher.collectAsState().value?.firstOrNull { it.id == roomApp?.id }
    /* Kimono's suite down the rail, the same in every app. */
    val railApps = model.drive.launcher.collectAsState().value?.let { app.kimono.screens.suiteOf(it) }.orEmpty()
    fun roomGo(to: String) { if (to == "notes") notes.go(app.kimono.screens.NotePlace.All); goTab(to) }
    fun roomTask() { when (roomApp?.id) { app.kimono.data.Notes.APP_ID -> notes.askSearch(); app.kimono.data.Code.APP_ID -> { AiDrawerAsk.open.value = true; if (route == "ai/connections" || route == "ai/memory") goTab("code") } } }
    Box(Modifier.fillMaxSize()) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        bottomBar = {
            Column {
            if (musicBar) AppAccentTheme(app.kimono.data.Music.GOLD) { app.kimono.screens.MusicBar(player, hem = roomApp == null || wide) }
            /* Notes' Home is all its notes. */
            if (roomApp != null && !wide) RoomBar(roomApp, route, launcherApp = launcherOfRoom, me = me, go = ::roomGo, startTask = ::roomTask, openApps = { appsOpen = true })
            }
        },
    ) { padding ->
        /* A wide window (an iPad) brings every app up as a card in the middle; a phone, as a sheet from the bottom. */
        if (appsOpen && wide) app.kimono.screens.AppsDialog(model.drive, here = ::here, onDismiss = { appsOpen = false }, home = { appsOpen = false; goTab("home") }) { appsOpen = false; openApp(it) }
        else if (appsOpen) app.kimono.screens.AppsSheet(model.drive, here = ::here, onDismiss = { appsOpen = false }, home = { appsOpen = false; goTab("home") }) { appsOpen = false; openApp(it) }
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
        Row(Modifier.fillMaxSize()) {
        if (rail && roomApp != null) RoomRail(roomApp, route, launcherApp = launcherOfRoom, me = me, go = ::roomGo, startTask = ::roomTask, openApps = { appsOpen = true }, apps = railApps, openApp = ::openApp)
        NavHost(
            nav, startDestination = "home",
            /* The bar takes the bottom inset, so a composer under it doesn't stand a whole hem higher. */
            modifier = Modifier.weight(1f).padding(bottom = if (chrome) padding.calculateBottomPadding() else 0.dp).then(if (chrome) Modifier.consumeWindowInsets(PaddingValues(bottom = padding.calculateBottomPadding())) else Modifier),
            enterTransition = { if (between(initialState.destination.route, targetState.destination.route)) throughIn else slideInHorizontally(axis) { it / 8 } + arrive },
            exitTransition = { if (between(initialState.destination.route, targetState.destination.route)) leave else slideOutHorizontally(axis) { -it / 8 } + leave },
            popEnterTransition = { if (between(initialState.destination.route, targetState.destination.route)) throughIn else slideInHorizontally(axis) { -it / 8 } + arrive },
            popExitTransition = { if (between(initialState.destination.route, targetState.destination.route)) leave else slideOutHorizontally(axis) { it / 8 } + leave },
        ) {
            composable("home") { app.kimono.screens.HomeScreen(me, platform, update, onLater, recheck, model.drive, code, vpn, admin, friends, books, here = ::here, open = ::openApp) { to -> if (to == "drive" || to == "code" || to == "vpn") goTab(to) else nav.navigate(to) } }
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
            /* A chat someone shared, by its link: it joins your chats, then opens. */
            composable("ai/c/{token}") { backStack ->
                val token = backStack.arguments?.read { getStringOrNull("token") } ?: ""
                var failed by remember { mutableStateOf<String?>(null) }
                LaunchedEffect(token) {
                    try {
                        val chat = code.join(token)
                        nav.navigate("code/${chat.id}") { popUpTo("ai/c/{token}") { inclusive = true } }
                    } catch (p: KimonoProblem) { failed = p.message }
                }
                AppAccentTheme(aiAccent()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { if (failed == null) InkLoader() else Problem(failed) }
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
            /* Books: Home, your shelf and search, each with a book's sheet over it. */
            fun booksAccent() = model.drive.launcher.value?.firstOrNull { it.id == app.kimono.data.Books.APP_ID }?.accent ?: "#5b6b3f"
            composable("books") {
                AppAccentTheme(booksAccent()) {
                    app.kimono.screens.BooksHomeScreen(books, platform, me?.name?.substringBefore(' ')?.takeIf { it.isNotBlank() }, openSearch = { goTab("books/search") }, openShelf = { goTab("books/shelf") }, openDownloads = { nav.navigate("books/downloads") })
                    /* The first time, with friends: does Books show on your profile? */
                    app.kimono.screens.SharingAsk(friends, "books")
                }
            }
            composable("books/shelf") {
                AppAccentTheme(booksAccent()) { app.kimono.screens.BooksShelfScreen(books, platform, openSearch = { goTab("books/search") }) }
            }
            composable("books/downloads") { AppAccentTheme(booksAccent()) { app.kimono.screens.BooksDownloadsScreen(books, platform) { nav.popBackStack() } } }
            composable("books/search") {
                AppAccentTheme(booksAccent()) { app.kimono.screens.BooksSearchScreen(books, platform, back = { goTab("books") }) }
            }
            /* Music: Home, You and Search in the bar; an artist, album, song, playlist or party opened over them. */
            fun musicGo(to: String) { if (to == "music" || to == "music/you" || to == "music/search") goTab(to) else nav.navigate(to) }
            val gold = app.kimono.data.Music.GOLD
            composable("music") { AppAccentTheme(gold) { app.kimono.screens.MusicHomeScreen(player, me, ::musicGo) { goTab("music/search") } } }
            composable("music/you") { AppAccentTheme(gold) { app.kimono.screens.MusicYouScreen(player, me, ::musicGo) { goTab("music/search") } } }
            composable("music/search") { AppAccentTheme(gold) { app.kimono.screens.MusicSearchScreen(player, ::musicGo) { goTab("music") } } }
            composable("music/liked") { AppAccentTheme(gold) { app.kimono.screens.MusicLikedScreen(player, ::musicGo) { nav.popBackStack() } } }
            composable("music/history") { AppAccentTheme(gold) { app.kimono.screens.MusicHistoryScreen(player, ::musicGo) { nav.popBackStack() } } }
            composable("music/downloads") { AppAccentTheme(gold) { app.kimono.screens.MusicDownloadsScreen(player, remember { platform.freeBytes() }, ::musicGo) { nav.popBackStack() } } }
            composable("music/artist/{id}") { b -> AppAccentTheme(gold) { app.kimono.screens.MusicArtistScreen(player, b.arguments?.read { getStringOrNull("id") } ?: "", ::musicGo) { nav.popBackStack() } } }
            composable("music/album/{id}") { b -> AppAccentTheme(gold) { app.kimono.screens.MusicAlbumScreen(player, b.arguments?.read { getStringOrNull("id") } ?: "", ::musicGo) { nav.popBackStack() } } }
            composable("music/song/{id}") { b -> AppAccentTheme(gold) { app.kimono.screens.MusicSongScreen(player, b.arguments?.read { getStringOrNull("id") } ?: "", ::musicGo) { nav.popBackStack() } } }
            composable("music/playlist/{id}") { b -> AppAccentTheme(gold) { app.kimono.screens.MusicPlaylistScreen(player, b.arguments?.read { getStringOrNull("id") } ?: "", ::musicGo) { nav.popBackStack() } } }
            composable("music/genre/{id}") { b -> AppAccentTheme(gold) { app.kimono.screens.MusicGenreScreen(player, b.arguments?.read { getStringOrNull("id") }?.toIntOrNull() ?: 0, ::musicGo) { nav.popBackStack() } } }
            composable("music/mix/{id}") { b -> AppAccentTheme(gold) { app.kimono.screens.MusicMixScreen(player, (b.arguments?.read { getStringOrNull("id") } ?: "").decodeURLPart(), ::musicGo) { nav.popBackStack() } } }
            composable("music/party/{id}") { b -> AppAccentTheme(gold) { app.kimono.screens.MusicPartyScreen(player, b.arguments?.read { getStringOrNull("id") } ?: "", ::musicGo) { nav.popBackStack() } } }
            /* Prayer: Today (the countdown, today's prayers and the night) and the coming Days. */
            fun prayerAccent() = model.drive.launcher.value?.firstOrNull { it.id == app.kimono.prayer.Prayers.APP_ID }?.accent ?: app.kimono.prayer.Prayers.ACCENT
            composable("prayer") { app.kimono.screens.PrayerTheme(platform, prayerAccent()) { app.kimono.screens.PrayerScreen(prayers, platform) } }
            composable("prayer/days") { app.kimono.screens.PrayerTheme(platform, prayerAccent()) { app.kimono.screens.PrayerDaysScreen(prayers, platform) } }
            /* Notes: the list with its drawer of notebooks, and a note full screen over it. */
            fun notesAccent() = model.drive.launcher.value?.firstOrNull { it.id == app.kimono.data.Notes.APP_ID }?.accent ?: "#b56d78"
            composable("notes") {
                AppAccentTheme(notesAccent()) {
                    NotesWithNote(notes, platform, me?.username, openFull = { nav.navigate("note/$it") }) { open ->
                        app.kimono.screens.NotesScreen(notes, platform, notesAccent(), admin, me?.username, back = { goTab("home") }, open = open) { nav.navigate(it) }
                    }
                }
            }
            /* A notebook opened from Drive. */
            composable("notes/{notebook}") { backStack ->
                val notebook = backStack.arguments?.read { getStringOrNull("notebook") } ?: ""
                LaunchedEffect(notebook) { notes.go(app.kimono.screens.NotePlace.InNotebook(notebook)) }
                AppAccentTheme(notesAccent()) {
                    NotesWithNote(notes, platform, me?.username, openFull = { nav.navigate("note/$it") }) { open ->
                        app.kimono.screens.NotesScreen(notes, platform, notesAccent(), admin, me?.username, back = { nav.popBackStack() }, open = open) { nav.navigate(it) }
                    }
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
            composable("you") { YouScreen(session, platform, me, friends) { nav.navigate(it) } }
            composable("friends") { app.kimono.screens.FriendsScreen(friends, open = { nav.navigate(it) }) { nav.popBackStack() } }
            composable("people/{username}") { backStack ->
                val username = backStack.arguments?.read { getStringOrNull("username") } ?: ""
                app.kimono.screens.ProfileScreen(friends, username, still = platform.reduceMotion, open = { nav.navigate(it) }) { nav.popBackStack() }
            }
            composable("settings") { app.kimono.screens.SettingsScreen(session, platform, me, open = { nav.navigate(it) }) { nav.popBackStack() } }
            composable("details") { DetailsScreen(session, me) { nav.popBackStack() } }
            composable("devices") { DevicesScreen(session) { nav.popBackStack() } }
            composable("password") { PasswordScreen(session, me) { nav.popBackStack() } }
            composable("kimono-read") { KimonoReadScreen(session) { nav.popBackStack() } }
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
    AppAccentTheme(app.kimono.data.Music.GOLD) {
        app.kimono.screens.NowPlaying(player) { to -> nav.navigate(to) }
        /* Asked once, the first time Music is opened with a friend. */
        var askedSharing by remember { mutableStateOf(false) }
        if (inMusic) askedSharing = true
        if (askedSharing) app.kimono.screens.SharingAsk(friends, "music")
        if (inMusic && !player.nowPlayingOpen) player.toast?.let { app.kimono.screens.Toast(it, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = if (chrome) 150.dp else 24.dp)) }
    }
    }
}

/**
 * Notes with room to spare: the list down the left and the note it opened beside it, as
 * Notes on an iPad has it. Narrower than that (a phone, an iPad upright beside its rail, a
 * Split View half) the list is the whole screen and a note opens over it, as before. Turning
 * the iPad upright with a note open carries that note over to its own screen.
 */
@Composable
private fun NotesWithNote(notes: app.kimono.screens.NotesModel, platform: Platform, me: String?, openFull: (String) -> Unit, list: @Composable (open: (String) -> Unit) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val twoPane = maxWidth >= 840.dp
        var selected by rememberSaveable { mutableStateOf<String?>(null) }
        LaunchedEffect(twoPane) { if (!twoPane) selected?.let { selected = null; openFull(it) } }
        val listWidth = (maxWidth * .36f).coerceIn(320.dp, 420.dp)
        Row(Modifier.fillMaxSize()) {
            /* The list keeps its place in the tree either way, so its scroll and drawer survive a turn. */
            Box(if (twoPane) Modifier.width(listWidth).fillMaxHeight() else Modifier.weight(1f).fillMaxHeight()) {
                val pick: (String) -> Unit = { id -> selected = id }
                list(if (twoPane) pick else openFull)
            }
            if (twoPane) {
                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    val id = selected
                    if (id == null) Text("Choose a note, or start a new one.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else key(id) { app.kimono.screens.NoteEditorScreen(notes, platform, id, me, back = { selected = null }) { other -> selected = other } }
                }
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
    InkSheet(onDismissRequest = done, sheetState = sheet) {
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
