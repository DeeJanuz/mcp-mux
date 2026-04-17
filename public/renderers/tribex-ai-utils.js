// @ts-nocheck
/* Hosted workspace utilities — navigator grouping, filtering, and display helpers */

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

  function sortProjects(projects, activeProjectId) {
    return (projects || []).slice().sort(function (a, b) {
      if ((a.id === activeProjectId) !== (b.id === activeProjectId)) {
        return a.id === activeProjectId ? -1 : 1;
      }
      return getTimeValue(b.lastActivityAt) - getTimeValue(a.lastActivityAt);
    });
  }

  function sortThreads(threads) {
    return (threads || []).slice().sort(function (a, b) {
      return getTimeValue(b.lastActivityAt) - getTimeValue(a.lastActivityAt);
    });
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

  function initials(value) {
    var parts = String(value || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (!parts.length) return '?';
    return parts.map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
  }

  function matchesSearch(project, thread, searchTerm) {
    var query = String(searchTerm || '').trim().toLowerCase();
    if (!query) return true;
    var haystack = [
      project && project.name,
      project && project.workspaceName,
      thread && thread.title,
      thread && thread.preview,
      thread && thread.workspaceName,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return haystack.indexOf(query) >= 0;
  }

  function buildProjectGroups(projects, threads, activeProjectId, searchTerm) {
    var threadMap = {};
    sortThreads(threads).forEach(function (thread) {
      if (!thread.projectId) return;
      if (!threadMap[thread.projectId]) threadMap[thread.projectId] = [];
      threadMap[thread.projectId].push(thread);
    });

    return sortProjects(projects, activeProjectId)
      .map(function (project) {
        var filteredThreads = (threadMap[project.id] || []).filter(function (thread) {
          return matchesSearch(project, thread, searchTerm);
        });

        if (!filteredThreads.length && String(searchTerm || '').trim()) {
          return null;
        }

        return {
          project: project,
          threads: filteredThreads,
        };
      })
      .filter(Boolean);
  }

  window.__tribexAiUtils = {
    buildProjectGroups: buildProjectGroups,
    formatRelativeTime: formatRelativeTime,
    getTimeValue: getTimeValue,
    initials: initials,
    isAiContentType: isAiContentType,
    matchesSearch: matchesSearch,
    sortProjects: sortProjects,
    sortThreads: sortThreads,
    titleCase: titleCase,
  };
})();
