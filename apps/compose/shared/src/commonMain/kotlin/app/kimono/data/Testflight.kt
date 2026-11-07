package app.kimono.data

import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * 試 Kimono's iPhone apps come through TestFlight, one at a time and by
 * asking: a person asks for an app, an admin approves, and only then does
 * Apple invite them. This asks the Portal (/api/v1/app/testflight) where
 * someone stands with each app, and asks for one.
 */

private val json = Json { ignoreUnknownKeys = true }

/**
 * One iPhone app as the Portal sees you: [status] is idle (not asked),
 * requested (waiting for an admin), declined, waiting (approved, invite on its
 * way), invited, stuck (invite expired or unanswered), tester, problem or none
 * (no email to invite).
 */
@Serializable
data class TestflightApp(val bundleId: String, val name: String, val status: String)

@Serializable
data class TestflightStanding(val email: String? = null, val apps: List<TestflightApp> = emptyList())

class Testflight(private val session: Session) {
    /** Where you stand with each iPhone app; null when this Kimono has no TestFlight, or doesn't answer. */
    suspend fun mine(): TestflightStanding? = runCatching { json.decodeFromString<TestflightStanding>(session.call(PATH)) }.getOrNull()

    /** Asks for [bundleId]; once approved, asking again checks on the invite. */
    suspend fun ask(bundleId: String): TestflightStanding = json.decodeFromString(session.call(PATH, HttpMethod.Post) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("app", bundleId) }.toString())
    })

    companion object {
        private const val PATH = "/api/v1/app/testflight"
    }
}

/** [phone]'s TestFlight app in [standing], matched by bundle ID (the same as its Android package) or name. */
fun TestflightStanding.appFor(phone: PhoneApp, fullName: String): TestflightApp? =
    apps.firstOrNull { it.bundleId == phone.androidPackage } ?: apps.firstOrNull { it.name == phone.name || it.name == fullName }
