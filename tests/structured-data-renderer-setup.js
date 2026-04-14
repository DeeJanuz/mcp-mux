import './setup.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname_resolved = dirname(fileURLToPath(import.meta.url));

globalThis.window.__renderers = globalThis.window.__renderers || {};
globalThis.window.__companionUtils = globalThis.window.__companionUtils || {};

globalThis.window.__companionUtils.escapeHtml = function (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

var code = readFileSync(join(__dirname_resolved, '../public/renderers/structured-data.js'), 'utf8');
var fn = new Function(code);
fn.call(globalThis);
