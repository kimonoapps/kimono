@file:OptIn(kotlin.time.ExperimentalTime::class)

package app.kimono.watch.data

import app.kimono.watch.model.AccountProfile
import app.kimono.watch.model.ApiFailure
import app.kimono.watch.model.DeviceAnswer
import app.kimono.watch.model.Discovery
import app.kimono.watch.model.SignInConfig
import app.kimono.watch.model.TokenAnswer
import app.kimono.watch.model.WatchProblem
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.prepareRequest
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.utils.io.readUTF8Line
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.Parameters
import io.ktor.http.URLBuilder
import io.ktor.http.isSuccess
import io.ktor.http.takeFrom
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.io.encoding.Base64
import kotlin.time.Clock

/** What the shared code needs from the device: values kept encrypted between launches, and a little crypto. */
interface Keeper {
    suspend fun read(key: String): String?
    suspend fun keep(key: String, value: String?)
    fun randomBytes(count: Int): ByteArray
    fun sha256(bytes: ByteArray): ByteArray
}

/**
 * Someone on this device: a Kimono account signed in here. "Who's watching?"
 * lists them; each keeps its own refresh token, so a household TV holds
 * everyone and nobody's progress lands on anyone else's.
 */
@Serializable
data class Profile(
    val server: String,
    val issuer: String,
    val clientId: String,
    val refresh: String,
    val username: String,
    val name: String = "",
    val picture: String? = null,
) {
    val key get() = "$server|$username"
    val shown get() = name.ifBlank { username }
}

/**
 * A TV waiting to be signed in from a phone: [code] is what the person enters
 * at [address] ([link] already holds it, for the QR code).
 */
class Pairing internal constructor(
    val server: String,
    val code: String,
    val address: String,
    val link: String,
    val expiresAt: Long,
    internal val interval: Long,
    internal val deviceCode: String,
    internal val config: SignInConfig,
    internal val tokenEndpoint: String,
)

sealed interface SignInNext {
    data object Done : SignInNext
    data object Code : SignInNext
}

private const val REDIRECT = "kimono://auth"
private const val KEPT = "watch.profiles"
private const val LAST = "watch.last"
const val OFFLINE = "Kimono isn't answering. Check your connection and try again."
private val REFUSALS = setOf("invalid_grant", "invalid_client", "invalid_scope")

/**
 * Signing in and staying signed in, the way the main Kimono app does
 * (shared/data/Session.kt): the same Portal-named provider, PKCE, the flow
 * answered in-app, only refresh tokens kept, access tokens in memory.
 */
class Accounts(val keeper: Keeper, val http: HttpClient) {
    private val json = Json { ignoreUnknownKeys = true }
    private val _profiles = MutableStateFlow<List<Profile>?>(null)
    /** Null until read from the device. */
    val profiles: StateFlow<List<Profile>?> = _profiles
    private val _active = MutableStateFlow<Profile?>(null)
    val active: StateFlow<Profile?> = _active
    private val access = mutableMapOf<String, Pair<String, Long>>()
    private val renewing = Mutex()
    private val discovered = mutableMapOf<String, Discovery>()
    /** Who was watching last, so a phone with one person on it opens straight to Home. */
    var lastKey: String? = null
        private set

    private fun now() = Clock.System.now().toEpochMilliseconds()

    suspend fun load() {
        val text = keeper.read(KEPT)
        _profiles.value = text?.let { runCatching { json.decodeFromString<List<Profile>>(it) }.getOrNull() } ?: emptyList()
        lastKey = keeper.read(LAST)
    }

    private suspend fun save(list: List<Profile>) {
        _profiles.value = list
        keeper.keep(KEPT, json.encodeToString(list))
    }

    suspend fun choose(profile: Profile?) {
        _active.value = profile
        if (profile != null) { lastKey = profile.key; keeper.keep(LAST, profile.key) }
    }

    suspend fun remove(profile: Profile) {
        runCatching {
            discover(profile.issuer).revocationEndpoint?.let { endpoint ->
                http.submitForm(endpoint, Parameters.build {
                    append("token", profile.refresh); append("token_type_hint", "refresh_token"); append("client_id", profile.clientId)
                })
            }
        }
        access.remove(profile.key)
        if (_active.value?.key == profile.key) _active.value = null
        save(_profiles.value.orEmpty().filter { it.key != profile.key })
    }

    private suspend fun discover(issuer: String): Discovery = discovered[issuer]
        ?: json.decodeFromString<Discovery>(http.get("${issuer.trimEnd('/')}/.well-known/openid-configuration").bodyAsText()).also { discovered[issuer] = it }

    private suspend fun tokens(endpoint: String, form: Map<String, String>): TokenAnswer {
        val response = http.submitForm(endpoint, Parameters.build { form.forEach { (k, v) -> append(k, v) } })
        if (response.status.value >= 500) error("token ${response.status.value}")
        return json.decodeFromString<TokenAnswer>(response.bodyAsText())
    }

    private class Pending(val flow: SignInFlow, val server: String, val config: SignInConfig, val tokenEndpoint: String, val verifier: String, val state: String, val username: String, val password: String)
    private var pending: Pending? = null

    private fun serverOf(address: String): String {
        val trimmed = address.trim().trimEnd('/')
        if (trimmed.isEmpty()) throw WatchProblem("Enter your Kimono's address.")
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "https://$trimmed"
    }

    private suspend fun configOf(server: String): SignInConfig = try {
        val response = http.get("$server/api/v1/sign-in")
        if (!response.status.isSuccess()) throw WatchProblem(failureOf(response, "There's no Kimono at that address."))
        json.decodeFromString<SignInConfig>(response.bodyAsText())
    } catch (problem: WatchProblem) { throw problem } catch (_: Exception) { throw WatchProblem("There's no Kimono at that address.") }

    /**
     * Asks for a code a TV shows, so the person signs it in from their phone
     * instead of typing a password with a remote.
     */
    suspend fun pair(address: String): Pairing {
        val server = serverOf(address)
        val config = configOf(server)
        val discovery = try { discover(config.issuer) } catch (_: Exception) { throw WatchProblem("Kimono isn't answering. Try again in a moment.") }
        val endpoint = discovery.deviceEndpoint ?: URLBuilder(config.issuer).takeFrom("/application/o/device/").buildString()
        val got = try {
            val response = http.submitForm(endpoint, Parameters.build {
                append("client_id", config.clientId); append("scope", config.scopes.joinToString(" "))
            })
            if (response.status.value == 429) throw WatchProblem("Too many codes for now. Try again in a few minutes.")
            json.decodeFromString<DeviceAnswer>(response.bodyAsText())
        } catch (problem: WatchProblem) { throw problem } catch (_: Exception) { throw WatchProblem("Kimono isn't answering. Try again in a moment.") }
        val code = got.userCode; val device = got.deviceCode
        if (code == null || device == null) throw WatchProblem("This Kimono can't sign in a TV yet. Sign in with a password instead.")
        val address = "${server.substringAfter("://")}/tv"
        return Pairing(server, code, address, "$server/tv?code=$code", now() + got.expiresIn * 1000, got.interval.coerceIn(2, 30), device, config, discovery.tokenEndpoint)
    }

    /**
     * Asks once whether the TV's code has been approved: true once it has
     * and the person is signed in here, false while it's still waiting.
     * Throws when the code ran out or was turned down.
     */
    suspend fun pairCheck(pairing: Pairing): Boolean {
        val got = try {
            tokens(pairing.tokenEndpoint, mapOf("grant_type" to "urn:ietf:params:oauth:grant-type:device_code", "client_id" to pairing.config.clientId, "device_code" to pairing.deviceCode))
        } catch (_: Exception) { return false }
        when (got.error) {
            null -> {}
            "authorization_pending", "slow_down" -> return false
            "access_denied" -> throw WatchProblem("That sign-in was turned down.")
            else -> throw WatchProblem("That code ran out.")
        }
        welcome(pairing.server, pairing.config, got)
        return true
    }

    /** How often to ask while a TV waits. */
    fun pairInterval(pairing: Pairing): Long = pairing.interval * 1000


    suspend fun signIn(address: String, username: String, password: String): SignInNext {
        val server = serverOf(address)
        if (username.isBlank()) throw WatchProblem("Enter your username.")
        if (password.isEmpty()) throw WatchProblem("Enter your password.")
        val config = configOf(server)
        val discovery = try { discover(config.issuer) } catch (_: Exception) { throw WatchProblem("Kimono isn't answering. Try again in a moment.") }
        val b64 = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT)
        val verifier = b64.encode(keeper.randomBytes(32))
        val challenge = b64.encode(keeper.sha256(verifier.encodeToByteArray()))
        val state = b64.encode(keeper.randomBytes(16))
        val url = URLBuilder(discovery.authorizationEndpoint).apply {
            parameters.append("response_type", "code")
            parameters.append("client_id", config.clientId)
            parameters.append("redirect_uri", REDIRECT)
            parameters.append("scope", config.scopes.joinToString(" "))
            parameters.append("code_challenge", challenge)
            parameters.append("code_challenge_method", "S256")
            parameters.append("state", state)
        }.buildString()
        val flow = SignInFlow(http, REDIRECT, config.issuer)
        val next = try {
            flow.start(url)
            flow.answer(username.trim(), password, null)
        } catch (problem: WatchProblem) { throw problem } catch (_: Exception) { throw WatchProblem("Kimono isn't answering. Try again in a moment.") }
        val waiting = Pending(flow, server, config, discovery.tokenEndpoint, verifier, state, username.trim(), password)
        if (next == SignInNextFlow.Code) { pending = waiting; return SignInNext.Code }
        finish(waiting)
        return SignInNext.Done
    }

    suspend fun signInCode(code: String): SignInNext {
        val waiting = pending ?: throw WatchProblem("Signing in didn't finish. Try again.")
        val next = try { waiting.flow.answer(waiting.username, waiting.password, code.filter { it.isLetterOrDigit() }) }
            catch (problem: WatchProblem) { throw problem } catch (_: Exception) { throw WatchProblem("Kimono isn't answering. Try again in a moment.") }
        if (next == SignInNextFlow.Code) return SignInNext.Code
        pending = null
        finish(waiting)
        return SignInNext.Done
    }

    fun cancelSignIn() { pending = null }

    private suspend fun finish(waiting: Pending) {
        val code = waiting.flow.code ?: throw WatchProblem("Signing in didn't finish. Try again.")
        if (waiting.flow.returnedState != waiting.state) throw WatchProblem("Signing in didn't finish. Try again.")
        val got = try {
            tokens(waiting.tokenEndpoint, mapOf("grant_type" to "authorization_code", "client_id" to waiting.config.clientId, "code" to code, "redirect_uri" to REDIRECT, "code_verifier" to waiting.verifier))
        } catch (_: Exception) { throw WatchProblem("Signing in didn't finish. Try again.") }
        welcome(waiting.server, waiting.config, got, waiting.username)
    }

    /** Keeps a new sign-in's tokens as a profile on this device and makes it the one watching. */
    private suspend fun welcome(server: String, config: SignInConfig, got: TokenAnswer, typed: String? = null) {
        val refresh = got.refreshToken
        val token = got.accessToken
        if (token == null || refresh == null) throw WatchProblem("Signing in didn't finish. Try again.")
        val me = runCatching {
            json.decodeFromString<AccountProfile>(http.get("$server/api/v1/me") { header(HttpHeaders.Authorization, "Bearer $token") }.bodyAsText())
        }.getOrNull()
        /* A TV never saw a username: without its name, the sign-in can't be told apart from anyone else's. */
        val username = me?.username ?: typed ?: throw WatchProblem("Signing in didn't finish. Try again.")
        /* Their name and portrait, for the face on "Who's watching?". */
        val profile = Profile(server, config.issuer, config.clientId, refresh, username, me?.name ?: "", me?.picture)
        access[profile.key] = token to now() + got.expiresIn * 1000
        save(_profiles.value.orEmpty().filter { it.key != profile.key } + profile)
        choose(profile)
    }

    /** Renews this profile's access token; a refusal signs only them out. */
    private suspend fun renew(profile: Profile): String = withContext(NonCancellable) { renewing.withLock {
        access[profile.key]?.let { (token, expires) -> if (expires - now() > 60_000) return@withLock token }
        val current = _profiles.value.orEmpty().firstOrNull { it.key == profile.key } ?: throw WatchProblem("Sign in to Kimono first.")
        val got = try {
            tokens(discover(current.issuer).tokenEndpoint, mapOf("grant_type" to "refresh_token", "client_id" to current.clientId, "refresh_token" to current.refresh))
        } catch (_: Exception) { throw WatchProblem(OFFLINE) }
        val token = got.accessToken
        if (token == null && got.error !in REFUSALS) throw WatchProblem(OFFLINE)
        if (token == null) {
            remove(current)
            throw WatchProblem("${current.shown} was signed out. Sign in again.", 401)
        }
        got.refreshToken?.takeIf { it != current.refresh }?.let { fresh ->
            save(_profiles.value.orEmpty().map { if (it.key == current.key) it.copy(refresh = fresh) else it })
        }
        access[current.key] = token to now() + got.expiresIn * 1000
        token
    } }

    private suspend fun token(profile: Profile): String = access[profile.key]?.takeIf { it.second - now() > 60_000 }?.first ?: renew(profile)

    private suspend fun failureOf(response: HttpResponse, fallback: String): String =
        runCatching { json.decodeFromString<ApiFailure>(response.bodyAsText()).error }.getOrNull()?.takeIf { it.isNotBlank() } ?: fallback

    /** Warms the chosen profile's token (the loading ring on "Who's watching?"), throwing if they've been signed out. */
    suspend fun ready(profile: Profile) { token(profile) }

    val server: String? get() = _active.value?.server

    /**
     * Listens to a server-sent event stream on /api/v1 as whoever is
     * watching, handing each event's name and data to [onEvent] until the
     * stream ends. Throws when it can't connect.
     */
    suspend fun stream(path: String, onEvent: suspend (event: String, data: String) -> Unit) {
        val profile = _active.value ?: throw WatchProblem("Choose who's watching first.", 401)
        suspend fun attempt(bearer: String): Boolean = http.prepareRequest("${profile.server}$path") {
            method = HttpMethod.Get
            header(HttpHeaders.Accept, "text/event-stream")
            header(HttpHeaders.Authorization, "Bearer $bearer")
        }.execute { response ->
            if (response.status.value == 401) return@execute false
            if (!response.status.isSuccess()) throw WatchProblem(failureOf(response, "The party isn't answering."), response.status.value)
            val channel = response.bodyAsChannel()
            var event = "message"; val data = StringBuilder()
            while (true) {
                val line = channel.readUTF8Line() ?: break
                when {
                    line.isEmpty() -> { if (data.isNotEmpty()) onEvent(event, data.toString()); event = "message"; data.clear() }
                    line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                    line.startsWith("data:") -> { if (data.isNotEmpty()) data.append('\n'); data.append(line.removePrefix("data:").trimStart()) }
                }
            }
            true
        }
        if (!attempt(token(profile))) { access.remove(profile.key); attempt(renew(profile)) }
    }

    /** Like [call], but answers with the body whatever the status (bar a sign-in that has ended), and the status. */
    suspend fun callAny(path: String, method: HttpMethod, configure: HttpRequestBuilder.() -> Unit = {}): Pair<Int, String> {
        val profile = _active.value ?: throw WatchProblem("Choose who's watching first.", 401)
        suspend fun attempt(bearer: String): Pair<Int, String>? = http.prepareRequest("${profile.server}$path") {
            this.method = method
            header(HttpHeaders.Accept, "application/json")
            header(HttpHeaders.Authorization, "Bearer $bearer")
            configure()
        }.execute { response -> if (response.status.value == 401) null else response.status.value to response.bodyAsText() }
        fun wrap(e: Exception): Nothing = when (e) { is WatchProblem, is CancellationException -> throw e; else -> throw WatchProblem(OFFLINE) }
        val first = try { attempt(token(profile)) } catch (e: Exception) { wrap(e) }
        if (first != null) return first
        access.remove(profile.key)
        /* Refused again with a token Authentik has only just granted: the server is the confused one (starting up for an update). */
        return (try { attempt(renew(profile)) } catch (e: Exception) { wrap(e) }) ?: throw WatchProblem(OFFLINE)
    }

    /** Calls /api/v1 as whoever is watching. [path] starts with a slash. */
    suspend fun call(path: String, method: HttpMethod = HttpMethod.Get, configure: HttpRequestBuilder.() -> Unit = {}): String {
        val profile = _active.value ?: throw WatchProblem("Choose who's watching first.", 401)
        suspend fun attempt(bearer: String): String? = http.prepareRequest("${profile.server}$path") {
            this.method = method
            header(HttpHeaders.Accept, "application/json")
            header(HttpHeaders.Authorization, "Bearer $bearer")
            configure()
        }.execute { response ->
            if (response.status.value == 401) null
            else if (!response.status.isSuccess()) throw WatchProblem(failureOf(response, "Something went wrong. Try again."), response.status.value)
            else response.bodyAsText()
        }
        fun wrap(e: Exception): Nothing = when (e) { is WatchProblem, is CancellationException -> throw e; else -> throw WatchProblem(OFFLINE) }
        val first = try { attempt(token(profile)) } catch (e: Exception) { wrap(e) }
        if (first != null) return first
        access.remove(profile.key)
        val second = try { attempt(renew(profile)) } catch (e: Exception) { wrap(e) }
        /* Only Authentik refusing the saved sign-in (in renew) signs someone out; a 401 on a token it
           has only just granted is the server starting up for an update, so the account stays. */
        return second ?: throw WatchProblem(OFFLINE)
    }
}
