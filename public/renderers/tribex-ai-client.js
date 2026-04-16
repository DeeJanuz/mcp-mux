// @ts-nocheck
/* TribeX AI client — first-party ProPaasAI transport and normalization helpers */

(function () {
  'use strict';

  function invoke(command, args) {
    if (!window.__TAURI__ || !window.__TAURI__.core || typeof window.__TAURI__.core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri API is unavailable.'));
    }
    return window.__TAURI__.core.invoke(command, args || {});
  }

  function pickFirst(values, fallback) {
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return fallback;
  }

  function extractArray(value, keys) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(value[keys[i]])) return value[keys[i]];
    }
    if (value.data && Array.isArray(value.data)) return value.data;
    if (value.items && Array.isArray(value.items)) return value.items;
    if (value.results && Array.isArray(value.results)) return value.results;
    return [];
  }

  function stringifyContent(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      return value.map(stringifyContent).filter(Boolean).join('\n');
    }
    if (typeof value === 'object') {
      return pickFirst([
        value.text,
        value.content,
        value.body,
        value.message,
        value.summary,
      ], '');
    }
    return '';
  }

  function stripCodeFence(value) {
    var trimmed = String(value || '').trim();
    var fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
  }

  function parseEmbeddedCompanionPayload(value) {
    if (typeof value !== 'string') return null;
    var trimmed = stripCodeFence(value);
    if (!trimmed || trimmed.charAt(0) !== '{' || trimmed.charAt(trimmed.length - 1) !== '}') {
      return null;
    }

    try {
      var parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      if (!parsed.toolName && !parsed.tool_name) return null;
      if (
        parsed.result === undefined &&
        parsed.reviewRequired === undefined &&
        parsed.timeout === undefined &&
        parsed.toolArgs === undefined &&
        parsed.tool_args === undefined
      ) {
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function pickString(values) {
    for (var i = 0; i < values.length; i++) {
      if (typeof values[i] === 'string') return values[i];
    }
    return null;
  }

  function isAssistantDeltaPayload(raw) {
    if (!raw || typeof raw !== 'object') return false;
    var companionToolName = String(pickFirst([raw.toolName, raw.tool_name], '')).toLowerCase();
    if (
      companionToolName &&
      companionToolName !== 'assistant_delta' &&
      companionToolName !== 'assistant-delta'
    ) {
      return false;
    }

    var type = String(pickFirst([
      raw.type,
      raw.event,
      raw.kind,
      getNestedValue(raw, ['result', 'meta', 'event']),
      getNestedValue(raw, ['result', 'meta', 'type']),
    ], '')).toLowerCase();

    if (
      type === 'assistant_delta' ||
      type === 'assistant-delta' ||
      type === 'assistant.token' ||
      type === 'assistant_token' ||
      type === 'message.delta' ||
      type === 'response.output_text.delta' ||
      type === 'delta' ||
      type === 'token' ||
      type === 'chunk' ||
      type === 'partial'
    ) {
      return true;
    }

    if (
      raw.partial === true ||
      raw.streaming === true ||
      raw.isDelta === true ||
      raw.append === true ||
      getNestedValue(raw, ['result', 'meta', 'partial']) === true ||
      getNestedValue(raw, ['result', 'meta', 'streaming']) === true
    ) {
      return true;
    }

    return !!pickString([
      raw.delta,
      raw.token,
      raw.textDelta,
      raw.contentDelta,
      raw.partialText,
      getNestedValue(raw, ['message', 'delta']),
      getNestedValue(raw, ['message', 'token']),
      getNestedValue(raw, ['result', 'data', 'delta']),
      getNestedValue(raw, ['result', 'data', 'token']),
      getNestedValue(raw, ['result', 'data', 'textDelta']),
      getNestedValue(raw, ['result', 'data', 'contentDelta']),
      getNestedValue(raw, ['result', 'data', 'partialText']),
    ]);
  }

  function extractStreamingContent(raw) {
    return pickString([
      raw.delta,
      raw.token,
      raw.textDelta,
      raw.contentDelta,
      raw.partialText,
      getNestedValue(raw, ['message', 'delta']),
      getNestedValue(raw, ['message', 'token']),
      getNestedValue(raw, ['result', 'data', 'delta']),
      getNestedValue(raw, ['result', 'data', 'token']),
      getNestedValue(raw, ['result', 'data', 'textDelta']),
      getNestedValue(raw, ['result', 'data', 'contentDelta']),
      getNestedValue(raw, ['result', 'data', 'partialText']),
    ]);
  }

  function normalizeTimestamp(value) {
    if (!value) return null;
    var ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  function titleCaseWords(value) {
    return String(value || '')
      .replace(/[._-]+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (match) {
        return match.toUpperCase();
      });
  }

  function getNestedValue(value, path) {
    var current = value;
    for (var i = 0; i < path.length; i++) {
      if (!current || typeof current !== 'object') return null;
      current = current[path[i]];
    }
    return current === undefined ? null : current;
  }

  function deriveToolSummary(raw) {
    var explicit = pickFirst([
      raw.summary,
      getNestedValue(raw, ['result', 'data', 'summary']),
      getNestedValue(raw, ['result', 'meta', 'summary']),
    ], '');
    if (explicit) return explicit;

    var phase = String(pickFirst([
      getNestedValue(raw, ['result', 'meta', 'phase']),
      raw.status,
      raw.state,
    ], '')).toLowerCase();

    if (phase === 'started') return 'Starting hosted execution';
    if (phase === 'session-created') return 'Connected hosted session';
    if (phase === 'completed') return 'Hosted execution completed';
    if (phase === 'failed') return 'Hosted execution failed';

    var toolName = String(pickFirst([raw.toolName, raw.tool_name, raw.name], 'tool'));
    var tail = toolName.split('.').pop() || toolName;
    return titleCaseWords(tail || 'tool event');
  }

  function extractToolResultData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.result && typeof raw.result === 'object' && !Array.isArray(raw.result) && Object.prototype.hasOwnProperty.call(raw.result, 'data')) {
      return raw.result.data;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'resultData')) {
      return raw.resultData;
    }
    return Object.prototype.hasOwnProperty.call(raw, 'result') ? raw.result : null;
  }

  function extractToolResultMeta(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.result && typeof raw.result === 'object' && !Array.isArray(raw.result) && raw.result.meta && typeof raw.result.meta === 'object') {
      return raw.result.meta;
    }
    return getNestedValue(raw, ['resultMeta']) || null;
  }

  function formatStructuredDetail(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map(function (item) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          return String(item);
        }
        try {
          return JSON.stringify(item, null, 2);
        } catch (_error) {
          return '';
        }
      }).filter(Boolean).join('\n');
    }

    var textual = stringifyContent(value);
    if (textual) return textual;

    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return '';
    }
  }

  function deriveToolDetail(raw) {
    var resultData = extractToolResultData(raw);
    var explicit = pickFirst([
      raw.detail,
      raw.body,
      raw.description,
      getNestedValue(raw, ['result', 'data', 'error']),
      getNestedValue(raw, ['result', 'data', 'assistantContentPreview']),
      getNestedValue(raw, ['result', 'data', 'detail']),
      getNestedValue(raw, ['result', 'meta', 'detail']),
    ], '');
    if (explicit) return stringifyContent(explicit);

    var phase = String(getNestedValue(raw, ['result', 'meta', 'phase']) || '').toLowerCase();
    var contentLength = getNestedValue(raw, ['result', 'data', 'contentLength']);
    if (phase === 'started' && typeof contentLength === 'number') {
      return 'Submitting ' + contentLength + ' characters to the hosted runtime.';
    }

    var formatted = formatStructuredDetail(resultData);
    if (formatted) return formatted;

    return '';
  }

  function shouldPreviewCompanionPayload(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.reviewRequired) return true;
    var toolName = String(raw.toolName || raw.tool_name || '').trim();
    if (!toolName) return false;
    var normalizedToolName = toolName.toLowerCase();
    if (
      normalizedToolName === 'assistant_delta' ||
      normalizedToolName === 'assistant-delta'
    ) {
      return false;
    }
    var explicitStandalonePreview = !!(
      getNestedValue(raw, ['meta', 'autoFocus']) === true ||
      getNestedValue(raw, ['meta', 'previewPane']) === true ||
      getNestedValue(raw, ['meta', 'standalonePreview']) === true ||
      getNestedValue(raw, ['result', 'meta', 'autoFocus']) === true ||
      getNestedValue(raw, ['result', 'meta', 'previewPane']) === true ||
      getNestedValue(raw, ['result', 'meta', 'standalonePreview']) === true
    );
    var threadScoped = !!(
      getNestedValue(raw, ['toolArgs', 'threadId']) ||
      getNestedValue(raw, ['toolArgs', 'thread_id']) ||
      getNestedValue(raw, ['threadId']) ||
      getNestedValue(raw, ['thread_id']) ||
      getNestedValue(raw, ['meta', 'threadId']) ||
      getNestedValue(raw, ['result', 'meta', 'threadId'])
    );

    if (threadScoped && toolName === 'rich_content' && !explicitStandalonePreview) {
      return false;
    }

    return explicitStandalonePreview || /^[a-z0-9_]+$/i.test(toolName);
  }

  function normalizeOrganization(raw, index) {
    raw = raw || {};
    var id = pickFirst([raw.id, raw.organizationId, raw.orgId], 'organization-' + index);
    return {
      id: id,
      name: pickFirst([raw.name, raw.title, raw.slug], 'Organization'),
      slug: pickFirst([raw.slug, raw.name && String(raw.name).toLowerCase().replace(/\s+/g, '-')], id),
      role: pickFirst([raw.role, raw.membershipRole], null),
    };
  }

  function normalizeWorkspace(raw, organizationId, index) {
    raw = raw || {};
    var id = pickFirst([raw.id, raw.workspaceId], 'workspace-' + index);
    return {
      id: id,
      organizationId: pickFirst([raw.organizationId, raw.orgId], organizationId),
      name: pickFirst([raw.name, raw.title, raw.slug], 'Workspace'),
      slug: pickFirst([raw.slug, raw.name && String(raw.name).toLowerCase().replace(/\s+/g, '-')], id),
      packageKey: pickFirst([raw.packageKey, raw.package && raw.package.key], null),
      packageVersion: pickFirst([raw.packageVersion, raw.package && raw.package.version], null),
      packageName: pickFirst([raw.packageName, raw.package && raw.package.name, raw.persona], null),
      status: pickFirst([raw.status, raw.provisioningState, raw.state], null),
    };
  }

  function normalizePackage(raw, index) {
    raw = raw || {};
    var key = pickFirst([raw.key, raw.packageKey, raw.slug], 'package-' + index);
    return {
      id: pickFirst([raw.id, raw.packageId], key),
      key: key,
      name: pickFirst([raw.displayName, raw.name, raw.title], key),
      version: pickFirst([raw.version, raw.packageVersion], null),
      audience: pickFirst([raw.audience], null),
      lifecycle: pickFirst([raw.lifecycle, raw.status], null),
      default: !!pickFirst([raw.default, raw.defaultOffering], false),
    };
  }

  function normalizeProject(raw, workspace, index) {
    raw = raw || {};
    var id = pickFirst([raw.id, raw.projectId], 'project-' + index);
    return {
      id: id,
      workspaceId: pickFirst([raw.workspaceId, workspace && workspace.id], null),
      organizationId: pickFirst([raw.organizationId, raw.orgId, workspace && workspace.organizationId], null),
      name: pickFirst([raw.name, raw.title], 'Project'),
      summary: pickFirst([raw.summary, raw.description], ''),
      lastActivityAt: normalizeTimestamp(pickFirst([raw.lastActivityAt, raw.updatedAt, raw.createdAt], null)),
      status: pickFirst([raw.status, raw.state], null),
      workspaceName: workspace && workspace.name ? workspace.name : null,
    };
  }

  function normalizeThreadSummary(raw, project, index) {
    raw = raw || {};
    var id = pickFirst([raw.id, raw.threadId], 'thread-' + index);
    return {
      id: id,
      projectId: pickFirst([raw.projectId, project && project.id], null),
      workspaceId: pickFirst([raw.workspaceId, project && project.workspaceId], null),
      organizationId: pickFirst([raw.organizationId, raw.orgId, project && project.organizationId], null),
      title: pickFirst([raw.title, raw.name], 'Untitled thread'),
      preview: pickFirst([raw.preview, raw.summary, raw.lastMessagePreview, stringifyContent(raw.lastMessage)], ''),
      hydrateState: pickFirst([raw.hydrateState, raw.status, raw.state], null),
      lastActivityAt: normalizeTimestamp(pickFirst([raw.lastActivityAt, raw.latestMessageAt, raw.lastRunAt, raw.updatedAt, raw.createdAt], null)),
      workspaceName: pickFirst([raw.workspaceName, project && project.workspaceName], null),
      projectName: pickFirst([raw.projectName, project && project.name], null),
    };
  }

  function normalizeMessage(raw, index) {
    raw = raw || {};
    var nestedMessage = raw.message && typeof raw.message === 'object' ? raw.message : null;
    var source = nestedMessage || raw;
    var role = pickFirst([raw.role, raw.authorRole], null);
    if (!role) {
      role = pickFirst([source.role, source.authorRole], null);
    }
    if (!role) {
      var type = String(pickFirst([source.type, raw.type], '')).toLowerCase();
      if (type.indexOf('assistant') >= 0) role = 'assistant';
      else if (type.indexOf('user') >= 0) role = 'user';
      else if (type.indexOf('tool') >= 0) role = 'tool';
      else role = 'assistant';
    }

    var isStreamingAssistant = role === 'assistant' && isAssistantDeltaPayload(raw);
    var content = stringifyContent(pickFirst([
      isStreamingAssistant ? extractStreamingContent(raw) : null,
      source.content,
      raw.content,
      source.text,
      raw.text,
      source.body,
      raw.body,
      raw.message,
      source.delta,
      raw.delta,
      source.output,
      raw.output,
    ], ''));
    var embeddedPayload = !isStreamingAssistant ? parseEmbeddedCompanionPayload(content) : null;

    if (role === 'assistant' && embeddedPayload) {
      embeddedPayload.id = pickFirst([raw.id, source.id, embeddedPayload.id], 'message-' + index);
      embeddedPayload.createdAt = pickFirst([raw.createdAt, source.createdAt, embeddedPayload.createdAt], null);
      embeddedPayload.messageId = pickFirst([
        source.messageId,
        source.messageID,
        raw.messageId,
        raw.messageID,
        embeddedPayload.messageId,
      ], null);
      return normalizeMessage(embeddedPayload, index);
    }

    if (isStreamingAssistant) {
      return {
        id: pickFirst([source.id, raw.id, raw.eventId], 'message-' + index),
        role: 'assistant',
        content: content,
        messageId: pickFirst([
          source.messageId,
          source.messageID,
          raw.messageId,
          raw.messageID,
          getNestedValue(raw, ['result', 'data', 'messageId']),
        ], null),
        sessionId: pickFirst([source.sessionId, raw.sessionId], null),
        isStreaming: true,
        createdAt: normalizeTimestamp(pickFirst([
          source.createdAt,
          raw.createdAt,
          raw.timestamp,
        ], null)),
      };
    }

    if (role === 'tool' || raw.toolName || raw.tool_name) {
      return {
        id: pickFirst([raw.id, raw.eventId], 'message-' + index),
        role: 'tool',
        toolName: pickFirst([raw.toolName, raw.tool_name, raw.name], 'tool'),
        status: pickFirst([raw.status, raw.state], 'success'),
        summary: deriveToolSummary(raw),
        detail: deriveToolDetail(raw),
        toolArgs: raw.toolArgs || raw.tool_args || null,
        resultData: extractToolResultData(raw),
        resultMeta: extractToolResultMeta(raw),
        sequence: typeof raw.sequence === 'number' ? raw.sequence : null,
        createdAt: normalizeTimestamp(pickFirst([raw.createdAt, raw.timestamp], null)),
      };
    }

    return {
      id: pickFirst([source.id, raw.id, raw.eventId], 'message-' + index),
      role: role,
      content: content,
      messageId: pickFirst([
        source.messageId,
        source.messageID,
        raw.messageId,
        raw.messageID,
      ], null),
      sessionId: pickFirst([source.sessionId, raw.sessionId], null),
      isStreaming: isStreamingAssistant,
      createdAt: normalizeTimestamp(pickFirst([
        source.createdAt,
        raw.createdAt,
        source.timestamp,
        raw.timestamp,
      ], null)),
    };
  }

  function normalizeThreadDetail(raw) {
    raw = raw || {};
    var thread = raw.thread && typeof raw.thread === 'object' ? raw.thread : raw;
    var project = raw.project && typeof raw.project === 'object' ? raw.project : {};
    var workspace = raw.workspace && typeof raw.workspace === 'object' ? raw.workspace : {};
    var messages = extractArray(raw, ['messages', 'events', 'transcript', 'items']);
    if (!messages.length && thread !== raw) {
      messages = extractArray(thread, ['messages', 'events', 'transcript', 'items']);
    }
    if (!messages.length && raw.message) {
      messages = [raw.message];
    }

    return {
      id: pickFirst([thread.id, thread.threadId], null),
      projectId: pickFirst([thread.projectId, raw.projectId, project.id], null),
      workspaceId: pickFirst([thread.workspaceId, raw.workspaceId, project.workspaceId, workspace.id], null),
      title: pickFirst([thread.title, thread.name], 'Untitled thread'),
      status: pickFirst([thread.status, thread.state, raw.status], null),
      hydrateState: pickFirst([thread.hydrateState, raw.hydrateState], null),
      preview: pickFirst([thread.preview, thread.summary], ''),
      projectName: pickFirst([thread.projectName, project.name], null),
      workspaceName: pickFirst([thread.workspaceName, workspace.name], null),
      lastActivityAt: normalizeTimestamp(pickFirst([thread.lastActivityAt, thread.lastRunAt, thread.updatedAt, thread.createdAt], null)),
      messages: messages.map(function (message, index) {
        return normalizeMessage(message, index);
      }),
    };
  }

  function normalizeCompanionSession(raw) {
    raw = raw || {};
    var transport = raw.transport || raw.companionTransport || raw.session || raw.data || {};
    return {
      id: pickFirst([raw.id, raw.sessionId, transport.id], null),
      companionKey: pickFirst([
        raw.streamKey,
        raw.companionKey,
        raw.key,
        transport.streamKey,
        transport.companionKey,
        transport.key,
      ], null),
    };
  }

  var runtimeSessionsByThread = {};
  var relayCatalogExcludedToolNames = {
    init_session: true,
    mcpviews_setup: true,
    mcpviews_install_plugin: true,
    get_plugin_docs: true,
    get_plugin_prompt: true,
    list_registry: true,
    update_plugins: true,
    save_update_preference: true,
    start_plugin_auth: true,
    push_check: true,
    push_content: true,
  };

  function shouldPublishRelayTool(tool) {
    var name = tool && tool.name ? String(tool.name).trim() : '';
    if (!name) return false;
    return !relayCatalogExcludedToolNames[name];
  }

  function normalizeRelayTool(tool) {
    if (!tool || !tool.name) return null;
    var name = String(tool.name).trim();
    return {
      name: name,
      description: tool && tool.description ? String(tool.description) : '',
      inputSchema: tool && tool.inputSchema ? tool.inputSchema : null,
    };
  }

  function normalizeRelayConnectorTool(tool) {
    return normalizeRelayTool(tool);
  }

  function normalizeRelayConnector(connector) {
    if (!connector || !connector.key || !connector.label) return null;
    var tools = extractArray(connector.tools, ['tools']).map(function (tool) {
      return normalizeRelayConnectorTool(tool);
    }).filter(Boolean);
    var toolGroups = extractArray(connector.toolGroups, ['toolGroups']).map(function (group) {
      if (!group || !group.name) return null;
      return {
        name: String(group.name),
        hint: typeof group.hint === 'string' ? group.hint : '',
        tools: extractArray(group.tools, ['tools']).map(function (tool) {
          return normalizeRelayConnectorTool(tool);
        }).filter(Boolean),
      };
    }).filter(Boolean);

    return {
      key: String(connector.key),
      label: String(connector.label),
      description: typeof connector.description === 'string' ? connector.description : '',
      namespaces: Array.isArray(connector.namespaces) ? connector.namespaces.filter(Boolean).map(String) : [],
      capabilities: Array.isArray(connector.capabilities) ? connector.capabilities.filter(Boolean).map(String) : [],
      authState: typeof connector.authState === 'string' ? connector.authState : 'available',
      discoveryState: typeof connector.discoveryState === 'string' ? connector.discoveryState : 'breadcrumb',
      toolCount: typeof connector.toolCount === 'number' ? connector.toolCount : tools.length,
      tools: tools,
      toolGroups: toolGroups,
    };
  }

  function getNested(value, path) {
    var current = value;
    for (var i = 0; i < path.length; i += 1) {
      if (!current || typeof current !== 'object') return null;
      current = current[path[i]];
    }
    return current == null ? null : current;
  }

  function normalizePackageConnectors(packageManifest) {
    var initialConnectors = extractArray(
      getNested(packageManifest, ['bootstrapConfig', 'tools', 'initialConnectors']),
      ['initialConnectors'],
    );

    return initialConnectors.map(function (connector) {
      return normalizeRelayConnector(connector);
    }).filter(Boolean);
  }

  function normalizeConnectorHints(packageManifest) {
    var hints = extractArray(
      getNested(packageManifest, ['bootstrapConfig', 'workflowPack', 'connectorHints']),
      ['connectorHints'],
    );
    return hints.map(function (hint) {
      return String(hint || '').trim().toLowerCase();
    }).filter(Boolean);
  }

  function connectorMatchesHint(connector, hint) {
    if (!connector || !hint) return false;
    var candidates = []
      .concat(connector.key || [])
      .concat(connector.label || [])
      .concat(Array.isArray(connector.namespaces) ? connector.namespaces : [])
      .concat(Array.isArray(connector.capabilities) ? connector.capabilities : []);
    return candidates.some(function (candidate) {
      return String(candidate || '').toLowerCase().indexOf(hint) >= 0;
    });
  }

  function mergeConnectorBreadcrumb(base, discovered) {
    if (!base && !discovered) return null;
    var tools = [];
    var toolGroups = [];
    var seenTools = {};

    [base, discovered].forEach(function (connector) {
      if (!connector) return;
      (connector.tools || []).forEach(function (tool) {
        if (!tool || !tool.name || seenTools[tool.name]) return;
        seenTools[tool.name] = true;
        tools.push(tool);
      });
      (connector.toolGroups || []).forEach(function (group) {
        if (!group || !group.name) return;
        toolGroups.push(group);
      });
    });

    return {
      key: (base && base.key) || (discovered && discovered.key) || '',
      label: (base && base.label) || (discovered && discovered.label) || '',
      description: (discovered && discovered.description) || (base && base.description) || '',
      namespaces: Array.from(new Set([]
        .concat(base && base.namespaces ? base.namespaces : [])
        .concat(discovered && discovered.namespaces ? discovered.namespaces : []))),
      capabilities: Array.from(new Set([]
        .concat(base && base.capabilities ? base.capabilities : [])
        .concat(discovered && discovered.capabilities ? discovered.capabilities : []))),
      authState: (discovered && discovered.authState) || (base && base.authState) || 'available',
      discoveryState: (base && base.discoveryState) || (discovered && discovered.discoveryState) || 'breadcrumb',
      toolCount: (discovered && discovered.toolCount) || tools.length || (base && base.toolCount) || 0,
      tools: tools.slice(0, 3),
      toolGroups: toolGroups.slice(0, 3).map(function (group) {
        return Object.assign({}, group, {
          tools: (group.tools || []).slice(0, 4),
        });
      }),
    };
  }

  function buildPublishedConnectors(localConnectors, packageManifest) {
    var normalizedConnectors = (localConnectors || []).map(function (connector) {
      return normalizeRelayConnector(connector);
    }).filter(Boolean);
    var initialConnectors = normalizePackageConnectors(packageManifest);
    var connectorHints = normalizeConnectorHints(packageManifest);
    var connectorsByKey = {};

    normalizedConnectors.forEach(function (connector) {
      connectorsByKey[connector.key] = connector;
    });

    var selected = [];
    var selectedKeys = {};

    initialConnectors.forEach(function (connector) {
      var discovered = connectorsByKey[connector.key] || normalizedConnectors.find(function (candidate) {
        return connectorMatchesHint(candidate, connector.key);
      }) || null;
      var merged = mergeConnectorBreadcrumb(connector, discovered);
      if (!merged || !merged.key || selectedKeys[merged.key]) return;
      selectedKeys[merged.key] = true;
      selected.push(merged);
    });

    if (!selected.length && connectorHints.length) {
      normalizedConnectors.forEach(function (connector) {
        if (selected.length >= 4 || selectedKeys[connector.key]) return;
        if (!connectorHints.some(function (hint) { return connectorMatchesHint(connector, hint); })) return;
        selectedKeys[connector.key] = true;
        selected.push(mergeConnectorBreadcrumb(connector, connector));
      });
    }

    if (!selected.length) {
      normalizedConnectors.slice(0, 4).forEach(function (connector) {
        if (selectedKeys[connector.key]) return;
        selectedKeys[connector.key] = true;
        selected.push(mergeConnectorBreadcrumb(connector, connector));
      });
    }

    return selected;
  }

  function getCloudflareBridge() {
    if (!window.__tribexAiCloudflareBridge) {
      throw new Error('Cloudflare Agents bridge is unavailable.');
    }
    return window.__tribexAiCloudflareBridge;
  }

  function isExpiredTimestamp(value, safetyWindowMs) {
    if (!value) return true;
    var ms = Date.parse(value);
    if (Number.isNaN(ms)) return true;
    return ms <= Date.now() + (safetyWindowMs || 0);
  }

  function extractRuntimeText(parts) {
    if (!Array.isArray(parts)) return '';
    return parts
      .filter(function (part) {
        return part && part.type === 'text' && typeof part.text === 'string';
      })
      .map(function (part) {
        return part.text;
      })
      .join('');
  }

  function normalizeRuntimeUiMessage(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var role = pickFirst([raw.role], null);
    var text = extractRuntimeText(raw.parts);
    if ((role !== 'user' && role !== 'assistant') || !text) {
      return null;
    }

    return {
      id: pickFirst([raw.id], 'runtime-message-' + index),
      role: role,
      content: text,
      createdAt: normalizeTimestamp(pickFirst([
        raw.createdAt,
        raw.timestamp,
        raw.metadata && raw.metadata.createdAt,
      ], null)) || new Date().toISOString(),
    };
  }

  function normalizeRuntimeTranscript(threadId, runtimeMessages) {
    var rawMessages = extractArray(runtimeMessages, ['messages']);
    var messages = rawMessages.map(function (message, index) {
      return normalizeRuntimeUiMessage(message, index);
    }).filter(Boolean);
    var latest = messages.length ? messages[messages.length - 1] : null;

    return {
      id: threadId,
      messagesSource: 'runtime',
      rawRuntimeMessages: rawMessages,
      runtimeMessages: messages,
      messages: messages,
      preview: latest && latest.content ? latest.content : '',
      lastActivityAt: latest && latest.createdAt ? latest.createdAt : null,
    };
  }

  function normalizeRuntimeSessionEnvelope(raw) {
    raw = raw || {};
    return {
      thread: raw.thread || null,
      project: raw.project || null,
      workspace: raw.workspace || null,
      packageManifest: raw.packageManifest || null,
      runtimeSession: raw.runtimeSession || null,
      companionSession: raw.companionSession || null,
      relay: raw.relay || {},
    };
  }

  function storeRuntimeSession(threadId, envelope) {
    runtimeSessionsByThread[threadId] = envelope;
    return envelope;
  }

  function buildLocalRelayCatalog(envelope) {
    return invoke('get_local_mcp_catalog')
      .catch(function () {
        return listLocalMcpTools().then(function (tools) {
          return { connectors: [], tools: tools || [] };
        });
      })
      .then(function (catalog) {
        var tools = extractArray(catalog && catalog.tools, ['tools']).map(function (tool) {
          return normalizeRelayTool(tool);
        }).filter(function (tool) {
          return tool && shouldPublishRelayTool(tool);
        });

        return {
          connectors: buildPublishedConnectors(
            extractArray(catalog && catalog.connectors, ['connectors']),
            envelope && envelope.packageManifest ? envelope.packageManifest : null,
          ),
          tools: tools,
        };
      });
  }

  function fetchRuntimeSession(threadId, options) {
    return requestVariants('POST', [
      {
        path: '/threads/' + encodeURIComponent(threadId) + '/runtime-session',
        body: (options && options.body) || {},
      },
    ]).then(normalizeRuntimeSessionEnvelope);
  }

  function ensureRuntimeSession(threadId, options) {
    var forceRefresh = !!(options && options.forceRefresh);
    var existing = runtimeSessionsByThread[threadId];
    if (
      !forceRefresh &&
      existing &&
      existing.runtimeSession &&
      !isExpiredTimestamp(existing.runtimeSession.expiresAt, 30 * 1000)
    ) {
      return Promise.resolve(existing);
    }

    return fetchRuntimeSession(threadId, options).then(function (envelope) {
      return storeRuntimeSession(threadId, envelope);
    });
  }

  function connectAgentRuntime(threadId, envelope) {
    return getCloudflareBridge().connect({
      threadId: threadId,
      connection: envelope.runtimeSession && envelope.runtimeSession.connection,
    });
  }

  function ensureAgentRuntime(threadId, options) {
    return ensureRuntimeSession(threadId, options).then(function (envelope) {
      return buildLocalRelayCatalog(envelope).then(function (catalog) {
        var relaySessionId = envelope.relay && envelope.relay.bridge
          ? envelope.relay.bridge.relaySessionId
          : null;
        return publishDesktopRelayCatalog(relaySessionId, catalog).then(function (publishResult) {
          envelope.relay = envelope.relay || {};
          envelope.relay.catalog = publishResult.catalog || catalog;
          return connectAgentRuntime(threadId, envelope).then(function () {
            return envelope;
          });
        });
      });
    });
  }

  function syncThreadRuntime(threadId, options) {
    return ensureAgentRuntime(threadId, options).then(function (envelope) {
      return getCloudflareBridge().getMessages({
        threadId: threadId,
        connection: envelope.runtimeSession && envelope.runtimeSession.connection,
      }).then(function (messages) {
        return normalizeRuntimeTranscript(threadId, messages);
      });
    });
  }

  function listenToRuntimeEvents(threadId, handler) {
    return getCloudflareBridge().subscribe(threadId, handler);
  }

  function request(method, path, body, query) {
    return invoke('first_party_ai_request', {
      method: method,
      path: path,
      body: body || null,
      query: query || null,
    });
  }

  function relayRequest(method, path, body, query) {
    return invoke('first_party_ai_relay_request', {
      method: method,
      path: path,
      body: body || null,
      query: query || null,
    });
  }

  function listLocalMcpTools() {
    return invoke('list_local_mcp_tools');
  }

  function callLocalMcpTool(name, toolArgs) {
    return invoke('call_local_mcp_tool', {
      name: name,
      arguments: toolArgs || {},
    });
  }

  function requestCandidates(method, candidates, body, query) {
    var lastError = null;
    var sequence = Promise.reject(new Error('No request candidates.'));
    candidates.forEach(function (candidate) {
      sequence = sequence.catch(function () {
        return request(method, candidate, body, query).catch(function (error) {
          lastError = error;
          throw error;
        });
      });
    });
    return sequence.catch(function () {
      throw lastError || new Error('Request failed.');
    });
  }

  function requestVariants(method, variants) {
    var lastError = null;
    var sequence = Promise.reject(new Error('No request variants.'));
    variants.forEach(function (variant) {
      sequence = sequence.catch(function () {
        return request(method, variant.path, variant.body || null, variant.query || null).catch(function (error) {
          lastError = error;
          throw error;
        });
      });
    });
    return sequence.catch(function () {
      throw lastError || new Error('Request failed.');
    });
  }

  function getConfig() {
    return invoke('get_first_party_ai_config');
  }

  function startAuth() {
    return invoke('start_first_party_ai_auth');
  }

  function clearAuth() {
    return invoke('clear_first_party_ai_auth');
  }

  function fetchSession() {
    return invoke('get_first_party_ai_session').then(function (session) {
      return session && typeof session === 'object' ? session : null;
    });
  }

  function sendMagicLink(email) {
    return invoke('send_first_party_ai_magic_link', {
      email: email,
    });
  }

  function verifyMagicLink(verificationUrlOrToken) {
    return invoke('verify_first_party_ai_magic_link', {
      verificationUrlOrToken: verificationUrlOrToken,
    });
  }

  function fetchOrganizations() {
    return requestCandidates('GET', [
      '/organizations',
    ]).then(function (raw) {
      return extractArray(raw, ['organizations', 'items', 'results']).map(function (item, index) {
        return normalizeOrganization(item, index);
      });
    });
  }

  function fetchPackages() {
    return requestCandidates('GET', [
      '/packages',
    ]).then(function (raw) {
      return extractArray(raw, ['packages', 'items', 'results']).map(function (item, index) {
        return normalizePackage(item, index);
      });
    });
  }

  function fetchWorkspaces(organizationId) {
    return requestCandidates('GET', [
      '/organizations/' + encodeURIComponent(organizationId) + '/workspaces',
    ]).then(function (raw) {
      return extractArray(raw, ['workspaces', 'items', 'results']).map(function (item, index) {
        return normalizeWorkspace(item, organizationId, index);
      });
    });
  }

  function createWorkspace(organizationId, name, packageKey) {
    var body = {
      name: String(name || '').trim() || 'New workspace',
    };
    if (packageKey) body.packageKey = packageKey;

    return requestVariants('POST', [
      {
        path: '/organizations/' + encodeURIComponent(organizationId) + '/workspaces',
        body: body,
      },
    ]).then(function (raw) {
      return normalizeWorkspace(raw.workspace || raw, organizationId, 0);
    });
  }

  function fetchProjects(workspace) {
    return requestCandidates('GET', [
      '/workspaces/' + encodeURIComponent(workspace.id) + '/projects',
    ]).then(function (raw) {
      return extractArray(raw, ['projects', 'items', 'results']).map(function (item, index) {
        return normalizeProject(item, workspace, index);
      });
    });
  }

  function createProject(workspace, name) {
    return requestVariants('POST', [
      {
        path: '/workspaces/' + encodeURIComponent(workspace.id) + '/projects',
        body: { name: name || 'General' },
      },
    ]).then(function (raw) {
      return normalizeProject(raw.project || raw, workspace, 0);
    });
  }

  function fetchThreads(project) {
    return requestCandidates('GET', [
      '/projects/' + encodeURIComponent(project.id) + '/threads',
    ]).then(function (raw) {
      return extractArray(raw, ['threads', 'items', 'results']).map(function (item, index) {
        return normalizeThreadSummary(item, project, index);
      });
    });
  }

  function fetchThread(threadId) {
    return requestCandidates('GET', [
      '/threads/' + encodeURIComponent(threadId),
    ]).then(normalizeThreadDetail);
  }

  function createThread(projectId, title) {
    var threadTitle = String(title || 'New chat').trim() || 'New chat';
    return requestVariants('POST', [
      {
        path: '/projects/' + encodeURIComponent(projectId) + '/threads',
        body: { title: threadTitle },
      },
    ]).then(function (raw) {
      var summary = normalizeThreadSummary(raw.thread || raw, { id: projectId }, 0);
      if (!summary.title || summary.title === 'Untitled thread') summary.title = threadTitle;
      return summary;
    });
  }

  function buildSmokePrompt(smokeKey) {
    void smokeKey;
    return 'Please verify that the currently loaded rule and skill bundle is wired correctly for this workspace. Use the available validation tool to confirm the exact loaded rule and skill basenames, then summarize the result briefly for the operator.';
  }

  function sendMessage(threadId, prompt, options) {
    return ensureAgentRuntime(threadId, { forceRefresh: true }).then(function (envelope) {
      return getCloudflareBridge().startTurn({
        threadId: threadId,
        connection: envelope.runtimeSession && envelope.runtimeSession.connection,
        relayBridge: envelope.relay && envelope.relay.bridge ? envelope.relay.bridge : null,
        relayCatalog: envelope.relay && envelope.relay.catalog ? envelope.relay.catalog : null,
        prompt: prompt,
        validationProfile: options && options.validationProfile ? options.validationProfile : null,
        turnId: options && options.turnId ? options.turnId : null,
      });
    });
  }

  function runSmokeTest(threadId, smokeKey) {
    var validationProfile = smokeKey || 'rule-skill-echo';
    return sendMessage(threadId, buildSmokePrompt(validationProfile), {
      validationProfile: validationProfile,
    });
  }

  function createCompanionSession(workspaceId, threadId) {
    return requestVariants('POST', [
      {
        path: '/workspaces/' + encodeURIComponent(workspaceId) + '/companion-sessions',
        body: {
          threadId: threadId || undefined,
          metadata: {},
        },
      },
    ]).then(normalizeCompanionSession);
  }

  function startCompanionStream(threadId, companionKey) {
    return invoke('start_first_party_ai_companion_stream', {
      threadId: threadId,
      companionKey: companionKey,
    });
  }

  function stopCompanionStream(threadId) {
    return invoke('stop_first_party_ai_companion_stream', {
      threadId: threadId,
    });
  }

  function registerDesktopRelay(body) {
    return invoke('register_first_party_ai_desktop_relay', {
      body: body || {},
    });
  }

  function refreshDesktopRelay(body) {
    return invoke('refresh_first_party_ai_desktop_relay', {
      body: body || {},
    });
  }

  function publishDesktopRelayCatalog(relaySessionId, catalog) {
    return Promise.resolve(catalog || null)
      .then(function (existingCatalog) {
        return existingCatalog || buildLocalRelayCatalog();
      })
      .then(function (resolvedCatalog) {
        return relayRequest('POST', '/api/desktop-relay/catalog', {
          relaySessionId: relaySessionId || undefined,
          connectors: resolvedCatalog.connectors || [],
          tools: resolvedCatalog.tools || [],
        }).then(function (response) {
          return Object.assign({}, response || {}, {
            catalog: resolvedCatalog,
          });
        });
      });
  }

  function startDesktopRelayStream(streamId, path, query) {
    return invoke('start_first_party_ai_desktop_relay_stream', {
      streamId: streamId,
      path: path || null,
      query: query || null,
    });
  }

  function stopDesktopRelayStream(streamId) {
    return invoke('stop_first_party_ai_desktop_relay_stream', {
      streamId: streamId,
    });
  }

  function startDesktopPresenceHeartbeat(heartbeatId, intervalSecs, body, path) {
    return invoke('start_first_party_ai_desktop_presence_heartbeat', {
      heartbeatId: heartbeatId,
      path: path || null,
      intervalSecs: intervalSecs,
      body: body || {},
    });
  }

  function stopDesktopPresenceHeartbeat(heartbeatId) {
    return invoke('stop_first_party_ai_desktop_presence_heartbeat', {
      heartbeatId: heartbeatId,
    });
  }

  function disconnectRuntime(threadId) {
    delete runtimeSessionsByThread[threadId];
    if (window.__tribexAiCloudflareBridge && typeof window.__tribexAiCloudflareBridge.disconnect === 'function') {
      window.__tribexAiCloudflareBridge.disconnect(threadId);
    }
  }

  function listenToStreamEvents(handler) {
    if (!window.__TAURI__ || !window.__TAURI__.event || typeof window.__TAURI__.event.listen !== 'function') {
      return Promise.resolve(function () {});
    }
    return window.__TAURI__.event.listen('first_party_ai_stream_event', function (event) {
      handler(event.payload || {});
    });
  }

  function listenToDesktopRelayEvents(handler) {
    if (!window.__TAURI__ || !window.__TAURI__.event || typeof window.__TAURI__.event.listen !== 'function') {
      return Promise.resolve(function () {});
    }
    return window.__TAURI__.event.listen('first_party_ai_desktop_relay_event', function (event) {
      handler(event.payload || {});
    });
  }

  function listenToDesktopPresenceEvents(handler) {
    if (!window.__TAURI__ || !window.__TAURI__.event || typeof window.__TAURI__.event.listen !== 'function') {
      return Promise.resolve(function () {});
    }
    return window.__TAURI__.event.listen('first_party_ai_desktop_presence_event', function (event) {
      handler(event.payload || {});
    });
  }

  window.__tribexAiClient = {
    clearAuth: clearAuth,
    createCompanionSession: createCompanionSession,
    createProject: createProject,
    createWorkspace: createWorkspace,
    createThread: createThread,
    buildSmokePrompt: buildSmokePrompt,
    fetchPackages: fetchPackages,
    fetchSession: fetchSession,
    fetchOrganizations: fetchOrganizations,
    fetchProjects: fetchProjects,
    fetchRuntimeSession: fetchRuntimeSession,
    fetchThread: fetchThread,
    fetchThreads: fetchThreads,
    fetchWorkspaces: fetchWorkspaces,
    getConfig: getConfig,
    ensureAgentRuntime: ensureAgentRuntime,
    listenToRuntimeEvents: listenToRuntimeEvents,
    listenToDesktopPresenceEvents: listenToDesktopPresenceEvents,
    listenToDesktopRelayEvents: listenToDesktopRelayEvents,
    listenToStreamEvents: listenToStreamEvents,
    normalizeThreadDetail: normalizeThreadDetail,
    normalizeRuntimeTranscript: normalizeRuntimeTranscript,
    normalizeRuntimeUiMessage: normalizeRuntimeUiMessage,
    normalizeThreadSummary: normalizeThreadSummary,
    normalizeMessage: normalizeMessage,
    request: request,
    relayRequest: relayRequest,
    listLocalMcpTools: listLocalMcpTools,
    callLocalMcpTool: callLocalMcpTool,
    disconnectRuntime: disconnectRuntime,
    requestCandidates: requestCandidates,
    publishDesktopRelayCatalog: publishDesktopRelayCatalog,
    refreshDesktopRelay: refreshDesktopRelay,
    registerDesktopRelay: registerDesktopRelay,
    runSmokeTest: runSmokeTest,
    sendMessage: sendMessage,
    sendMagicLink: sendMagicLink,
    shouldPreviewCompanionPayload: shouldPreviewCompanionPayload,
    startAuth: startAuth,
    startCompanionStream: startCompanionStream,
    startDesktopPresenceHeartbeat: startDesktopPresenceHeartbeat,
    startDesktopRelayStream: startDesktopRelayStream,
    stopCompanionStream: stopCompanionStream,
    stopDesktopPresenceHeartbeat: stopDesktopPresenceHeartbeat,
    stopDesktopRelayStream: stopDesktopRelayStream,
    syncThreadRuntime: syncThreadRuntime,
    verifyMagicLink: verifyMagicLink,
  };
})();
