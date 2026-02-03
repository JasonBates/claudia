#!/usr/bin/env node
/**
 * Generate update manifest (latest.json) for Tauri auto-updater.
 *
 * This script reads the built artifacts and generates a manifest file
 * that the Tauri updater plugin uses to check for and download updates.
 *
 * Usage: node scripts/generate-update-manifest.js
 *
 * The version is read from tauri.conf.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Read config from tauri.conf.json
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8')
);
const version = tauriConfig.version;
const productName = tauriConfig.productName;

if (!version) {
  console.error('Error: Could not read version from tauri.conf.json');
  process.exit(1);
}

if (!productName) {
  console.error('Error: Could not read productName from tauri.conf.json');
  process.exit(1);
}

console.log(`Generating manifest for ${productName} v${version}`);

// Find the tarball and signature files
const bundleDir = path.join(
  projectRoot,
  'src-tauri/target/universal-apple-darwin/release/bundle/macos'
);

// Tauri generates {productName}.app.tar.gz and {productName}.app.tar.gz.sig
const tarballName = `${productName}.app.tar.gz`;
const sigName = `${tarballName}.sig`;
const tarballPath = path.join(bundleDir, tarballName);
const sigPath = path.join(bundleDir, sigName);

// Verify tarball exists
if (!fs.existsSync(tarballPath)) {
  console.error(`Error: Tarball not found: ${tarballPath}`);
  console.error('  Build may have failed or produced a different filename.');
  process.exit(1);
}
console.log(`Found tarball: ${tarballName}`);

// Read signature
let signature = '';
try {
  signature = fs.readFileSync(sigPath, 'utf8').trim();
  console.log(`Found signature: ${sigName}`);
} catch (e) {
  console.error(`Error: Signature file not found: ${sigPath}`);
  console.error('  Ensure TAURI_SIGNING_PRIVATE_KEY is set and the build completed successfully.');
  process.exit(1);
}

if (!signature) {
  console.error('Error: Signature file is empty.');
  process.exit(1);
}

// Generate the manifest
const downloadUrl = `https://github.com/JasonBates/claudia/releases/download/v${version}/${tarballName}`;
const manifest = {
  version,
  notes: `Release v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-universal': {
      signature,
      url: downloadUrl
    },
    // Also support specific architectures for backwards compatibility
    'darwin-aarch64': {
      signature,
      url: downloadUrl
    },
    'darwin-x86_64': {
      signature,
      url: downloadUrl
    }
  }
};

// Write the manifest
const outputPath = path.join(projectRoot, 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
console.log(`Generated: ${outputPath}`);
