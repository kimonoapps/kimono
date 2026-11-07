@file:OptIn(ExperimentalMaterial3Api::class)

package app.kimono.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata

/*
 * 墨 Kimono's sheet: the same paper as its dialogs, risen from the bottom.
 * One colour for every sheet, a brushed stroke for its handle, a wash bled
 * into its top corner behind the head, and its foot kept off the home
 * indicator by the hem (bottomChrome), not a whole inset.
 */
@Composable
fun InkSheet(
    onDismissRequest: () -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    seed: String = "sheet",
    tint: Color = Kata.suo,
    wash: Boolean = true,
    containerColor: Color = MaterialTheme.colorScheme.surfaceContainerLow,
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        sheetState = sheetState,
        containerColor = containerColor,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { InkHandle() },
        contentWindowInsets = { WindowInsets(0) },
    ) {
        Column(
            (if (wash) Modifier.inkBleed(seed, tint, containerColor) else Modifier).fillMaxWidth().bottomChrome(),
            content = content,
        )
    }
}

/** A sheet's handle: one short stroke of the brush. */
@Composable
fun InkHandle() {
    val stroke = remember {
        val random = InkRandom(inkSeed("handle"))
        inkBrush(Path().apply { moveTo(8f, 50f); lineTo(92f, 50f + random.between(-2f, 2f)) }, random, 11f, closed = false, lift = null, swell = .25f, wander = .3f, tip = .55f)
    }
    val ink = MaterialTheme.colorScheme.outline
    Box(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 14.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(width = 40.dp, height = 6.dp)) {
            scale(size.width / 100f, size.height / 12f * .9f, pivot = Offset.Zero) {
                drawPath(Path().apply { addPath(stroke, Offset(0f, -44f)) }, ink, alpha = .7f)
            }
        }
    }
}
