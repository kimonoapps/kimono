package app.kimono.watch.player

import android.content.Context
import app.kimono.watch.MainActivity
import app.kimono.watch.R
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.cast.framework.media.CastMediaOptions
import com.google.android.gms.cast.framework.media.NotificationOptions

/**
 * Chromecast with Google's own receiver: it plays the Portal's HLS
 * rendition (H.264, AAC), so no receiver app of Kimono's own is needed.
 * Named in the manifest; the Cast framework makes it by name.
 */
class CastSetup : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions = CastOptions.Builder()
        .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
        .setStopReceiverApplicationWhenEndingSession(true)
        .setCastMediaOptions(
            CastMediaOptions.Builder()
                .setNotificationOptions(NotificationOptions.Builder().setSmallIconDrawableResId(R.drawable.ic_stat_watch).setTargetActivityClassName(MainActivity::class.java.name).build())
                .build(),
        )
        .build()

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
