package app.kimono.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import coil3.compose.LocalPlatformContext
import app.kimono.resources.Res
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.svg.SvgDecoder
import org.jetbrains.compose.resources.ExperimentalResourceApi

/* The website's file-type marks (apps/portal/scripts/file-icons.mjs), shipped in the app. */

/** The mark for a file named [name] (TypeScript, Android, Excel…), if Kimono has one. */
@OptIn(ExperimentalResourceApi::class)
fun fileMarkUri(name: String): String? {
    val dot = name.lastIndexOf('.')
    val icon = fileIcons[(if (dot > 0) name.substring(dot + 1) else name).lowercase()] ?: return null
    return Res.getUri("files/file-icons/$icon.svg")
}

/** A file type's mark, or [fallback] when there's none or it won't load. */
@Composable
fun FileTypeMark(name: String, modifier: Modifier = Modifier, fallback: @Composable () -> Unit) {
    val uri = remember(name) { fileMarkUri(name) }
    var failed by remember(name) { mutableStateOf(false) }
    if (uri == null || failed) { fallback(); return }
    val context = LocalPlatformContext.current
    val request = remember(uri, context) { ImageRequest.Builder(context).data(uri).decoderFactory(SvgDecoder.Factory()).build() }
    AsyncImage(model = request, contentDescription = null, contentScale = ContentScale.Fit, modifier = modifier, onError = { failed = true })
}
