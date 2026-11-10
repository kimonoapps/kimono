package app.kimono.watch

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import app.kimono.watch.data.Profile
import app.kimono.watch.model.Card
import app.kimono.watch.phone.Go
import app.kimono.watch.phone.PhoneShell
import app.kimono.watch.phone.SearchScreen
import app.kimono.watch.phone.TitleScreen
import app.kimono.watch.theme.Night
import app.kimono.watch.tv.TvShell
import app.kimono.watch.ui.HomeViewModel
import app.kimono.watch.ui.HotViewModel
import app.kimono.watch.ui.ListViewModel
import app.kimono.watch.ui.ProfilesScreen
import app.kimono.watch.ui.Screen
import app.kimono.watch.ui.SearchViewModel
import app.kimono.watch.ui.SignInScreen
import app.kimono.watch.ui.TitleViewModel
import app.kimono.watch.ui.ToastHost
import app.kimono.watch.ui.WavyRing

private sealed interface Phase {
    data object Loading : Phase
    data object Profiles : Phase
    data class SignIn(val first: Boolean) : Phase
    data class Shell(val profile: Profile) : Phase
}

/** A screen on the stack, with the view models that live as long as it does. */
class Entry(val screen: Screen) {
    val store = ViewModelStore()
    inline fun <reified T : ViewModel> vm(crossinline create: () -> T): T = ViewModelProvider.create(store, object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <V : ViewModel> create(modelClass: Class<V>): V = create() as V
    })[T::class]
}

/**
 * Who's watching, then the app: the phone's tabs and stacked pages, or the
 * TV's. Playing opens the player on its own screen ([play]); [resumed] goes
 * up each time the app comes back to the front, so pages ask again.
 */
@Composable
fun WatchRoot(app: WatchApp, resumed: Int, play: (titleId: String, season: Int?, episode: Int?) -> Unit) {
    var phase by remember { mutableStateOf<Phase>(Phase.Loading) }
    LaunchedEffect(Unit) {
        app.accounts.load()
        val all = app.accounts.profiles.value.orEmpty()
        phase = when {
            all.isEmpty() -> Phase.SignIn(true)
            /* A phone with one person on it goes straight in; a TV always asks. */
            !app.tv && all.size == 1 -> runCatching { app.accounts.ready(all[0]); app.accounts.choose(all[0]); Phase.Shell(all[0]) }.getOrDefault(Phase.Profiles)
            else -> Phase.Profiles
        }
    }
    Box(Modifier.fillMaxSize().background(Night.bg)) {
        AnimatedContent(phase, transitionSpec = { fadeIn(tween(350)) togetherWith fadeOut(tween(250)) }, contentKey = { it::class to ((it as? Phase.Shell)?.profile?.key) }, label = "phase") { p ->
            when (p) {
                Phase.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { WavyRing(72.dp) }
                Phase.Profiles -> ProfilesScreen(app.accounts, app.tv, onChosen = { phase = Phase.Shell(it) }, onAdd = { phase = Phase.SignIn(false) })
                is Phase.SignIn -> SignInScreen(app.accounts, app.tv, onDone = { phase = Phase.Shell(it) }, onCancel = if (p.first) null else ({ phase = Phase.Profiles }))
                is Phase.Shell -> Signed(app, p.profile, resumed, play, onProfiles = {
                    if (app.accounts.profiles.value.orEmpty().isEmpty()) phase = Phase.SignIn(true) else phase = Phase.Profiles
                })
            }
        }
        ToastHost(app.toasts.flow, bottom = if (app.tv) 48.dp else 90.dp)
    }
    /* Signed out underneath (refused at renewal): back to the faces. */
    val active by app.accounts.active.collectAsState()
    LaunchedEffect(active) { if (active == null && phase is Phase.Shell) phase = if (app.accounts.profiles.value.orEmpty().isEmpty()) Phase.SignIn(true) else Phase.Profiles }
}

@Composable
private fun Signed(app: WatchApp, profile: Profile, resumed: Int, play: (String, Int?, Int?) -> Unit, onProfiles: () -> Unit) {
    val root = remember(profile.key) { Entry(Screen.Search) }
    val home = root.vm { HomeViewModel(app.api) }
    val hot = root.vm { HotViewModel(app.api, app.toasts) }
    val list = root.vm { ListViewModel(app.api) }
    val stack = remember(profile.key) { mutableStateListOf<Entry>() }
    fun push(s: Screen) { stack.add(Entry(s)) }
    fun pop() { stack.removeLastOrNull()?.store?.clear() }
    val go = remember(profile.key) {
        Go(open = { c: Card -> push(Screen.Title(c.id, c.top)) }, play = play)
    }
    LaunchedEffect(resumed) {
        if (resumed > 0) {
            home.refresh(); list.refresh()
            (stack.lastOrNull()?.screen as? Screen.Title)?.let { stack.last().vm { TitleViewModel(app.api, app.toasts, it.id) }.refresh() }
        }
    }
    BackHandler(stack.isNotEmpty()) { pop() }
    if (app.tv) {
        TvShell(app, profile, home, hot, list, stack.lastOrNull(), go, onSearch = { push(Screen.Search) }, onProfiles = onProfiles, onBack = ::pop)
        return
    }
    Box(Modifier.fillMaxSize()) {
        PhoneShell(profile, home, hot, list, go, onSearch = { push(Screen.Search) }, onProfiles = onProfiles, previewing = stack.isEmpty())
        AnimatedContent(stack.lastOrNull(), transitionSpec = {
            (fadeIn(tween(250)) + slideInVertically(tween(400)) { it / 24 } + scaleIn(tween(400), initialScale = 0.97f)) togetherWith fadeOut(tween(200))
        }, label = "stack") { entry ->
            when (val s = entry?.screen) {
                is Screen.Title -> TitleScreen(entry.vm { TitleViewModel(app.api, app.toasts, s.id) }, go, s.top, onClose = ::pop, downloads = app.downloads)
                Screen.Search -> SearchScreen(entry.vm { SearchViewModel(app.api) }, go, onClose = ::pop)
                null -> Box(Modifier) {}
            }
        }
    }
}
