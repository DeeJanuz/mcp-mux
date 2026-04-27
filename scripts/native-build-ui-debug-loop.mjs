import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const appBundle = join(repoRoot, 'target/aarch64-apple-darwin/release/bundle/macos/MCPViews.app');
const appBinary = join(appBundle, 'Contents/MacOS/mcpviews');
const logFile = process.env.MCPVIEWS_NATIVE_DEBUG_LOG || join(tmpdir(), 'mcpviews-native-build-debug.log');
const ports = [1420, 4200];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function pidsForPort(port) {
  const result = run('lsof', ['-nP', '-t', '-iTCP:' + port, '-sTCP:LISTEN']);
  if (result.status !== 0 && !result.stdout) return [];
  return result.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter(Boolean);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForPortClear(port) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (pidsForPort(port).length === 0) return true;
    sleep(250);
  }
  return false;
}

function stopPort(port) {
  const pids = pidsForPort(port);
  if (!pids.length) {
    return { port, pids: [], stopped: true };
  }

  pids.forEach((pid) => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error && error.code !== 'ESRCH') throw error;
    }
  });

  if (!waitForPortClear(port)) {
    pidsForPort(port).forEach((pid) => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error && error.code !== 'ESRCH') throw error;
      }
    });
  }

  return { port, pids, stopped: waitForPortClear(port) };
}

function waitForPort(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const pids = pidsForPort(port);
    if (pids.length) return pids;
    sleep(250);
  }
  return [];
}

const stopped = ports.map(stopPort);
const blocked = stopped.filter((item) => !item.stopped);
if (blocked.length) {
  throw new Error('Could not stop listeners on ports: ' + blocked.map((item) => item.port).join(', '));
}

const buildArgs = [
  'run',
  'build',
  '--',
  '--target',
  'aarch64-apple-darwin',
  '--bundles',
  'app',
];

const build = spawnSync('npm', buildArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) {
  process.exit(build.status || 1);
}

if (!existsSync(appBinary)) {
  throw new Error('Expected built MCPViews binary at ' + appBinary);
}

mkdirSync(dirname(logFile), { recursive: true });
const logFd = openSync(logFile, 'a');
const child = spawn(appBinary, [], {
  cwd: repoRoot,
  detached: true,
  env: {
    ...process.env,
    MCPVIEWS_ENABLE_LOCAL_AI_DEBUG: process.env.MCPVIEWS_ENABLE_LOCAL_AI_DEBUG || '1',
  },
  stdio: ['ignore', logFd, logFd],
});
child.unref();

const mcpPids = waitForPort(4200);
const vitePids = pidsForPort(1420);

console.log(JSON.stringify({
  appBundle,
  appBinary,
  buildCommand: 'npm ' + buildArgs.join(' '),
  logFile,
  launchedPid: child.pid,
  ports: {
    1420: vitePids,
    4200: mcpPids,
  },
  stopped,
  notes: [
    'The app was built from the current dirty working tree.',
    'Local first-party AI debug proxy is enabled for this native debug loop only.',
    'Use Computer Use with bundle id com.mcpviews.app to inspect the real macOS client.',
    "If the previous-crash reopen dialog appears, choose Don't Reopen for a clean debug window.",
  ],
}, null, 2));
