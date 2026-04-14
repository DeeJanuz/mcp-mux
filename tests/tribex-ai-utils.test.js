import './tribex-ai-utils-setup.js';
import { describe, expect, it } from 'vitest';

describe('tribex-ai-utils', function () {
  var utils = window.__tribexAiUtils;

  it('detects AI content types', function () {
    expect(utils.isAiContentType('tribex_ai_home')).toBe(true);
    expect(utils.isAiContentType('rich_content')).toBe(false);
  });

  it('sorts pinned and current projects ahead of older items', function () {
    var sorted = utils.sortProjects(
      [
        { id: 'older', pinned: false, lastActivityAt: '2026-04-13T10:00:00Z' },
        { id: 'pinned', pinned: true, lastActivityAt: '2026-04-12T10:00:00Z' },
        { id: 'current', pinned: false, lastActivityAt: '2026-04-13T09:00:00Z' },
      ],
      'current',
    );

    expect(sorted.map(function (project) { return project.id; })).toEqual([
      'pinned',
      'current',
      'older',
    ]);
  });

  it('summarizes ready vs blocked bindings', function () {
    var summary = utils.summarizeReadiness([
      { required: true, readiness: 'ready' },
      { required: true, readiness: 'permission_required' },
      { required: false, readiness: 'not_authenticated' },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.ready).toBe(1);
    expect(summary.required).toBe(2);
    expect(summary.needsAttention).toBe(2);
    expect(summary.blocked).toBe(1);
  });

  it('builds setup stages with current tool handoff when required bindings are blocked', function () {
    var stages = utils.buildSetupStages(
      {
        organizationReady: true,
        package: { name: 'Operator Studio' },
        billing: { status: 'ACTIVE' },
        provisioning: { state: 'ACTIVE' },
      },
      [
        { required: true, readiness: 'permission_required' },
      ],
    );

    expect(stages.map(function (stage) { return stage.status; })).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
      'current',
    ]);
  });
});
