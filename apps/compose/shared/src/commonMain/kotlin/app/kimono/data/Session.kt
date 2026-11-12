package app.kimono.data

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.HttpTimeoutConfig
import io.ktor.client.call.body
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.prepareRequest
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.fromHttpToGmtDate
import io.ktor.http.Parameters
import io.ktor.http.URLBuilder
import io.ktor.http.isSuccess
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/**
 * 鍵 Signing in, staying signed in, and talking to the Portal: the Portal says where to sign in, the
 * page opens in the system browser sheet with PKCE and prompt=login, only the
 * refresh token is kept (by the OS keystore), and access tokens live in memory.
 */
sealed interface SessionState {
    data object Loading : SessionState
    data class SignedOut(val server: String?) : SessionState
    data class SignedIn(val server: String, val me: AccountProfile?) : SessionState
}

private const val REDIRECT = "kimono://auth"
private const val ME = "/api/v1/me"
private val json = Json { ignoreUnknownKeys = true }

@OptIn(ExperimentalTime::class, ExperimentalEncodingApi::class)
class Session(private val platform: Platform, private val http: HttpClient) {
    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state

    private data class Kept(val server: String, val issuer: String, val clientId: String, val refreshToken: String)
    private var kept: Kept? = null
    private var access: Pair<String, Long>? = null
    private val renewing = Mutex()
    /** What the Portal answered last, so screens open on it while they ask again. */
    val answers = Answers(platform)
    /* The sign-in provider's endpoints barely ever change: asked once per launch, not at every renewal. */
    private val discovered = mutableMapOf<String, Discovery>()

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
        answers.server = server
        /* Who you were last time opens the app at once; the Portal is asked underneath. */
        answers.peek(ME)?.let { text -> runCatching { json.decodeFromString<AccountProfile>(text) }.getOrNull() }?.let { known ->
            _state.value = SessionState.SignedIn(server, known)
            try { refreshMe() } catch (_: KimonoProblem) { /* Refused: already signed out. Offline: what's known stands. */ }
            return
        }
        _state.value = try {
            SessionState.SignedIn(server, me())
        } catch (problem: KimonoProblem) {
            /* Refused: signed out. Offline: stay in and try again when asked. */
            if (kept == null) SessionState.SignedOut(server) else SessionState.SignedIn(server, null)
        }
    }

    private suspend fun discover(issuer: String): Discovery = discovered[issuer]
        ?: json.decodeFromString<Discovery>(http.get("${issuer.trimEnd('/')}/.well-known/openid-configuration").bodyAsText()).also { discovered[issuer] = it }

    /* An answer that isn't the provider's (a gateway's error page, a 5xx) throws, so it reads as offline, never as a refusal. */
    private suspend fun tokens(endpoint: String, form: Map<String, String>): TokenAnswer {
        val response = http.submitForm(endpoint, Parameters.build { form.forEach { (k, v) -> append(k, v) } })
        if (response.status.value >= 500) error("token ${response.status.value}")
        return json.decodeFromString<TokenAnswer>(response.bodyAsText())
    }

    /* A sign-in waiting on a code from the person's authenticator app. */
    private class Pending(val flow: SignInFlow, val server: String, val config: SignInConfig, val tokenEndpoint: String, val verifier: String, val state: String, val username: String, val password: String)
    private var pending: Pending? = null

    /**
     * Signs in with a username and password typed into the app. The steps
     * the sign-in page would take run here, out of sight; an account with an
     * authenticator app asks for its code next ([SignInNext.Code]).
     */
    suspend fun signIn(address: String, username: String, password: String): SignInNext {
        val trimmed = address.trim().trimEnd('/')
        if (trimmed.isEmpty()) throw KimonoProblem("Enter your Kimono's address.")
        if (username.isBlank()) throw KimonoProblem("Enter your username.")
        if (password.isEmpty()) throw KimonoProblem("Enter your password.")
        val server = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "https://$trimmed"
        val config = try {
            val response = http.get("$server/api/v1/sign-in")
            if (!response.status.isSuccess()) throw KimonoProblem(failureOf(response, "There's no Kimono at that address."))
            json.decodeFromString<SignInConfig>(response.bodyAsText())
        } catch (problem: KimonoProblem) { throw problem } catch (_: Exception) { throw KimonoProblem("There's no Kimono at that address.") }
        val discovery = try { discover(config.issuer) } catch (_: Exception) { throw KimonoProblem("Kimono isn't answering. Try again in a moment.") }

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
        }.buildString()

        val flow = SignInFlow(http, REDIRECT, config.issuer)
        val next = try {
            flow.start(url)
            flow.answer(username.trim(), password, null)
        } catch (problem: KimonoProblem) { throw problem } catch (_: Exception) { throw KimonoProblem("Kimono isn't answering. Try again in a moment.") }
        val waiting = Pending(flow, server, config, discovery.tokenEndpoint, verifier, state, username.trim(), password)
        if (next == SignInNext.Code) { pending = waiting; return next }
        finish(waiting)
        return SignInNext.Done
    }

    /** The code from the authenticator app, for a sign-in that asked for one. */
    suspend fun signInCode(code: String): SignInNext {
        val waiting = pending ?: throw KimonoProblem("Signing in didn't finish. Try again.")
        val next = try { waiting.flow.answer(waiting.username, waiting.password, code.filter { it.isLetterOrDigit() }) }
            catch (problem: KimonoProblem) { throw problem } catch (_: Exception) { throw KimonoProblem("Kimono isn't answering. Try again in a moment.") }
        if (next == SignInNext.Code) return next
        pending = null
        finish(waiting)
        return SignInNext.Done
    }

    /**
     * Whether a newer version of this app is out, and whether it's required:
     * asked of the Kimono you use, or kimonolabs.dev before you've signed in.
     * Null when there's nothing new, or no answer.
     */
    suspend fun checkUpdate(): AppUpdate? = runCatching {
        val server = kept?.server ?: platform.readKept("kimono.server") ?: app.kimono.screens.DEFAULT_SERVER
        val response = http.get("$server/api/v1/app/update?platform=${platform.os}&build=${platform.build}")
        if (!response.status.isSuccess()) null else json.decodeFromString<AppUpdate>(response.bodyAsText())
    }.getOrNull()?.takeIf { it.available && it.url != null }

    /** Starts over from the username and password. */
    fun cancelSignIn() { pending = null }

    private suspend fun finish(waiting: Pending) {
        val code = waiting.flow.code ?: throw KimonoProblem("Signing in didn't finish. Try again.")
        if (waiting.flow.returnedState != waiting.state) throw KimonoProblem("Signing in didn't finish. Try again.")
        val got = try {
            tokens(waiting.tokenEndpoint, mapOf("grant_type" to "authorization_code", "client_id" to waiting.config.clientId, "code" to code, "redirect_uri" to REDIRECT, "code_verifier" to waiting.verifier))
        } catch (_: Exception) { throw KimonoProblem("Signing in didn't finish. Try again.") }
        val refresh = got.refreshToken
        if (got.accessToken == null || refresh == null) throw KimonoProblem("Signing in didn't finish. Try again.")
        kept = Kept(waiting.server, waiting.config.issuer, waiting.config.clientId, refresh)
        answers.clear()
        answers.server = waiting.server
        access = got.accessToken to now() + got.expiresIn * 1000
        platform.keep("kimono.server", waiting.server)
        platform.keep("kimono.issuer", waiting.config.issuer)
        platform.keep("kimono.clientId", waiting.config.clientId)
        platform.keep("kimono.refresh", refresh)
        _state.value = SessionState.SignedIn(waiting.server, me())
    }

    private suspend fun forget() {
        val server = kept?.server
        kept = null
        access = null
        answers.clear()
        answers.server = null
        platform.keep("kimono.refresh", null)
        _state.value = SessionState.SignedOut(server ?: platform.readKept("kimono.server"))
    }

    /* Once asked, a renewal finishes and is kept even if whatever wanted it has gone (a screen
       left, the app sent to the back): the provider has already retired the old token by then,
       and dropping its answer would leave this phone holding only that. */
    private suspend fun renew(): String = withContext(NonCancellable) { renewing.withLock {
        access?.let { (token, expires) -> if (expires - now() > 60_000) return@withLock token }
        /* The Files app extension shares this sign-in and may have renewed it since: start from what is kept now. */
        var current = latestKept() ?: throw KimonoProblem("Sign in to Kimono first.")
        suspend fun ask(from: Kept) = try {
            tokens(discover(from.issuer).tokenEndpoint, mapOf("grant_type" to "refresh_token", "client_id" to from.clientId, "refresh_token" to from.refreshToken))
        } catch (_: Exception) { throw KimonoProblem(OFFLINE) }
        var got = ask(current)
        /* Refused, perhaps because the Files extension renewed at the same moment and is still
           saving the token it got: give it a few seconds, and try again with what it kept. */
        var waited = 0
        while (got.accessToken == null && waited < 5) {
            val again = latestKept() ?: break
            if (again.refreshToken != current.refreshToken) { current = again; got = ask(again); continue }
            delay(1_000)
            waited++
        }
        val token = got.accessToken
        if (token == null && got.error !in REFUSALS) throw KimonoProblem(OFFLINE)
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
    } }

    private suspend fun latestKept(): Kept? {
        val known = kept ?: return null
        val refresh = platform.readKept("kimono.refresh") ?: return known
        return known.copy(refreshToken = refresh).also { kept = it }
    }

    private suspend fun token(): String = access?.takeIf { it.second - now() > 60_000 }?.first ?: renew()

    private suspend fun failureOf(response: HttpResponse, fallback: String): String =
        runCatching { json.decodeFromString<ApiFailure>(response.bodyAsText()).error }.getOrNull()?.takeIf { it.isNotBlank() } ?: fallback

    /* A stream that stays open for minutes, its heartbeat every 15 s: no overall limit, only a quiet one. */
    private val streaming by lazy { http.config { install(HttpTimeout) { requestTimeoutMillis = HttpTimeoutConfig.INFINITE_TIMEOUT_MS; socketTimeoutMillis = 45_000 } } }

    /** The Kimono this app is signed in to, as https://… with no trailing slash. */
    val server: String? get() = kept?.server

    /**
     * Calls /api/v1 as the signed-in person and hands back the answer, whatever
     * its status (other than a sign-in that has ended, which signs out). [path]
     * starts with a slash; [handle] reads the answer while it streams.
     */
    suspend fun <T> respond(path: String, method: HttpMethod = HttpMethod.Get, configure: HttpRequestBuilder.() -> Unit = {}, long: Boolean = false, handle: suspend (HttpResponse) -> T): T {
        val base = kept?.server ?: throw KimonoProblem("Sign in to Kimono first.")
        val offline = OFFLINE
        suspend fun attempt(bearer: String): T? = (if (long) streaming else http).prepareRequest("$base$path") {
            this.method = method
            header(HttpHeaders.Accept, "application/json")
            header(HttpHeaders.Authorization, "Bearer $bearer")
            /* Not `configure()`'s neighbour build(): that is the builder's own method. */
            configure()
        }.execute { response -> ServerClock.heard(response.headers[HttpHeaders.Date]); if (response.status.value == 401) null else handle(response) }
        val first = try { attempt(token()) } catch (problem: KimonoProblem) { throw problem } catch (cancel: kotlinx.coroutines.CancellationException) { throw cancel } catch (_: Exception) { throw KimonoProblem(offline) }
        if (first != null) return first
        access = null
        val second = try { attempt(renew()) } catch (problem: KimonoProblem) { throw problem } catch (cancel: kotlinx.coroutines.CancellationException) { throw cancel } catch (_: Exception) { throw KimonoProblem(offline) }
        if (second != null) return second
        forget()
        throw KimonoProblem("You've been signed out. Sign in again.")
    }

    /** Calls /api/v1 as the signed-in person. Throws a KimonoProblem a person can read. */
    suspend fun call(path: String, method: HttpMethod = HttpMethod.Get, configure: HttpRequestBuilder.() -> Unit = {}): String =
        respond(path, method, configure) { response ->
            if (!response.status.isSuccess()) throw KimonoProblem(failureOf(response, "Something went wrong. Try again."))
            response.bodyAsText()
        }

    /** Like [call] for a question (a GET), keeping the answer for [answers]. */
    suspend fun fetch(path: String): String = call(path).also { answers.put(path, it) }

    suspend fun problemOf(response: HttpResponse, fallback: String): KimonoProblem = KimonoProblem(failureOf(response, fallback))

    suspend fun me(): AccountProfile = json.decodeFromString(fetch(ME))

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

/** The provider's answers that mean this sign-in is over, rather than a hiccup. */
private val REFUSALS = setOf("invalid_grant", "invalid_client", "invalid_scope")

/** What a dropped or missing connection reads as: worth trying again, unlike a refusal. */
const val OFFLINE = "Kimono isn't answering. Check your connection and try again."

/**
 * The server's clock, as heard in its replies' Date headers. A phone whose clock is
 * off would otherwise count a turn's time from the wrong moment (a chat "thinking"
 * from 40s the moment it starts). Seconds only, so small differences are left alone.
 */
object ServerClock {
    var offset = 0L
        private set

    fun heard(date: String?) {
        val server = date?.let { runCatching { it.fromHttpToGmtDate().timestamp + 500 }.getOrNull() } ?: return
        val off = server - kotlin.time.Clock.System.now().toEpochMilliseconds()
        offset = if (kotlin.math.abs(off) < 2_000) 0 else off
    }

    fun now() = kotlin.time.Clock.System.now().toEpochMilliseconds() + offset
}
