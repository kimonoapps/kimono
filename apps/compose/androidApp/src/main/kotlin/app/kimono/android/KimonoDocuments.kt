package app.kimono.android

import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.os.ProxyFileDescriptorCallback
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import android.system.ErrnoException
import android.system.OsConstants
import android.webkit.MimeTypeMap
import app.kimono.data.Drive
import app.kimono.data.DriveNode
import app.kimono.data.DriveSpace
import app.kimono.data.KimonoProblem
import app.kimono.data.PickedFile
import app.kimono.data.Replacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Kimono Drive in Android's Files app and in every app's open and save
 * pickers. Spaces are the top level; what a role can't do isn't offered.
 * Files are read in place, a few MB at a time, so a long video starts
 * playing at once; saves go up in the background as a new version, and a
 * clash with an edit made elsewhere keeps both.
 */
class KimonoDocuments : DocumentsProvider() {
    companion object {
        private const val ROOT = "kimono"
        /** The top level: the person's spaces. */
        private const val SPACES = "spaces"
        private val ROOT_COLUMNS = arrayOf(Root.COLUMN_ROOT_ID, Root.COLUMN_FLAGS, Root.COLUMN_ICON, Root.COLUMN_TITLE, Root.COLUMN_DOCUMENT_ID)
        private val DOCUMENT_COLUMNS = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_MIME_TYPE, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_LAST_MODIFIED, Document.COLUMN_FLAGS, Document.COLUMN_SIZE)

        fun authority(context: Context) = "${context.packageName}.documents"

        /** Where saves wait until they're sent. */
        fun savingDir(context: Context) = File(context.cacheDir, "saving").apply { mkdirs() }

        /** Tells whatever is showing [folderId] to look again. */
        fun changed(context: Context, folderId: String) {
            context.contentResolver.notifyChange(DocumentsContract.buildChildDocumentsUri(authority(context), folderId), null)
        }

        /** Signed in or out: Kimono appears in, or leaves, the Files app. */
        /** Whether the server has Drive switched on, as last heard; it's on until said otherwise. */
        const val DRIVE_ON = "drive_on"

        fun rootsChanged(context: Context) {
            context.contentResolver.notifyChange(DocumentsContract.buildRootsUri(authority(context)), null)
        }
    }

    private val app get() = context!!.applicationContext as KimonoApplication
    private val drive by lazy { Drive(app.session) }
    private val nodes = ConcurrentHashMap<String, DriveNode>()
    private val spaces = ConcurrentHashMap<String, DriveSpace>()
    private val handler by lazy { Handler(HandlerThread("kimono-documents").apply { start() }.looper) }

    override fun onCreate() = true

    /** Runs Drive calls for the system, which asks on its own threads and understands FileNotFoundException. */
    private fun <T> blocking(work: suspend () -> T): T = try {
        runBlocking(Dispatchers.IO) {
            if (!app.ensureSession()) throw KimonoProblem("Sign in to Kimono first.")
            work()
        }
    } catch (problem: KimonoProblem) {
        throw FileNotFoundException(problem.message)
    }

    private suspend fun spaceOf(id: String): DriveSpace? =
        spaces[id] ?: drive.spaces().onEach { spaces[it.id] = it }.firstOrNull { it.id == id }

    private suspend fun nodeOf(id: String): DriveNode = nodes[id] ?: fresh(id)

    private suspend fun fresh(id: String): DriveNode = drive.node(id).also { nodes[it.id] = it }

    /* ── Roots and listings ── */

    override fun queryRoots(projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: ROOT_COLUMNS)
        cursor.setNotificationUri(context!!.contentResolver, DocumentsContract.buildRootsUri(authority(context!!)))
        val signedIn = runCatching { runBlocking(Dispatchers.IO) { app.ensureSession() } }.getOrDefault(false)
        if (!signedIn) return cursor
        if (!context!!.getSharedPreferences("kimono", Context.MODE_PRIVATE).getBoolean(DRIVE_ON, true)) return cursor
        cursor.newRow().apply {
            add(Root.COLUMN_ROOT_ID, ROOT)
            /* Shown when saving too: folders in it take new files. */
            add(Root.COLUMN_FLAGS, Root.FLAG_SUPPORTS_CREATE or Root.FLAG_SUPPORTS_IS_CHILD or Root.FLAG_SUPPORTS_SEARCH or Root.FLAG_SUPPORTS_RECENTS)
            add(Root.COLUMN_ICON, R.mipmap.ic_launcher)
            add(Root.COLUMN_TITLE, "Kimono")
            add(Root.COLUMN_DOCUMENT_ID, SPACES)
        }
        return cursor
    }

    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: DOCUMENT_COLUMNS)
        if (documentId == SPACES) {
            cursor.newRow().apply {
                add(Document.COLUMN_DOCUMENT_ID, SPACES)
                add(Document.COLUMN_MIME_TYPE, Document.MIME_TYPE_DIR)
                add(Document.COLUMN_DISPLAY_NAME, "Kimono")
                add(Document.COLUMN_FLAGS, 0)
            }
            return cursor
        }
        blocking { addRow(cursor, fresh(documentId)) }
        return cursor
    }

    override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?): Cursor {
        val cursor = MatrixCursor(projection ?: DOCUMENT_COLUMNS)
        cursor.setNotificationUri(context!!.contentResolver, DocumentsContract.buildChildDocumentsUri(authority(context!!), parentDocumentId))
        blocking {
            if (parentDocumentId == SPACES) {
                drive.spaces().forEach { space ->
                    spaces[space.id] = space
                    addRow(cursor, DriveNode(id = space.rootId, spaceId = space.id, kind = "folder", name = space.name))
                }
            } else {
                drive.folder(parentDocumentId).children.forEach { child ->
                    nodes[child.id] = child
                    addRow(cursor, child)
                }
            }
        }
        return cursor
    }

    private suspend fun addRow(cursor: MatrixCursor, node: DriveNode) {
        val space = spaceOf(node.spaceId)
        val canEdit = space != null && space.role != "viewer"
        val isSpace = space?.rootId == node.id
        var flags = 0
        if (canEdit) {
            flags = flags or if (node.isFolder) Document.FLAG_DIR_SUPPORTS_CREATE else Document.FLAG_SUPPORTS_WRITE
            /* A space itself is made, renamed and removed in the app. */
            if (!isSpace) flags = flags or Document.FLAG_SUPPORTS_DELETE or Document.FLAG_SUPPORTS_RENAME or Document.FLAG_SUPPORTS_MOVE
        }
        val mime = if (node.isFolder) Document.MIME_TYPE_DIR else mimeOf(node)
        if (Thumbnails.canMake(node, mime)) flags = flags or Document.FLAG_SUPPORTS_THUMBNAIL
        cursor.newRow().apply {
            add(Document.COLUMN_DOCUMENT_ID, node.id)
            add(Document.COLUMN_MIME_TYPE, mime)
            add(Document.COLUMN_DISPLAY_NAME, if (isSpace) space!!.name else node.name)
            add(Document.COLUMN_LAST_MODIFIED, node.updatedAt.toLong().takeIf { it > 0 })
            add(Document.COLUMN_FLAGS, flags)
            add(Document.COLUMN_SIZE, if (node.isFolder) null else node.size)
        }
    }

    private fun mimeOf(node: DriveNode): String = node.mime
        ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(node.name.substringAfterLast('.', "").lowercase())
        ?: "application/octet-stream"

    override fun isChildDocument(parentDocumentId: String, documentId: String): Boolean {
        if (parentDocumentId == SPACES) return true
        return blocking {
            var current: String? = documentId
            var found = false
            var steps = 0
            while (current != null && !found && steps++ < 64) {
                if (current == parentDocumentId) found = true else current = nodeOf(current).parentId
            }
            found
        }
    }

    /* ── Reading and saving ── */

    override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor {
        val node = blocking { fresh(documentId) }
        if (node.isFolder) throw FileNotFoundException("That's a folder.")
        return if ('w' in mode || 'a' in mode) openForSaving(node, mode) else openForReading(node)
    }

    private fun openForReading(node: DriveNode): ParcelFileDescriptor {
        /* Already downloaded by the app at this version: read it from there. */
        val local = File(context!!.cacheDir, "drive/${node.id}-${node.contentVersion}/${node.name}")
        if (local.isFile && local.length() == node.size) return ParcelFileDescriptor.open(local, ParcelFileDescriptor.MODE_READ_ONLY)
        val storage = context!!.getSystemService(StorageManager::class.java)
        return storage.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, RemoteFile(node), handler)
    }

    /** A file on Kimono, read a piece at a time as the app reading it asks. */
    private inner class RemoteFile(node: DriveNode) : ProxyFileDescriptorCallback() {
        private val reader = RangedReader(drive, node)

        override fun onGetSize(): Long = reader.size

        override fun onRead(offset: Long, size: Int, data: ByteArray): Int = try {
            reader.read(offset, data, 0, size)
        } catch (_: java.io.IOException) {
            throw ErrnoException("read", OsConstants.EIO)
        }

        override fun onRelease() = reader.clear()
    }

    /* ── Thumbnails, search and recent files ── */

    private val thumbnails get() = app.thumbnails

    override fun openDocumentThumbnail(documentId: String, sizeHint: android.graphics.Point, signal: CancellationSignal?): android.content.res.AssetFileDescriptor {
        val file = blocking {
            val node = nodeOf(documentId)
            signal?.throwIfCanceled()
            thumbnails.make(node, mimeOf(node), maxOf(sizeHint.x, sizeHint.y))
        } ?: throw FileNotFoundException("No thumbnail for that file.")
        return android.content.res.AssetFileDescriptor(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY), 0, android.content.res.AssetFileDescriptor.UNKNOWN_LENGTH)
    }

    override fun querySearchDocuments(rootId: String, query: String, projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: DOCUMENT_COLUMNS)
        blocking { drive.search(query).forEach { nodes[it.id] = it; addRow(cursor, it) } }
        return cursor
    }

    override fun queryRecentDocuments(rootId: String, projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: DOCUMENT_COLUMNS)
        blocking { drive.recent().forEach { nodes[it.id] = it; addRow(cursor, it) } }
        return cursor
    }

    /**
     * Saving: the app writes to Kimono's own copy, which goes up in the
     * background once it's closed, as a new version of the file.
     */
    private fun openForSaving(node: DriveNode, mode: String): ParcelFileDescriptor {
        val space = blocking { spaceOf(node.spaceId) }
        if (space == null || space.role == "viewer") throw FileNotFoundException("You can only view this space.")
        val folder = node.parentId ?: throw FileNotFoundException("That file can't be changed.")
        val copy = File(savingDir(context!!), UUID.randomUUID().toString())
        /* "rw" and "wa" carry on from what's there; "w" and "wt" start empty. */
        if (('r' in mode || 'a' in mode) && 't' !in mode && node.size > 0) {
            val downloaded = blocking { drive.download(node, context!!.cacheDir.absolutePath) {} }
            File(downloaded).copyTo(copy, overwrite = true)
        } else {
            copy.createNewFile()
        }
        val uploads = app.platform.uploads as AndroidUploads
        return ParcelFileDescriptor.open(copy, ParcelFileDescriptor.parseMode(mode), handler) { error ->
            if (error != null) copy.delete()
            else uploads.startSaved(copy, node.name, folder, Replacing(node.id, node.contentVersion))
        }
    }

    /* ── Changes ── */

    override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
        if (parentDocumentId == SPACES) throw FileNotFoundException("Make new spaces in the Kimono app.")
        val id = blocking {
            if (mimeType == Document.MIME_TYPE_DIR) drive.createFolder(parentDocumentId, displayName).also { nodes[it.id] = it }.id
            else drive.upload(EmptyFile(nameWithExtension(displayName, mimeType)), parentDocumentId) {}
        }
        changed(context!!, parentDocumentId)
        return id
    }

    /** "Notes" saved as text/plain is "Notes.txt", as other places would name it. */
    private fun nameWithExtension(name: String, mimeType: String): String {
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType) ?: return name
        return if (name.substringAfterLast('.', "").equals(extension, ignoreCase = true)) name else "$name.$extension"
    }

    private class EmptyFile(override val name: String) : PickedFile {
        override val size = 0L
        override val mimeType: String? = null
        override suspend fun read(offset: Long, max: Int) = ByteArray(0)
    }

    override fun renameDocument(documentId: String, displayName: String): String? {
        val parent = blocking {
            drive.rename(documentId, displayName)
            fresh(documentId).parentId
        }
        parent?.let { changed(context!!, it) }
        return null
    }

    override fun deleteDocument(documentId: String) {
        val parent = blocking {
            val parent = nodeOf(documentId).parentId
            drive.moveToTrash(documentId)
            parent
        }
        nodes.remove(documentId)
        revokeDocumentPermission(documentId)
        parent?.let { changed(context!!, it) }
    }

    override fun moveDocument(sourceDocumentId: String, sourceParentDocumentId: String, targetParentDocumentId: String): String {
        blocking { drive.move(sourceDocumentId, targetParentDocumentId) }
        nodes.remove(sourceDocumentId)
        changed(context!!, sourceParentDocumentId)
        changed(context!!, targetParentDocumentId)
        return sourceDocumentId
    }
}
