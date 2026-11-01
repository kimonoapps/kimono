@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage

/** The first letter of a name, as the website shows when there's no picture. */
fun initialOf(name: String?, username: String?): String =
    (name?.trim()?.takeIf { it.isNotEmpty() } ?: username?.trim()?.takeIf { it.isNotEmpty() } ?: "?")
        .let { if (it.length > 1 && it[0].isHighSurrogate()) it.take(2) else it.take(1) }.uppercase()

/**
 * A person's picture, or their initial in Mincho. Large portraits wear
 * Material's scalloped cookie; small ones (the tab, lists) stay round.
 */
@Composable
fun Portrait(picture: String?, name: String?, username: String?, size: Dp, modifier: Modifier = Modifier, shape: Shape? = null) {
    val clip = shape ?: if (size >= 64.dp) MaterialShapes.Cookie12Sided.toShape() else CircleShape
    val framed = modifier.size(size).clip(clip)
    if (picture != null) {
        AsyncImage(model = picture, contentDescription = name ?: username, contentScale = ContentScale.Crop, modifier = framed.background(MaterialTheme.colorScheme.surfaceContainerHigh))
    } else {
        Box(framed.background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            Text(initialOf(name, username), color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.displaySmall.copy(fontSize = (size.value * .44f).sp, lineHeight = (size.value * .5f).sp))
        }
    }
}
