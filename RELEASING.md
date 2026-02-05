# Releasing Claudia

This guide covers how to create a new release of Claudia with the auto-update system.

## Prerequisites

- GitHub secrets configured:
  - `TAURI_SIGNING_PRIVATE_KEY` - The minisign private key (base64-encoded)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Password for the key (required if key is password-protected)

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

The GitHub Actions workflow builds:
1. Universal macOS binary (arm64 + x86_64)
2. Signs update artifacts with minisign
3. Generates `latest.json` manifest
4. Creates GitHub Release with all artifacts

Monitor progress at: https://github.com/JasonBates/claudia/actions

### 7. Verify the Release

1. Check the release page: https://github.com/JasonBates/claudia/releases
2. Download and test the DMG on a fresh machine
3. Test the auto-updater by running an older version

### 8. Update Download Badge

Update the download badge in `README.md` to point to the new version:

```markdown
[![Download for macOS](https://img.shields.io/badge/Download-v0.3.0-black?logo=apple)](https://github.com/JasonBates/claudia/releases/download/v0.3.0/Claudia_0.3.0_universal.dmg)
```

Replace `0.3.0` with the new version number in both places (badge label and download URL).

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

Without Apple Developer signing, users need to right-click → Open the first time to bypass Gatekeeper.
