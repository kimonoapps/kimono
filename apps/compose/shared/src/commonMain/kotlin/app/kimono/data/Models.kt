package app.kimono.data

import kotlinx.serialization.Serializable

/** The shapes /api/v1 answers with, as in @kimono/account on the web side. */
@Serializable
data class AccountProfile(val username: String, val name: String, val email: String, val role: String, val picture: String? = null)

@Serializable
data class AccountSession(val id: String, val browser: String, val os: String, val device: String, val ip: String, val lastUsed: String? = null, val place: String? = null)

@Serializable
data class SessionList(val sessions: List<AccountSession>)

@Serializable
data class SignInConfig(val issuer: String, val clientId: String, val scopes: List<String>)

@Serializable
data class Discovery(
    @kotlinx.serialization.SerialName("authorization_endpoint") val authorizationEndpoint: String,
    @kotlinx.serialization.SerialName("token_endpoint") val tokenEndpoint: String,
    @kotlinx.serialization.SerialName("revocation_endpoint") val revocationEndpoint: String? = null,
)

@Serializable
data class TokenAnswer(
    @kotlinx.serialization.SerialName("access_token") val accessToken: String? = null,
    @kotlinx.serialization.SerialName("refresh_token") val refreshToken: String? = null,
    @kotlinx.serialization.SerialName("expires_in") val expiresIn: Long = 600,
    val error: String? = null,
)

@Serializable
data class ApiFailure(val error: String)

/** A sentence a person can read, for the screen to show as it is. */
class KimonoProblem(message: String) : Exception(message)
