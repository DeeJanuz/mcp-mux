#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const dmgPaths = process.argv.slice(2).map((path) => resolve(path));

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status || 1}${output ? `\n${output}` : ''}`,
    );
  }

  return result;
}

function detachMount(mountpoint) {
  if (!mountpoint) return;

  const detach = spawnSync('hdiutil', ['detach', mountpoint], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (detach.status === 0) return;

  spawnSync('hdiutil', ['detach', '-force', mountpoint], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertFile(path, label) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Missing ${label}: ${path}`);
  }

  if (statSync(path).size <= 0) {
    throw new Error(`${label} is empty: ${path}`);
  }
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function assertApplicationsLink(path) {
  if (!existsSync(path) || !lstatSync(path).isSymbolicLink()) {
    throw new Error(`Missing Applications symlink: ${path}`);
  }

  const target = readlinkSync(path);
  if (target !== '/Applications') {
    throw new Error(`Applications symlink points to ${target}, expected /Applications`);
  }
}

function verifyDmgLayout(dmgPath) {
  if (!existsSync(dmgPath) || !lstatSync(dmgPath).isFile()) {
    throw new Error(`DMG does not exist: ${dmgPath}`);
  }

  run('hdiutil', ['verify', dmgPath]);

  const mountpoint = mkdtempSync(join(tmpdir(), 'mcpviews-dmg-layout-'));

  try {
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountpoint, dmgPath]);

    assertFile(join(mountpoint, '.DS_Store'), 'Finder layout metadata (.DS_Store)');
    assertFile(join(mountpoint, '.VolumeIcon.icns'), 'volume icon');
    assertDirectory(join(mountpoint, 'MCPViews.app'), 'MCPViews.app');
    assertApplicationsLink(join(mountpoint, 'Applications'));

    console.log(`Verified macOS DMG Finder layout: ${basename(dmgPath)}`);
  } finally {
    detachMount(mountpoint);
    rmSync(mountpoint, { recursive: true, force: true });
  }
}

if (process.platform !== 'darwin') {
  fail('macOS DMG layout verification requires macOS and hdiutil.');
} else if (dmgPaths.length === 0) {
  fail('Usage: node scripts/verify-macos-dmg-layout.mjs <path-to-dmg> [more.dmg ...]');
} else {
  for (const dmgPath of dmgPaths) {
    try {
      verifyDmgLayout(dmgPath);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
}
