package app.kimono.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.FIND_AT_LEAST
import app.kimono.data.People
import app.kimono.data.Person
import app.kimono.ui.Portrait
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.delay

/*
 * 人 Finding someone on this Kimono, the one way every screen does it: type
 * three letters of a name and the closest few are shown (the Portal's
 * lib/people; the web's PeopleSearch is the same thing).
 */

@Composable
fun PeopleSearch(
    people: People,
    onPick: (Person) -> Unit,
    modifier: Modifier = Modifier,
    /** Usernames not to offer: you, the owner, who's in already. */
    skip: Set<String> = emptySet(),
    placeholder: String = "Add people",
) {
    var typed by remember { mutableStateOf("") }
    /* What the newest search found, with what it was for: an older answer isn't shown. */
    var answer by remember { mutableStateOf<Pair<String, List<Person>>?>(null) }
    val q = typed.trim().removePrefix("@")
    LaunchedEffect(q) {
        if (q.length < FIND_AT_LEAST) return@LaunchedEffect
        delay(200)
        answer = q to runCatching { people.find(q) }.getOrDefault(emptyList())
    }
    val hidden = skip.map { it.lowercase() }.toSet()
    val found = answer?.takeIf { it.first == q }?.second?.filter { it.username.lowercase() !in hidden }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            typed, { typed = it }, placeholder = { Text(placeholder) }, singleLine = true,
            leadingIcon = { Icon(kimonoIcon("search"), null, modifier = Modifier.size(18.dp)) },
            shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
        )
        when {
            q.isEmpty() -> {}
            q.length < FIND_AT_LEAST -> Note("Keep typing")
            found == null -> {}
            found.isEmpty() -> Note("No one by that name")
            else -> found.forEach { p ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(14.dp))
                        .clickable { typed = ""; people.know(listOf(p)); onPick(p) }.padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Portrait(p.picture, p.name, p.username, 36.dp)
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("@${p.username}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Icon(kimonoIcon("plus"), "Add ${p.name}", modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable
private fun Note(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp))
