#!/bin/sh
# Builds the Kimono app as a release APK for arm64 Android phones, signed with
# the Kimono key, into apps/mobile/dist/. Every APK must carry the same key, or
# Android refuses to install it over the one already on the phone.
#
#   pnpm --filter @kimono/mobile apk
#
# Needs JDK 17 and the Android SDK (platform 36). The key lives outside the
# repo, in ~/.config/kimono/; back it up. KIMONO_ANDROID_KEY overrides where.
set -eu
cd "$(dirname "$0")/.."

key=${KIMONO_ANDROID_KEY:-$HOME/.config/kimono/android-release.jks}
[ -f "$key" ] || { echo "No signing key at $key" >&2; exit 1; }
[ -f "${key%.jks}.password" ] || { echo "No password file beside $key" >&2; exit 1; }
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Library/Android/sdk}
export PATH="$JAVA_HOME/bin:$PATH"
build_tools=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)

CI=1 npx expo prebuild -p android --clean --no-install
(cd android && NODE_ENV=production ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)

version=$(node -p 'require("./app.json").expo.version')
mkdir -p dist
# A local test build (plain http allowed) is named so it can't be mistaken for one to share.
out="dist/kimono-$version${KIMONO_LOCAL_TEST:+-local-test}.apk"
"$build_tools/apksigner" sign --ks "$key" --ks-key-alias kimono --ks-pass "file:${key%.jks}.password" --out "$out" android/app/build/outputs/apk/release/app-release.apk
"$build_tools/apksigner" verify --print-certs "$out" | head -3
echo "Built $out"
