import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname_resolved = dirname(fileURLToPath(import.meta.url));

// Set up DOM globals for happy-dom
globalThis.window = globalThis;
globalThis.window.__companionUtils = globalThis.window.__companionUtils || {};

// Mock renderMarkdown: wraps text in a div element (simulates parsed markdown)
globalThis.window.__companionUtils.renderMarkdown = function (text) {
  if (!text) return text;
  var div = document.createElement('div');
  div.innerHTML = String(text);
  return div;
};

// Mock escapeHtml
globalThis.window.__companionUtils.escapeHtml = function (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

// Load suggestion-widgets.js IIFE
var code = readFileSync(join(__dirname_resolved, '../public/renderers/suggestion-widgets.js'), 'utf8');
var fn = new Function(code);
fn.call(globalThis);
