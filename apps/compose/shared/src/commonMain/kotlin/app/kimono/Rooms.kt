@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono

import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.ShortNavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import app.kimono.data.AccountProfile
import app.kimono.data.LauncherApp
import app.kimono.ui.AppAccentTheme
import app.kimono.ui.InkBloom
import app.kimono.ui.KimonoBranch
import app.kimono.ui.Portrait
import app.kimono.ui.kimonoIcon

/*
 * 間 The bottom bar is the room you're in. Its middle is the app you're in,
 * its bloom (Kimono's branch on Kimono's own pages); either side are that
 * app's rooms; on Kimono's own pages, Home and You. Pressing the bloom
 * brings up every app, to go to another. Inside an app the bar wears its colour.
 */

/** A screen to open from outside the app (an update notification, say), taken up once signed in. */
object Opening { val route = kotlinx.coroutines.flow.MutableStateFlow<String?>(null) }

/** One place in the bar: a room to go to, or something to do. */
class Room(val route: String, val label: String, val icon: String, val action: Boolean = false)

class RoomApp(val id: String, val name: String, val accent: String?, val glyph: String?, val before: List<Room>, val after: List<Room> = emptyList()) {
    val rooms get() = before + after
}

/* Kimono's own pages: Home (what's happening), the flower (every app), You. */
private val kimono = RoomApp("kimono", "Kimono", null, null, listOf(Room("home", "Home", "home")))
private val drive = RoomApp("kimono-drive", "Drive", "#5f5596", "file", listOf(Room("drive", "Spaces", "folder")), listOf(Room("trash", "Trash", "trash")))
/* Kimono AI has no bar: its chats and pages are in its drawer. */
private val vpn = RoomApp("kimono-vpn", "VPN", "#2f6b7a", "mesh", listOf(Room("vpn", "Devices", "phone"), Room("vpn/people", "People", "person")), listOf(Room("vpn/connect", "Connect", "link")))

/* Notes, as its mockup has it: Home (all notes), the bloom, Search. */
private val notes = RoomApp(app.kimono.data.Notes.APP_ID, "Notes", "#b56d78", "notes", listOf(Room("notes", "Home", "home")), listOf(Room("notes/search", "Search", "search", action = true)))

/** Which app's bar a screen shows, or null for a screen opened from a room (it has its own back). */
fun appOfRoom(route: String?): RoomApp? = when (route) {
    "home", "you" -> kimono
    "drive", "trash" -> drive
    "vpn", "vpn/people", "vpn/connect" -> vpn
    "notes", "notes/{notebook}" -> notes
    else -> null
}

@Composable
fun RoomBar(app: RoomApp, route: String?, launcherApp: LauncherApp?, me: AccountProfile?, go: (String) -> Unit, startTask: () -> Unit, openApps: () -> Unit) {
    val accent = launcherApp?.accent ?: app.accent
    AppAccentTheme(accent) {
        val colors = ShortNavigationBarItemDefaults.colors(
            selectedIndicatorColor = MaterialTheme.colorScheme.secondaryContainer, selectedIconColor = MaterialTheme.colorScheme.primary,
            selectedTextColor = MaterialTheme.colorScheme.onSurface, unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant, unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        @Composable fun RowScope.place(room: Room) = ShortNavigationBarItem(
            selected = route == room.route, onClick = { if (room.action) startTask() else go(room.route) },
            icon = { Icon(kimonoIcon(room.icon), null) }, label = { Text(room.label, maxLines = 1) }, colors = colors, modifier = Modifier.weight(1f),
        )
        /* The bloom stays dead centre whatever the app: its rooms share the left half, the rest and You the right. */
        Surface(color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().navigationBarsPadding().heightIn(min = 72.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f)) { app.before.forEach { place(it) } }
                Column(
                    Modifier.width(92.dp).clip(RoundedCornerShape(24.dp)).clickable(onClickLabel = "Every app", onClick = openApps).padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (accent == null) KimonoBranch(36.dp) else InkBloom(launcherApp?.id ?: app.id, accent, launcherApp?.glyph ?: app.glyph, 42.dp)
                    Text(if (app.id == "kimono-code") app.name else launcherApp?.name ?: app.name, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, maxLines = 1, modifier = Modifier.padding(top = 2.dp))
                }
                Row(Modifier.weight(1f)) {
                    app.after.forEach { place(it) }
                    /* You is Kimono's: inside an app the bar is that app's alone. */
                    if (app === kimono) ShortNavigationBarItem(selected = route == "you", onClick = { go("you") }, icon = { Portrait(me?.picture, me?.name, me?.username, 24.dp) }, label = { Text("You") }, colors = colors, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}
