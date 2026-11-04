package app.kimono.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readString
import kotlinx.io.writeString

/**
 * 控 The last answer to each question asked of the Portal, kept in memory and
 * on disk, so a screen opens on what it showed last time and catches up
 * underneath. Kept per Kimono, and forgotten on signing in or out, so one
 * person's files never show for another. The OS may clear it; nothing in it
 * is the only copy of anything.
 */
class Answers(private val platform: Platform) {
    private val memory = MutableStateFlow<Map<String, String>>(emptyMap())
    private val folder get() = Path(platform.cacheDir(), "answers")
    /** Which Kimono the answers came from; none kept until signed in. */
    var server: String? = null
        set(value) { if (field != value) memory.value = emptyMap(); field = value }

    @OptIn(ExperimentalStdlibApi::class)
    private fun file(path: String): Path? {
        val from = server ?: return null
        return Path(folder, platform.sha256("$from$path".encodeToByteArray()).toHexString() + ".json")
    }

    /** What [path] answered last, or null if it hasn't been asked (or was forgotten). */
    fun peek(path: String): String? {
        memory.value[path]?.let { return it }
        val file = file(path) ?: return null
        val text = runCatching { SystemFileSystem.source(file).buffered().use { it.readString() } }.getOrNull() ?: return null
        memory.update { it + (path to text) }
        return text
    }

    fun put(path: String, text: String) {
        val file = file(path) ?: return
        memory.update { it + (path to text) }
        runCatching {
            SystemFileSystem.createDirectories(folder)
            val partial = Path(folder, "${file.name}.part")
            SystemFileSystem.sink(partial).buffered().use { it.writeString(text) }
            SystemFileSystem.atomicMove(partial, file)
        }
    }

    /** Forgets one answer, when something done here has made it wrong. */
    fun drop(path: String) {
        memory.update { it - path }
        file(path)?.let { runCatching { SystemFileSystem.delete(it, mustExist = false) } }
    }

    /** Forgets everything, for every Kimono. */
    fun clear() {
        memory.value = emptyMap()
        runCatching { SystemFileSystem.list(folder).forEach { SystemFileSystem.delete(it, mustExist = false) } }
    }
}
