@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.ui

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonShapes
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata

enum class SealTone { Primary, Quiet, Danger }

/**
 * 判 Seal — the hanko, on Material's expressive button.
 *
 * The carved inner ring and the 2px base stay Kimono's; pressing it borrows
 * Material's shape morph, so the block softens a little as it goes into the
 * paper, and springs back.
 */
@Composable
fun Seal(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: SealTone = SealTone.Primary,
    enabled: Boolean = true,
    busy: Boolean = false,
    compact: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val (face, base, text) = when (tone) {
        SealTone.Primary -> Triple(Kata.suo, Color(0xFF8A3E51), Kata.lift)
        SealTone.Quiet -> Triple(Kata.fold, Kata.hairDeep, Kata.ink)
        SealTone.Danger -> Triple(Kata.suoWash, Color(0xFFEBC4CC), Kata.suoDeep)
    }
    val live = enabled && !busy
    Button(
        onClick = onClick,
        enabled = live,
        interactionSource = interaction,
        shapes = ButtonShapes(shape = RoundedCornerShape(2.dp), pressedShape = RoundedCornerShape(7.dp)),
        colors = ButtonDefaults.buttonColors(
            containerColor = face,
            contentColor = text,
            disabledContainerColor = if (busy) face else Kata.fold,
            disabledContentColor = if (busy) text else Kata.faint,
        ),
        contentPadding = PaddingValues(horizontal = if (compact) 16.dp else 24.dp),
        modifier = modifier
            .heightIn(min = if (compact) 36.dp else 44.dp)
            .drawWithContent {
                drawContent()
                if (!live || pressed) return@drawWithContent
                /* the base the block stands on */
                drawRect(base, topLeft = Offset(0f, size.height - 2.dp.toPx()), size = Size(size.width, 2.dp.toPx()))
                /* the ring cut 3px in, primary only */
                if (tone == SealTone.Primary) {
                    val inset = 3.dp.toPx()
                    drawRoundRect(
                        color = Kata.lift.copy(alpha = .32f),
                        topLeft = Offset(inset, inset),
                        size = Size(size.width - inset * 2, size.height - inset * 2 - 2.dp.toPx()),
                        cornerRadius = CornerRadius(1.dp.toPx()),
                        style = Stroke(1.dp.toPx()),
                    )
                }
            },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (busy) LoadingIndicator(modifier = Modifier.size(20.dp), color = text)
            Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
        }
    }
}
