# Kimono app — Compose proof

The Kimono phone app in Compose Multiplatform with Material 3 Expressive,
themed with Kata, built to compare against the React Native app in
`apps/mobile`. Android and iPhone share everything in `shared/src/commonMain`.

- `shared/` — the app: Kata as a `MaterialExpressiveTheme`, the seal, sign-in
  (PKCE, `max_age`), the You tab, name and email, devices, the share sheet.
- `androidApp/` — the Android shell: Keystore-encrypted storage, the sign-in
  browser sheet, the photo picker, and Kimono in Android's share sheet.
- `iosApp/` — the iPhone shell in Swift (Keychain, sign-in sheet, photo
  picker) and `KimonoFiles`, the File Provider extension that puts Kimono
  Drive in the Files app beside iCloud Drive (see `docs/drive-files-app.md`).
  The app and the extension share one sign-in through the Keychain.

```sh
./gradlew :androidApp:assembleRelease                      # HTTPS only
./gradlew :androidApp:assembleRelease -PkimonoLocalTest    # can reach a Portal on this machine
```

The APK lands in `androidApp/build/outputs/apk/release/`, signed with the
Kimono key in `~/.config/kimono/` (see `apps/mobile/README.md`). It installs
beside the React Native app (`app.kimono.compose`); with both installed,
Android asks which one should finish a sign-in.

Needs JDK 21 and the Android SDK with platform 37 (`sdk.dir` in
`local.properties`).

## iPhone

Needs Xcode and XcodeGen (`brew install xcodegen`). The Xcode project is
generated, not committed:

```sh
cd iosApp && xcodegen
open Kimono.xcodeproj    # or: xcodebuild -scheme Kimono -sdk iphonesimulator build
```

Building runs Gradle to make the shared framework (JDK 21). Simulator builds
are Apple silicon only. Installing on an iPhone, and TestFlight, need the
Apple developer team set as `DEVELOPMENT_TEAM` in `project.yml`, with the
App Group `group.app.kimono` and Keychain sharing enabled for both app ids.
