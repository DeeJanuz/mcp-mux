import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactDir = process.env.MCPVIEWS_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.MCPVIEWS_E2E_ARTIFACT_DIR)
  : path.resolve(__dirname, 'artifacts');
const defaultAppPath = path.resolve(
  repoRoot,
  'target',
  'release',
  process.platform === 'win32' ? 'mcpviews.exe' : 'mcpviews',
);
const appPath = path.resolve(process.env.MCPVIEWS_E2E_APP_PATH || defaultAppPath);

let tauriDriver;
let tauriDriverExitedByUs = false;
let tauriDriverLog;

function tauriDriverPath() {
  const binary = process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver';
  return path.resolve(os.homedir(), '.cargo', 'bin', binary);
}

function closeTauriDriver() {
  tauriDriverExitedByUs = true;
  if (tauriDriver && !tauriDriver.killed) {
    tauriDriver.kill();
  }
  tauriDriverLog?.end();
}

function onShutdown(fn) {
  ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].forEach(function (signal) {
    try {
      process.on(signal, function () {
        try {
          fn();
        } finally {
          if (signal !== 'exit') process.exit();
        }
      });
    } catch (_error) {}
  });
}

onShutdown(closeTauriDriver);

export const config = {
  host: '127.0.0.1',
  port: 4444,
  specs: ['./specs/**/*.e2e.mjs'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: appPath,
      },
    },
  ],
  logLevel: 'info',
  outputDir: path.join(artifactDir, 'webdriverio'),
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 90000,
  },
  onPrepare: function () {
    mkdirSync(artifactDir, { recursive: true });
    if (!existsSync(appPath)) {
      throw new Error(`MCPViews app binary not found for WebDriver smoke: ${appPath}`);
    }
    writeFileSync(
      path.join(artifactDir, 'artifact-metadata.json'),
      `${JSON.stringify({
        appPath,
        flavor: process.env.MCPVIEWS_RELEASE_FLAVOR || null,
        runnerArch: process.arch,
        platform: process.platform,
        commit: process.env.GITHUB_SHA || null,
        ref: process.env.GITHUB_REF_NAME || null,
      }, null, 2)}\n`,
    );
  },
  beforeSession: async function () {
    const driverPath = tauriDriverPath();
    if (!existsSync(driverPath)) {
      throw new Error(`tauri-driver not found at ${driverPath}`);
    }
    mkdirSync(artifactDir, { recursive: true });
    tauriDriverLog = createWriteStream(path.join(artifactDir, 'tauri-driver.log'), { flags: 'a' });
    tauriDriver = spawn(driverPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    tauriDriver.stdout.pipe(tauriDriverLog);
    tauriDriver.stderr.pipe(tauriDriverLog);
    tauriDriver.on('error', function (error) {
      console.error('tauri-driver error:', error);
      process.exit(1);
    });
    tauriDriver.on('exit', function (code) {
      if (!tauriDriverExitedByUs) {
        console.error('tauri-driver exited before the smoke completed:', code);
        process.exit(1);
      }
    });
    await new Promise(function (resolve) {
      setTimeout(resolve, 1000);
    });
  },
  afterSession: function () {
    closeTauriDriver();
  },
  onComplete: function () {
    closeTauriDriver();
  },
};
