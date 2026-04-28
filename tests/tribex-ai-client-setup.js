import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname_resolved = dirname(fileURLToPath(import.meta.url));
await import('../src/cloudflare-agent-bridge.js');
var skillsCode = readFileSync(join(__dirname_resolved, '../public/renderers/tribex-ai-skills.js'), 'utf8');
var code = readFileSync(join(__dirname_resolved, '../public/renderers/tribex-ai-client.js'), 'utf8');

new Function(skillsCode).call(globalThis);
new Function(code).call(globalThis);
