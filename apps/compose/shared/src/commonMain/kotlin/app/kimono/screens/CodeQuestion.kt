@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import app.kimono.data.CodeEvent
import app.kimono.data.QuestionReply
import app.kimono.theme.Kata
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.bottomChrome
import app.kimono.ui.inkBleed
import app.kimono.ui.kimonoIcon

/*
 * 問 Kimono AI's questions, in the writing bar's place: one at a time, its
 * options as rows to tap, Other to write in. Kept above the panel so that a
 * send that fails comes back with what was picked.
 */

/** What has been picked so far for one [CodeEvent.Question], kept while it waits. */
@Stable
internal class QuestionDraft(val question: CodeEvent.Question) {
    val count = question.questions.size
    var at by mutableIntStateOf(0)
    val picked = mutableStateListOf<List<String>>().apply { repeat(count) { add(emptyList()) } }
    val other = mutableStateListOf<String>().apply { repeat(count) { add("") } }
    val writing = mutableStateListOf<Boolean>().apply { repeat(count) { add(false) } }
    var problem by mutableStateOf<String?>(null)

    fun has(i: Int) = picked[i].isNotEmpty() || other[i].isNotBlank()
    fun replies() = (0 until count).map { QuestionReply(picked[it], other[it].trim().takeIf { o -> o.isNotEmpty() }) }
}

/** The quiet line an answered question leaves in the timeline. */
internal fun askedLine(q: CodeEvent.Question, answer: CodeEvent.QuestionAnswer): String {
    val asked = if (q.questions.size == 1) q.questions[0].question
        else q.questions.joinToString(" · ") { it.header.ifBlank { it.question } }
    return "Asked: $asked${if (answer.skipped) " · skipped" else ""}"
}

@Composable
internal fun QuestionPanel(draft: QuestionDraft, onAnswer: (List<QuestionReply>) -> Unit, onSkip: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    fun next() {
        if (draft.at < draft.count - 1) draft.at++ else onAnswer(draft.replies())
    }
    Column(Modifier.fillMaxWidth().background(scheme.surface).bottomChrome().imePadding().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 4.dp)) {
        Surface(shape = RoundedCornerShape(28.dp), color = scheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.inkBleed("question:${draft.question.id}", Kata.suo, ground = scheme.surfaceContainer).padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 10.dp)) {
                AnimatedContent(
                    targetState = draft.at,
                    transitionSpec = {
                        val forward = targetState > initialState
                        val spatial = motion.defaultSpatialSpec<IntOffset>()
                        (slideInHorizontally(spatial) { w -> (if (forward) w else -w) / 8 } + fadeIn(motion.defaultEffectsSpec()))
                            .togetherWith(slideOutHorizontally(spatial) { w -> (if (forward) -w else w) / 8 } + fadeOut(motion.fastEffectsSpec()))
                            .using(SizeTransform(clip = false) { _, _ -> motion.defaultSpatialSpec() })
                    },
                    label = "question",
                ) { i ->
                    OneQuestion(draft, i, next = ::next, onSkip = onSkip)
                }
                if (draft.problem != null) Box(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) { Problem(draft.problem) }
            }
        }
    }
}

@Composable
private fun OneQuestion(draft: QuestionDraft, i: Int, next: () -> Unit, onSkip: () -> Unit) {
    val q = draft.question.questions[i]
    val scheme = MaterialTheme.colorScheme
    val last = i == draft.count - 1
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        /* Its head: back, the question (and where it is among them), Skip. */
        Row(Modifier.fillMaxWidth().padding(start = 4.dp), verticalAlignment = Alignment.Top) {
            if (i > 0) IconButton(onClick = { draft.at = i - 1 }, modifier = Modifier.size(40.dp).semantics { contentDescription = "Previous question" }) {
                Icon(kimonoIcon("back"), null, modifier = Modifier.size(20.dp))
            } else Box(Modifier.width(8.dp))
            Column(
                Modifier.weight(1f).padding(top = 8.dp, end = 8.dp).semantics(mergeDescendants = true) {
                    heading()
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = if (draft.count > 1) "Question ${i + 1} of ${draft.count}. ${q.question}" else q.question
                },
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (draft.count > 1) Text("${i + 1} of ${draft.count}", style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
                Text(q.question, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = scheme.onSurface)
            }
            Text("Skip", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant,
                modifier = Modifier.clip(RoundedCornerShape(16.dp)).clickable(role = Role.Button, onClick = onSkip).padding(horizontal = 12.dp, vertical = 12.dp))
        }
        Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            q.options.forEachIndexed { n, option ->
                val chosen = option.label in draft.picked[i]
                OptionRow(n + 1, option.label, option.description, chosen, q.multi) {
                    if (q.multi) draft.picked[i] = if (chosen) draft.picked[i] - option.label else draft.picked[i] + option.label
                    else {
                        /* one choice: the option is the answer, and on it goes */
                        draft.picked[i] = listOf(option.label); draft.other[i] = ""; draft.writing[i] = false
                        next()
                    }
                }
            }
            OtherRow(draft, i, q.multi, last, next)
        }
        if (q.multi) Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.End) {
            Seal(if (last) "Send" else "Next", compact = true, enabled = draft.has(i), onClick = next)
        }
    }
}

@Composable
private fun OptionRow(number: Int, label: String, description: String?, chosen: Boolean, multi: Boolean, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val face by animateColorAsState(if (chosen) scheme.secondaryContainer else scheme.surfaceContainerHigh, MaterialTheme.motionScheme.fastEffectsSpec(), label = "option")
    val pick = if (multi) Modifier.toggleable(value = chosen, role = Role.Checkbox, onValueChange = { onClick() })
        else Modifier.selectable(selected = chosen, role = Role.RadioButton, onClick = onClick)
    Surface(shape = RoundedCornerShape(16.dp), color = face, border = if (chosen) BorderStroke(1.5.dp, scheme.primary) else null, modifier = Modifier.fillMaxWidth()) {
        Row(pick.heightIn(min = 56.dp).padding(start = 14.dp, end = 14.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("$number", style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant.copy(alpha = .7f), modifier = Modifier.width(12.dp).clearAndSetSemantics {})
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label, style = MaterialTheme.typography.bodyLarge, color = scheme.onSurface)
                if (description != null) Text(description, style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant)
            }
            if (multi) CheckSquare(chosen)
            else if (chosen) Icon(kimonoIcon("check"), null, tint = scheme.primary, modifier = Modifier.size(20.dp))
        }
    }
}

/** A multiple choice's box: an outline, filled with a check once ticked. */
@Composable
private fun CheckSquare(on: Boolean) {
    val scheme = MaterialTheme.colorScheme
    val fill by animateColorAsState(if (on) scheme.primary else scheme.surfaceContainerHigh.copy(alpha = 0f), MaterialTheme.motionScheme.fastEffectsSpec(), label = "check")
    Surface(shape = RoundedCornerShape(6.dp), color = fill, border = if (on) null else BorderStroke(1.5.dp, scheme.outline), modifier = Modifier.size(22.dp).clearAndSetSemantics {}) {
        if (on) Box(contentAlignment = Alignment.Center) { Icon(kimonoIcon("check"), null, tint = scheme.onPrimary, modifier = Modifier.size(16.dp)) }
    }
}

/** Always last: Other…, which opens into a line to write their own answer on. */
@Composable
private fun OtherRow(draft: QuestionDraft, i: Int, multi: Boolean, last: Boolean, next: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val writing = draft.writing[i]
    val text = draft.other[i]
    Surface(shape = RoundedCornerShape(16.dp), color = scheme.surfaceContainerHigh, border = if (writing) BorderStroke(1.5.dp, scheme.primary) else null, modifier = Modifier.fillMaxWidth()) {
        if (!writing) Row(
            Modifier.clickable(role = Role.Button, onClickLabel = "Write your own answer") { draft.writing[i] = true }.heightIn(min = 56.dp).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(kimonoIcon("edit"), null, tint = scheme.onSurfaceVariant.copy(alpha = .7f), modifier = Modifier.size(14.dp))
            Text(if (text.isNotBlank()) text else "Other…", style = MaterialTheme.typography.bodyLarge, color = if (text.isNotBlank()) scheme.onSurface else scheme.onSurfaceVariant, maxLines = 2, modifier = Modifier.weight(1f))
        } else {
            val focus = remember { FocusRequester() }
            val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
            LaunchedEffect(Unit) { focus.requestFocus(); keyboard?.show() }
            val go = {
                if (draft.has(i)) {
                    /* one choice: what they wrote is the answer instead of an option */
                    if (!multi) draft.picked[i] = emptyList()
                    if (last) keyboard?.hide()
                    next()
                }
            }
            Row(Modifier.heightIn(min = 56.dp).padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BasicTextField(
                    value = text, onValueChange = { draft.other[i] = it.take(2_000) },
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface),
                    cursorBrush = SolidColor(scheme.primary), maxLines = 4,
                    keyboardOptions = KeyboardOptions(imeAction = if (last) ImeAction.Send else ImeAction.Next),
                    keyboardActions = KeyboardActions(onSend = { go() }, onNext = { go() }),
                    modifier = Modifier.weight(1f).focusRequester(focus).semantics { contentDescription = "Other answer" },
                    decorationBox = { inner -> Box { if (text.isEmpty()) Text("Other…", style = MaterialTheme.typography.bodyLarge, color = scheme.onSurfaceVariant); inner() } },
                )
                val ready = text.isNotBlank() || (multi && draft.picked[i].isNotEmpty())
                val face by animateColorAsState(if (ready) scheme.primary else scheme.surfaceContainerHighest, MaterialTheme.motionScheme.fastEffectsSpec(), label = "other-go")
                Surface(onClick = { go() }, enabled = ready, shape = RoundedCornerShape(14.dp), color = face,
                    modifier = Modifier.size(44.dp).semantics { contentDescription = if (last) "Send" else "Next"; role = Role.Button }) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(kimonoIcon(if (last) "send" else "go"), null, tint = if (ready) scheme.onPrimary else scheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
}
