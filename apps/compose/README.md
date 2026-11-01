# Kimono app — Compose proof

The Kimono phone app in Compose Multiplatform with Material 3 Expressive,
themed with Kata, built to compare against the React Native app in
`apps/mobile`. Android today; the iPhone target joins once Xcode is installed
(all shared code is already in `shared/src/commonMain`).

- `shared/` — the app: Kata as a `MaterialExpressiveTheme`, the seal, sign-in
  (PKCE, `max_age`), the You tab, name and email, devices, the share sheet.
- `androidApp/` — the Android shell: Keystore-encrypted storage, the sign-in
  browser sheet, the photo picker, and Kimono in Android's share sheet.

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
