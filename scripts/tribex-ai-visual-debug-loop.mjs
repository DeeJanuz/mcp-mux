import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TRIBEX_AI_DEBUG_URL || 'http://localhost:1420';
const stages = ['running', 'workflow', 'review', 'churn'];
const outputDir = process.env.TRIBEX_AI_DEBUG_OUTPUT || join(tmpdir(), 'mcpviews-tribex-ai-debug-loop');

if (!existsSync(chromePath)) {
  throw new Error('Google Chrome was not found at the expected path.');
}

async function assertDevServer() {
  const response = await fetch(baseUrl + '/debug/tribex-ai-thread-loop.html?stage=running');
  if (!response.ok) {
    throw new Error('Expected MCPViews Vite dev server at ' + baseUrl + ' but received HTTP ' + response.status + '. Run npm run dev first.');
  }
}

await assertDevServer();

mkdirSync(outputDir, { recursive: true });

const results = [];

for (const stage of stages) {
  const file = join(outputDir, stage + '.png');
  const profileDir = join(outputDir, 'chrome-profile-' + stage);
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  const url = baseUrl + '/debug/tribex-ai-thread-loop.html?stage=' + encodeURIComponent(stage);
  const result = spawnSync(chromePath, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--run-all-compositor-stages-before-draw',
    '--window-size=1600,1100',
    '--user-data-dir=' + profileDir,
    '--screenshot=' + file,
    url,
  ], { stdio: 'ignore', timeout: 15000 });
  if (result.error && !(result.error.code === 'ETIMEDOUT' && existsSync(file))) {
    throw result.error;
  }
  if (!existsSync(file)) {
    throw new Error('Chrome did not create screenshot for stage ' + stage + '.');
  }
  results.push({ stage, file, url });
}

console.log(JSON.stringify({
  outputDir,
  screenshots: results,
}, null, 2));
