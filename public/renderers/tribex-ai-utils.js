// @ts-nocheck
/* TribeX AI utilities — shared state helpers for the first-party AI shell */

(function () {
  'use strict';

  function isAiContentType(contentType) {
    return typeof contentType === 'string' && contentType.indexOf('tribex_ai_') === 0;
  }

  function getTimeValue(value) {
    if (!value) return 0;
    var ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }

  function sortProjects(projects, currentProjectId) {
    return (projects || []).slice().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if ((a.id === currentProjectId) !== (b.id === currentProjectId)) {
        return a.id === currentProjectId ? -1 : 1;
      }
      return getTimeValue(b.lastActivityAt) - getTimeValue(a.lastActivityAt);
    });
  }

  function sortThreads(threads) {
    return (threads || []).slice().sort(function (a, b) {
      return getTimeValue(b.lastActivityAt) - getTimeValue(a.lastActivityAt);
    });
  }

  function summarizeReadiness(bindings) {
    var summary = {
      total: 0,
      ready: 0,
      required: 0,
      needsAttention: 0,
      blocked: 0,
    };

    (bindings || []).forEach(function (binding) {
      summary.total += 1;
      if (binding.required) summary.required += 1;
      if (binding.readiness === 'ready') {
        summary.ready += 1;
      } else {
        summary.needsAttention += 1;
        if (binding.required) summary.blocked += 1;
      }
    });

    return summary;
  }

  function buildSetupStages(workspace, toolBindings) {
    var toolSummary = summarizeReadiness(toolBindings);
    var provisioningState = workspace && workspace.provisioning && workspace.provisioning.state;
    var billingStatus = workspace && workspace.billing && workspace.billing.status;

    return [
      {
        key: 'organization',
        label: 'Organization',
        status: workspace && workspace.organizationReady ? 'complete' : 'current',
        detail: workspace && workspace.organizationReady
          ? 'Organization context is attached to this workspace.'
          : 'Create or attach an organization before setup can continue.',
      },
      {
        key: 'billing',
        label: 'Billing',
        status: billingStatus === 'ACTIVE' ? 'complete' : 'current',
        detail: billingStatus === 'ACTIVE'
          ? 'Billing and entitlement checks are satisfied.'
          : 'Billing still needs attention before hosted work can fully activate.',
      },
      {
        key: 'package',
        label: 'Package',
        status: workspace && workspace.package ? 'complete' : 'upcoming',
        detail: workspace && workspace.package
          ? workspace.package.name + ' is selected for this workspace.'
          : 'Choose the package or persona for this workspace.',
      },
      {
        key: 'provisioning',
        label: 'Provisioning',
        status: provisioningState === 'ACTIVE'
          ? 'complete'
          : provisioningState === 'FAILED'
            ? 'current'
            : provisioningState === 'PROVISIONING'
              ? 'current'
              : 'upcoming',
        detail: provisioningState === 'ACTIVE'
          ? 'Hosted workspace resources are provisioned.'
          : provisioningState === 'FAILED'
            ? 'Provisioning needs attention before users can enter normal flow.'
            : provisioningState === 'PROVISIONING'
              ? 'Provisioning is in progress and can be resumed after interruption.'
              : 'Provisioning has not started yet.',
      },
      {
        key: 'tools',
        label: 'Tool readiness',
        status: toolSummary.blocked === 0 && toolSummary.total > 0 ? 'complete' : 'current',
        detail: toolSummary.total === 0
          ? 'No local tools are required for this package yet.'
          : toolSummary.blocked === 0
            ? 'Required local tools are ready on this device.'
            : toolSummary.blocked + ' required tool(s) still need attention on this device.',
      },
    ];
  }

  function formatRelativeTime(value) {
    var ms = getTimeValue(value);
    if (!ms) return 'just now';
    var delta = Date.now() - ms;
    var minute = 60 * 1000;
    var hour = 60 * minute;
    var day = 24 * hour;

    if (delta < minute) return 'just now';
    if (delta < hour) return Math.floor(delta / minute) + 'm ago';
    if (delta < day) return Math.floor(delta / hour) + 'h ago';
    return Math.floor(delta / day) + 'd ago';
  }

  function titleCase(value) {
    return String(value || '')
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join(' ');
  }

  window.__tribexAiUtils = {
    buildSetupStages: buildSetupStages,
    formatRelativeTime: formatRelativeTime,
    isAiContentType: isAiContentType,
    sortProjects: sortProjects,
    sortThreads: sortThreads,
    summarizeReadiness: summarizeReadiness,
    titleCase: titleCase,
  };
})();
