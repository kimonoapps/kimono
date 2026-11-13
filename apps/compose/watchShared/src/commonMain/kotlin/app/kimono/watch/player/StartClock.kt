package app.kimono.watch.player

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import app.kimono.watch.LocalWatch
import app.kimono.watch.nowMs
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlin.math.exp

/**
 * The start ring's progress, by time. Starting has three steps: finding a
 * copy (the server), opening it (the source's first bytes: most of the wait),
 * and buffering. Nothing reports progress inside the middle one, so the ring
 * shares itself out by how long each step really took on this device lately
 * (the median of the last plays, kept on the device) and moves through each
 * step at that pace: steadily to most of its share by the time it usually
 * ends, then creeping, and on only when the step is really done. Buffering
 * also follows the buffer itself.
 */
object StartClock {
    /** Typical milliseconds per step before this device has played anything. */
    private val defaults = longArrayOf(2500, 9000, 3000)
    private const val KEPT = "watch.startTimes"
    private val json = Json { ignoreUnknownKeys = true }

    /** Each step's share of the ring, by how long it usually takes; none under 10%. */
    fun shares(expected: LongArray): FloatArray {
        val raw = expected.map { it.coerceAtLeast(1).toFloat() }
        val total = raw.sum()
        val floored = raw.map { maxOf(it / total, .1f) }
        val sum = floored.sum()
        return FloatArray(3) { floored[it] / sum }
    }

    /** How far through a step it looks after [elapsed] of an expected [expected]: 85% by then, then creeping to 95%. */
    fun within(elapsed: Long, expected: Long): Float {
        val x = elapsed.toFloat() / expected.coerceAtLeast(1)
        return if (x <= 1f) .85f * x else .85f + .1f * (1f - exp(-(x - 1f) * 1.5f))
    }

    /** The ring at [step] (0–2), [elapsed] into it; [fill] is the buffer's own 0–1 in the last step. */
    fun value(step: Int, elapsed: Long, fill: Float, expected: LongArray): Float {
        val s = shares(expected)
        var done = 0f
        for (i in 0 until step.coerceIn(0, 3)) done += s[i]
        if (step >= 3) return 1f
        val inside = maxOf(within(elapsed, expected[step]), if (step == 2) fill.coerceIn(0f, 1f) else 0f)
        return (done + s[step] * inside).coerceIn(0f, .99f)
    }

    fun median(list: List<Long>): Long = list.sorted().let { if (it.isEmpty()) 0 else it[it.size / 2] }

    suspend fun load(read: suspend (String) -> String?): Array<List<Long>> =
        runCatching { json.decodeFromString<List<List<Long>>>(read(KEPT)!!) }.getOrNull()?.takeIf { it.size == 3 }?.map { it.takeLast(7) }?.toTypedArray()
            ?: arrayOf(emptyList(), emptyList(), emptyList())

    fun expected(history: Array<List<Long>>) = LongArray(3) { i -> history[i].takeIf { it.isNotEmpty() }?.let(::median) ?: defaults[i] }

    suspend fun save(history: Array<List<Long>>, keep: suspend (String, String?) -> Unit) {
        keep(KEPT, json.encodeToString(history.map { it.takeLast(7) }))
    }
}

/**
 * The ring for one start ([loads] counts starts): [step] is where it is (0 find, 1 open, 2 buffer, 3 done),
 * [fill] the buffer's own 0–1. Each step's real length is noted as it ends, for next time.
 */
@Composable
fun rememberStartRing(loads: Int, step: Int, fill: Float): () -> Float {
    val keeper = LocalWatch.current.accounts.keeper
    val scope = rememberCoroutineScope()
    var history by remember { mutableStateOf<Array<List<Long>>?>(null) }
    LaunchedEffect(Unit) { history = StartClock.load(keeper::read) }
    val stepAt = remember(loads) { longArrayOf(nowMs(), -1) } // [since, which step]
    var value by remember(loads) { mutableFloatStateOf(0f) }
    val buffer by androidx.compose.runtime.rememberUpdatedState(fill)
    LaunchedEffect(loads, step) {
        val h = history
        if (stepAt[1] >= 0 && step > stepAt[1] && h != null) {
            /* The step just ended: kept for next time (a step that took under 50 ms was already done, not measured). */
            val took = nowMs() - stepAt[0]
            val i = stepAt[1].toInt()
            if (i in 0..2 && took > 50) {
                val next = h.copyOf().also { it[i] = (it[i] + took).takeLast(7) }
                history = next
                scope.launch { runCatching { StartClock.save(next, keeper::keep) } }
            }
        }
        stepAt[0] = nowMs(); stepAt[1] = step.toLong()
        while (step < 3) {
            value = maxOf(value, StartClock.value(step, nowMs() - stepAt[0], buffer, StartClock.expected(history ?: arrayOf(emptyList(), emptyList(), emptyList()))))
            delay(100)
        }
        value = 1f
    }
    return { value }
}
