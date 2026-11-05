package app.kimono.data

import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/* ── What /api/v1/admin/apps answers with (apps/portal/src/lib/app-admin.ts) ── */

@Serializable
data class ManagedAppSummary(
    val id: String, val name: String, val description: String = "", val accent: String, val glyph: String? = null, val icon: String? = null,
    val state: String = "available", val stateLabel: String = "", val stateDetail: String = "",
)

@Serializable
private data class ManagedAppList(val apps: List<ManagedAppSummary>)

@Serializable
data class AppTunnel(val id: String, val name: String, val detail: String = "", val zones: List<String> = emptyList(), val zone: String? = null, val subdomain: String = "", val domain: String = "")

@Serializable
data class AppSetup(val enabled: Boolean, val name: String, val builtIn: Boolean = false, val tunnelId: String? = null, val tunnels: List<AppTunnel> = emptyList(), val internetAccess: Boolean = false)

@Serializable
data class AppField(
    val key: String, val label: String, val group: String = "general", val kind: String = "text", val description: String? = null,
    val options: List<String> = emptyList(), val value: String = "", val configured: Boolean = false, val placeholder: String? = null,
)

@Serializable
data class AppBackupItem(val id: String, val label: String, val description: String = "", val kept: Boolean)

@Serializable
data class AppBackups(val storage: Boolean, val enabled: Boolean, val items: List<AppBackupItem> = emptyList())

@Serializable
data class ManagedApp(
    val id: String, val name: String, val description: String = "", val accent: String, val glyph: String? = null, val icon: String? = null,
    val state: String = "available", val stateLabel: String = "", val stateDetail: String = "",
    val setupReady: Boolean = true, val configured: Boolean = false,
    val setup: AppSetup? = null, val settings: List<AppField> = emptyList(), val environment: List<AppField> = emptyList(), val backups: AppBackups? = null,
)

private val json = Json { ignoreUnknownKeys = true }

/**
 * 管 Managing the household's apps, for administrators: the website's
 * /admin/apps, as the Portal answers it for the phone.
 */
class AppAdmin(private val session: Session) {
    suspend fun apps(): List<ManagedAppSummary> = json.decodeFromString<ManagedAppList>(session.fetch(APPS)).apps
    fun knownApps(): List<ManagedAppSummary>? = session.answers.peek(APPS)?.let { runCatching { json.decodeFromString<ManagedAppList>(it).apps }.getOrNull() }

    suspend fun app(id: String): ManagedApp = json.decodeFromString(session.fetch("$APPS/$id"))
    fun knownApp(id: String): ManagedApp? = session.answers.peek("$APPS/$id")?.let { runCatching { json.decodeFromString<ManagedApp>(it) }.getOrNull() }

    suspend fun start(id: String): ManagedApp = send(id, HttpMethod.Post, buildJsonObject { put("action", "start") })

    suspend fun saveSetup(id: String, enabled: Boolean, name: String, tunnelId: String?, subdomain: String?, zone: String?, domain: String?, internetAccess: Boolean): ManagedApp =
        send(id, HttpMethod.Patch, buildJsonObject {
            put("section", "setup"); put("enabled", enabled); put("name", name); put("tunnelId", tunnelId); put("internetAccess", internetAccess)
            subdomain?.let { put("subdomain", it) }; zone?.let { put("zone", it) }; domain?.let { put("domain", it) }
        })

    /** Saves the Settings or Advanced view: only the answers that changed, switches as true or false. */
    suspend fun saveFields(id: String, section: String, values: Map<String, JsonElement>): ManagedApp =
        send(id, HttpMethod.Patch, buildJsonObject { put("section", section); put("values", JsonObject(values)) })

    suspend fun saveBackups(id: String, enabled: Boolean, items: Map<String, Boolean>): ManagedApp =
        send(id, HttpMethod.Patch, buildJsonObject {
            put("section", "backups"); put("enabled", enabled); put("items", JsonObject(items.mapValues { JsonPrimitive(it.value) }))
        })

    private suspend fun send(id: String, method: HttpMethod, body: JsonObject): ManagedApp {
        val text = session.call("$APPS/$id", method) { contentType(ContentType.Application.Json); setBody(body.toString()) }
        session.answers.put("$APPS/$id", text)
        return json.decodeFromString(text)
    }

    companion object { const val APPS = "/api/v1/admin/apps" }
}
