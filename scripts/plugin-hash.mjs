import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

export const BUNDLED_HASH_FILE = '.mcpviews-bundled-plugin-sha256';

function sortedFiles(root, current = root) {
  if (!existsSync(current)) return [];
  const entries = readdirSync(current).sort((a, b) => a.localeCompare(b));
  const files = [];
  for (const entry of entries) {
    if (entry === '.DS_Store' || entry === BUNDLED_HASH_FILE) continue;
    const path = join(current, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...sortedFiles(root, path));
    } else if (stat.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export function writePluginHash(pluginDir) {
  const hash = createHash('sha256');
  for (const file of sortedFiles(pluginDir)) {
    hash.update(relative(pluginDir, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  const digest = hash.digest('hex');
  writeFileSync(join(pluginDir, BUNDLED_HASH_FILE), `${digest}\n`);
  return digest;
}
