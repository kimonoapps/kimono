package app.kimono.data

import io.ktor.client.HttpClient
import io.ktor.client.plugins.cookies.AcceptAllCookiesStorage
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.plugins.cookies.cookies
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.URLBuilder
import io.ktor.http.Url
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import io.ktor.http.hostWithPort
import io.ktor.http.takeFrom
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** What signing in needs next, after the username and password. */
sealed interface SignInNext {
    data object Done : SignInNext
    /** A one-time code from the person's authenticator app. */
    data object Code : SignInNext
}

/**
 * Signing in without leaving the app: the same steps the sign-in page takes
 * (who you are, your password, a code if you use one), answered here through
 * the identity provider's flow API, ending at the same authorisation code the
 * page would hand back. People only ever see Kimono.
 */
internal class SignInFlow(http: HttpClient, private val redirect: String, issuer: String) {
    /* The password only ever goes to the identity provider Kimono named, wherever the redirects lead. */
    private val issuer = Url(issuer)
    private val json = Json { ignoreUnknownKeys = true }
    private val cookies = AcceptAllCookiesStorage()
    /* Its own jar, and redirects taken one at a time so the app's own address can be caught. */
    private val client = http.config {
        followRedirects = false
        install(HttpCookies) { storage = cookies }
    }
    private var executor: String? = null
    private var origin: String = ""
    private var challenge: JsonObject? = null
    /** The authorisation code, once the flow hands it back. */
    var code: String? = null
        private set
    var returnedState: String? = null
        private set

    private val failed = "Signing in didn't finish. Try again."
    /* Stands in for the next step once the code is back. */
    private val finished = buildJsonObject { put("component", "done") }

    /** Opens the authorisation address and follows it to the sign-in flow. */
    suspend fun start(authorizeUrl: String) {
        var url = authorizeUrl
        repeat(10) {
            if (caught(url)) return
            val response = client.get(url)
            val location = response.headers["Location"]
            if (response.status.value in 300..399 && location != null) {
                url = if (location.startsWith(redirect)) location else URLBuilder(Url(url)).takeFrom(location).buildString()
                val flow = Regex("/if/flow/([^/]+)/").find(Url(url).encodedPath)
                if (flow != null) {
                    val page = Url(url)
                    if (!page.host.equals(issuer.host, ignoreCase = true) || page.protocol != issuer.protocol) throw KimonoProblem("Signing in led somewhere other than Kimono.")
                    /* The origin as the server writes it: no ":443" on https (Authentik's CSRF check compares it exactly). */
                    origin = "${page.protocol.name}://${if (page.port == page.protocol.defaultPort) page.host else page.hostWithPort}"
                    executor = "$origin/api/v3/flows/executor/${flow.groupValues[1]}/?query=${page.encodedQuery.encodeURLParameter()}"
                    challenge = read(client.get(executor!!))
                    return
                }
            } else throw KimonoProblem(failed)
        }
        throw KimonoProblem(failed)
    }

    /** Answers the flow's questions with what the person typed, until it needs more or is done. */
    suspend fun answer(username: String?, password: String?, otp: String?): SignInNext {
        repeat(12) {
            if (code != null) return SignInNext.Done
            val current = challenge ?: throw KimonoProblem(failed)
            val component = current["component"]?.jsonPrimitive?.contentOrNull ?: throw KimonoProblem(failed)
            problemIn(current)?.let { throw KimonoProblem(it) }
            val reply: JsonObject = when (component) {
                "ak-stage-identification" -> buildJsonObject {
                    put("component", component)
                    put("uid_field", username ?: throw KimonoProblem("Enter your username."))
                    if (current["password_fields"]?.jsonPrimitive?.contentOrNull == "true") put("password", password ?: "")
                }
                "ak-stage-password" -> buildJsonObject { put("component", component); put("password", password ?: throw KimonoProblem("Enter your password.")) }
                "ak-stage-authenticator-validate" -> {
                    val kinds = current["device_challenges"]?.jsonArray?.mapNotNull { it.jsonObject["device_class"]?.jsonPrimitive?.contentOrNull }.orEmpty()
                    if ("totp" !in kinds && "static" !in kinds) throw KimonoProblem("This account signs in with a security key, which the app can't use yet. Sign in on the website.")
                    if (otp == null) return SignInNext.Code
                    buildJsonObject { put("component", component); put("code", otp) }
                }
                /* The app is Kimono's own: agree to it on the person's behalf. */
                "ak-stage-consent" -> buildJsonObject { put("component", component); put("token", current["token"]?.jsonPrimitive?.contentOrNull ?: "") }
                "ak-stage-user-login" -> buildJsonObject { put("component", component); put("remember_me", false) }
                "xak-flow-redirect" -> {
                    follow(current["to"]?.jsonPrimitive?.contentOrNull ?: throw KimonoProblem(failed))
                    return@repeat
                }
                "ak-stage-flow-error" -> throw KimonoProblem(current["error"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: failed)
                "ak-stage-access-denied" -> throw KimonoProblem(current["error_message"]?.jsonPrimitive?.contentOrNull ?: "This account can't sign in here.")
                else -> throw KimonoProblem("This account needs a step the app can't do yet. Sign in on the website first.")
            }
            challenge = read(post(reply))
            /* A wrong password comes back as the same step with errors. */
            problemIn(challenge!!)?.let { message ->
                if (component == "ak-stage-authenticator-validate") throw KimonoProblem("That code didn't work. Try the newest one.")
                throw KimonoProblem(message)
            }
        }
        if (code != null) return SignInNext.Done
        throw KimonoProblem(failed)
    }

    private suspend fun post(reply: JsonObject): HttpResponse {
        val csrf = cookies.get(Url(origin)).firstOrNull { it.name == "authentik_csrf" }?.value
        return client.post(executor!!) {
            contentType(ContentType.Application.Json)
            csrf?.let { header("X-authentik-CSRF", it) }
            header("Referer", origin)
            setBody(reply.toString())
        }
    }

    /** Reads the next step, following the flow's own redirects back to itself. */
    private suspend fun read(first: HttpResponse): JsonObject {
        var response = first
        repeat(5) {
            val location = response.headers["Location"]
            if (response.status.value in 300..399 && location != null) {
                val next = URLBuilder(Url(origin)).takeFrom(location).buildString()
                if (!next.contains("/flows/executor/")) {
                    follow(next)
                    return if (code != null) finished else challenge ?: throw KimonoProblem(failed)
                }
                response = client.get(next)
            } else return json.parseToJsonElement(response.bodyAsText()).jsonObject
        }
        throw KimonoProblem(failed)
    }

    /** Follows an address the flow sends us to, catching the app's own address at the end. */
    private suspend fun follow(to: String) {
        var url = URLBuilder(Url(origin)).takeFrom(to).buildString()
        repeat(10) {
            if (caught(url)) return
            val response = client.get(url)
            val location = response.headers["Location"] ?: run {
                /* Another flow (consent, say): carry on there. */
                val flow = Regex("/if/flow/([^/]+)/").find(Url(url).encodedPath) ?: throw KimonoProblem(failed)
                executor = "$origin/api/v3/flows/executor/${flow.groupValues[1]}/?query=${Url(url).encodedQuery.encodeURLParameter()}"
                challenge = read(client.get(executor!!))
                return
            }
            url = if (location.startsWith(redirect)) location else URLBuilder(Url(url)).takeFrom(location).buildString()
            Regex("/if/flow/([^/]+)/").find(Url(url).encodedPath)?.let { flow ->
                executor = "$origin/api/v3/flows/executor/${flow.groupValues[1]}/?query=${Url(url).encodedQuery.encodeURLParameter()}"
                challenge = read(client.get(executor!!))
                return
            }
        }
        throw KimonoProblem(failed)
    }

    private fun caught(url: String): Boolean {
        if (!url.startsWith(redirect)) return false
        val answer = URLBuilder(url).parameters
        code = answer["code"] ?: throw KimonoProblem(answer["error_description"] ?: failed)
        returnedState = answer["state"]
        return true
    }

    /** The first error the flow gives for what was sent, in its own words. */
    private fun problemIn(step: JsonObject): String? {
        val errors = step["response_errors"] as? JsonObject ?: return null
        val first = errors.values.firstOrNull() as? JsonArray ?: return null
        val text = (first.firstOrNull() as? JsonObject)?.get("string")?.jsonPrimitive?.contentOrNull ?: return "That didn't work. Try again."
        return when {
            text.contains("password", ignoreCase = true) || text.contains("invalid", ignoreCase = true) -> "That username or password isn't right."
            else -> text
        }
    }
}

