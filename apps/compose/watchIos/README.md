# Kimono Watch for iPhone

Its own app (`app.kimono.watch`, "Kimono Watch"), apart from the main Kimono
app, which gains nothing from the player. The screens, view models and API
client are `watchShared` (Compose Multiplatform); this folder is the Swift
side behind its seams:

- `MPVPlayer.swift`: `PlaybackEngine` on libmpv (MPVKit, LGPL build). MKV,
  HEVC, 10-bit, HDR (EDR where the screen has headroom) and styled ASS
  subtitles play as they are. AirPlay and picture in picture hand over to
  the Portal's HLS rendition (`play` with `cast: "airplay"`) through AVPlayer
  from the same moment, and back to mpv after. Now Playing and the lock
  screen; nothing plays with the app away except those two.
- `Downloader.swift`: downloads with a background URLSession.
- `Host.swift`: the Keychain, what the device plays, the landscape player.

## Build

```sh
./MPVKit/fetch.sh   # the LGPL xcframeworks, checksummed (about 1 GB, kept out of git)
xcodegen
xcodebuild -project KimonoWatch.xcodeproj -scheme KimonoWatch -sdk iphonesimulator build
```

Building runs Gradle for the shared framework (JDK 21). Simulator builds are
Apple silicon only. The simulator has no picture in picture: there the button
only switches to the HLS rendition.

Signed archive (no upload): import `~/.config/kimono/ios-signing.p12` into a
keychain, then archive with `DEVELOPMENT_TEAM=DF8FQFRCS5`, automatic signing
and the App Store Connect key, as the release workflow does for Kimono, and
export with `destination: export`.
