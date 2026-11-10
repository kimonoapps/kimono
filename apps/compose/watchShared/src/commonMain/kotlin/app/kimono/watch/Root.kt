@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

package app.kimono.watch

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import app.kimono.watch.data.Profile
import app.kimono.watch.ink.InkLoader
import app.kimono.watch.model.Card
import app.kimono.watch.phone.Go
import app.kimono.watch.phone.PhoneShell
import app.kimono.watch.phone.SearchScreen
import app.kimono.watch.phone.SettingsScreen
import app.kimono.watch.phone.TitleScreen
import app.kimono.watch.theme.Night
import app.kimono.watch.ui.HomeViewModel
import app.kimono.watch.ui.HotViewModel
import app.kimono.watch.ui.ListViewModel
import app.kimono.watch.ui.ProfilesScreen
import app.kimono.watch.ui.Screen
import app.kimono.watch.ui.SearchViewModel
import app.kimono.watch.ui.SignInScreen
import app.kimono.watch.ui.TitleViewModel
import app.kimono.watch.ui.ToastHost
import app.kimono.watch.ui.WatchBloom

private sealed interface Phase {
    data object Loading : Phase
    data object Profiles : Phase
    /** [server]: a Kimono named by a connect link, or null for the usual. */
    data class SignIn(val first: Boolean, val server: String? = null, val back: Profile? = null) : Phase
    data class Shell(val profile: Profile) : Phase
}

/** A screen on the stack, with the view models that live as long as it does. */
class Entry(val screen: Screen) {
    val store = ViewModelStore()
    inline fun <reified T : ViewModel> vm(crossinline create: () -> T): T = ViewModelProvider.create(store, object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <V : ViewModel> create(modelClass: kotlin.reflect.KClass<V>, extras: androidx.lifecycle.viewmodel.CreationExtras): V = create() as V
    })[T::class]
}

/** Opens the player: on its own, starting a party, or joining one. */
interface PlayerLauncher {
    fun play(titleId: String, season: Int?, episode: Int?)
    fun together(titleId: String, season: Int?, episode: Int?, at: Double)
    fun join(partyId: String)
}

/** What the TV draws instead of the phone's shell; the Android app passes its androidx.tv screens. */
fun interface TvShellSlot {
    @Composable fun Show(profile: Profile, home: HomeViewModel, hot: HotViewModel, list: ListViewModel, top: Entry?, go: Go, onSearch: () -> Unit, onProfiles: () -> Unit, onSettings: () -> Unit, onBack: () -> Unit)
}

/**
 * Who's watching, then the app: the phone's tabs and stacked pages, or the
 * TV's. Playing opens the player on its own screen ([play]); [resumed] goes
 * up each time the app comes back to the front, so pages ask again. [connect]
 * is a Kimono address from a kimono-watch://connect link.
 */
/**
 * The "who's watching" picker. Off for now: the app opens on whoever signed in
 * last, or on sign-in. The picker and its screen stay for when it comes back.
 */
const val PROFILE_PICKER = false

@Composable
fun WatchRoot(services: WatchServices, resumed: Int, connect: String?, tvShell: TvShellSlot?, play: PlayerLauncher) {
    CompositionLocalProvider(LocalWatch provides services) {
        val accounts = services.accounts
        var phase by remember { mutableStateOf<Phase>(Phase.Loading) }
        LaunchedEffect(Unit) {
            accounts.load()
            val all = accounts.profiles.value.orEmpty()
            phase = when {
                connect != null -> Phase.SignIn(all.isEmpty(), connect)
                all.isEmpty() -> Phase.SignIn(true)
                /* Picker off: straight into whoever signed in last, or sign in again. */
                !PROFILE_PICKER -> (all.firstOrNull { it.key == accounts.lastKey } ?: all[0]).let { p ->
                    runCatching { accounts.ready(p); accounts.choose(p); Phase.Shell(p) }.getOrDefault(Phase.SignIn(true))
                }
                /* A phone with one person on it goes straight in; a TV always asks. */
                !services.tv && all.size == 1 -> runCatching { accounts.ready(all[0]); accounts.choose(all[0]); Phase.Shell(all[0]) }.getOrDefault(Phase.Profiles)
                else -> Phase.Profiles
            }
        }
        /* A connect link from the Portal's "Get the app": sign in to that Kimono. */
        LaunchedEffect(connect) { if (connect != null && phase != Phase.Loading) phase = Phase.SignIn(accounts.profiles.value.orEmpty().isEmpty(), connect) }
        Box(Modifier.fillMaxSize().background(Night.bg)) {
            AnimatedContent(phase, transitionSpec = { fadeIn(tween(350)) togetherWith fadeOut(tween(250)) }, contentKey = { it::class to ((it as? Phase.Shell)?.profile?.key) }, label = "phase") { p ->
                when (p) {
                    Phase.Loading -> Starting()
                    Phase.Profiles -> ProfilesScreen(accounts, services.tv, onChosen = { phase = Phase.Shell(it) }, onAdd = { phase = Phase.SignIn(false) })
                    is Phase.SignIn -> SignInScreen(accounts, services.tv, p.server, onDone = { phase = Phase.Shell(it) }, onCancel = if (p.first) null else ({ phase = (p.back?.let { Phase.Shell(it) } ?: Phase.Profiles) }))
                    is Phase.Shell -> Signed(services, p.profile, resumed, tvShell, play, onProfiles = {
                        phase = when {
                            accounts.profiles.value.orEmpty().isEmpty() -> Phase.SignIn(true)
                            /* Picker off: "switch" signs in as someone else, Back returns here. */
                            !PROFILE_PICKER -> Phase.SignIn(false, back = p.profile)
                            else -> Phase.Profiles
                        }
                    })
                }
            }
            ToastHost(services.toasts.flow, bottom = if (services.tv) 48.dp else 90.dp)
        }
        /* Signed out underneath (refused at renewal): back to the faces. */
        val active by accounts.active.collectAsState()
        LaunchedEffect(active) { if (active == null && phase is Phase.Shell) phase = if (!PROFILE_PICKER || accounts.profiles.value.orEmpty().isEmpty()) Phase.SignIn(true) else Phase.Profiles }
    }
}

/** App start: Watch's bloom, and Kimono's loader under it. */
@Composable
private fun Starting() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            WatchBloom(72.dp)
            Spacer(Modifier.height(24.dp))
            InkLoader(size = 40.dp)
        }
    }
}

@Composable
private fun Signed(services: WatchServices, profile: Profile, resumed: Int, tvShell: TvShellSlot?, play: PlayerLauncher, onProfiles: () -> Unit) {
    val root = remember(profile.key) { Entry(Screen.Search) }
    val home = root.vm { HomeViewModel(services.api) }
    val hot = root.vm { HotViewModel(services.api, services.toasts) }
    val list = root.vm { ListViewModel(services.api) }
    val stack = remember(profile.key) { mutableStateListOf<Entry>() }
    fun push(s: Screen) { stack.add(Entry(s)) }
    fun pop() { stack.removeLastOrNull()?.store?.clear() }
    val go = remember(profile.key) { Go(open = { c: Card -> push(Screen.Title(c.id, c.top)) }, play = play::play, together = play::together, join = play::join) }
    LaunchedEffect(profile.key) { services.prefs.load() }
    LaunchedEffect(resumed) {
        if (resumed > 0) {
            home.refresh(); list.refresh()
            (stack.lastOrNull()?.screen as? Screen.Title)?.let { stack.last().vm { TitleViewModel(services.api, services.toasts, it.id) }.refresh() }
        }
    }
    BackHandler(stack.isNotEmpty()) { pop() }
    if (tvShell != null) {
        tvShell.Show(profile, home, hot, list, stack.lastOrNull(), go, onSearch = { push(Screen.Search) }, onProfiles = onProfiles, onSettings = { push(Screen.Settings) }, onBack = ::pop)
        return
    }
    Box(Modifier.fillMaxSize()) {
        PhoneShell(profile, home, hot, list, go, onSearch = { push(Screen.Search) }, onProfiles = onProfiles, onSettings = { push(Screen.Settings) }, previewing = stack.isEmpty())
        AnimatedContent(stack.lastOrNull(), transitionSpec = {
            (fadeIn(tween(250)) + slideInVertically(tween(400)) { it / 24 } + scaleIn(tween(400), initialScale = 0.97f)) togetherWith fadeOut(tween(200))
        }, label = "stack") { entry ->
            when (val s = entry?.screen) {
                is Screen.Title -> TitleScreen(entry.vm { TitleViewModel(services.api, services.toasts, s.id) }, go, s.top, onClose = ::pop, downloads = services.downloads)
                Screen.Search -> SearchScreen(entry.vm { SearchViewModel(services.api) }, go, onClose = ::pop)
                Screen.Settings -> SettingsScreen(onClose = ::pop, onProfiles = onProfiles)
                null -> Box(Modifier) {}
            }
        }
    }
}
