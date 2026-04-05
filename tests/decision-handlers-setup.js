import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname_resolved = dirname(fileURLToPath(import.meta.url));

// Read main.js and extract DECISION_HANDLERS and PLUGIN_TYPE_TO_TOOL
// These are pure data/functions that don't depend on DOM, so we can extract them.
var mainCode = readFileSync(join(__dirname_resolved, '../public/main.js'), 'utf8');

// Extract DECISION_HANDLERS block
var handlersMatch = mainCode.match(/var DECISION_HANDLERS = \{[\s\S]*?\n  \};/);
if (!handlersMatch) throw new Error('Could not extract DECISION_HANDLERS from main.js');

// Build a function that returns the handlers
var handlersFn = new Function(handlersMatch[0] + '\n return DECISION_HANDLERS;');
globalThis.__DECISION_HANDLERS = handlersFn();

// Read citation-panel.js and extract PLUGIN_TYPE_TO_TOOL
var citationCode = readFileSync(join(__dirname_resolved, '../public/renderers/citation-panel.js'), 'utf8');

var toolMapMatch = citationCode.match(/var PLUGIN_TYPE_TO_TOOL = \{[\s\S]*?\};/);
if (!toolMapMatch) throw new Error('Could not extract PLUGIN_TYPE_TO_TOOL from citation-panel.js');

var toolMapFn = new Function(toolMapMatch[0] + '\n return PLUGIN_TYPE_TO_TOOL;');
globalThis.__PLUGIN_TYPE_TO_TOOL = toolMapFn();

// Also extract the fallback logic from the plugin detail renderer
// The fallback is: PLUGIN_TYPE_TO_TOOL[data.type] || ('get_' + data.type)
globalThis.__resolveToolName = function (type) {
  return globalThis.__PLUGIN_TYPE_TO_TOOL[type] || ('get_' + type);
};
