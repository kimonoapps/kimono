@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata

/** The plum rule the website's header sits on. */
fun Modifier.plumRule(): Modifier = drawWithContent {
    drawContent()
    val y = size.height - 1.dp.toPx()
    drawLine(Kata.plum, Offset(0f, y), Offset(size.width, y), strokeWidth = 2.dp.toPx())
}

/** A plain bar: back, a title, actions at the right edge. */
@Composable
fun KimonoTopBar(title: String, onBack: (() -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = { Text(title, style = MaterialTheme.typography.titleMedium) },
        navigationIcon = { if (onBack != null) IconButton(onClick = onBack) { Icon(kimonoIcon("back"), "Back", tint = Kata.inkSoft) } },
        actions = { Row(Modifier.padding(end = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { actions() } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Kata.ground),
        modifier = Modifier.plumRule(),
    )
}

@Composable
fun GroupLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = Kata.inkSoft, modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 8.dp))
}

/** One line of a settings list. */
@Composable
fun ListRow(label: String, detail: String? = null, danger: Boolean = false, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = if (danger) FontWeight.Bold else FontWeight.Normal), color = if (danger) Kata.suoDeep else Kata.ink, modifier = Modifier.weight(1f))
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = Kata.inkSoft, modifier = Modifier.padding(end = 8.dp))
            if (!danger) Icon(kimonoIcon("go"), null, tint = Kata.faint, modifier = Modifier.size(16.dp))
        }
        HorizontalDivider(color = Kata.hair)
    }
}

@Composable
fun Problem(text: String?) {
    if (text != null) Text(text, style = MaterialTheme.typography.bodyMedium, color = Kata.suoDeep)
}
