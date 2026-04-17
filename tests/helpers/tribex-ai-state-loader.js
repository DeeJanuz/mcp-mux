import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var rendererDir = join(__dirnameResolved, '../../public/renderers');

function loadScript(filename) {
  var code = readFileSync(join(rendererDir, filename), 'utf8');
  new Function(code).call(globalThis);
}

export function loadTribexAiUtils() {
  loadScript('tribex-ai-utils.js');
}

export function loadTribexAiState() {
  [
    'tribex-ai-state-core.js',
    'tribex-ai-state-projection.js',
    'tribex-ai-state-runtime.js',
    'tribex-ai-state-actions.js',
    'tribex-ai-state.js',
  ].forEach(loadScript);
}
