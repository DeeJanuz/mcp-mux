#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const env = {
  ...process.env,
  MCPVIEWS_DEV_UPDATE: process.env.MCPVIEWS_DEV_UPDATE || '1',
  MCPVIEWS_DEV_UPDATE_VERSION: process.env.MCPVIEWS_DEV_UPDATE_VERSION || '',
  MCPVIEWS_DEV_HTTP_PORT: process.env.MCPVIEWS_DEV_HTTP_PORT || '44200',
};

function run(command, args, options = {}) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      ...options,
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        rejectProcess(Object.assign(new Error(`Process exited from ${signal}`), { signal }));
        return;
      }
      if (code !== 0) {
        rejectProcess(new Error(`Process exited with status ${code}`));
        return;
      }
      resolveProcess();
    });

    child.on('error', rejectProcess);
  });
}

function debugExecutablePath() {
  if (process.platform === 'darwin') {
    const macosBundleDir = resolve(repoRoot, 'target/debug/bundle/macos');
    const appName = 'MCPViews Update Test.app';
    const preferredPath = resolve(macosBundleDir, appName, 'Contents/MacOS/mcpviews');
    if (existsSync(preferredPath)) return preferredPath;

    const app = readdirSync(macosBundleDir).find((entry) => entry.endsWith('.app'));
    if (app) {
      const executableDir = resolve(macosBundleDir, app, 'Contents/MacOS');
      const executable = readdirSync(executableDir)[0];
      if (executable) return resolve(executableDir, executable);
    }
  }

  return resolve(
    repoRoot,
    'target/debug',
    process.platform === 'win32' ? 'mcpviews.exe' : 'mcpviews',
  );
}

async function main() {
  await run(npxCommand, [
    'tauri',
    'build',
    '--debug',
    '--bundles',
    'app',
    '--config',
    'src-tauri/tauri.update-test.conf.json',
    '--no-sign',
  ]);

  const appPath = debugExecutablePath();
  if (!existsSync(appPath)) {
    throw new Error(`Could not find debug MCPViews executable at ${appPath}`);
  }

  await run(appPath, process.argv.slice(2));
}

main().catch((error) => {
  if (error && (error.signal === 'SIGTERM' || error.signal === 'SIGINT')) {
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});
