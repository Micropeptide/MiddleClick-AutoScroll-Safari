#!/bin/bash
set -euo pipefail

VERSION="1.2.0"
APP_NAME="Middle-Click AutoScroll"
DMG_NAME="MiddleClickAutoScroll-${VERSION}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DERIVED_APP="/Users/runtianwu/Library/Developer/Xcode/DerivedData/Middle-Click_AutoScroll-afdpswogxxhrmjcuujznzqwbsfgx/Build/Products/Release/${APP_NAME}.app"
OUT_DIR="${ROOT}/dist"
STAGING="${OUT_DIR}/staging"

if [ ! -d "$DERIVED_APP" ]; then
  echo "Release build not found at: $DERIVED_APP" >&2
  echo "Run: xcodebuild -scheme \"${APP_NAME}\" -configuration Release build" >&2
  exit 1
fi

rm -rf "$STAGING" "${OUT_DIR}/${DMG_NAME}.dmg" "${OUT_DIR}/rw.dmg"
mkdir -p "$STAGING"

cp -R "$DERIVED_APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

# Build a read-write DMG first so we can arrange the Finder window/icons,
# then convert to a compressed read-only DMG for distribution.
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGING" -ov -format UDRW "${OUT_DIR}/rw.dmg"

MOUNT_DIR="/Volumes/$APP_NAME"
hdiutil attach "${OUT_DIR}/rw.dmg" -mountpoint "$MOUNT_DIR"

osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$APP_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 720, 460}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set position of item "${APP_NAME}.app" of container window to {130, 180}
    set position of item "Applications" of container window to {390, 180}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
APPLESCRIPT

sync
hdiutil detach "$MOUNT_DIR"
hdiutil convert "${OUT_DIR}/rw.dmg" -format UDZO -o "${OUT_DIR}/${DMG_NAME}.dmg"
rm -f "${OUT_DIR}/rw.dmg"
rm -rf "$STAGING"

# Ad-hoc sign the DMG itself too (the .app inside is already signed by Xcode).
codesign --force --sign - "${OUT_DIR}/${DMG_NAME}.dmg" || true

echo "Built: ${OUT_DIR}/${DMG_NAME}.dmg"
