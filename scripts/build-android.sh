#!/usr/bin/env bash
# Builds an installable release APK:   ./scripts/build-android.sh
#
# Needs: Node, an Android SDK (ANDROID_HOME) with platform 37, build-tools 37.0.0,
#        NDK 27.1.12297006 and CMake 3.22.1, and a JDK 17 (React Native's Gradle plugin requires 17).
# Env:   ARCHS=arm64-v8a (default; e.g. "arm64-v8a,x86_64" to also run on emulators)
#        JAVA17_HOME=/path/to/jdk17 (auto-detected on most systems)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK directory}"
ARCHS="${ARCHS:-arm64-v8a}"

find_jdk17() {
  if [ -n "${JAVA17_HOME:-}" ]; then echo "$JAVA17_HOME"; return; fi
  if [ -n "${JAVA_HOME:-}" ] && "$JAVA_HOME/bin/java" -version 2>&1 | grep -q 'version "17'; then echo "$JAVA_HOME"; return; fi
  if command -v /usr/libexec/java_home >/dev/null 2>&1; then /usr/libexec/java_home -v 17 2>/dev/null && return; fi
  for d in /usr/lib/jvm/java-17-openjdk-* /usr/lib/jvm/temurin-17* /opt/homebrew/opt/openjdk@17; do
    [ -x "$d/bin/java" ] && { echo "$d"; return; }
  done
  return 1
}
JDK17="$(find_jdk17)" || { echo "JDK 17 not found. Install it or set JAVA17_HOME." >&2; exit 1; }
export JAVA_HOME="$JDK17" PATH="$JDK17/bin:$PATH" ANDROID_SDK_ROOT="$ANDROID_HOME"
echo "Using JDK: $JDK17"

npx expo prebuild --platform android --no-install

cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties

# Set (or replace) a key in gradle.properties. Always puts it on its own line, even if the file
# does not end with a newline (appending blindly can merge two settings into one line).
setprop() {
  local key="$1" value="$2" file=gradle.properties
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "$file.bak"
  else
    [ -n "$(tail -c1 "$file")" ] && printf '\n' >> "$file"
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
setprop reactNativeArchitectures "$ARCHS"
setprop org.gradle.jvmargs "-Xmx5120m -XX:MaxMetaspaceSize=1024m"
setprop org.gradle.java.installations.paths "$JDK17"
setprop org.gradle.java.installations.auto-download false

NODE_ENV=production ./gradlew assembleRelease --console=plain

cd ..
mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk dist/remo-code-release.apk
echo
echo "APK: $(pwd)/dist/remo-code-release.apk  ($(du -h dist/remo-code-release.apk | cut -f1))"
