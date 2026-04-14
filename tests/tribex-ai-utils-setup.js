import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname_resolved = dirname(fileURLToPath(import.meta.url));
var code = readFileSync(join(__dirname_resolved, '../public/renderers/tribex-ai-utils.js'), 'utf8');

var fn = new Function(code);
fn.call(globalThis);
