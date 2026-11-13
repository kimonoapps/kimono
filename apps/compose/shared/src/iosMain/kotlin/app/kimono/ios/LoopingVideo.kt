@file:OptIn(ExperimentalForeignApi::class)

package app.kimono.ios

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitViewController
import kotlinx.cinterop.ExperimentalForeignApi
import platform.AVFoundation.AVPlayerItem
import platform.AVFoundation.AVPlayerLooper
import platform.AVFoundation.AVQueuePlayer
import platform.AVFoundation.pause
import platform.AVFoundation.play
import platform.AVFoundation.setMuted
import platform.AVFoundation.AVLayerVideoGravityResizeAspect
import platform.AVKit.AVPlayerViewController
import platform.Foundation.NSURL
import platform.UIKit.UIColor

/** A short silent clip from the server, playing over and over with no controls, as a GIF would. */
@Composable
internal fun IosLoopingVideo(url: String, modifier: Modifier) {
    UIKitViewController(
        factory = {
            val player = AVQueuePlayer()
            player.setMuted(true)
            val item = NSURL.URLWithString(url)?.let { AVPlayerItem.playerItemWithURL(it) }
            /* The looper keeps the clip coming round; it lives as long as the view does. */
            val looper = item?.let { AVPlayerLooper.playerLooperWithPlayer(player, templateItem = it) }
            AVPlayerViewController().apply {
                this.player = player
                showsPlaybackControls = false
                videoGravity = AVLayerVideoGravityResizeAspect
                view.backgroundColor = UIColor.clearColor
                loopers[hashCode()] = looper
                player.play()
            }
        },
        modifier = modifier,
        onRelease = { controller ->
            controller.player?.pause()
            loopers.remove(controller.hashCode())
        },
        properties = UIKitInteropProperties(isInteractive = false, isNativeAccessibilityEnabled = false),
    )
}

private val loopers = mutableMapOf<Int, AVPlayerLooper?>()
