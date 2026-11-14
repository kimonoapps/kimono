package app.kimono

import io.ktor.http.Url
import io.ktor.http.parseQueryString

/*
 * 縁 A Kimono address opened on the phone (a link in a message, say) opens
 * here when the app is installed: Android's App Links and iOS's Universal
 * Links hand it over, and it becomes the screen the website would show.
 * Only the paths the phones claim arrive (see the manifest and the portal's
 * .well-known files), so each one has a screen here.
 */

/** The app's route for a Kimono web address, or null when it isn't one the app shows. */
fun routeOfLink(link: String): String? {
    val url = runCatching { Url(link) }.getOrNull() ?: return null
    if (url.protocol.name != "https" && url.protocol.name != "http") return null
    val path = url.encodedPath.trimEnd('/')
    val query = url.parameters
    /* Kimono AI keeps where you are in the hash: /code#w=<chat>. */
    val hash = parseQueryString(url.fragment)
    fun id(value: String?) = value?.takeIf { it.isNotBlank() && it.all { c -> c.isLetterOrDigit() || c == '-' || c == '_' } }
    return when {
        path.startsWith("/ai/c/") -> id(path.removePrefix("/ai/c/"))?.let { "ai/c/$it" }
        path.startsWith("/ai/a/") -> id(path.removePrefix("/ai/a/"))?.let { "ai/a/$it" }
        path == "/code" -> when {
            id(hash["w"]) != null -> "code/${hash["w"]}"
            hash["connections"] != null -> id(hash["connections"])?.let { "ai/connections/$it" } ?: "ai/connections"
            hash["memory"] != null -> "ai/memory"
            hash["archived"] != null -> "ai/archived"
            else -> "code"
        }
        path == "/notes" -> id(query["n"])?.takeIf { it != "new" }?.let { "note/$it" } ?: "notes"
        path == "/drive" -> when {
            query["view"] == "shared" -> "drive/shared"
            id(query["folder"]) != null -> "folder/${query["folder"]}"
            id(query["space"]) != null -> "space/${query["space"]}"
            else -> "drive"
        }
        path == "/books" -> if (query["tab"] == "shelf") "books/shelf" else "books"
        else -> null
    }
}

/** Opens a Kimono web address in the app, once signed in. False when the app has no screen for it. */
fun openLink(link: String): Boolean {
    val route = routeOfLink(link) ?: return false
    Opening.route.value = route
    return true
}
