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

  function containsInternalDebugValue(value) {
    var text = String(value || '');
    return !!(
      /\b(accountId|account_id|session_id|sessionId|reviewSessionId|review_session_id|humanInputId|human_input_id|operationId|operation_id|threadId|thread_id|runId|run_id|messageId|message_id|toolCallId|tool_call_id|inputId|input_id|emailAddress|email_address)\s*[:=]/i.test(text) ||
      /\bprovider\s*[:=]\s*[A-Z0-9_-]+/i.test(text) ||
      /\barchive_review_[A-Za-z0-9_-]+\b/.test(text) ||
      /\bcm[a-z0-9]{12,}\b/.test(text) ||
      /\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/i.test(text)
    );
  }

  function displayKeyLabel(key) {
    var normalized = String(key || '').replace(/_/g, '').toLowerCase();
    if (normalized === 'accountid') return 'account';
    if (normalized === 'sessionid' || normalized === 'reviewsessionid') return 'review session';
    if (normalized === 'humaninputid' || normalized === 'inputid') return 'review item';
    if (normalized === 'operationid') return 'operation';
    if (normalized === 'threadid' || normalized === 'runid' || normalized === 'messageid' || normalized === 'toolcallid') return 'item';
    if (normalized === 'emailaddress') return 'email address';
    if (normalized === 'receivedafter') return 'starting';
    if (normalized === 'receivedbefore') return 'ending';
    if (normalized === 'ininboxonly') return 'in the inbox';
    return 'item';
  }

  function sanitizeDisplayText(value) {
    var text = String(value || '');
    if (!text) return '';
    if (
      /\bAnalyze account(?:Id)?(?:\b|[=:,])/i.test(text) &&
      /\buser_email_search\b/i.test(text) &&
      /\bdo not mutate email\b/i.test(text)
    ) {
      return 'Checking the connected mailbox for the requested time window. No email changes are made in this step.';
    }
    text = text
      .replace(/\b(accountId|account_id|session_id|sessionId|reviewSessionId|review_session_id|humanInputId|human_input_id|operationId|operation_id|threadId|thread_id|runId|run_id|messageId|message_id|toolCallId|tool_call_id|inputId|input_id|emailAddress|email_address|receivedAfter|received_after|receivedBefore|received_before|inInboxOnly|in_inbox_only)\s*[:=]\s*["']?[^,\s;)\]}]+["']?/gi, function (_match, key) {
        return displayKeyLabel(key);
      })
      .replace(/\bprovider\s*[:=]\s*["']?([A-Za-z0-9_-]+)["']?/gi, function (_match, provider) {
        return String(provider || '').toUpperCase() === 'GMAIL' ? 'Gmail' : 'email provider';
      })
      .replace(/\barchive_review_[A-Za-z0-9_-]+\b/g, 'review')
      .replace(/\buser_email_[A-Za-z0-9:_-]{16,}\b/gi, 'email item')
      .replace(/\bcm[a-z0-9]{12,}\b/g, 'item')
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/gi, 'item')
      .replace(/\bawait_review\b/g, 'wait for your review')
      .replace(/\bpush_review\b/g, 'prepare review')
      .replace(/\bstructured_data\b/g, 'review table')
      .replace(/\brich_content\b/g, 'content')
      .replace(/\buser_email_search\b/g, 'email search')
      .replace(/\baccountId\b/g, 'account')
      .replace(/\binInboxOnly\b/g, 'in the inbox')
      .replace(/\s*,\s*,+/g, ', ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\(\s*\)/g, '')
      .trim();
    return text;
  }

  function formatThreadTitleForDisplay(value, fallback) {
    var raw = String(value || '').trim();
    var defaultTitle = fallback || 'Thread';
    if (!raw) return defaultTitle;
    var colonIndex = raw.indexOf(':');
    if (colonIndex > 0 && containsInternalDebugValue(raw.slice(colonIndex + 1))) {
      return sanitizeDisplayText(raw.slice(0, colonIndex)) || defaultTitle;
    }
    return sanitizeDisplayText(raw) || defaultTitle;
  }

  function isSyntheticReviewResumeContent(value) {
    var text = String(value || '').trim();
    if (!text) return false;
    return /^The user submitted a review decision for session\b/i.test(text) ||
      (
        /\buser submitted a review decision\b/i.test(text) &&
        (/\bawait_review\b/i.test(text) || /\bsession_id\s*=/.test(text))
      );
  }

  function normalizeActivityKey(value) {
    return String(value || '').toLowerCase().replace(/[.\s-]+/g, '_');
  }

  function formatActivityTitleForDisplay(item) {
    item = item || {};
    var rawTitle = String(item.title || item.summary || '').trim();
    var toolKey = normalizeActivityKey(item.toolName || item.tool_name || item.type || item.kind);
    var titleKey = normalizeActivityKey(rawTitle);
    var key = toolKey || titleKey;
    if (key === 'subagent_dispatch' || titleKey === 'subagent_dispatch') return 'Starting delegated work';
    if (key === 'subagent_listen' || titleKey === 'subagent_listen') return 'Collecting delegated results';
    if (key === 'get_tool_instructions' || titleKey === 'get_tool_instructions') return 'Preparing available actions';
    if (key === 'user_email_accounts_list' || titleKey === 'user_email_accounts_list') return 'Checking connected mailboxes';
    if (key === 'user_email_search' || titleKey === 'user_email_search') return 'Searching mailbox';
    if (key === 'user_email_archive_review_propose' || titleKey === 'user_email_archive_review_propose') return 'Preparing archive suggestions';
    if (key === 'user_email_archive' || titleKey === 'user_email_archive') return 'Archiving email';
    if (key === 'push_review' || titleKey === 'push_review') return 'Preparing review';
    if (key === 'await_review' || titleKey === 'await_review') return 'Waiting for your review';
    return sanitizeDisplayText(rawTitle || titleCase(item.kind || item.toolName || 'Work activity'));
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
    formatActivityTitleForDisplay: formatActivityTitleForDisplay,
    formatThreadTitleForDisplay: formatThreadTitleForDisplay,
    getTimeValue: getTimeValue,
    initials: initials,
    isAiContentType: isAiContentType,
    isSyntheticReviewResumeContent: isSyntheticReviewResumeContent,
    matchesSearch: matchesSearch,
    sanitizeDisplayText: sanitizeDisplayText,
    sortProjects: sortProjects,
    sortThreads: sortThreads,
    titleCase: titleCase,
  };
})();
