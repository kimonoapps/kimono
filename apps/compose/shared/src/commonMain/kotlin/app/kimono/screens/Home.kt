@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.kimono.data.AccountProfile
import app.kimono.data.Drive
import app.kimono.data.KimonoAppLink
import app.kimono.data.KimonoProblem
import app.kimono.data.Platform
import app.kimono.ui.GroupLabel
import app.kimono.ui.KimonoBranch
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import coil3.compose.AsyncImage

/**
 * Home: what the Kimono app does itself (Drive, and your account under You),
 * then the rest of your Kimono, each opening its own app when it has one and
 * its website when it doesn't.
 */
@Composable
fun HomeScreen(me: AccountProfile?, drive: Drive, platform: Platform, openDrive: () -> Unit) {
    val first = me?.name?.split(" ")?.firstOrNull()?.takeIf { it.isNotBlank() } ?: me?.username ?: "home"
    var apps by remember { mutableStateOf<List<KimonoAppLink>?>(null) }
    LaunchedEffect(Unit) { apps = try { drive.otherApps() } catch (_: KimonoProblem) { null } }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            TopAppBar(
                title = { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { KimonoBranch(30.dp); Text("kimono", style = MaterialTheme.typography.titleLarge) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        }
        item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 22.dp)) {
                Text("Your household", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(buildAnnotatedString {
                    append("Welcome home, ")
                    withStyle(SpanStyle(color = MaterialTheme.colorScheme.primary)) { append("$first.") }
                }, style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 6.dp))
            }
        }
        item {
            Card(
                onClick = openDrive,
                shape = MaterialTheme.shapes.extraLarge,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer),
                modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth(),
            ) {
                Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Box(Modifier.size(56.dp).background(MaterialTheme.colorScheme.primary, MaterialShapes.Cookie9Sided.toShape()), contentAlignment = Alignment.Center) {
                        Icon(kimonoIcon("folder"), null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(26.dp))
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Drive", style = MaterialTheme.typography.headlineSmall)
                        Text("Your spaces and files, and what others share with you.", style = MaterialTheme.typography.bodyMedium)
                    }
                    Icon(kimonoIcon("go"), null, modifier = Modifier.size(20.dp))
                }
            }
        }
        val list = apps.orEmpty()
        if (list.isNotEmpty()) {
            item { GroupLabel("More Kimono apps") }
            itemsIndexed(list, key = { _, app -> app.id }) { index, app ->
                val store = if (platform.os == "ios") app.ios else app.android
                SegmentedListItem(
                    onClick = { platform.openUrl(store ?: app.web) },
                    shapes = ListItemDefaults.segmentedShapes(index, list.size),
                    colors = segmentColors(),
                    modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
                    leadingContent = { AppMark(app) },
                    supportingContent = { Text(if (store != null) "Opens its app" else app.description, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    trailingContent = { Icon(kimonoIcon("out"), null, modifier = Modifier.size(18.dp)) },
                ) { Text(app.name, style = MaterialTheme.typography.bodyLarge) }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

/** An app's glyph on its own colour, in a blossom like its tile on the web. */
@Composable
private fun AppMark(app: KimonoAppLink) {
    val accent = remember(app.accent) { parseColor(app.accent) }
    Box(Modifier.size(42.dp).background(accent, MaterialShapes.Flower.toShape()), contentAlignment = Alignment.Center) {
        if (app.icon != null) AsyncImage(model = app.icon, contentDescription = null, colorFilter = ColorFilter.tint(Color.White), modifier = Modifier.size(22.dp))
        else Text(app.shortName.take(1), color = Color.White, style = MaterialTheme.typography.titleMedium)
    }
}

private fun parseColor(hex: String): Color {
    val clean = hex.removePrefix("#")
    val value = clean.toLongOrNull(16) ?: return Color(0xFFA84D63)
    return if (clean.length == 6) Color(0xFF000000 or value) else Color(value)
}
