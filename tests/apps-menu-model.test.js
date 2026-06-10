import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var appsMenuModelCode = readFileSync(join(__dirnameResolved, '../public/apps-menu-model.js'), 'utf8').replace(/\r\n/g, '\n');

function loadAppsMenuModel() {
  new Function(appsMenuModelCode).call(globalThis);
}

beforeEach(function () {
  document.body.innerHTML = '<div id="apps"></div>';
  delete window.__mcpviewsAppsMenu;
  loadAppsMenuModel();
});

describe('apps menu model', function () {
  it('normalizes plugin labels and renderer labels for shared menu callers', function () {
    var plugins = window.__mcpviewsAppsMenu.normalizePlugins([
      {
        plugin: 'decidr',
        renderers: [
          { name: 'decidr_timeline', label: 'Timeline' },
          { name: 'decidr_dashboard' },
        ],
      },
      {
        plugin: 'tribe-x-persona-studio',
        label: 'Persona Lab',
        renderers: [],
      },
    ]);

    expect(plugins[0].label).toBe('DecidR');
    expect(plugins[0].renderers[0].label).toBe('Timeline');
    expect(plugins[0].renderers[1].label).toBe('decidr_dashboard');
    expect(plugins[1].label).toBe('Persona Lab');
  });

  it('renders identical grouping structure for DOM fallback selections', function () {
    var onSelect = vi.fn();
    var root = document.getElementById('apps');

    window.__mcpviewsAppsMenu.renderAppsMenu(root, [
      {
        plugin: 'ludflow',
        renderers: [
          {
            name: 'ludflow_documents_home',
            label: 'Documents',
            description: 'Documents workspace',
          },
        ],
      },
    ], {
      headerTag: 'div',
      itemTag: 'div',
      chevronText: '\u25B6',
      onSelect: onSelect,
    });

    expect(root.querySelector('.apps-plugin-header span:last-child').textContent).toBe('Ludflow');
    expect(root.querySelector('.apps-plugin-header').classList.contains('expanded')).toBe(true);
    expect(root.querySelector('.apps-renderer-item').textContent).toBe('Documents');

    root.querySelector('.apps-renderer-item').click();

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ludflow_documents_home' }),
      'Documents',
      expect.objectContaining({ plugin: 'ludflow' }),
    );
  });

  it('uses button controls for the native popup caller', function () {
    var root = document.getElementById('apps');

    window.__mcpviewsAppsMenu.renderAppsMenu(root, [
      {
        plugin: 'decidr',
        renderers: [{ name: 'decidr_dashboard', label: 'Dashboard' }],
      },
    ], {
      headerTag: 'button',
      itemTag: 'button',
    });

    expect(root.querySelector('.apps-plugin-header').tagName).toBe('BUTTON');
    expect(root.querySelector('.apps-renderer-item').tagName).toBe('BUTTON');
  });
});
