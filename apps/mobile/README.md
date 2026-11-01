# Kimono app

The phone app for everyone on a Kimono: sign in once, then your account
(picture, name and email, password, signed-in devices), with the home screen
and getting other Kimono apps to follow. React Native with Expo and Expo Router,
in the same workspace as the Portal, so it shares `@kimono/account` (the rules
for names and passwords, and the shapes `/api/v1` answers with).

## Run it

```sh
pnpm --filter @kimono/mobile start      # the dev server, for Expo Go or a dev install
pnpm --filter @kimono/mobile web        # the same app in a browser, for checking layouts
```

Expo Go signs in through `exp://…/--/auth`, which only the local identity
provider accepts (`infra/compose/authentik/blueprints/kimono-app.yaml`). A real
install signs in through `kimono://auth`, the only address the server accepts.

## Build the Android app

```sh
pnpm --filter @kimono/mobile apk
```

This builds a release APK on this machine (no cloud build service) into
`dist/kimono-<version>.apk`, signed with the Kimono key in
`~/.config/kimono/android-release.jks`. Every APK has to carry that same key,
or Android won't install it over the copy already on a phone, so back the key
and its password file up somewhere safe. It needs JDK 21 and the Android SDK;
`scripts/build-apk.sh` says where it looks for them.

Icons are drawn from Kimono's branch mark by `pnpm --filter @kimono/mobile icons`.

## How signing in works

1. The person types their Kimono's address. The app asks the Portal's
   `/api/v1/sign-in` where to sign in.
2. Kimono's sign-in page opens in a private browser sheet, as the `kimono-app`
   public client with PKCE (`infra/compose/server/authentik/blueprints/kimono-app.yaml`).
3. The app keeps only the refresh token, in the Keychain or Keystore, and sends
   ten-minute access tokens to `/api/v1` as `Authorization: Bearer`.
4. The Portal checks each token's signature, issuer, audience and expiry, and
   refuses it if the account is switched off or was signed out everywhere after
   that sign-in. Signing out on the phone revokes the refresh token.

## Theme

`src/theme/tokens.ts` is generated from Kata's `tokens.css`. After changing the
tokens, run `pnpm --filter @kimono/mobile theme`.
