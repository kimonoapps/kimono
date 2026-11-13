package app.kimono.ui

import androidx.compose.ui.window.DialogProperties

/** A dialog that covers the whole screen, under the status bar and home indicator: its content keeps clear of them itself. */
expect fun edgeToEdgeDialog(): DialogProperties
