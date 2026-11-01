package app.kimono.data

/**
 * The rules for a new password, the same as @kimono/account's passwordRules on
 * the website, so the checklist fills in identically on both. The Portal
 * checks again (and against known leaks) when the change is sent.
 */
const val PASSWORD_MIN_LENGTH = 12

data class PasswordRules(val long: Boolean, val notName: Boolean) { val met get() = long && notName }

fun passwordRules(next: String, username: String, name: String?): PasswordRules {
    val lower = next.lowercase()
    val names = (listOf(username) + (name ?: "").split(Regex("\\s+"))).map { it.trim().lowercase() }.filter { it.length >= 3 }
    val characters = next.visibleLength()
    return PasswordRules(long = characters >= PASSWORD_MIN_LENGTH, notName = names.none { lower.contains(it) })
}

/* Counts characters as people see them, so an emoji is one, not two. */
private fun String.visibleLength(): Int {
    var count = 0
    var index = 0
    while (index < length) {
        index += if (this[index].isHighSurrogate() && index + 1 < length && this[index + 1].isLowSurrogate()) 2 else 1
        count++
    }
    return count
}
