import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));

describe('apps popup capability', function () {
  it('grants the popup only core IPC/window/event permissions', function () {
    var capability = JSON.parse(readFileSync(
      join(__dirnameResolved, '../src-tauri/capabilities/apps-popup.json'),
      'utf8',
    ));

    expect(capability.windows).toEqual(['apps-popup']);
    expect(capability.permissions).toEqual([
      'core:default',
      'core:event:default',
      'core:window:default',
      'core:window:allow-close',
      'core:window:allow-set-focus',
    ]);
    expect(capability.permissions.some(function (permission) {
      return /^(shell|dialog|autostart):/.test(permission);
    })).toBe(false);
  });
});
