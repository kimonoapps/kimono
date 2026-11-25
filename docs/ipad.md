# Kimono on iPad

Kimono for iPhone ran on iPad in compatibility mode: a fixed iPhone-sized window in the middle
of the screen. This note covers what made it do that, what makes it a native universal app,
and how the shared Compose UI adapts to an iPad's width. A local xtool build from Linux (kept out of
the repo) links the `Shared.xcframework` that `.github/workflows/ios-xcframework.yml` builds.

## 1. Build and configuration

**What pinned it to iPhone.** In `apps/compose/iosApp/project.yml`, both the app and the
Files extension set `TARGETED_DEVICE_FAMILY: "1"`. XcodeGen turns that into
`UIDeviceFamily = [1]`, and iPadOS letterboxes any app without `2`. The `Info.plist` files are
generated and gitignored (`iosApp/*/Info.plist`), so `project.yml` is the only place to change.

| Where | Before | After |
| --- | --- | --- |
| `project.yml` › Kimono | `TARGETED_DEVICE_FAMILY: "1"` | `"1,2"` |
| `project.yml` › KimonoFiles | `TARGETED_DEVICE_FAMILY: "1"` | `"1,2"` (an extension must cover its app's devices) |
| `project.yml` › Kimono `info` | portrait only | adds `UISupportedInterfaceOrientations~ipad` with all four |
| `project.yml` › Kimono `info` | no camera string | adds `NSCameraUsageDescription` (see below) |

iPhone keeps `UISupportedInterfaceOrientations: [Portrait]`. `UIRequiresFullScreen` stays
unset, which keeps Split View, Slide Over and Stage Manager available. iPadOS only allows
those with all four iPad orientations and a launch screen, and `UILaunchScreen` is already set.

**Repository facts the request assumed differently:**

- There was no `xtool.yml` or `Package.swift` for this app. iOS builds came from XcodeGen. The
  only `Package.swift` was `watchIos/MPVKit`, a local package for Kimono Watch. An xtool
  package that compiles the same Swift files can live in `iosApp/xtool/`, which is git-ignored.
- `Info.plist` isn't committed. It's generated from `project.yml`.
- There is no `GoogleService-Info.plist`, because nothing uses Firebase. `.env` belongs to
  the web Portal (`pnpm local:dev`) and isn't needed for the app. `local.properties` is
  needed only on the Mac that builds the Kotlin framework, because Gradle configures the
  Android target too (`sdk.dir`, or `ANDROID_HOME`).
- **Kotlin/Native links iOS binaries only on a macOS host.** `Shared.framework` can't be
  built on Linux. `shared/build.gradle.kts` now also packs it as `Shared.xcframework`. The
  new manual workflow `.github/workflows/ios-xcframework.yml` builds it on a macOS runner,
  and xtool on Linux links the result.

**Icons.** The asset catalog holds one 1024px "universal" icon, which covers iPad in Xcode
builds. xtool can't compile asset catalogs, so it uses that PNG through `iconPath`.

**Pre-existing crashes that iPad exposes:**

- `Host.share` presented `UIActivityViewController` with no popover anchor. iPhone ignores
  that, but on iPad UIKit raises an exception the first time anyone taps Share. It now
  anchors to the centre of the Compose view with no arrow.
- *Take photo* opens the camera, but the app had no `NSCameraUsageDescription`, so iOS ends
  the app as soon as the camera opens, on iPhone as well. Both builds now include it.

## 2. Responsive layout

The audit found little hardcoding. Most screens already fill their width, dialogs cap at
420dp, sheets take Material's 640dp maximum, and the Books grids use `GridCells.Adaptive`.
The problems are layouts sized as *fractions of the width*, which grow without limit on a
tablet:

| Where | On a landscape 11" iPad | Fix |
| --- | --- | --- |
| `WidgetBoard` (profile board) | 2-wide grid, `cell = width / 2`: each small widget about 580dp wide | Column count from the width (`176dp` minimum cell, 2 to 6 columns) |
| `Launcher` (My apps) | `GridCells.Fixed(2)`: two tiles about 575dp wide | `AdaptiveAtLeast(168.dp)`: still 2 on any phone, 4 to 6 on iPad. Header spans use `maxLineSpan` |
| Music › Listen again | 3×3 square tiles across the page: one page over 1,000dp tall | Page capped at 420dp (`PageSize.Fixed`), so neighbouring pages show beside it. Identical on phones |
| Kimono AI chat | lines of text a whole tablet wide | Transcript centred at 760dp through content padding (scrolls from either edge); composer aligned under it |
| Home, Drive spaces, folders | rows stretched edge to edge | Centred at 840dp through `WithGutter` |
| Settings and grouped lists (`KimonoGroup`, `GroupLabel`) | segmented rows a tablet wide | Centred at 640dp, labels aligned over them |

All of it lives in `shared/.../ui/Adaptive.kt`, with no new dependency:

- `WidthClass` / `widthClassOf(dp)`: Material's breakpoints (600 and 840dp).
- `ProvideWindowWidth` / `LocalWindowWidth`: measured at the root, so rotation, Split View
  and Stage Manager resizes reach every screen.
- `Modifier.readable(max)`: fill up to `max`, then centre.
- `WithGutter(max, least)` / `gutter(...)`: content padding for lazy lists.
- `AdaptiveAtLeast(min, least = 2)`: grid columns that never drop below two.

Decisions use the space a composable actually gets, not the device type. A narrow Split View
window on an iPad behaves like a phone, and a wide Android tablet benefits as well.

## 3. Tablet navigation

- **Rail instead of bottom bar** at Medium width and up (600dp or more, which includes every
  iPad held either way at full screen). `RoomRail` in `Rooms.kt` shows the same rooms as
  `RoomBar`: the app's bloom (every app) at the top, its rooms, then You at the foot. The
  music bar stays at the bottom.
- **Notes as list and note side by side** when the space beside the rail reaches 840dp (an
  11" iPad on its side, or a 13" either way). `NotesWithNote` in `App.kt` puts the list on the
  left at about 36% (320 to 420dp) and the editor on the right. When the window narrows with a
  note open, that note moves to its own screen. The existing `note/{id}` route is unchanged
  for links from Drive or elsewhere.
- **Kimono AI's chats as a sidebar** from 840dp. `AiDrawer` becomes a
  `DismissibleNavigationDrawer` that starts open and stays open while you move between chats.
  The menu button hides or shows it, and the choice carries across chats.
- **Insets.** The app already draws edge to edge (`ComposeView().ignoresSafeArea()`) and
  each screen takes its own insets. `NavigationRail` takes the status bar and the leading
  edge, and sheets and dialogs cap their width, so nothing new is needed for the iPad's
  rounded corners or the Stage Manager title bar.

## Not done yet

- **Kimono Watch** (`watchIos/project.yml`) is still `TARGETED_DEVICE_FAMILY: "1"`. The same
  two-line change applies, but its player and browse screens haven't been audited for iPad.
- **More two-pane screens**: Drive folder › file details, and Books › book sheet.
- **Pointer and keyboard**: Compose handles both. `NoteEditor` already takes hardware
  shortcuts. Hover states and a ⌘K for the AI composer would round it out.
- **The rail only shows on room screens**, as the bottom bar did. A rail that stays on screen
  with subscreens could keep the last room selected.

## Checking it on an iPad

Hold the iPad both ways at full screen, then use Split View at ⅓, ½ and ⅔, and Stage
Manager at a few window sizes. At ⅓ width the bottom bar should come back and Notes should be
a single list. Tap Share in Kimono AI and Drive, and Take photo in a chat. Both crashed before
this change.
