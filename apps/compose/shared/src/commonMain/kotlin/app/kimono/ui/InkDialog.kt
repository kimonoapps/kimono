package app.kimono.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.kimono.theme.Kata
import app.kimono.theme.LocalNight
import app.kimono.theme.plumInk

/*
 * 墨 Kimono's dialog: a sheet of paper with a wash of colour bled in from
 * its top corner, the subject's mark in its own puddle, a Mincho title, and
 * its seals along the foot. The sheet itself stays clean; the ink is in the
 * marks on it.
 */
@Composable
fun InkDialog(
    title: String,
    onDismiss: () -> Unit,
    icon: String? = null,
    tint: Color = Kata.suo,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val sheet = MaterialTheme.colorScheme.surfaceContainerLow
        val bleed = remember(title) { InkRandom(inkSeed("dialog:$title")).let { inkBlot(it, 4f, 2f, 30f, lobes = 11, low = .82f, high = 1.08f) } }
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = sheet,
            shadowElevation = 12.dp,
            modifier = Modifier.padding(horizontal = 24.dp).widthIn(max = 420.dp).fillMaxWidth(),
        ) {
            Column(
                Modifier.drawBehind {
                    /* The wash, in the 100 box laid over the sheet's top-left: colour pooling at its rim, the paper at its heart. */
                    val s = size.width / 100f * .9f
                    scale(s, s, pivot = Offset.Zero) {
                        drawWash(
                            bleed,
                            inkWash(mix(tint, sheet, .93f), mix(tint, sheet, .87f), mix(tint, sheet, .8f), Offset(0f, -2f), 34f, paper = mix(tint, sheet, .97f)),
                            tint, alpha = .8f, pool = .25f,
                        )
                    }
                }.padding(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 20.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    if (icon != null) InkBlot("dialog:$title", tint = tint, size = 44.dp) {
                        Icon(inkIcon(icon), null, tint = Kata.plum, modifier = Modifier.size(22.dp))
                    }
                    Text(title, style = MaterialTheme.typography.headlineSmall, color = plumInk)
                }
                Column(Modifier.padding(top = 20.dp)) { content() }
                Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically, content = actions)
            }
        }
    }
}


/** How a page looks in one appearance: its paper, its ink, and its seal. */
class InkLook(val paper: Color, val ink: Color, val seal: Color)

val DayLook = InkLook(paper = Color(0xFFFFFBF7), ink = Kata.plum, seal = Kata.suo)
val NightLook = InkLook(paper = Color(0xFF261E1B), ink = Color(0xFFF2E1CA), seal = Kata.suoDeep)

/**
 * A choice drawn as a small page in its own colours: a watercolour puddle of
 * its paper, two brushed lines of its text and a dab of its seal, inside a
 * wobbly plum brush outline. The chosen one is outlined in suō.
 * [looks] holds one look, or two to split the page down the middle.
 */
@Composable
fun InkPageChoice(label: String, looks: List<InkLook>, chosen: Boolean, onChoose: () -> Unit, modifier: Modifier = Modifier) {
    val marks = remember(label) {
        val random = InkRandom(inkSeed("page:$label"))
        val page = inkBlot(random, 50f, 50f, 42f, lobes = 10, low = .9f, high = 1.04f)
        val outline = inkBrush(page, random, 2.6f, closed = true, lift = 60f..110f, gap = 3f..6f, swell = .4f, wander = .25f)
        val chosenOutline = inkBrush(page, random, 4.4f, closed = true, lift = null, swell = .35f, wander = .2f)
        /* A little page: a heading, two lines of text, and its seal in the corner. */
        val lines = listOf(Triple(36f, 26f, 4.2f), Triple(49f, 40f, 2.6f), Triple(59f, 30f, 2.6f)).map { (y, w, weight) ->
            inkBrush(Path().apply { moveTo(27f, y); lineTo(27f + w, y + random.between(-.8f, .8f)) }, random, weight, closed = false, lift = null, swell = .3f)
        }
        val dab = inkBlot(random, 67f, 69f, 5.5f, lobes = 6, low = .9f, high = 1.05f)
        Marks(page, outline, chosenOutline, lines, dab)
    }
    val night = LocalNight.current
    val rest = if (night) plumInk.copy(alpha = .75f) else Kata.plum.copy(alpha = .8f)
    val ring by animateColorAsState(if (chosen) (if (night) Color(0xFFE2A0A8) else Kata.suo) else rest)
    val weight by animateFloatAsState(if (chosen) 1f else 0f)
    Column(
        modifier.selectable(selected = chosen, onClick = onChoose, role = Role.RadioButton, interactionSource = remember { MutableInteractionSource() }, indication = null),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Canvas(Modifier.fillMaxWidth().aspectRatio(1f)) {
            inBox {
                /* Each half of the page in its own look: one look fills the puddle, two split it down the middle. */
                looks.forEachIndexed { i, look ->
                    clipPath(Path().apply { val w = 100f / looks.size; addRect(androidx.compose.ui.geometry.Rect(i * w, 0f, (i + 1) * w, 100f)) }) {
                        drawWash(marks.page, inkWash(mix(look.paper, look.ink, .03f), mix(look.paper, look.ink, .07f), mix(look.paper, look.ink, .16f), Offset(46f, 44f), 56f, paper = look.paper), look.ink, pool = .6f)
                        marks.lines.forEach { drawPath(it, look.ink, alpha = .78f) }
                        drawPath(marks.dab, look.seal, alpha = .9f)
                    }
                }
                drawPath(marks.outline, ring, alpha = .85f * (1 - weight))
                drawPath(marks.chosenOutline, ring, alpha = .95f * weight)
            }
        }
        Text(
            label,
            style = MaterialTheme.typography.labelLarge.copy(fontWeight = if (chosen) FontWeight.Bold else FontWeight.Medium),
            color = if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

private class Marks(val page: Path, val outline: Path, val chosenOutline: Path, val lines: List<Path>, val dab: Path)
