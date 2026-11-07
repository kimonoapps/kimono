package app.kimono.screens

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import app.kimono.data.Drive
import app.kimono.data.KimonoProblem
import app.kimono.data.NoteLibrary
import app.kimono.data.NoteMeta
import app.kimono.data.Notebook
import app.kimono.data.NoteSection
import app.kimono.data.Notes
import app.kimono.data.Person
import app.kimono.data.Platform
import app.kimono.data.WaitingEdit
import app.kimono.data.offline
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/*
 * 帳 What Notes keeps while the app is open: the library, where the list is,
 * and every note being written, each saving itself 800ms after typing stops.
 */

/** The words shown when something done here fails. */
internal const val DIDNT_WORK = "That didn't work."

/** Where the list is: every note, a notebook, or a section. */
sealed interface NotePlace {
    data object All : NotePlace
    data class InNotebook(val id: String) : NotePlace
    data class InSection(val id: String) : NotePlace

    val key: String get() = when (this) { All -> "all"; is InNotebook -> "nb:$id"; is InSection -> "sec:$id" }

    companion object {
        fun of(key: String?): NotePlace = when {
            key == null -> All
            key.startsWith("nb:") -> InNotebook(key.removePrefix("nb:"))
            key.startsWith("sec:") -> InSection(key.removePrefix("sec:"))
            else -> All
        }
    }
}

enum class SaveState { Saved, Saving, Failed, Waiting }

class NotesModel(val notes: Notes, val drive: Drive, val platform: Platform) {
    internal val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var library by mutableStateOf(notes.knownLibrary())
        private set
    /** Why the library couldn't be read, when nothing was kept to show instead. */
    var problem by mutableStateOf<String?>(null)
        private set
    var place by mutableStateOf<NotePlace>(NotePlace.All)
        private set
    /** The note last opened, its row lifted when you come back to the list. */
    var lastOpened by mutableStateOf<String?>(null)
    /** A note just deleted, for the list's Undo. */
    var deleted by mutableStateOf<NoteMeta?>(null)
    /** A new note's request has taken longer than 300ms. */
    var creating by mutableStateOf(false)
        private set
    var people by mutableStateOf<Map<String, Person>>((notes.knownPeople() ?: drive.knownPeople()).orEmpty().associateBy { it.username.lowercase() })
        private set
    /** Who is in each shared notebook, asked as they're shown. */
    val members = mutableStateMapOf<String, List<String>>()

    private val drafts = mutableMapOf<String, NoteDraft>()

    init {
        scope.launch { notes.lastPlace()?.let { place = NotePlace.of(it) } }
        /* What was written with no connection last time goes now. */
        scope.launch { for (edit in notes.waiting()) draft(edit.id).resume(edit) }
    }

    fun go(to: NotePlace) {
        place = to
        scope.launch { notes.keepPlace(to.key) }
    }

    suspend fun load() {
        try {
            library = notes.library()
            problem = null
            /* A place that's gone (left, deleted, shared away) falls back to every note. */
            val shown = place
            val gone = when (shown) {
                NotePlace.All -> false
                is NotePlace.InNotebook -> library?.notebooks?.none { it.id == shown.id } == true
                is NotePlace.InSection -> library?.sections?.none { it.id == shown.id } == true
            }
            if (gone) go(NotePlace.All)
        } catch (p: KimonoProblem) {
            if (library == null || !p.offline) problem = p.message
        }
    }

    /** Keeps the library, and notes open but untouched, in step with what changed elsewhere. */
    suspend fun follow() {
        while (true) {
            val changed = runCatching { notes.changed() }.getOrDefault(false)
            if (changed) {
                load()
                drafts.values.toSet().forEach { if (it.clean) it.refresh() }
            }
            delay(15_000)
        }
    }

    suspend fun loadPeople() { runCatching { notes.people() }.onSuccess { list -> people = list.associateBy { it.username.lowercase() } } }

    /** Who a notebook is shared with beyond its space, for the faces after its name. */
    suspend fun loadMembers(notebookId: String) {
        notes.knownSharing(notebookId, true)?.let { known -> members[notebookId] = known.shares.map { it.username } }
        runCatching { notes.sharing(notebookId, true) }.onSuccess { found -> members[notebookId] = found.shares.map { it.username } }
    }

    fun notebook(id: String?): Notebook? = library?.notebooks?.firstOrNull { it.id == id }
    fun section(id: String?): NoteSection? = library?.sections?.firstOrNull { it.id == id }
    fun meta(id: String?): NoteMeta? = library?.notes?.firstOrNull { it.id == id }

    /** Every section inside [id], at any depth, and [id] itself. */
    fun within(id: String): Set<String> {
        val all = library?.sections.orEmpty()
        val found = mutableSetOf(id)
        var grew = true
        while (grew) { grew = all.filter { it.parentId in found && it.id !in found }.map { found.add(it.id) }.isNotEmpty() }
        return found
    }

    fun notesIn(place: NotePlace): List<NoteMeta> {
        val all = library?.notes.orEmpty()
        return when (place) {
            NotePlace.All -> all
            is NotePlace.InNotebook -> all.filter { it.notebookId == place.id }
            is NotePlace.InSection -> within(place.id).let { inside -> all.filter { it.parentId in inside } }
        }
    }

    /** Where a new note goes from [place], or null for the person's own notebook. */
    fun parentFor(place: NotePlace): String? = when (place) {
        NotePlace.All -> null
        is NotePlace.InNotebook -> place.id
        is NotePlace.InSection -> place.id
    }

    fun canWrite(place: NotePlace): Boolean = when (place) {
        NotePlace.All -> true
        is NotePlace.InNotebook -> notebook(place.id)?.canWrite != false
        is NotePlace.InSection -> notebook(section(place.id)?.notebookId)?.canWrite != false
    }

    internal fun changeLibrary(change: (NoteLibrary) -> NoteLibrary) { library = library?.let(change) }

    /** A note's row, as it is after a save here. */
    internal fun heard(note: NoteMeta, text: String?) = changeLibrary { lib ->
        val excerpt = text?.let(::excerptOf) ?: lib.notes.firstOrNull { it.id == note.id }?.excerpt.orEmpty()
        lib.copy(notes = listOf(note.copy(excerpt = excerpt)) + lib.notes.filter { it.id != note.id })
    }

    /* ── writing ── */

    /** The note being written under [key]: an id, or a new note's key while it's made. */
    fun draft(key: String): NoteDraft = drafts.getOrPut(key) { NoteDraft(this, key) }
    fun hasDraft(key: String) = key in drafts

    /**
     * A new note, at once: the editor opens on it while it's made behind it,
     * and what's typed waits for its id. Returns the key to open it by.
     */
    fun startNew(place: NotePlace): String {
        val key = "new-" + (1..10).map { "abcdefghijklmnopqrstuvwxyz0123456789".random() }.joinToString("")
        val parent = parentFor(place)
        val draft = NoteDraft(this, key, parent)
        drafts[key] = draft
        scope.launch {
            val slow = scope.launch { delay(300); creating = true }
            draft.create()
            slow.cancel()
            creating = false
        }
        return key
    }

    internal fun registered(draft: NoteDraft, id: String) { drafts[id] = draft }

    /** Into the trash, with Undo on the list. */
    fun delete(note: NoteMeta, onFail: (String) -> Unit = {}) {
        drafts.filterValues { it.id == note.id }.toList().forEach { (key, draft) -> drafts.remove(key); draft.discard() }
        changeLibrary { lib -> lib.copy(notes = lib.notes.filter { it.id != note.id }) }
        deleted = note
        scope.launch {
            try { notes.delete(note.id) } catch (_: KimonoProblem) { deleted = null; load(); onFail(DIDNT_WORK) }
        }
    }

    fun undoDelete(note: NoteMeta) {
        deleted = null
        changeLibrary { lib -> lib.copy(notes = (listOf(note) + lib.notes).sortedByDescending { it.updatedAt }) }
        scope.launch { runCatching { notes.restore(note.id) }; load() }
    }
}

/** The start of a note's prose, as the list shows it. */
internal fun excerptOf(text: String): String {
    val prose = text.lineSequence().filter { !it.trimStart().startsWith("#") && !it.trimStart().startsWith("```") }
        .map { it.replace(Regex("^\\s*(?:[-*+]|\\d+\\.)\\s+(\\[[ xX]\\]\\s+)?"), "") }.joinToString(" ")
        .replace(Regex("!\\[[^\\]]*\\]\\([^)]*\\)"), "").replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("[#>*_`~|]"), "").replace(Regex("\\s+"), " ").trim()
    return if (prose.length > 160) prose.take(160).trimEnd() + "…" else prose
}

/**
 * One note being written. It saves 800ms after typing stops, when a field
 * loses focus and when you leave; with no connection the edit waits on the
 * phone, and a failed save keeps trying in the background.
 */
class NoteDraft internal constructor(private val model: NotesModel, val key: String, private val parent: String? = null) {
    private val notes get() = model.notes
    val title = TextFieldState()
    val body = TextFieldState()
    /** The note's id, once it has one. */
    var id by mutableStateOf<String?>(key.takeUnless { it.startsWith("new-") })
        private set
    var state by mutableStateOf(SaveState.Saved)
        private set
    var savedAt by mutableStateOf(0L)
        private set
    var loaded by mutableStateOf(false)
        private set
    /** The copy kept when someone else saved first, for "Open copy". */
    var copy by mutableStateOf<String?>(null)
    val isNew = key.startsWith("new-")

    private var version = 0
    private var savedText = ""
    private var savedTitle = ""
    private val made = CompletableDeferred<String>().also { done -> id?.let(done::complete) }
    private val saving = Mutex()
    private var retry: Job? = null
    /* Deleted from here: nothing more to save. */
    private var gone = false

    /** Stops saving: the note is going to the trash. */
    fun discard() { gone = true; retry?.cancel() }

    val clean get() = body.text.toString() == savedText && state == SaveState.Saved

    private fun put(field: TextFieldState, text: String) = field.edit { replace(0, length, text); selection = TextRange(0) }

    /* Text from elsewhere, in place: the cursor stays where it was (as near as the new text allows), and the scroll with it. */
    private fun swap(field: TextFieldState, text: String) {
        if (field.text.toString() == text) return
        field.edit {
            val keep = selection
            replace(0, length, text)
            selection = TextRange(keep.start.coerceIn(0, text.length), keep.end.coerceIn(0, text.length))
        }
    }

    /** Opens on what's kept, then on what the server has, unless it's been written over here since. */
    suspend fun open() {
        if (loaded) return
        val id = id ?: run { loaded = true; return }
        notes.knownNote(id)?.let { known -> take(known.note, known.text) }
        model.meta(id)?.let { if (!loaded) { put(title, it.title); savedTitle = it.title; savedAt = it.updatedAt.toLong() } }
        loaded = true
        refresh()
    }

    private fun take(note: NoteMeta, text: String) {
        version = note.version
        savedText = text
        savedTitle = note.title
        savedAt = note.updatedAt.toLong()
        put(title, note.title)
        put(body, text)
    }

    /**
     * Asks again. When the note moved on elsewhere (another phone, Kimono AI) and
     * nothing here is unsaved, its text takes the place of this one's; unsaved
     * edits stay, and the version rule keeps both when they're saved.
     */
    suspend fun refresh() {
        val id = id ?: return
        if (gone || saving.isLocked) return
        try {
            val fresh = notes.note(id)
            if (fresh.note.version == version && fresh.note.title == savedTitle) return
            val unsaved = body.text.toString() != savedText || state != SaveState.Saved
            if (unsaved) return
            version = fresh.note.version
            savedText = fresh.text
            savedAt = fresh.note.updatedAt.toLong()
            swap(body, fresh.text)
            if (title.text.toString().trim() == savedTitle) swap(title, fresh.note.title)
            savedTitle = fresh.note.title
            model.heard(fresh.note, fresh.text)
        } catch (_: KimonoProblem) { }
    }

    /** An edit kept from a time with no connection: shown, and sent. */
    internal suspend fun resume(edit: WaitingEdit) {
        if (edit.new) {
            put(title, edit.title.orEmpty())
            put(body, edit.text)
            loaded = true
            state = SaveState.Waiting
            create(edit)
            return
        }
        open()
        version = edit.version
        if (edit.text != savedText) { put(body, edit.text); state = SaveState.Waiting }
        save()
    }

    /** Makes the note on the server; with no connection, keeps it waiting and tries again. */
    internal suspend fun create(kept: WaitingEdit? = null) {
        while (id == null) {
            try {
                val text = body.text.toString().takeIf { it.isNotEmpty() }
                val typed = title.text.toString().trim().takeIf { it.isNotEmpty() }
                val note = notes.create(kept?.parent ?: parent, typed, text)
                id = note.id
                version = note.version
                savedText = text.orEmpty()
                savedTitle = note.title
                savedAt = note.updatedAt.toLong()
                notes.doneWaiting(kept?.id ?: key)
                model.registered(this, note.id)
                model.heard(note, savedText)
                made.complete(note.id)
                if (state == SaveState.Waiting) state = SaveState.Saved
                /* Whatever was typed while it was being made. */
                save()
                rename()
            } catch (p: KimonoProblem) {
                if (p.offline) {
                    state = SaveState.Waiting
                    notes.keepWaiting(WaitingEdit(key, body.text.toString(), 0, new = true, parent = kept?.parent ?: parent, title = title.text.toString()))
                    delay(5_000)
                } else { state = SaveState.Failed; delay(10_000) }
            }
        }
    }

    /** Saves the body if it changed since the last save. */
    suspend fun save() {
        if (gone) return
        if (id == null) {
            /* Still being made: keep what's typed so far, should the phone be offline. */
            if (state == SaveState.Waiting) notes.keepWaiting(WaitingEdit(key, body.text.toString(), 0, new = true, parent = parent, title = title.text.toString()))
            return
        }
        val id = made.await()
        saving.withLock {
            val text = body.text.toString()
            if (text == savedText) { if (state != SaveState.Saved) { state = SaveState.Saved; notes.doneWaiting(id) }; return }
            state = SaveState.Saving
            try {
                val saved = notes.save(id, text, version)
                notes.doneWaiting(id)
                retry?.cancel()
                if (saved.conflict) {
                    /* Theirs stays; this edit is the copy beside it, and the note shows theirs again. */
                    copy = saved.note.id
                    model.heard(saved.note, text)
                    runCatching { notes.note(id) }.onSuccess { fresh -> take(fresh.note, fresh.text); model.heard(fresh.note, fresh.text) }
                } else {
                    version = saved.note.version
                    savedText = text
                    savedAt = saved.note.updatedAt.toLong()
                    model.heard(saved.note, text)
                }
                state = SaveState.Saved
            } catch (p: KimonoProblem) {
                if (p.offline) {
                    state = SaveState.Waiting
                    notes.keepWaiting(WaitingEdit(id, text, version))
                } else state = SaveState.Failed
                again(if (p.offline) 5_000 else 10_000)
            }
        }
    }

    private fun again(after: Long) {
        if (retry?.isActive == true) return
        retry = model.scope.launch { delay(after); retry = null; save() }
    }

    fun retryNow() { retry?.cancel(); retry = null; model.scope.launch { save() } }

    /** Renames the note to its title field, "Untitled" when blank. */
    suspend fun rename() {
        val typed = title.text.toString().trim()
        val wanted = typed.ifEmpty { "Untitled" }
        if (typed.isEmpty() && title.text.isNotEmpty()) put(title, "")
        if (wanted == savedTitle) return
        val id = id ?: return
        try {
            val note = notes.retitle(id, wanted)
            savedTitle = note.title
            if (typed.isNotEmpty() && note.title != typed) put(title, note.title)
            model.heard(note, null)
        } catch (_: KimonoProblem) { }
    }

    /** Leaving: everything saved, and a new note left blank isn't kept. */
    fun leave() {
        if (gone) return
        model.scope.launch {
            if (isNew && body.text.isBlank() && title.text.isBlank()) {
                val id = made.await()
                runCatching { notes.delete(id) }
                model.changeLibrary { lib -> lib.copy(notes = lib.notes.filter { it.id != id }) }
                return@launch
            }
            save()
            rename()
        }
    }
}
