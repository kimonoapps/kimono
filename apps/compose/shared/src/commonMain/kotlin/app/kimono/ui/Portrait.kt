
package app.kimono.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.theme.Kata
import coil3.compose.AsyncImage

/** The first letter of a name, as the website shows when there's no picture. */
fun initialOf(name: String?, username: String?): String =
    (name?.trim()?.takeIf { it.isNotEmpty() } ?: username?.trim()?.takeIf { it.isNotEmpty() } ?: "?")
        .let { if (it.length > 1 && it[0].isHighSurrogate()) it.take(2) else it.take(1) }.uppercase()

/**
 * A person's picture, or their initial in Mincho. Large portraits sit in an
 * ink frame, a washed disc in an open brush ring; small ones (the tab,
 * lists) stay plainly round.
 */
@Composable
fun Portrait(picture: String?, name: String?, username: String?, size: Dp, modifier: Modifier = Modifier, shape: Shape? = null) {
    if (shape == null && size >= 64.dp) {
        InkPortraitFrame(username ?: name ?: "you", size, modifier) {
            /* A picture sits inside the ring; an initial is written straight onto the wash. */
            if (picture != null) Portrait(picture, name, username, size * .84f, shape = CircleShape)
            else Text(initialOf(name, username), color = Kata.plum, style = MaterialTheme.typography.displaySmall.copy(fontSize = (size.value * .42f).sp, lineHeight = (size.value * .5f).sp))
        }
        return
    }
    val clip = shape ?: CircleShape
    val framed = modifier.size(size).clip(clip)
    if (picture != null) {
        AsyncImage(model = picture, contentDescription = name ?: username, contentScale = ContentScale.Crop, modifier = framed.background(MaterialTheme.colorScheme.surfaceContainerHigh))
    } else {
        Box(framed.background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            Text(initialOf(name, username), color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.displaySmall.copy(fontSize = (size.value * .44f).sp, lineHeight = (size.value * .5f).sp))
        }
    }
}
