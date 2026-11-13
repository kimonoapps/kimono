package app.kimono.watch.ui

/** Where the app is: the screens stacked over the tabs. */
sealed interface Screen {
    data class Title(val id: String, val top: Int? = null) : Screen
    data object Search : Screen
    data object Settings : Screen
    /** A friend's list and ratings. */
    data class Friend(val username: String, val name: String = "", val picture: String? = null) : Screen
}
