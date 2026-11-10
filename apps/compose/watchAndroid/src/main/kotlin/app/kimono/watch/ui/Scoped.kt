package app.kimono.watch.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore

/** A view model that lives as long as this spot on screen (a title page, a tab), cleared when it goes. */
@Composable
inline fun <reified T : ViewModel> scoped(key: Any, crossinline create: () -> T): T {
    val store = remember(key) { ViewModelStore() }
    DisposableEffect(store) { onDispose { store.clear() } }
    return remember(store) {
        ViewModelProvider.create(store, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <V : ViewModel> create(modelClass: Class<V>): V = create() as V
        })[T::class]
    }
}

/** Where the app is: the screens stacked over the tabs. */
sealed interface Screen {
    data class Title(val id: String, val top: Int? = null) : Screen
    data object Search : Screen
}
