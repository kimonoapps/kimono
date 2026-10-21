package app.kimono.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.Parameters
import io.ktor.http.URLBuilder
import io.ktor.http.isSuccess
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/**
 * 鍵 Signing in, staying signed in, and talking to the Portal — the same
 * contract as the React Native app: the Portal says where to sign in, the
 * page opens in the system browser sheet with PKCE and prompt=login, only the
 * refresh token is kept (by the OS keystore), and access tokens live in memory.
 */
sealed interface SessionState {
    data object Loading : SessionState
    data class SignedOut(val server: String?) : SessionState
    data class SignedIn(val server: String, val me: AccountProfile?) : SessionState
}

private const val REDIRECT = "kimono://auth"
private val json = Json { ignoreUnknownKeys = true }

@OptIn(ExperimentalTime::class, ExperimentalEncodingApi::class)
class Session(private val platform: Platform, private val http: HttpClient) {
    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state

    private data class Kept(val server: String, val issuer: String, val clientId: String, val refreshToken: String)
    private var kept: Kept? = null
    private var access: Pair<String, Long>? = null
    private val renewing = Mutex()

    private fun now() = Clock.System.now().toEpochMilliseconds()

    suspend fun start() {
        val server = platform.readKept("kimono.server")
        val issuer = platform.readKept("kimono.issuer")
        val clientId = platform.readKept("kimono.clientId")
        val refresh = platform.readKept("kimono.refresh")
        if (server == null || issuer == null || clientId == null || refresh == null) {
            _state.value = SessionState.SignedOut(server)
            return
        }
        kept = Kept(server, issuer, clientId, refresh)
        _state.value = try {
            SessionState.SignedIn(server, me())
        } catch (problem: KimonoProblem) {
            /* Refused: signed out. Offline: stay in and try again when asked. */
            if (kept == null) SessionState.SignedOut(server) else SessionState.SignedIn(server, null)
        }
    }

    private suspend fun discover(issuer: String): Discovery =
        json.decodeFromString(http.get("${issuer.trimEnd('/')}/.well-known/openid-configuration").bodyAsText())

    private suspend fun tokens(endpoint: String, form: Map<String, String>): TokenAnswer {
        val response = http.submitForm(endpoint, Parameters.build { form.forEach { (k, v) -> append(k, v) } })
        return runCatching { json.decodeFromString<TokenAnswer>(response.bodyAsText()) }.getOrDefault(TokenAnswer(error = "status ${response.status.value}"))
    }

    suspend fun signIn(address: String) {
        val trimmed = address.trim().trimEnd('/')
        if (trimmed.isEmpty()) throw KimonoProblem("Enter your Kimono's address.")
        val server = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "https://$trimmed"
        val config = try {
            val response = http.get("$server/api/v1/sign-in")
            if (!response.status.isSuccess()) throw KimonoProblem(failureOf(response, "There's no Kimono at that address."))
            json.decodeFromString<SignInConfig>(response.bodyAsText())
        } catch (problem: KimonoProblem) { throw problem } catch (_: Exception) { throw KimonoProblem("There's no Kimono at that address.") }
        val discovery = try { discover(config.issuer) } catch (_: Exception) { throw KimonoProblem("Kimono's sign-in page isn't answering. Try again in a moment.") }

        val verifier = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT).encode(platform.randomBytes(32))
        val challenge = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT).encode(platform.sha256(verifier.encodeToByteArray()))
        val state = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT).encode(platform.randomBytes(16))
        val url = URLBuilder(discovery.authorizationEndpoint).apply {
            parameters.append("response_type", "code")
            parameters.append("client_id", config.clientId)
            parameters.append("redirect_uri", REDIRECT)
            parameters.append("scope", config.scopes.joinToString(" "))
            parameters.append("code_challenge", challenge)
            parameters.append("code_challenge_method", "S256")
            parameters.append("state", state)
            /* The password every time, asked exactly once: a browser sign-in
               older than this is refused and asked for again, and the one just
               typed passes. (prompt=login asks twice when the browser has none.) */
            parameters.append("max_age", "30")
        }.buildString()

        val returned = platform.openSignIn(url, REDIRECT) ?: return
        val answer = URLBuilder(returned).parameters
        if (answer["state"] != state) throw KimonoProblem("Signing in didn't finish. Try again.")
        val code = answer["code"] ?: throw KimonoProblem(answer["error_description"] ?: "Signing in didn't finish. Try again.")
        val got = try {
            tokens(discovery.tokenEndpoint, mapOf("grant_type" to "authorization_code", "client_id" to config.clientId, "code" to code, "redirect_uri" to REDIRECT, "code_verifier" to verifier))
        } catch (_: Exception) { throw KimonoProblem("Signing in didn't finish. Try again.") }
        val refresh = got.refreshToken
        if (got.accessToken == null || refresh == null) throw KimonoProblem("Signing in didn't finish. Try again.")
        kept = Kept(server, config.issuer, config.clientId, refresh)
        access = got.accessToken to now() + got.expiresIn * 1000
        platform.keep("kimono.server", server)
        platform.keep("kimono.issuer", config.issuer)
        platform.keep("kimono.clientId", config.clientId)
        platform.keep("kimono.refresh", refresh)
        _state.value = SessionState.SignedIn(server, me())
    }

    private suspend fun forget() {
        val server = kept?.server
        kept = null
        access = null
        platform.keep("kimono.refresh", null)
        _state.value = SessionState.SignedOut(server ?: platform.readKept("kimono.server"))
    }

    private suspend fun renew(): String = renewing.withLock {
        access?.let { (token, expires) -> if (expires - now() > 60_000) return@withLock token }
        val current = kept ?: throw KimonoProblem("Sign in to Kimono first.")
        val got = try {
            tokens(discover(current.issuer).tokenEndpoint, mapOf("grant_type" to "refresh_token", "client_id" to current.clientId, "refresh_token" to current.refreshToken))
        } catch (_: Exception) { throw KimonoProblem("Kimono isn't answering. Check your connection and try again.") }
        val token = got.accessToken
        if (token == null) {
            /* The provider said no: signed out elsewhere, expired, or switched off. */
            forget()
            throw KimonoProblem("You've been signed out. Sign in again.")
        }
        got.refreshToken?.takeIf { it != current.refreshToken }?.let {
            kept = current.copy(refreshToken = it)
            platform.keep("kimono.refresh", it)
        }
        access = token to now() + got.expiresIn * 1000
        token
    }

    private suspend fun token(): String = access?.takeIf { it.second - now() > 60_000 }?.first ?: renew()

    private suspend fun failureOf(response: HttpResponse, fallback: String): String =
        runCatching { json.decodeFromString<ApiFailure>(response.bodyAsText()).error }.getOrNull()?.takeIf { it.isNotBlank() } ?: fallback

    /** Calls /api/v1 as the signed-in person. Throws a KimonoProblem a person can read. */
    suspend fun call(path: String, method: HttpMethod = HttpMethod.Get, configure: HttpRequestBuilder.() -> Unit = {}): String {
        val base = kept?.server ?: throw KimonoProblem("Sign in to Kimono first.")
        suspend fun send(bearer: String) = http.request("$base$path") {
            this.method = method
            header(HttpHeaders.Accept, "application/json")
            header(HttpHeaders.Authorization, "Bearer $bearer")
            /* Not `configure()`'s neighbour build(): that is the builder's own method. */
            configure()
        }
        var response = try { send(token()) } catch (problem: KimonoProblem) { throw problem } catch (_: Exception) { throw KimonoProblem("Kimono isn't answering. Check your connection and try again.") }
        if (response.status.value == 401) {
            access = null
            response = try { send(renew()) } catch (problem: KimonoProblem) { throw problem } catch (_: Exception) { throw KimonoProblem("Kimono isn't answering. Check your connection and try again.") }
        }
        if (response.status.value == 401) {
            forget()
            throw KimonoProblem("You've been signed out. Sign in again.")
        }
        if (!response.status.isSuccess()) throw KimonoProblem(failureOf(response, "Something went wrong. Try again."))
        return response.bodyAsText()
    }

    suspend fun me(): AccountProfile = json.decodeFromString(call("/api/v1/me"))

    suspend fun refreshMe() {
        val current = _state.value
        if (current is SessionState.SignedIn) _state.value = current.copy(me = me())
    }

    suspend fun <T> decode(text: String, strategy: kotlinx.serialization.DeserializationStrategy<T>): T = json.decodeFromString(strategy, text)

    suspend fun signOut() {
        val current = kept
        if (current != null) runCatching {
            discover(current.issuer).revocationEndpoint?.let { endpoint ->
                http.submitForm(endpoint, Parameters.build {
                    append("token", current.refreshToken)
                    append("token_type_hint", "refresh_token")
                    append("client_id", current.clientId)
                })
            }
        }
        forget()
    }
}
