package app.kimono.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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

/** A person's picture, or their initial on folded paper. */
@Composable
fun Portrait(picture: String?, name: String?, username: String?, size: Dp, modifier: Modifier = Modifier) {
    val round = modifier.size(size).clip(CircleShape).border(1.dp, Kata.hairDeep, CircleShape)
    if (picture != null) {
        AsyncImage(model = picture, contentDescription = name ?: username, contentScale = ContentScale.Crop, modifier = round.background(Kata.fold))
    } else {
        Box(round.background(Kata.fold), contentAlignment = Alignment.Center) {
            Text(initialOf(name, username), style = MaterialTheme.typography.displaySmall.copy(fontSize = (size.value * .46f).sp, lineHeight = (size.value * .5f).sp))
        }
    }
}
