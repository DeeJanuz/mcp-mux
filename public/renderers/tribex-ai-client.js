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

  function deriveToolDetail(raw) {
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

    return '';
  }

  function shouldPreviewCompanionPayload(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.reviewRequired) return true;
    var toolName = String(raw.toolName || raw.tool_name || '').trim();
    if (!toolName) return false;
    return /^[a-z0-9_]+$/i.test(toolName);
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
    var role = pickFirst([raw.role, raw.authorRole], null);
    if (!role) {
      var type = String(raw.type || '').toLowerCase();
      if (type.indexOf('assistant') >= 0) role = 'assistant';
      else if (type.indexOf('user') >= 0) role = 'user';
      else if (type.indexOf('tool') >= 0) role = 'tool';
      else role = 'assistant';
    }

    var content = stringifyContent(pickFirst([
      raw.content,
      raw.text,
      raw.body,
      raw.message,
      raw.delta,
      raw.output,
    ], ''));

    if (role === 'tool' || raw.toolName || raw.tool_name) {
      return {
        id: pickFirst([raw.id, raw.eventId], 'message-' + index),
        role: 'tool',
        toolName: pickFirst([raw.toolName, raw.tool_name, raw.name], 'tool'),
        status: pickFirst([raw.status, raw.state], 'success'),
        summary: deriveToolSummary(raw),
        detail: deriveToolDetail(raw),
        toolArgs: raw.toolArgs || raw.tool_args || null,
        resultData: getNestedValue(raw, ['result', 'data']),
        resultMeta: getNestedValue(raw, ['result', 'meta']),
        sequence: typeof raw.sequence === 'number' ? raw.sequence : null,
        createdAt: normalizeTimestamp(pickFirst([raw.createdAt, raw.timestamp], null)),
      };
    }

    return {
      id: pickFirst([raw.id, raw.eventId], 'message-' + index),
      role: role,
      content: content,
      createdAt: normalizeTimestamp(pickFirst([raw.createdAt, raw.timestamp], null)),
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

  function fetchWorkspaces(organizationId) {
    return requestCandidates('GET', [
      '/organizations/' + encodeURIComponent(organizationId) + '/workspaces',
    ]).then(function (raw) {
      return extractArray(raw, ['workspaces', 'items', 'results']).map(function (item, index) {
        return normalizeWorkspace(item, organizationId, index);
      });
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

  function sendMessage(threadId, prompt) {
    return requestVariants('POST', [
      {
        path: '/threads/' + encodeURIComponent(threadId) + '/messages',
        body: { content: prompt },
      },
    ]);
  }

  function runSmokeTest(threadId, smokeKey) {
    return requestVariants('POST', [
      {
        path: '/threads/' + encodeURIComponent(threadId) + '/smoke',
        body: {
          smokeKey: smokeKey || 'rule-skill-echo',
        },
      },
    ]);
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
    createThread: createThread,
    fetchSession: fetchSession,
    fetchOrganizations: fetchOrganizations,
    fetchProjects: fetchProjects,
    fetchThread: fetchThread,
    fetchThreads: fetchThreads,
    fetchWorkspaces: fetchWorkspaces,
    getConfig: getConfig,
    listenToDesktopPresenceEvents: listenToDesktopPresenceEvents,
    listenToDesktopRelayEvents: listenToDesktopRelayEvents,
    listenToStreamEvents: listenToStreamEvents,
    normalizeThreadDetail: normalizeThreadDetail,
    normalizeThreadSummary: normalizeThreadSummary,
    normalizeMessage: normalizeMessage,
    request: request,
    relayRequest: relayRequest,
    requestCandidates: requestCandidates,
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
    verifyMagicLink: verifyMagicLink,
  };
})();
