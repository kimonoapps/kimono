package app.kimono.data

import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/* ── What /api/v1/vpn answers with (apps/portal/src/lib/vpn-view.ts) ── */

@Serializable
data class VpnDevice(val id: String, val name: String, val addresses: List<String> = emptyList(), val online: Boolean = false, val seen: String = "", val expiry: String? = null)

@Serializable
data class VpnPerson(val username: String, val name: String)

@Serializable
data class VpnView(
    val member: Boolean, val mesh: String, val available: Boolean = false, val reason: String? = null,
    val devices: List<VpnDevice> = emptyList(), val guests: List<VpnPerson> = emptyList(),
    val hosts: List<VpnPerson> = emptyList(), val invitable: List<VpnPerson> = emptyList(),
)

@Serializable
data class VpnKey(val key: String, val expiresAt: String = "", val command: String)

private val json = Json { ignoreUnknownKeys = true }

/**
 * 網 Kimono VPN, as the phone looks after it: your devices, who reaches them,
 * whose you reach. Joining the mesh itself is Tailscale's, pointed at this Kimono.
 */
class Vpn(private val session: Session) {
    suspend fun view(): VpnView = json.decodeFromString(session.fetch(VPN))
    fun known(): VpnView? = session.answers.peek(VPN)?.let { runCatching { json.decodeFromString<VpnView>(it) }.getOrNull() }

    /** Signs a device out ("disconnect") or forgets it ("remove"). */
    suspend fun device(id: String, intent: String): VpnView = changed(session.call("$VPN/devices/$id", HttpMethod.Post) {
        contentType(ContentType.Application.Json); setBody(buildJsonObject { put("intent", intent) }.toString())
    })

    suspend fun guest(username: String, invited: Boolean): VpnView = changed(session.call("$VPN/guests", HttpMethod.Put) {
        contentType(ContentType.Application.Json); setBody(buildJsonObject { put("username", username); put("invited", invited) }.toString())
    })

    suspend fun key(): VpnKey = json.decodeFromString(session.call("$VPN/key", HttpMethod.Post))

    private fun changed(text: String): VpnView = json.decodeFromString<VpnView>(text).also { session.answers.put(VPN, text) }

    companion object { const val VPN = "/api/v1/vpn" }
}
