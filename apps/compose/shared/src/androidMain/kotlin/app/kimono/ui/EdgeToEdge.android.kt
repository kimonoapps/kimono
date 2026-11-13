package app.kimono.ui

import androidx.compose.ui.window.DialogProperties

actual fun edgeToEdgeDialog(): DialogProperties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
