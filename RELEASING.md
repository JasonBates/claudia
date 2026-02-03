# Releasing Claudia

This guide covers how to create a new release of Claudia with the auto-update system.

## Prerequisites

- GitHub secrets configured:
  - `TAURI_SIGNING_PRIVATE_KEY` - The minisign private key
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Password for the key (empty if none)

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

### 3. Commit the Version Bump

```bash
git add -A
git commit -m "Bump version to <version>"
```

### 4. Create and Push Tag

```bash
git tag v<version>
git push origin main v<version>
```

Example:
```bash
git tag v0.2.0
git push origin main v0.2.0
```

### 5. Monitor the Release

The GitHub Actions workflow (`.github/workflows/release.yml`) triggers automatically on `v*` tags and:

1. Builds a universal macOS binary (arm64 + x86_64)
2. Signs the update artifacts with minisign
3. Generates `latest.json` manifest
4. Creates a GitHub Release with:
   - `Claudia_<version>_universal.dmg` - Installer for new users
   - `Claudia.app.tar.gz` - Update payload for existing users
   - `Claudia.app.tar.gz.sig` - Signature file
   - `latest.json` - Update manifest

Monitor progress at: https://github.com/JasonBates/claudia/actions

### 6. Verify the Release

1. Check the release page: https://github.com/JasonBates/claudia/releases
2. Download and test the DMG on a fresh machine
3. Test the auto-updater by running an older version

## Quick Reference

```bash
# Full release flow (example for v0.2.0)
./scripts/bump-version.sh 0.2.0
git add -A
git commit -m "Bump version to 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

## Troubleshooting

### Build fails with signing error
Verify `TAURI_SIGNING_PRIVATE_KEY` is correctly set in GitHub secrets.

### Update not detected by app
- Check `latest.json` was uploaded to the release
- Verify the version in `latest.json` is newer than the installed version
- Check the endpoint URL matches: `https://github.com/JasonBates/claudia/releases/latest/download/latest.json`

### DMG won't open on user's machine
Without Apple Developer signing, users need to right-click → Open the first time to bypass Gatekeeper.
