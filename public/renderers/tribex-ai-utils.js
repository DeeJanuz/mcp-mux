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

  function getThreadTreeActivity(thread) {
    var latest = getTimeValue(thread && thread.lastActivityAt);
    (thread && thread.childThreads || []).forEach(function (childThread) {
      latest = Math.max(latest, getThreadTreeActivity(childThread));
    });
    return latest;
  }

  function sortThreadTree(threads) {
    return (threads || []).slice().sort(function (a, b) {
      return getThreadTreeActivity(b) - getThreadTreeActivity(a);
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

  function cloneThreadForTree(thread) {
    return Object.assign({}, thread, {
      childThreads: [],
    });
  }

  function buildThreadTree(threads) {
    var nodesById = {};
    var roots = [];

    sortThreads(threads).forEach(function (thread) {
      if (!thread || !thread.id) return;
      nodesById[thread.id] = cloneThreadForTree(thread);
    });

    Object.keys(nodesById).forEach(function (threadId) {
      var node = nodesById[threadId];
      var parentId = node.parentThreadId || null;
      var parent = parentId ? nodesById[parentId] : null;
      if (parent && parent.projectId === node.projectId) {
        parent.childThreads.push(node);
      } else {
        roots.push(node);
      }
    });

    function sortChildren(node) {
      node.childThreads = sortThreadTree(node.childThreads);
      node.childThreads.forEach(sortChildren);
      return node;
    }

    return sortThreadTree(roots).map(sortChildren);
  }

  function filterThreadTree(project, threads, searchTerm) {
    var query = String(searchTerm || '').trim();
    if (!query) return buildThreadTree(threads);

    function filterNode(thread) {
      var childThreads = (thread.childThreads || []).map(filterNode).filter(Boolean);
      if (matchesSearch(project, thread, query) || childThreads.length) {
        return Object.assign({}, thread, {
          childThreads: childThreads,
        });
      }
      return null;
    }

    return buildThreadTree(threads).map(filterNode).filter(Boolean);
  }

  function flattenThreadTree(threads) {
    var flattened = [];
    (threads || []).forEach(function visit(thread) {
      if (!thread) return;
      flattened.push(thread);
      (thread.childThreads || []).forEach(visit);
    });
    return flattened;
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
        var threadTree = filterThreadTree(project, threadMap[project.id] || [], searchTerm);
        var filteredThreads = flattenThreadTree(threadTree);

        if (!filteredThreads.length && String(searchTerm || '').trim()) {
          return null;
        }

        return {
          project: project,
          threads: filteredThreads,
          threadTree: threadTree,
        };
      })
      .filter(Boolean);
  }

  window.__tribexAiUtils = {
    buildThreadTree: buildThreadTree,
    buildProjectGroups: buildProjectGroups,
    flattenThreadTree: flattenThreadTree,
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
