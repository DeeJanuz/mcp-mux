import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function windowsBundleVersion(version) {
  const rawVersion = String(version || '').trim();
  const match = rawVersion.match(/^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.]+))?$/);
  if (!match) {
    throw new Error(`Invalid release version for Windows bundling: ${rawVersion}`);
  }

  const prerelease = match[2];
  if (!prerelease) return rawVersion;

  const numeric = prerelease.match(/(?:^|\.)(\d+)$/)?.[1];
  if (!numeric) {
    throw new Error(`Windows MSI prerelease version must end with a numeric identifier: ${rawVersion}`);
  }

  const prereleaseNumber = Number(numeric);
  if (!Number.isInteger(prereleaseNumber) || prereleaseNumber > 65535) {
    throw new Error(`Windows MSI prerelease number must be 0-65535: ${rawVersion}`);
  }

  return `${match[1]}-${prereleaseNumber}`;
}

export function prepareWindowsBundleConfig(options = {}) {
  const cwd = options.cwd || process.cwd();
  const packagePath = resolve(cwd, 'package.json');
  const outputPath = resolve(cwd, options.outputPath || 'tauri.windows.release.conf.json');
  const packageVersion = JSON.parse(readFileSync(packagePath, 'utf8')).version;
  const releaseVersion = options.releaseVersion || process.env.RELEASE_VERSION || packageVersion;
  const bundleVersion = windowsBundleVersion(releaseVersion);

  writeFileSync(outputPath, `${JSON.stringify({ version: bundleVersion }, null, 2)}\n`);
  return { bundleVersion, outputPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = prepareWindowsBundleConfig();
  console.log(`Windows bundle version: ${result.bundleVersion}`);
  console.log(`Wrote ${result.outputPath}`);
}
