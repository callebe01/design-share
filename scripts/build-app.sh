#!/bin/bash
# Builds the DesignShare menu bar app into dist/DesignShare.app.
# Signs with a Developer ID Application certificate when one is in the
# keychain, otherwise falls back to any available identity, then ad hoc.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=dist/DesignShare.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

echo "compiling app/main.swift…"
swiftc -swift-version 5 -O app/main.swift -o "$APP/Contents/MacOS/DesignShare"
cp app/Info.plist "$APP/Contents/Info.plist"

IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"' || true)
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Apple Development[^"]*"' | head -1 | tr -d '"' || true)
fi

if [ -n "$IDENTITY" ]; then
  echo "signing with: $IDENTITY"
  codesign --force --options runtime --sign "$IDENTITY" "$APP"
else
  echo "no signing identity found, using ad hoc signature"
  codesign --force --sign - "$APP"
fi

codesign --verify --deep "$APP" && echo "build ok: $APP"

# To notarize for distribution (requires a Developer ID Application identity
# and a notarytool keychain profile you create once with:
#   xcrun notarytool store-credentials design-share --apple-id <you> --team-id <team>):
#   ditto -c -k --keepParent "$APP" dist/DesignShare.zip
#   xcrun notarytool submit dist/DesignShare.zip --keychain-profile design-share --wait
#   xcrun stapler staple "$APP"
