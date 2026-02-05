# Releasing Claudia

This guide covers how to create a new release of Claudia with the auto-update system.

## Prerequisites

### GitHub Secrets Required

**Update signing (minisign):**
- `TAURI_SIGNING_PRIVATE_KEY` - The minisign private key (base64-encoded)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Password for the key (required if key is password-protected)

**Apple code signing & notarization:**
- `APPLE_CERTIFICATE` - Developer ID Application certificate (.p12, base64-encoded)
- `APPLE_CERTIFICATE_PASSWORD` - Password for the .p12 certificate
- `APPLE_ID` - Apple ID email used for notarization
- `APPLE_PASSWORD` - App-specific password (generate at appleid.apple.com)
- `APPLE_TEAM_ID` - 10-character Team ID from Apple Developer account

## Signing Keys

Signing keys are stored in `~/.tauri/claudia-release.key` (private) and `~/.tauri/claudia-release.key.pub` (public).

### Generating New Keys

If you need to regenerate signing keys:

```bash
# With password (recommended for security)
npx tauri signer generate -w ~/.tauri/claudia-release.key

# Without password (simpler for CI, key is still secret)
npx tauri signer generate --ci -w ~/.tauri/claudia-release.key
```

After generating:
1. Update `TAURI_SIGNING_PRIVATE_KEY` secret in GitHub with the private key content
2. If password-protected, update `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret
3. Update `pubkey` in `src-tauri/tauri.conf.json` with the public key content

**Important:** If using a password-protected key, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` MUST be set. If using `--ci` (unencrypted), do NOT set the password variable.

## Apple Code Signing Setup

The release workflow automatically signs and notarizes the app for distribution.

### Creating a Developer ID Application Certificate

1. **Generate CSR**: Keychain Access → Certificate Assistant → Request Certificate From CA
2. **Create certificate**: https://developer.apple.com/account/resources/certificates/list → Developer ID Application
3. **Install**: Double-click the downloaded `.cer` file

### Exporting for GitHub Actions

1. Open Keychain Access, find "Developer ID Application: [Your Name]"
2. Right-click → Export → Save as `.p12` with a password
3. Base64 encode: `base64 -i certificate.p12 | pbcopy`
4. Add to GitHub secrets as `APPLE_CERTIFICATE`

### Creating an App-Specific Password

1. Go to https://appleid.apple.com/account/manage
2. Sign in → App-Specific Passwords → Generate
3. Name it "Claudia Notarization"
4. Add to GitHub secrets as `APPLE_PASSWORD`

### Finding Your Team ID

1. Go to https://developer.apple.com/account
2. Look under Membership Details → Team ID (10 characters)
3. Add to GitHub secrets as `APPLE_TEAM_ID`

## Release Process

### 1. Determine Version Number

Use semantic versioning (MAJOR.MINOR.PATCH):
- **PATCH** (0.1.0 → 0.1.1): Bug fixes, minor improvements
- **MINOR** (0.1.0 → 0.2.0): New features, non-breaking changes
- **MAJOR** (0.1.0 → 1.0.0): Breaking changes, major milestones

### 2. Bump Version

Run the version bump script from the project root:

```bash
./scripts/bump-version.sh <version>
```

Example:
```bash
./scripts/bump-version.sh 0.2.0
```

This updates:
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

### 3. Commit and Push

```bash
git add -A
git commit -m "Bump version to <version>"
git push origin main
```

### 4. Create and Push Tag

```bash
git tag v<version>
git push origin v<version>
```

### 5. Trigger the Release Build

The workflow should trigger automatically on tag push. If it doesn't, trigger manually:

```bash
gh workflow run release.yml -f tag=v<version> --ref main
```

### 6. Monitor the Release

The GitHub Actions workflow:
1. Builds universal macOS binary (arm64 + x86_64)
2. Signs the app with Developer ID Application certificate
3. Notarizes the DMG with Apple (takes 1-5 minutes)
4. Staples the notarization ticket to the DMG
5. Signs update artifacts with minisign
6. Generates `latest.json` manifest
7. Creates GitHub Release with all artifacts

Monitor progress at: https://github.com/JasonBates/claudia/actions

### 7. Verify the Release

1. Check the release page: https://github.com/JasonBates/claudia/releases
2. Download and test the DMG on a fresh machine
3. Test the auto-updater by running an older version

## Quick Reference

```bash
# Full release flow (example for v0.2.0)
./scripts/bump-version.sh 0.2.0
git add -A
git commit -m "Bump version to 0.2.0"
git push origin main
git tag v0.2.0
git push origin v0.2.0

# If workflow doesn't trigger automatically:
gh workflow run release.yml -f tag=v0.2.0 --ref main
```

## Troubleshooting

### Build fails with "incorrect updater private key password"

- If using password-protected key: Ensure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set correctly
- If using `--ci` generated key: Ensure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is NOT set (remove it from workflow)

### Build fails with signing error

- Verify `TAURI_SIGNING_PRIVATE_KEY` contains the full key content (base64-encoded)
- Ensure public key in `tauri.conf.json` matches the private key

### Update check fails with "not allowed by ACL"

The updater plugin needs permissions in `src-tauri/capabilities/default.json`:
```json
"updater:default",
"process:allow-restart"
```

### Update not detected by app

- Check `latest.json` was uploaded to the release
- Verify the version in `latest.json` is newer than the installed version
- Check the endpoint URL matches: `https://github.com/JasonBates/claudia/releases/latest/download/latest.json`

### Tag push doesn't trigger workflow

Use manual trigger:
```bash
gh workflow run release.yml -f tag=v<version> --ref main
```

### DMG won't open on user's machine

With proper signing and notarization, the app should open without warnings. If users still see Gatekeeper warnings:

1. Check notarization succeeded in the workflow logs
2. Verify the DMG was stapled: `stapler validate /path/to/Claudia.dmg`
3. Check the signature: `codesign -dv --verbose=4 /path/to/Claudia.app`

### Notarization fails

Common causes:
- **Invalid credentials**: Verify `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` secrets
- **App-specific password expired**: Generate a new one at appleid.apple.com
- **Certificate issues**: Ensure the Developer ID Application certificate is valid and not expired
- **Hardened runtime**: The entitlements.plist must include required permissions

Check notarization history:
```bash
xcrun notarytool history --apple-id "your@email.com" --password "app-specific-password" --team-id "TEAMID"
```

### Code signing fails in CI

- Verify `APPLE_CERTIFICATE` is properly base64-encoded
- Ensure `APPLE_CERTIFICATE_PASSWORD` matches the .p12 export password
- Check the certificate hasn't expired: `security find-identity -v -p codesigning`
