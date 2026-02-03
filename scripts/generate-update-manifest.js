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

// Read version from tauri.conf.json
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8')
);
const version = tauriConfig.version;

if (!version) {
  console.error('Error: Could not read version from tauri.conf.json');
  process.exit(1);
}

console.log(`Generating manifest for version ${version}`);

// Find the signature file
const bundleDir = path.join(
  projectRoot,
  'src-tauri/target/universal-apple-darwin/release/bundle/macos'
);

let signature = '';
try {
  const sigFiles = fs.readdirSync(bundleDir).filter(f => f.endsWith('.sig'));
  if (sigFiles.length > 0) {
    signature = fs.readFileSync(path.join(bundleDir, sigFiles[0]), 'utf8').trim();
    console.log(`Found signature: ${sigFiles[0]}`);
  }
} catch (e) {
  console.error('Error: Could not read signature file.');
  console.error(`  ${e.message}`);
  process.exit(1);
}

if (!signature) {
  console.error('Error: No signature file found. Cannot create valid update manifest.');
  console.error('  Ensure TAURI_SIGNING_PRIVATE_KEY is set and the build completed successfully.');
  process.exit(1);
}

// Generate the manifest
const manifest = {
  version,
  notes: `Release v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-universal': {
      signature,
      url: `https://github.com/JasonBates/claudia/releases/download/v${version}/Claudia.app.tar.gz`
    },
    // Also support specific architectures for backwards compatibility
    'darwin-aarch64': {
      signature,
      url: `https://github.com/JasonBates/claudia/releases/download/v${version}/Claudia.app.tar.gz`
    },
    'darwin-x86_64': {
      signature,
      url: `https://github.com/JasonBates/claudia/releases/download/v${version}/Claudia.app.tar.gz`
    }
  }
};

// Write the manifest
const outputPath = path.join(projectRoot, 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
console.log(`Generated: ${outputPath}`);
