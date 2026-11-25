#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
test -n "$sdk_root"
build_tools="$sdk_root/build-tools/35.0.0"
android_jar="$sdk_root/platforms/android-35/android.jar"
test -f "$android_jar"
variant="${NOBTEEK_APK_VARIANT:-p06}"
case "$variant" in
  p06)
    manifest="$project_root/android-preview/AndroidManifest.xml"
    activity="$project_root/android-preview/src/com/nobteek/preview/MainActivity.java"
    name=Nobteek_P06_Interface_Test
    ;;
  dhamar)
    manifest="$project_root/android-preview/dhamar/AndroidManifest.xml"
    activity="$project_root/android-preview/dhamar/MainActivity.java"
    name=Nobteek_Dhamar_Test
    ;;
  *) echo "Unknown Android build variant: $variant" >&2; exit 1 ;;
esac
phone_build="$(mktemp -d "${RUNNER_TEMP:-/tmp}/nobteek-phone-$variant.XXXXXXXX")"
trap 'rm -rf "$phone_build"' EXIT
mkdir -p "$phone_build/res/drawable" "$phone_build/classes" "$phone_build/dex" "$phone_build/assets/web" "$project_root/dist-phone"
cp "$project_root/design/assets/icon-512.png" "$phone_build/res/drawable/icon.png"
if [[ "$variant" == p06 ]]; then
    cp -R "$project_root/dist-phone/web/." "$phone_build/assets/web/"
fi
"$build_tools/aapt2" compile --dir "$phone_build/res" -o "$phone_build/resources.zip"
"$build_tools/aapt2" link -o "$phone_build/unsigned.apk" --manifest "$manifest" -I "$android_jar" -A "$phone_build/assets" "$phone_build/resources.zip"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -classpath "$android_jar" -d "$phone_build/classes" "$activity"
jar cf "$phone_build/classes.jar" -C "$phone_build/classes" .
"$build_tools/d8" --lib "$android_jar" --min-api 26 --output "$phone_build/dex" "$phone_build/classes.jar"
python3 - "$phone_build" <<'PY'
from pathlib import Path
import sys, zipfile
p=Path(sys.argv[1])
with zipfile.ZipFile(p/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as z:
    for f in (p/'dex').glob('*.dex'): z.write(f,f.name)
PY
"$build_tools/zipalign" -f 4 "$phone_build/unsigned.apk" "$phone_build/aligned.apk"
export NOBTEEK_APK_KEYSTORE_PASSWORD
NOBTEEK_APK_KEYSTORE_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
keytool -genkeypair -noprompt -alias preview -keyalg RSA -keysize 2048 -validity 3650 -keystore "$phone_build/preview.p12" -storetype PKCS12 -storepass:env NOBTEEK_APK_KEYSTORE_PASSWORD -keypass:env NOBTEEK_APK_KEYSTORE_PASSWORD -dname "CN=Nobteek Android QA,O=Nobteek Test,C=YE"
apk="$project_root/dist-phone/$name.apk"
"$build_tools/apksigner" sign --ks "$phone_build/preview.p12" --ks-key-alias preview --ks-pass env:NOBTEEK_APK_KEYSTORE_PASSWORD --key-pass env:NOBTEEK_APK_KEYSTORE_PASSWORD --out "$apk" "$phone_build/aligned.apk"
"$build_tools/apksigner" verify --verbose --print-certs "$apk" > "$project_root/dist-phone/APK_SIGNATURE.txt"
"$build_tools/aapt" dump badging "$apk" > "$project_root/dist-phone/APK_MANIFEST.txt"
sha256sum "$apk" > "$project_root/dist-phone/APK_SHA256.txt"
rm -f "$phone_build/preview.p12"
echo "Signed Android QA package built and signature verified."
