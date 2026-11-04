package app.kimono.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest

/**
 * A mark the Portal drew: an app's bloom or a space's crest, as SVG. The
 * phone apps show these as they come rather than drawing them again, so a
 * colour changed on the Portal, or a new crest, shows here as it is there.
 */
@Composable
fun SvgMark(svg: String?, size: Dp, modifier: Modifier = Modifier) {
    if (svg == null) {
        Box(modifier.size(size))
        return
    }
    val context = LocalPlatformContext.current
    val request = remember(svg) {
        ImageRequest.Builder(context).data(svg.encodeToByteArray()).memoryCacheKey("mark-${svg.length}-${svg.hashCode()}").build()
    }
    AsyncImage(model = request, contentDescription = null, modifier = modifier.size(size))
}
