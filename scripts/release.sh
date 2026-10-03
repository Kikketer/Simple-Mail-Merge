#!/usr/bin/env bash
# Signed + notarized release build for macOS.
#
# Usage:
#   ./scripts/release.sh            # build, sign, notarize, verify
#   ./scripts/release.sh v0.1.0     # same, then create a GitHub release with the DMG
#
# Credentials are read from release.env (see release.env.example).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f release.env ]]; then
	echo "error: release.env not found. Copy release.env.example and fill it in." >&2
	exit 1
fi

# Export every variable defined in release.env into this shell and child processes.
set -a
source release.env
set +a

for var in ELECTROBUN_DEVELOPER_ID ELECTROBUN_TEAMID \
	ELECTROBUN_APPLEAPIISSUER ELECTROBUN_APPLEAPIKEY ELECTROBUN_APPLEAPIKEYPATH; do
	if [[ -z "${!var:-}" ]]; then
		echo "error: $var is not set in release.env" >&2
		exit 1
	fi
	export "$var"
done

if [[ ! -f "$ELECTROBUN_APPLEAPIKEYPATH" ]]; then
	echo "error: API key file not found: $ELECTROBUN_APPLEAPIKEYPATH" >&2
	exit 1
fi

echo "==> Building (codesign + notarize)"
bun run build

APP=$(find build/stable-macos-arm64 -maxdepth 1 -name "*.app" | head -1)
DMG=$(find artifacts -maxdepth 1 -name "*.dmg" | head -1)

if [[ -z "$APP" || -z "$DMG" ]]; then
	echo "error: expected .app and .dmg artifacts not found" >&2
	exit 1
fi

echo "==> Verifying signature: $APP"
codesign --verify --deep --strict "$APP"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "Identifier|Authority" | head -4

echo "==> Verifying notarization (Gatekeeper): $DMG"
spctl -a -vv "$DMG"
stapler validate "$DMG" || true

TAG="${1:-}"
if [[ -n "$TAG" ]]; then
	if ! command -v gh >/dev/null; then
		echo "error: gh CLI required to publish a release" >&2
		exit 1
	fi
	echo "==> Creating GitHub release $TAG with $DMG"
	gh release create "$TAG" "$DMG" \
		--title "BulkMailer $TAG" \
		--generate-notes
fi

echo "==> Done: $DMG"
