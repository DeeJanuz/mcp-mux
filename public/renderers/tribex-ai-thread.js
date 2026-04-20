// @ts-nocheck
/* Hosted workspace thread renderer */

(function () {
  'use strict';

  function isLifecycleToolName(toolName) {
    var value = String(toolName || '');
    return /^brokered\.thread\.execution\./.test(value) || /^opencode\.thread\.execution\./.test(value);
  }

  function isRenderableArtifact(message) {
    var contentType = message && (message.resultContentType || message.contentType || message.toolName || null);
    return !!(
      message &&
      message.role === 'tool' &&
      message.resultData &&
      contentType &&
      window.__renderers &&
      typeof window.__renderers[contentType] === 'function'
    );
  }

  function createTextBody(content, className) {
    var body = document.createElement('div');
    body.className = className;
    body.textContent = content || '';
    return body;
  }

  function createMarkdownBody(content, className) {
    var body = document.createElement('div');
    body.className = className;
    if (
      window.__companionUtils &&
      typeof window.__companionUtils.renderMarkdown === 'function'
    ) {
      var markdown = window.__companionUtils.renderMarkdown(content || '');
      if (markdown) {
        body.appendChild(markdown);
        if (
          window.__companionUtils &&
          typeof window.__companionUtils.renderMermaidBlocks === 'function'
        ) {
          window.__companionUtils.renderMermaidBlocks(markdown);
        }
        return body;
      }
    }
    body.textContent = content || '';
    return body;
  }

  function createRawBody(content, className) {
    var body = document.createElement('pre');
    body.className = (className ? className + ' ' : '') + 'rc-raw-markdown';
    var code = document.createElement('code');
    code.textContent = content || '';
    body.appendChild(code);
    return body;
  }

  function isDevModeEnabled() {
    return !!window.__MCPVIEWS_DEV__;
  }

  function buildLegacyBlocks(messages) {
    return (messages || []).map(function (message) {
      if (!message) return null;
      return {
        type: isRenderableArtifact(message)
          ? 'artifact'
          : message.role === 'tool'
            ? 'tool'
            : 'chat',
        message: message,
      };
    }).filter(Boolean);
  }

  function createRunGroup(userMessage, index) {
    return {
      id: userMessage.id || ('run-group-' + index),
      user: userMessage,
      repeatCount: 1,
      latestCreatedAt: userMessage.createdAt || null,
      lifecycleMessages: [],
      toolNotes: [],
      artifacts: [],
      assistantMessages: [],
    };
  }

  function buildRunGroups(messages, rawMode) {
    var groups = [];
    var current = null;
    var shouldFallbackToLegacy = false;

    (messages || []).forEach(function (message, index) {
      if (!message) return;

      if (message.role === 'user') {
        if (
          current &&
          current.user &&
          current.user.content === message.content &&
          !current.lifecycleMessages.length &&
          !current.toolNotes.length &&
          !current.artifacts.length &&
          !current.assistantMessages.length
        ) {
          current.repeatCount += 1;
          current.latestCreatedAt = message.createdAt || current.latestCreatedAt;
          return;
        }

        current = createRunGroup(message, index);
        groups.push(current);
        return;
      }

      if (!current) {
        shouldFallbackToLegacy = true;
        return;
      }

      if (message.role === 'tool' && isLifecycleToolName(message.toolName)) {
        current.lifecycleMessages.push(message);
        return;
      }

      if (isRenderableArtifact(message)) {
        current.artifacts.push(message);
        return;
      }

      if (message.role === 'tool') {
        current.toolNotes.push(message);
        return;
      }

      if (message.role === 'assistant') {
        current.assistantMessages.push(message);
        return;
      }
    });

    if (!groups.length || shouldFallbackToLegacy) {
      return {
        mode: 'legacy',
        blocks: buildLegacyBlocks(messages),
      };
    }

    return {
      mode: 'groups',
      groups: groups.map(function (group, index) {
        return enrichRunGroup(group, index, rawMode);
      }),
    };
  }

  function deriveTaskStatus(message) {
    var toolName = String(message.toolName || '');
    var status = String(message.status || '').toLowerCase();

    if (toolName.indexOf('.failed') >= 0 || status === 'blocked' || status === 'error') {
      return 'failed';
    }
    if (toolName.indexOf('.started') >= 0) {
      return 'running';
    }
    if (toolName.indexOf('.completed') >= 0 || toolName.indexOf('.session.created') >= 0 || toolName.indexOf('.session_created') >= 0) {
      return 'completed';
    }
    return 'completed';
  }

  function buildRunTasks(messages, answerStreaming) {
    var tasks = [];

    (messages || []).forEach(function (message, index) {
      var toolName = String(message.toolName || '');
      var status = deriveTaskStatus(message);
      var lastTask = tasks.length ? tasks[tasks.length - 1] : null;

      if (toolName.indexOf('.completed') >= 0 && lastTask && lastTask.status === 'running') {
        lastTask.status = 'completed';
        if (message.detail) {
          lastTask.detail = lastTask.detail
            ? (lastTask.detail + '\n\n' + message.detail)
            : message.detail;
        }
        lastTask.createdAt = message.createdAt || lastTask.createdAt;
        return;
      }

      if (toolName.indexOf('.failed') >= 0 && lastTask && lastTask.status === 'running') {
        lastTask.status = 'failed';
        if (message.summary) {
          lastTask.title = message.summary;
        }
        if (message.detail) {
          lastTask.detail = lastTask.detail
            ? (lastTask.detail + '\n\n' + message.detail)
            : message.detail;
        }
        lastTask.createdAt = message.createdAt || lastTask.createdAt;
        return;
      }

      tasks.push({
        id: message.id || ((message.toolName || 'task') + '-' + index),
        title: message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'task'),
        detail: message.detail || '',
        status: status,
        open: false,
        createdAt: message.createdAt || null,
      });
    });

    return tasks.map(function (task, index) {
      var isLastTask = index === tasks.length - 1;
      return {
        id: task.id,
        title: task.title,
        detail: task.detail,
        status: task.status,
        open: task.status === 'running' || task.status === 'failed' || (answerStreaming && isLastTask),
        createdAt: task.createdAt,
      };
    });
  }

  function buildRunAnswer(messages) {
    var contentParts = [];
    var latestCreatedAt = null;
    var isStreaming = false;

    (messages || []).forEach(function (message) {
      if (!message) return;
      if (message.content) contentParts.push(message.content);
      latestCreatedAt = message.createdAt || latestCreatedAt;
      if (message.isStreaming) isStreaming = true;
    });

    return {
      content: contentParts.join('\n\n'),
      createdAt: latestCreatedAt,
      isStreaming: isStreaming,
    };
  }

  function toolNoteKey(message) {
    return JSON.stringify([
      message && message.toolName,
      message && message.summary,
      message && message.detail,
      message && message.status,
    ]);
  }

  function collapseToolNotes(messages) {
    var collapsed = [];

    (messages || []).forEach(function (message) {
      if (!message) return;

      var previous = collapsed.length ? collapsed[collapsed.length - 1] : null;
      if (previous && toolNoteKey(previous) === toolNoteKey(message)) {
        collapsed[collapsed.length - 1] = Object.assign({}, previous, message, {
          createdAt: message.createdAt || previous.createdAt,
        });
        return;
      }

      collapsed.push(message);
    });

    return collapsed;
  }

  function enrichRunGroup(group, index, rawMode) {
    var answer = buildRunAnswer(group.assistantMessages);
    var tasks = buildRunTasks(group.lifecycleMessages, answer.isStreaming);
    var toolNotes = collapseToolNotes(group.toolNotes);
    return {
      id: group.id || ('run-group-' + index),
      index: index,
      user: group.user,
      repeatCount: group.repeatCount,
      latestCreatedAt: group.latestCreatedAt,
      tasks: tasks,
      toolNotes: toolNotes,
      artifacts: group.artifacts,
      answer: answer,
      isStreaming: answer.isStreaming,
      signature: JSON.stringify({
        displayMode: rawMode ? 'raw' : 'rendered',
        repeatCount: group.repeatCount,
        prompt: group.user && group.user.content,
        tasks: tasks.map(function (task) {
          return [task.id, task.status, task.detail, task.open];
        }),
        toolNotes: toolNotes.map(function (note) {
          return [note.id, note.summary, note.detail, note.status];
        }),
        artifacts: group.artifacts.map(function (artifact) {
          return [
            artifact.id,
            artifact.resultData && artifact.resultData.title,
            artifact.resultData && artifact.resultData.body,
          ];
        }),
        answer: [answer.content, answer.isStreaming],
      }),
    };
  }

  function createMetaLabel(className, value) {
    var label = document.createElement('span');
    label.className = className;
    label.textContent = value;
    return label;
  }

  function createSummaryText(value, maxLength) {
    var text = typeof value === 'string' ? value.trim() : '';
    if (!text) return '';
    return text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text;
  }

  function countMarkdownListItems(body) {
    if (!body) return 0;
    var matches = String(body).match(/^\s*(?:[-*+]\s+|\d+\.\s+)/gm);
    return matches ? matches.length : 0;
  }

  function collectStructuredRowStats(rows, depth, stats) {
    (rows || []).forEach(function (row) {
      stats.rowCount += 1;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      collectStructuredRowStats(row && row.children, depth + 1, stats);
    });
  }

  function getStructuredDataStats(data) {
    var tables = data && Array.isArray(data.tables) ? data.tables : [];
    var stats = {
      tableCount: tables.length,
      rowCount: 0,
      columnCount: 0,
      maxDepth: 0,
    };

    tables.forEach(function (table) {
      var columns = Array.isArray(table && table.columns) ? table.columns : [];
      stats.columnCount = Math.max(stats.columnCount, columns.length);
      collectStructuredRowStats(table && table.rows, 0, stats);
    });

    return stats;
  }

  function getInlineRendererDescriptor(item) {
    var contentType = item && (item.contentType || item.resultContentType || item.toolName || null);
    var data = item && item.resultData ? item.resultData : {};
    var title = data && data.title
      ? data.title
      : item && item.resultTitle
        ? item.resultTitle
        : item && item.title
          ? item.title
          : contentType
            ? window.__tribexAiUtils.titleCase(String(contentType).replace(/_/g, ' '))
            : 'Inline result';

    if (contentType === 'structured_data') {
      var structuredStats = getStructuredDataStats(data);
      return {
        title: title,
        badge: 'table',
        summary: structuredStats.tableCount > 1
          ? structuredStats.tableCount + ' tables'
          : (structuredStats.rowCount || 0) + ' rows, ' + structuredStats.columnCount + ' columns',
        shouldCollapse: structuredStats.rowCount > 10 || structuredStats.columnCount > 6 || structuredStats.maxDepth > 2,
      };
    }

    var body = data && typeof data.body === 'string' ? data.body : '';
    var tables = data && Array.isArray(data.tables) ? data.tables : [];
    return {
      title: title,
      badge: 'rich content',
      summary: tables.length >= 2
        ? tables.length + ' tables'
        : (body && body.length > 1200 ? 'long markdown' : createSummaryText(body, 80) || 'inline markdown'),
      shouldCollapse: body.length > 1200 || countMarkdownListItems(body) > 12 || tables.length >= 2,
    };
  }

  function cloneInlineRendererData(data) {
    if (!data || typeof data !== 'object') return data;
    var clone = JSON.parse(JSON.stringify(data));
    if (clone && typeof clone === 'object' && clone.title) {
      delete clone.title;
    }
    return clone;
  }

  function createInlineRendererItem(item, threadState, groupId, index) {
    var descriptor = getInlineRendererDescriptor(item);
    var contentType = item && (item.contentType || item.resultContentType || item.toolName || null);
    var renderer = contentType && window.__renderers ? window.__renderers[contentType] : null;
    var resultId = [groupId || 'run', item && item.id || contentType || 'inline', index].join(':');

    var block = document.createElement('details');
    block.className = 'ai-inline-renderer';
    block.setAttribute('data-inline-result-id', resultId);
    var remembered = threadState.inlineResultOpen[resultId];
    block.open = remembered === undefined ? !descriptor.shouldCollapse : !!remembered;
    block.addEventListener('toggle', function () {
      threadState.inlineResultOpen[resultId] = block.open;
    });

    var summary = document.createElement('summary');
    summary.className = 'ai-inline-renderer-summary';

    var copy = document.createElement('div');
    copy.className = 'ai-inline-renderer-copy';

    var headerRow = document.createElement('div');
    headerRow.className = 'ai-inline-renderer-header';
    headerRow.appendChild(createMetaLabel('ai-inline-renderer-badge', descriptor.badge));

    var title = document.createElement('strong');
    title.className = 'ai-inline-renderer-title';
    title.textContent = descriptor.title;
    headerRow.appendChild(title);
    copy.appendChild(headerRow);

    if (descriptor.summary) {
      var meta = document.createElement('div');
      meta.className = 'ai-inline-renderer-meta';
      meta.textContent = descriptor.summary;
      copy.appendChild(meta);
    }

    summary.appendChild(copy);

    if (item && (item.updatedAt || item.createdAt)) {
      summary.appendChild(createMetaLabel(
        'ai-inline-renderer-time',
        window.__tribexAiUtils.formatRelativeTime(item.updatedAt || item.createdAt)
      ));
    }

    block.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'ai-inline-renderer-body';
    if (typeof renderer === 'function') {
      renderer(
        body,
        cloneInlineRendererData(item.resultData || {}),
        item.resultMeta || {},
        item.toolArgs || {},
        false,
        null,
      );
    } else {
      body.appendChild(createTextBody('Unable to render inline result.', 'ai-chat-body'));
    }
    block.appendChild(body);

    return block;
  }

  function createPromptBlock(message, repeatCount, latestCreatedAt) {
    var row = document.createElement('article');
    row.className = 'ai-turn-prompt';

    var metaRow = document.createElement('div');
    metaRow.className = 'ai-turn-meta-row';
    metaRow.appendChild(createMetaLabel('ai-turn-role', 'You'));

    if (repeatCount > 1) {
      metaRow.appendChild(createMetaLabel('ai-turn-repeat', repeatCount + ' attempts'));
    }

    if (latestCreatedAt) {
      metaRow.appendChild(createMetaLabel('ai-turn-time', window.__tribexAiUtils.formatRelativeTime(latestCreatedAt)));
    }

    row.appendChild(metaRow);
    row.appendChild(createTextBody(message.content || '', 'ai-turn-prompt-body ai-chat-body'));
    return row;
  }

  function createToolNote(message) {
    if (!message.detail) {
      var simple = document.createElement('article');
      simple.className = 'ai-tool-note';

      var simpleHeader = document.createElement('div');
      simpleHeader.className = 'ai-tool-note-header';

      var simpleTitle = document.createElement('strong');
      simpleTitle.textContent = message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'tool');
      simpleHeader.appendChild(simpleTitle);

      if (message.createdAt) {
        var simpleTime = document.createElement('span');
        simpleTime.className = 'ai-tool-note-time';
        simpleTime.textContent = window.__tribexAiUtils.formatRelativeTime(message.createdAt);
        simpleHeader.appendChild(simpleTime);
      }

      simple.appendChild(simpleHeader);
      return simple;
    }

    var row = document.createElement('details');
    row.className = 'ai-tool-note';

    var header = document.createElement('summary');
    header.className = 'ai-tool-note-header ai-tool-note-summary';

    var title = document.createElement('strong');
    title.textContent = message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'tool');
    header.appendChild(title);

    if (message.createdAt) {
      var time = document.createElement('span');
      time.className = 'ai-tool-note-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(message.createdAt);
      header.appendChild(time);
    }

    row.appendChild(header);
    row.appendChild(createTextBody(message.detail, 'ai-tool-note-body'));

    return row;
  }

  function summarizeArtifactBody(resultData) {
    var body = resultData && typeof resultData.body === 'string' ? resultData.body.trim() : '';
    if (!body && resultData && Array.isArray(resultData.tables) && resultData.tables.length) {
      return resultData.tables.length === 1
        ? '1 table is available in a separate result tab.'
        : resultData.tables.length + ' tables are available in a separate result tab.';
    }
    if (!body) return 'A renderer-backed result is available in a separate result tab.';
    return createSummaryText(body, 140);
  }

  function buildArtifactMatchFingerprint(candidate) {
    if (!candidate) return null;
    var contentType = candidate.contentType || candidate.resultContentType || candidate.toolName || null;
    var title = candidate.title
      || candidate.resultTitle
      || (candidate.resultMeta && candidate.resultMeta.headerTitle)
      || (candidate.resultData && candidate.resultData.title)
      || null;
    var body = candidate.summary
      || candidate.detail
      || (candidate.resultMeta && candidate.resultMeta.summary)
      || (candidate.resultData && candidate.resultData.body)
      || null;

    if (!contentType && !title && !body) return null;
    return JSON.stringify([
      contentType || '',
      title || '',
      createSummaryText(body || '', 120),
    ]);
  }

  function buildArtifactTitleKey(candidate) {
    if (!candidate) return null;
    var contentType = candidate.contentType || candidate.resultContentType || candidate.toolName || null;
    var title = candidate.title
      || candidate.resultTitle
      || (candidate.resultMeta && candidate.resultMeta.headerTitle)
      || (candidate.resultData && candidate.resultData.title)
      || null;
    if (!contentType && !title) return null;
    return JSON.stringify([
      String(contentType || '').trim().toLowerCase(),
      String(title || '').trim().toLowerCase(),
    ]);
  }

  function collectInlineArtifactMatchers(thread) {
    var artifactKeys = {};
    var fingerprints = {};
    var activityIds = {};
    var turnKeys = {};
    var titleKeys = {};
    var runs = thread && Array.isArray(thread.runs) ? thread.runs : [];

    runs.forEach(function (run) {
      var inlineResults = run && run.answer && Array.isArray(run.answer.inlineResults)
        ? run.answer.inlineResults
        : [];
      inlineResults.forEach(function (item) {
        if (!item) return;
        if (item.artifactKey) {
          artifactKeys[item.artifactKey] = true;
        }
        var activityId = item.id
          || item.toolCallId
          || (item.resultMeta && item.resultMeta.activityId)
          || null;
        if (activityId) {
          activityIds[String(activityId)] = true;
        }
        var turnId = item.turnId || (item.resultMeta && item.resultMeta.turnId) || null;
        var turnOrdinal = item.turnOrdinal || (item.resultMeta && item.resultMeta.turnOrdinal) || null;
        var contentType = item.contentType || item.resultContentType || item.toolName || null;
        var title = item.title
          || item.resultTitle
          || (item.resultMeta && item.resultMeta.headerTitle)
          || (item.resultData && item.resultData.title)
          || null;
        if ((turnId || turnOrdinal) && (contentType || title)) {
          turnKeys[JSON.stringify([
            turnId || '',
            turnOrdinal || '',
            contentType || '',
            title || '',
          ])] = true;
        }
        var titleKey = buildArtifactTitleKey(item);
        if (titleKey) {
          titleKeys[titleKey] = true;
        }
        var fingerprint = buildArtifactMatchFingerprint(item);
        if (fingerprint) {
          fingerprints[fingerprint] = true;
        }
      });
    });

    return {
      artifactKeys: artifactKeys,
      fingerprints: fingerprints,
      activityIds: activityIds,
      turnKeys: turnKeys,
      titleKeys: titleKeys,
    };
  }

  function collectReopenableArtifacts(thread) {
    var inlineMatchers = collectInlineArtifactMatchers(thread);

    function isInlineDuplicate(candidate) {
      if (!candidate) return false;
      if (candidate.artifactKey && inlineMatchers.artifactKeys[candidate.artifactKey]) {
        return true;
      }
      var activityId = candidate.id
        || candidate.toolCallId
        || (candidate.resultMeta && candidate.resultMeta.activityId)
        || null;
      if (activityId && inlineMatchers.activityIds[String(activityId)]) {
        return true;
      }
      var turnId = candidate.turnId || (candidate.resultMeta && candidate.resultMeta.turnId) || null;
      var turnOrdinal = candidate.turnOrdinal || (candidate.resultMeta && candidate.resultMeta.turnOrdinal) || null;
      var contentType = candidate.contentType || candidate.resultContentType || candidate.toolName || null;
      var title = candidate.title
        || candidate.resultTitle
        || (candidate.resultMeta && candidate.resultMeta.headerTitle)
        || (candidate.resultData && candidate.resultData.title)
        || null;
      if ((turnId || turnOrdinal) && (contentType || title)) {
        var turnKey = JSON.stringify([
          turnId || '',
          turnOrdinal || '',
          contentType || '',
          title || '',
        ]);
        if (inlineMatchers.turnKeys[turnKey]) {
          return true;
        }
      }
      var titleKey = buildArtifactTitleKey(candidate);
      if (titleKey && inlineMatchers.titleKeys[titleKey]) {
        return true;
      }
      var fingerprint = buildArtifactMatchFingerprint(candidate);
      return !!(fingerprint && inlineMatchers.fingerprints[fingerprint]);
    }

    if (thread && Array.isArray(thread.artifacts) && thread.artifacts.length) {
      return thread.artifacts.slice().map(function (artifact) {
        return {
          artifactKey: artifact.artifactKey,
          title: artifact.title || 'Open result',
          summary: createSummaryText(
            (artifact.data && artifact.data.body)
            || (artifact.meta && artifact.meta.summary)
            || '',
            120,
          ),
          contentType: artifact.contentType || null,
          resultData: artifact.data || null,
          resultMeta: artifact.meta || null,
          updatedAt: artifact.updatedAt || artifact.createdAt || null,
        };
      }).filter(function (artifact) {
        return !isInlineDuplicate(artifact);
      }).sort(function (left, right) {
        var leftTime = getTimeValue(left.updatedAt);
        var rightTime = getTimeValue(right.updatedAt);
        if (leftTime !== rightTime) return rightTime - leftTime;
        return String(left.title || '').localeCompare(String(right.title || ''));
      });
    }

    var byKey = {};

    function register(candidate) {
      if (!candidate || !candidate.artifactKey) return;
      if (isInlineDuplicate(candidate)) return;
      byKey[candidate.artifactKey] = {
        artifactKey: candidate.artifactKey,
        title: candidate.title || candidate.resultTitle || 'Open result',
        summary: createSummaryText(
          candidate.summary
          || candidate.detail
          || (candidate.resultData && candidate.resultData.body)
          || '',
          120,
        ),
        contentType: candidate.contentType || candidate.resultContentType || candidate.toolName || null,
        updatedAt: candidate.updatedAt || candidate.createdAt || null,
      };
    }

    var runs = thread && Array.isArray(thread.runs) ? thread.runs : [];
    runs.forEach(function (run) {
      var items = run && run.workSession && Array.isArray(run.workSession.items)
        ? run.workSession.items
        : [];
      items.forEach(function (item) {
        register({
          artifactKey: item.artifactKey,
          title: item.resultTitle || item.title,
          summary: item.detail,
          contentType: item.resultContentType || item.toolName,
          updatedAt: item.updatedAt || item.createdAt || null,
        });
      });
    });

    var activityItems = thread && Array.isArray(thread.activityItems) ? thread.activityItems : [];
    activityItems.forEach(function (item) {
      register({
        artifactKey: item.artifactKey,
        title: item.resultTitle || item.title,
        summary: item.detail,
        contentType: item.resultContentType || item.toolName,
        updatedAt: item.updatedAt || item.createdAt || null,
      });
    });

    var messages = thread && Array.isArray(thread.messages) ? thread.messages : [];
    messages.forEach(function (message) {
      register({
        artifactKey: message.artifactKey,
        title: (message.resultData && message.resultData.title) || message.title,
        summary: message.detail || (message.resultData && message.resultData.body) || '',
        contentType: message.contentType || message.toolName || null,
        updatedAt: message.createdAt || null,
      });
    });

    return Object.keys(byKey)
      .map(function (key) {
        return byKey[key];
      })
      .sort(function (left, right) {
        var leftTime = getTimeValue(left.updatedAt);
        var rightTime = getTimeValue(right.updatedAt);
        if (leftTime !== rightTime) return rightTime - leftTime;
        return String(left.title || '').localeCompare(String(right.title || ''));
      });
  }

  function createArtifactReopenItem(message, threadId) {
    var row = document.createElement('article');
    row.className = 'ai-result-reopen';

    var header = document.createElement('div');
    header.className = 'ai-result-reopen-header';

    var copy = document.createElement('div');
    copy.className = 'ai-result-reopen-copy';
    copy.appendChild(createMetaLabel('ai-result-reopen-kicker', 'Result ready'));

    var title = document.createElement('strong');
    title.textContent = (message.resultData && message.resultData.title) || 'Open result in slide-out';
    copy.appendChild(title);
    header.appendChild(copy);

    if (message.createdAt) {
      header.appendChild(createMetaLabel('ai-result-reopen-time', window.__tribexAiUtils.formatRelativeTime(message.createdAt)));
    }

    row.appendChild(header);
    row.appendChild(createTextBody(summarizeArtifactBody(message.resultData), 'ai-result-reopen-body'));

    if (message.artifactKey) {
      var actions = document.createElement('div');
      actions.className = 'ai-result-reopen-actions';

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-work-item-link';
      button.textContent = 'Reopen result';
      button.addEventListener('click', function () {
        openResultArtifact(threadId, message.artifactKey);
      });
      actions.appendChild(button);
      row.appendChild(actions);
    }

    return row;
  }

  function getTimeValue(value) {
    if (!value) return 0;
    var ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }

  function formatElapsed(startedAt, endedAt) {
    var start = getTimeValue(startedAt);
    var end = getTimeValue(endedAt) || Date.now();
    var delta = Math.max(1000, end - start);
    var totalSeconds = Math.max(1, Math.round(delta / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;

    if (minutes <= 0) return totalSeconds + 's';
    if (seconds === 0) return minutes + 'm';
    return minutes + 'm ' + seconds + 's';
  }

  function createWorkStatusLabel(status) {
    if (status === 'failed') return 'Failed';
    if (status === 'needs-approval') return 'Needs Approval';
    if (status === 'running') return 'Running';
    return 'Done';
  }

  function openResultArtifact(threadId, artifactKey) {
    if (!threadId || !artifactKey) return;
    if (window.__tribexAiState && typeof window.__tribexAiState.openThreadArtifact === 'function') {
      window.__tribexAiState.openThreadArtifact(threadId, artifactKey);
      return;
    }
    if (window.__tribexAiState && typeof window.__tribexAiState.selectThreadArtifact === 'function') {
      window.__tribexAiState.selectThreadArtifact(threadId, artifactKey);
      return;
    }
    var activeSession = window.__companionUtils && typeof window.__companionUtils.getActiveSession === 'function'
      ? window.__companionUtils.getActiveSession()
      : null;
    if (
      activeSession &&
      activeSession.sessionId &&
      window.__companionUtils &&
      typeof window.__companionUtils.selectThreadArtifact === 'function'
    ) {
      window.__companionUtils.selectThreadArtifact(activeSession.sessionId, threadId, artifactKey);
    }
  }

  function createWorkActivityItem(item, threadId) {
    var row = document.createElement('article');
    row.className = 'ai-work-item';

    var header = document.createElement('div');
    header.className = 'ai-work-item-header';

    var copy = document.createElement('div');
    copy.className = 'ai-work-item-copy';

    var kicker = document.createElement('span');
    kicker.className = 'ai-work-item-kicker';
    kicker.textContent = item.toolName ? window.__tribexAiUtils.titleCase(item.toolName) : 'Runtime activity';
    copy.appendChild(kicker);

    var title = document.createElement('strong');
    title.textContent = item.title || 'Runtime activity';
    copy.appendChild(title);
    header.appendChild(copy);

    var meta = document.createElement('div');
    meta.className = 'ai-work-item-meta';

    var status = document.createElement('span');
    status.className = 'ai-work-item-status ai-work-item-status-' + (item.status || 'completed');
    status.textContent = createWorkStatusLabel(item.status);
    meta.appendChild(status);

    if (item.updatedAt || item.createdAt) {
      var time = document.createElement('span');
      time.className = 'ai-work-item-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(item.updatedAt || item.createdAt);
      meta.appendChild(time);
    }

    header.appendChild(meta);
    row.appendChild(header);

    if (item.detail) {
      row.appendChild(createTextBody(item.detail, 'ai-work-item-detail'));
    }

    if (item.artifactKey) {
      var resultRow = document.createElement('div');
      resultRow.className = 'ai-work-item-actions';

      var openLink = document.createElement('button');
      openLink.type = 'button';
      openLink.className = 'ai-work-item-link';
      openLink.textContent = 'Open result';
      openLink.addEventListener('click', function () {
        openResultArtifact(threadId, item.artifactKey);
      });
      resultRow.appendChild(openLink);
      row.appendChild(resultRow);
    }

    return row;
  }

  function createWorkItemFromTask(task) {
    return {
      id: task.id,
      toolName: 'runtime_task',
      title: task.title || 'Runtime task',
      status: task.status || 'completed',
      detail: task.detail || '',
      createdAt: task.createdAt || null,
      updatedAt: task.createdAt || null,
      artifactKey: null,
    };
  }

  function createWorkItemFromNote(note) {
    return {
      id: note.id || ('note-' + note.summary),
      toolName: note.toolName || 'runtime_note',
      title: note.summary || window.__tribexAiUtils.titleCase(note.toolName || 'note'),
      status: note.status || 'completed',
      detail: note.detail || '',
      createdAt: note.createdAt || null,
      updatedAt: note.createdAt || null,
      artifactKey: note.artifactKey || null,
    };
  }

  function createWorkItemFromArtifact(message) {
    return {
      id: message.id || 'result',
      toolName: message.toolName || 'rich_content',
      title: (message.resultData && message.resultData.title) || 'Result ready',
      status: 'completed',
      detail: summarizeArtifactBody(message.resultData),
      createdAt: message.createdAt || null,
      updatedAt: message.createdAt || null,
      artifactKey: message.artifactKey || null,
    };
  }

  function deriveLegacyWorkSession(group) {
    var items = [];
    (group.tasks || []).forEach(function (task) {
      items.push(createWorkItemFromTask(task));
    });
    (group.toolNotes || []).forEach(function (note) {
      items.push(createWorkItemFromNote(note));
    });
    (group.artifacts || []).forEach(function (artifact) {
      items.push(createWorkItemFromArtifact(artifact));
    });

    if (!items.length) return null;

    var isRunning = !!group.isStreaming || items.some(function (item) {
      return item.status === 'running' || item.status === 'needs-approval';
    });
    var isFailed = !isRunning && items.some(function (item) {
      return item.status === 'failed';
    });
    var firstCreatedAt = items.reduce(function (earliest, item) {
      if (!item.createdAt) return earliest;
      if (!earliest) return item.createdAt;
      return Date.parse(item.createdAt) < Date.parse(earliest) ? item.createdAt : earliest;
    }, group.latestCreatedAt || null);
    var lastUpdatedAt = items.reduce(function (latest, item) {
      var candidate = item.updatedAt || item.createdAt || null;
      if (!candidate) return latest;
      if (!latest) return candidate;
      return Date.parse(candidate) > Date.parse(latest) ? candidate : latest;
    }, (group.answer && group.answer.createdAt) || group.latestCreatedAt || null);

    return {
      id: group.id + '-work',
      status: isRunning ? 'running' : (isFailed ? 'failed' : 'completed'),
      startedAt: firstCreatedAt,
      endedAt: isRunning ? null : lastUpdatedAt,
      items: items,
    };
  }

  function createWorkSessionElement(workSession, groupId, threadState) {
    var block = document.createElement('details');
    block.className = 'ai-work-session';
    block.setAttribute('data-work-session-id', workSession.id || groupId);
    var remembered = threadState.workSessionOpen[groupId];
    block.open = remembered === undefined ? workSession.status === 'running' : !!remembered;
    block.addEventListener('toggle', function () {
      threadState.workSessionOpen[groupId] = block.open;
    });

    var summary = document.createElement('summary');
    summary.className = 'ai-work-session-summary';

    summary.appendChild(createMetaLabel(
      'ai-work-session-status ai-work-session-status-' + (workSession.status || 'completed'),
      createWorkStatusLabel(workSession.status || 'completed')
    ));

    var label = document.createElement('span');
    label.className = 'ai-work-session-label';
    label.textContent = (workSession.status === 'running' ? 'Working for ' : 'Worked for ')
      + formatElapsed(workSession.startedAt, workSession.endedAt);
    summary.appendChild(label);

    if (workSession.items && workSession.items.length) {
      summary.appendChild(createMetaLabel('ai-work-session-count', workSession.items.length + ' items'));
    }
    block.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'ai-work-session-body';
    (workSession.items || []).forEach(function (item) {
      body.appendChild(createWorkActivityItem(item, threadState.threadId));
    });
    block.appendChild(body);

    return block;
  }

  function createRunAnswer(answer, threadState) {
    var section = document.createElement('section');
    section.className = 'ai-run-answer' + (answer.isStreaming ? ' ai-run-answer-streaming' : '');

    var header = document.createElement('div');
    header.className = 'ai-run-answer-header';

    header.appendChild(createMetaLabel('ai-run-answer-kicker', answer.isStreaming ? 'Thinking' : 'Summary'));

    if (answer.createdAt) {
      header.appendChild(createMetaLabel('ai-run-answer-time', window.__tribexAiUtils.formatRelativeTime(answer.createdAt)));
    }

    section.appendChild(header);
    var content = answer.content || (answer.isStreaming ? 'Waiting for response…' : '');
    section.appendChild(
      threadState && threadState.showRawResponses
        ? createRawBody(content, 'ai-chat-body ai-run-answer-body')
        : (
          answer.isStreaming
            ? createTextBody(content, 'ai-chat-body ai-run-answer-body')
            : createMarkdownBody(content, 'ai-chat-body ai-run-answer-body')
        )
    );
    return section;
  }

  function createRunGroupElement(group, threadState) {
    var section = document.createElement('section');
    section.className = 'ai-run-group';
    section.setAttribute('data-run-id', group.id);
    section.setAttribute('data-run-signature', group.signature);

    var prompt = document.createElement('div');
    prompt.className = 'ai-run-group-prompt';
    prompt.appendChild(createPromptBlock(group.user, group.repeatCount, group.latestCreatedAt));
    section.appendChild(prompt);

    var surface = document.createElement('div');
    surface.className = 'ai-run-group-surface';

    var workSession = group.workSession || deriveLegacyWorkSession(group);
    if (workSession) {
      surface.appendChild(createWorkSessionElement(workSession, group.id, threadState));
    }

    if (group.answer.content || group.answer.isStreaming) {
      surface.appendChild(createRunAnswer(group.answer, threadState));
    }

    (group.answer && Array.isArray(group.answer.inlineResults) ? group.answer.inlineResults : []).forEach(function (item, index) {
      surface.appendChild(createInlineRendererItem(item, threadState, group.id, index));
    });

    section.appendChild(surface);
    return section;
  }

  function createHeaderShell() {
    var header = document.createElement('section');
    header.className = 'ai-thread-header ai-thread-header-minimal';

    var topRow = document.createElement('div');
    topRow.className = 'ai-thread-meta-row';

    var breadcrumb = document.createElement('p');
    breadcrumb.className = 'ai-thread-breadcrumb';
    topRow.appendChild(breadcrumb);

    var title = document.createElement('h1');
    title.className = 'ai-thread-title';
    topRow.appendChild(title);
    header.appendChild(topRow);

    var statusRow = document.createElement('div');
    statusRow.className = 'ai-thread-status-row';
    header.appendChild(statusRow);

    return {
      root: header,
      breadcrumb: breadcrumb,
      title: title,
      statusRow: statusRow,
    };
  }

  function createResultsShell() {
    var section = document.createElement('section');
    section.className = 'ai-thread-results';
    section.hidden = true;

    var header = document.createElement('div');
    header.className = 'ai-thread-results-header';

    var copy = document.createElement('div');
    copy.className = 'ai-thread-results-copy';
    copy.appendChild(createMetaLabel('ai-thread-results-kicker', 'Results'));

    var title = document.createElement('strong');
    title.className = 'ai-thread-results-title';
    title.textContent = 'Stored renderer outputs';
    copy.appendChild(title);
    header.appendChild(copy);

    var count = document.createElement('span');
    count.className = 'ai-thread-results-count';
    header.appendChild(count);

    section.appendChild(header);

    var list = document.createElement('div');
    list.className = 'ai-thread-results-list';
    section.appendChild(list);

    return {
      root: section,
      count: count,
      list: list,
    };
  }

  function createResultChip(artifact, threadId, active) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-thread-result-chip' + (active ? ' is-active' : '');
    button.addEventListener('click', function () {
      openResultArtifact(threadId, artifact.artifactKey);
    });

    var title = document.createElement('strong');
    title.className = 'ai-thread-result-chip-title';
    title.textContent = artifact.title || 'Open result';
    button.appendChild(title);

    if (artifact.summary) {
      var summary = document.createElement('span');
      summary.className = 'ai-thread-result-chip-summary';
      summary.textContent = artifact.summary;
      button.appendChild(summary);
    }

    var meta = document.createElement('span');
    meta.className = 'ai-thread-result-chip-meta';
    meta.textContent = artifact.contentType
      ? String(artifact.contentType).replace(/_/g, ' ')
      : 'renderer result';
    button.appendChild(meta);

    return button;
  }

  function updateResultsShelf(state, threadContext) {
    if (!state.results) return;
    var thread = threadContext && threadContext.thread ? threadContext.thread : null;
    var artifacts = collectReopenableArtifacts(thread);
    state.results.root.hidden = !artifacts.length;
    state.results.list.innerHTML = '';

    if (!artifacts.length) {
      state.results.count.textContent = '';
      return;
    }

    state.results.count.textContent = artifacts.length === 1 ? '1 result' : artifacts.length + ' results';
    var activeKey = thread && thread.ui && thread.ui.selectedArtifactKey
      ? thread.ui.selectedArtifactKey
      : (thread && thread.artifactDrawer ? thread.artifactDrawer.selectedArtifactKey || null : null);
    artifacts.forEach(function (artifact) {
      state.results.list.appendChild(createResultChip(artifact, state.threadId, artifact.artifactKey === activeKey));
    });
  }

  function appendHeaderMeta(container, className, value) {
    if (!value) return;
    container.appendChild(createMetaLabel(className, value));
  }

  function rerenderActiveThread(state) {
    if (
      !state ||
      !state.threadId ||
      !window.__tribexAiState ||
      typeof window.__tribexAiState.getThreadContext !== 'function'
    ) {
      return;
    }

    var threadContext = window.__tribexAiState.getThreadContext(state.threadId);
    if (!threadContext || !threadContext.thread) return;
    renderThread(state, threadContext);
  }

  function createDevToggle(state) {
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ai-thread-dev-toggle' + (state.showRawResponses ? ' is-active' : '');
    toggle.textContent = 'Raw responses';
    toggle.title = state.showRawResponses ? 'Showing raw assistant response text' : 'Show raw assistant response text';
    toggle.setAttribute('aria-pressed', state.showRawResponses ? 'true' : 'false');
    toggle.addEventListener('click', function () {
      state.showRawResponses = !state.showRawResponses;
      rerenderActiveThread(state);
    });
    return toggle;
  }

  function createRenameButton(state) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-thread-rename-button';
    button.textContent = 'Rename';
    button.title = 'Rename this chat';
    button.addEventListener('click', function () {
      if (
        !window.__tribexAiState ||
        typeof window.__tribexAiState.openThreadRename !== 'function' ||
        !state.threadId
      ) {
        return;
      }
      window.__tribexAiState.openThreadRename(state.threadId).catch(function () {});
    });
    return button;
  }

  function updateHeader(state, threadContext) {
    var headerState = state.header;
    headerState.breadcrumb.textContent = [
      threadContext.organization && threadContext.organization.name,
      threadContext.project && threadContext.project.name,
    ].filter(Boolean).join(' / ') || ((threadContext.organization && threadContext.organization.name) || 'Hosted organization');

    headerState.title.textContent = (threadContext.thread && threadContext.thread.title) || 'Thread';

    headerState.statusRow.innerHTML = '';
    if (threadContext.thread && threadContext.thread.persona) {
      appendHeaderMeta(
        headerState.statusRow,
        'ai-thread-status-pill',
        threadContext.thread.persona.displayName
        || threadContext.thread.persona.name
        || threadContext.thread.persona.key
        || 'Persona'
      );
    }

    appendHeaderMeta(
      headerState.statusRow,
      'ai-thread-status-pill',
      threadContext.streamStatus ? 'Stream ' + window.__tribexAiUtils.titleCase(threadContext.streamStatus) : null
    );
    appendHeaderMeta(
      headerState.statusRow,
      'ai-thread-status-pill',
      threadContext.relayStatus ? 'Relay ' + window.__tribexAiUtils.titleCase(threadContext.relayStatus) : null
    );
    appendHeaderMeta(
      headerState.statusRow,
      'ai-thread-status-pill ai-thread-status-time',
      threadContext.thread && threadContext.thread.lastActivityAt
        ? window.__tribexAiUtils.formatRelativeTime(threadContext.thread.lastActivityAt)
        : null
    );

    if (
      state.threadId &&
      window.__tribexAiState &&
      typeof window.__tribexAiState.openThreadRename === 'function'
    ) {
      headerState.statusRow.appendChild(createRenameButton(state));
    }

    if (isDevModeEnabled()) {
      headerState.statusRow.appendChild(createDevToggle(state));
    }
  }

  function getScrollHost(container) {
    return container.closest('.session-scroll') || container;
  }

  function isNearBottom(scrollHost) {
    var remaining = (scrollHost.scrollHeight || 0) - ((scrollHost.scrollTop || 0) + (scrollHost.clientHeight || 0));
    return remaining < 72;
  }

  function scrollToBottom(scrollHost) {
    var max = Math.max(0, (scrollHost.scrollHeight || 0) - (scrollHost.clientHeight || 0));
    if (typeof scrollHost.scrollTo === 'function') {
      scrollHost.scrollTo({ top: max, behavior: 'auto' });
    }
    scrollHost.scrollTop = max;
  }

  function updateJumpButton(state, visible) {
    if (!state.jumpButton) return;
    state.jumpButton.hidden = !visible;
    state.jumpButton.classList.toggle('is-visible', !!visible);
  }

  function clearLiveTick(state) {
    if (!state || !state.liveTickId) return;
    window.clearTimeout(state.liveTickId);
    state.liveTickId = null;
  }

  function hasLiveRunState(threadContext) {
    if (!threadContext) return false;
    if (threadContext.pending || threadContext.loading) return true;
    var runs = threadContext.thread && Array.isArray(threadContext.thread.runs)
      ? threadContext.thread.runs
      : [];
    return runs.some(function (run) {
      return !!(
        run &&
        ((run.answer && run.answer.isStreaming) ||
        (run.workSession && run.workSession.status === 'running'))
      );
    });
  }

  function isThreadTurnBusy(threadContext) {
    if (!threadContext) return false;
    if (threadContext.pending) return true;
    var activeTurnStatus = threadContext.thread && threadContext.thread.activeTurn
      ? String(threadContext.thread.activeTurn.status || '').toLowerCase()
      : '';
    if (activeTurnStatus === 'queued' || activeTurnStatus === 'running') return true;
    var runs = threadContext.thread && Array.isArray(threadContext.thread.runs)
      ? threadContext.thread.runs
      : [];
    return runs.some(function (run) {
      return !!(
        run &&
        ((run.answer && run.answer.isStreaming) ||
        (run.workSession && run.workSession.status === 'running'))
      );
    });
  }

  function scheduleLiveTick(state) {
    if (!state || state.liveTickId || !state.threadId) return;
    state.liveTickId = window.setTimeout(function () {
      state.liveTickId = null;
      if (!window.__tribexAiState || typeof window.__tribexAiState.getThreadContext !== 'function' || !state.threadId) {
        return;
      }
      var nextContext = window.__tribexAiState.getThreadContext(state.threadId);
      if (!nextContext || !nextContext.thread) {
        return;
      }
      renderThread(state, nextContext);
    }, 1000);
  }

  function ensureShell(container) {
    var state = container.__tribexAiThreadState;
    if (state) return state;

    var scrollHost = getScrollHost(container);
    var view = document.createElement('div');
    view.className = 'ai-view ai-thread-view';

    var header = createHeaderShell();
    view.appendChild(header.root);

    var alerts = document.createElement('div');
    alerts.className = 'ai-thread-alerts';
    view.appendChild(alerts);

    var results = createResultsShell();
    view.appendChild(results.root);

    var layout = document.createElement('div');
    layout.className = 'ai-thread-layout';
    view.appendChild(layout);

    var interruptDock = document.createElement('div');
    interruptDock.className = 'ai-interrupt-turn-dock';
    layout.appendChild(interruptDock);

    var transcript = document.createElement('section');
    transcript.className = 'ai-chat-log ai-chat-log-standalone ai-run-log';
    layout.appendChild(transcript);

    var jumpButton = document.createElement('button');
    jumpButton.className = 'ai-jump-latest';
    jumpButton.type = 'button';
    jumpButton.textContent = 'Jump to latest';
    jumpButton.hidden = true;
    jumpButton.addEventListener('click', function () {
      updateJumpButton(state, false);
      scrollToBottom(scrollHost);
    });
    view.appendChild(jumpButton);

    var interrupt = document.createElement('button');
    interrupt.className = 'ai-interrupt-turn';
    interrupt.type = 'button';
    interrupt.textContent = 'Interrupt Agent';
    interrupt.hidden = true;
    interrupt.addEventListener('click', function () {
      if (!state.threadId || !window.__tribexAiState || typeof window.__tribexAiState.interruptThread !== 'function') return;
      interrupt.disabled = true;
      Promise.resolve(window.__tribexAiState.interruptThread(state.threadId)).finally(function () {
        interrupt.disabled = false;
        if (state.textarea && typeof state.textarea.focus === 'function') {
          state.textarea.focus();
        }
      });
    });
    interruptDock.appendChild(interrupt);

    var composer = document.createElement('section');
    composer.className = 'ai-composer-shell';

    var textarea = document.createElement('textarea');
    textarea.className = 'ai-composer-input';
    textarea.placeholder = 'Ask the hosted sandbox to do something...';
    composer.appendChild(textarea);

    var footer = document.createElement('div');
    footer.className = 'ai-composer-footer';

    var hint = document.createElement('div');
    hint.className = 'ai-composer-hint';
    hint.textContent = 'Cmd/Ctrl+Enter to send';
    footer.appendChild(hint);

    var actions = document.createElement('div');
    actions.className = 'ai-actions-row';

    var refresh = document.createElement('button');
    refresh.className = 'ai-secondary-btn';
    refresh.type = 'button';
    refresh.textContent = 'Refresh';
    refresh.addEventListener('click', function () {
      window.__tribexAiState.refreshActiveThread();
    });
    actions.appendChild(refresh);

    var primary = document.createElement('button');
    primary.className = 'ai-primary-btn';
    primary.type = 'button';
    primary.addEventListener('click', function () {
      if (!state.threadId) return;
      var prompt = textarea.value;
      window.__tribexAiState.submitPrompt(state.threadId, prompt).then(function (submitted) {
        if (submitted) textarea.value = '';
      });
    });
    actions.appendChild(primary);

    footer.appendChild(actions);
    composer.appendChild(footer);
    view.appendChild(composer);

    textarea.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !primary.disabled) {
        primary.click();
      }
    });

    textarea.addEventListener('input', function (event) {
      if (
        state.threadId &&
        window.__tribexAiState &&
        typeof window.__tribexAiState.setThreadDraft === 'function'
      ) {
        window.__tribexAiState.setThreadDraft(state.threadId, event.target.value);
      }
    });

    scrollHost.addEventListener('scroll', function () {
      if (
        state.threadId &&
        window.__tribexAiState &&
        typeof window.__tribexAiState.rememberThreadScroll === 'function'
      ) {
        window.__tribexAiState.rememberThreadScroll(state.threadId, {
          scrollTop: scrollHost.scrollTop || 0,
          wasNearBottom: isNearBottom(scrollHost),
        });
      }
      if (isNearBottom(scrollHost)) {
        updateJumpButton(state, false);
      }
    });

    container.innerHTML = '';
    container.appendChild(view);

    state = {
      container: container,
      scrollHost: scrollHost,
      view: view,
      header: header,
      alerts: alerts,
      results: results,
      layout: layout,
      transcript: transcript,
      jumpButton: jumpButton,
      interruptDock: interruptDock,
      interrupt: interrupt,
      composer: composer,
      textarea: textarea,
      hint: hint,
      primary: primary,
      lastModeSignature: null,
      threadId: null,
      lastRenderedThreadId: null,
      workSessionOpen: {},
      inlineResultOpen: {},
      showRawResponses: false,
      liveTickId: null,
    };

    container.__tribexAiThreadState = state;
    return state;
  }

  function updateAlerts(state, threadContext) {
    state.alerts.innerHTML = '';
    if (threadContext.error) {
      var error = document.createElement('section');
      error.className = 'ai-inline-alert ai-inline-alert-warning';
      error.innerHTML = '<div><strong>Thread needs attention</strong><p>' + threadContext.error + '</p></div>';
      state.alerts.appendChild(error);
    }
  }

  function updateLegacyTranscript(state, model) {
    var signature = JSON.stringify(model.blocks.map(function (block) {
      return [block.type, block.message && block.message.id, block.message && block.message.content, block.message && block.message.toolName];
    }).concat([[state.showRawResponses ? 'raw' : 'rendered']]));
    if (state.lastModeSignature === 'legacy:' + signature) return false;

    if (state.lastModeSignature && state.lastModeSignature.indexOf('groups:') === 0) {
      state.transcript.innerHTML = '';
    }

    state.transcript.innerHTML = '';

    if (!model.blocks.length) {
      var empty = document.createElement('div');
      empty.className = 'ai-thread-empty';
      empty.innerHTML = '<strong>No messages yet</strong><p>Start the conversation and the hosted thread will appear here.</p>';
      state.transcript.appendChild(empty);
    } else {
      model.blocks.forEach(function (block) {
        if (block.type === 'chat') {
          if (block.message.role === 'user') {
            state.transcript.appendChild(createPromptBlock(block.message, 1, block.message.createdAt || null));
          } else {
            state.transcript.appendChild(createRunAnswer({
              content: block.message.content || '',
              createdAt: block.message.createdAt || null,
              isStreaming: !!block.message.isStreaming,
            }, state));
          }
          return;
        }

        if (block.type === 'artifact') {
          state.transcript.appendChild(createArtifactReopenItem(block.message, state.threadId));
          return;
        }

        state.transcript.appendChild(createToolNote(block.message));
      });
    }

    state.lastModeSignature = 'legacy:' + signature;
    return true;
  }

  function syncRunGroups(state, groups) {
    var used = {};
    var changed = false;

    if (state.lastModeSignature && state.lastModeSignature.indexOf('legacy:') === 0) {
      state.transcript.innerHTML = '';
      changed = true;
    }

    if (!groups.length) {
      if (!state.transcript.querySelector('.ai-thread-empty')) {
        state.transcript.innerHTML = '';
        var empty = document.createElement('div');
        empty.className = 'ai-thread-empty';
        empty.innerHTML = '<strong>No messages yet</strong><p>Start the conversation and the hosted thread will appear here.</p>';
        state.transcript.appendChild(empty);
        changed = true;
      }
      return changed;
    }

    var emptyState = state.transcript.querySelector('.ai-thread-empty');
    if (emptyState) {
      emptyState.parentNode.removeChild(emptyState);
      changed = true;
    }

    groups.forEach(function (group, index) {
      var selector = '.ai-run-group[data-run-id="' + group.id.replace(/"/g, '\\"') + '"]';
      var existing = state.transcript.querySelector(selector);
      var node = existing;

      if (!existing) {
        node = createRunGroupElement(group, state);
        changed = true;
      } else if (existing.getAttribute('data-run-signature') !== group.signature) {
        node = createRunGroupElement(group, state);
        state.transcript.replaceChild(node, existing);
        changed = true;
      }

      used[group.id] = true;
      if (state.transcript.children[index] !== node) {
        state.transcript.insertBefore(node, state.transcript.children[index] || null);
        changed = true;
      }
    });

    Array.from(state.transcript.querySelectorAll('.ai-run-group')).forEach(function (node) {
      var id = node.getAttribute('data-run-id');
      if (!used[id]) {
        node.parentNode.removeChild(node);
        changed = true;
      }
    });

    var modeSignature = 'groups:' + JSON.stringify(groups.map(function (group) {
      return [group.id, group.signature];
    }));
    state.lastModeSignature = modeSignature;
    return changed;
  }

  function updateTranscript(state, threadContext) {
    var runtimeRuns = threadContext.thread && Array.isArray(threadContext.thread.runs)
      ? threadContext.thread.runs
      : null;
    var model = runtimeRuns
      ? {
        mode: 'groups',
        groups: runtimeRuns.map(function (group, index) {
          return Object.assign({}, group, {
            signature: JSON.stringify({
              displayMode: state.showRawResponses ? 'raw' : 'rendered',
              id: group.id,
              turnId: group.turnId,
              prompt: group.user && group.user.content,
              answer: group.answer ? [group.answer.content, group.answer.isStreaming] : null,
              inlineResults: group.answer && Array.isArray(group.answer.inlineResults)
                ? group.answer.inlineResults.map(function (item) {
                  return [
                    item.id,
                    item.contentType || item.resultContentType || item.toolName,
                    item.resultData && item.resultData.title,
                    item.resultData && item.resultData.body,
                    item.updatedAt || item.createdAt,
                  ];
                })
                : [],
              workSession: group.workSession
                ? {
                  status: group.workSession.status,
                  startedAt: group.workSession.startedAt,
                  endedAt: group.workSession.endedAt,
                  liveRenderBucket: group.workSession.status === 'running'
                    ? Math.floor(Date.now() / 1000)
                    : null,
                  items: (group.workSession.items || []).map(function (item) {
                    return [
                      item.id,
                      item.title,
                      item.status,
                      item.detail,
                      item.artifactKey,
                      item.updatedAt,
                    ];
                  }),
                }
                : null,
              index: index,
            }),
          });
        }),
      }
      : buildRunGroups(
        (threadContext.thread && (threadContext.thread.displayMessages || threadContext.thread.messages)) || [],
        state.showRawResponses,
      );
    if (model.mode === 'legacy') {
      return updateLegacyTranscript(state, model);
    }
    return syncRunGroups(state, model.groups || []);
  }

  function updateComposer(state, threadContext, threadChanged) {
    var nextThreadId = threadContext.thread && threadContext.thread.id ? threadContext.thread.id : null;
    var busy = isThreadTurnBusy(threadContext);
    state.threadId = nextThreadId;
    state.textarea.value = threadContext.thread && threadContext.thread.ui
      ? (threadContext.thread.ui.draftText || '')
      : '';
    state.view.classList.toggle('ai-thread-turn-busy', busy);
    state.composer.classList.toggle('is-context-mode', busy);
    state.composer.removeAttribute('aria-hidden');
    if ('inert' in state.composer) state.composer.inert = false;
    state.interruptDock.hidden = !busy;
    state.interrupt.hidden = !busy;
    state.interrupt.disabled = !busy;
    state.textarea.disabled = false;
    state.primary.disabled = false;
    state.primary.textContent = busy ? 'Add context' : 'Send';
    state.hint.textContent = busy
      ? 'The AI is still working. Your prompt will be added to the chat context and it will take it into account as it continues.'
      : 'Cmd/Ctrl+Enter to send';
  }

  function restoreThreadScroll(state, threadContext, threadChanged) {
    var threadUi = threadContext.thread && threadContext.thread.ui ? threadContext.thread.ui : null;
    if (!threadChanged) return;

    if (threadUi && threadUi.wasNearBottom === false && typeof threadUi.scrollTop === 'number') {
      state.scrollHost.scrollTop = threadUi.scrollTop;
      updateJumpButton(state, true);
      return;
    }

    scrollToBottom(state.scrollHost);
    updateJumpButton(state, false);
  }

  function renderThread(state, threadContext) {
    var nextThreadId = threadContext.thread && threadContext.thread.id ? threadContext.thread.id : null;
    var threadChanged = state.threadId !== nextThreadId;
    if (
      threadChanged &&
      state.threadId &&
      window.__tribexAiState &&
      typeof window.__tribexAiState.rememberThreadScroll === 'function'
    ) {
      window.__tribexAiState.rememberThreadScroll(state.threadId, {
        scrollTop: state.scrollHost.scrollTop || 0,
        wasNearBottom: isNearBottom(state.scrollHost),
      });
    }
    var wasNearBottom = threadChanged ? true : isNearBottom(state.scrollHost);
    var beforeHeight = state.scrollHost.scrollHeight || 0;

    state.threadId = nextThreadId;
    updateHeader(state, threadContext);
    updateAlerts(state, threadContext);
    updateResultsShelf(state, threadContext);
    var changed = updateTranscript(state, threadContext);
    updateComposer(state, threadContext, threadChanged);

    var afterHeight = state.scrollHost.scrollHeight || beforeHeight;
    var contentGrew = afterHeight > beforeHeight || threadContext.pending || threadContext.loading;

    if (threadChanged) {
      restoreThreadScroll(state, threadContext, threadChanged);
    } else if (wasNearBottom) {
      scrollToBottom(state.scrollHost);
      updateJumpButton(state, false);
    } else if (changed && (contentGrew || !wasNearBottom)) {
      updateJumpButton(state, true);
    }

    state.lastRenderedThreadId = nextThreadId;
    clearLiveTick(state);
    if (hasLiveRunState(threadContext)) {
      scheduleLiveTick(state);
    }
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.tribex_ai_thread = function renderTribexAiThread(container, data, meta, toolArgs) {
    var aiState = window.__tribexAiState;
    var threadId = toolArgs && toolArgs.threadId;
    if (!aiState || !threadId) {
      container.textContent = 'Thread context is unavailable.';
      return;
    }

    var threadContext = aiState.getThreadContext(threadId);
    if (!threadContext || !threadContext.thread) {
      container.textContent = 'Unable to load the selected thread.';
      return;
    }

    var state = ensureShell(container);
    renderThread(state, threadContext);
  };
})();
