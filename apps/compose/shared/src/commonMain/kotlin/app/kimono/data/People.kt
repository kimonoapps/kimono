package app.kimono.data

import androidx.compose.runtime.mutableStateMapOf
import io.ktor.http.encodeURLQueryComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/*
 * 人 People on this Kimono, as the Portal lets apps see them (portal
 * lib/people): found by typing three letters of a name, or looked up by a
 * username the app already has. No one is given the whole list.
 */

const val FIND_AT_LEAST = 3

@Serializable private data class PeopleAnswer(val people: List<Person> = emptyList())

private val json = Json { ignoreUnknownKeys = true }
private const val BASE = "/api/v1/people"
/* Where the book is kept between launches, so names and faces show offline. */
private const val KEPT = "$BASE#book"

/**
 * People by lower-case username. Reading someone not known yet asks for them
 * (with the others read meanwhile) and whoever read it draws again when they
 * arrive; it only ever holds people already met, never everyone.
 */
class People(private val session: Session) : AbstractMap<String, Person>() {
    private val book = mutableStateMapOf<String, Person>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    /* All touched on the main thread: reads come from composition, asks run on Main. */
    private val asking = mutableSetOf<String>()
    private val missing = mutableSetOf<String>()
    private val queued = mutableListOf<String>()
    private var loaded = false

    private fun load() {
        if (loaded) return
        loaded = true
        session.answers.peek(KEPT)?.let { text -> runCatching { json.decodeFromString<PeopleAnswer>(text).people }.getOrNull()?.forEach { book[it.username.lowercase()] = it } }
    }

    override val entries: Set<Map.Entry<String, Person>> get() { load(); return book.entries }

    override fun get(key: String): Person? {
        load()
        val u = key.lowercase()
        return book[u] ?: run { lookUp(u); null }
    }

    override fun containsKey(key: String): Boolean = get(key) != null

    /** Remembers people an answer already carried, so they needn't be asked for. */
    fun know(people: List<Person>) {
        load()
        people.forEach { book[it.username.lowercase()] = it }
        keep()
    }

    /** Anyone whose name or username has what was typed: none under three letters. */
    suspend fun find(typed: String): List<Person> {
        val q = typed.trim().removePrefix("@")
        if (q.length < FIND_AT_LEAST) return emptyList()
        return json.decodeFromString<PeopleAnswer>(session.call("$BASE?q=${q.encodeURLQueryComponent()}")).people
    }

    private fun lookUp(u: String) {
        if (u.isBlank() || u in asking || u in missing) return
        asking += u
        queued += u
        if (queued.size > 1) return
        scope.launch {
            delay(30)
            val batch = queued.toList()
            queued.clear()
            try {
                val found = json.decodeFromString<PeopleAnswer>(session.call("$BASE?u=${batch.joinToString(",").encodeURLQueryComponent()}")).people
                found.forEach { book[it.username.lowercase()] = it }
                batch.filter { it !in book }.forEach { missing += it }
                if (found.isNotEmpty()) keep()
            } catch (_: Exception) {
                /* Offline or refused: try again next launch, not on every draw. */
                missing += batch
            }
            asking -= batch.toSet()
        }
    }

    private fun keep() = session.answers.put(KEPT, json.encodeToString(PeopleAnswer(book.values.toList())))
}
