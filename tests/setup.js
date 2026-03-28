import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname_resolved = dirname(fileURLToPath(import.meta.url));
var code = readFileSync(join(__dirname_resolved, '../public/renderers/structured-data-utils.js'), 'utf8');

// Execute the IIFE in the happy-dom window context
var fn = new Function(code);
fn.call(globalThis);
