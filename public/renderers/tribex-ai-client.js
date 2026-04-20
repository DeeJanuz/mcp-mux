// @ts-nocheck
/* Hosted workspace client — compatibility transport and normalization helpers */

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

  function extractCompanionThreadId(raw) {
    return pickFirst([
      getNestedValue(raw, ['toolArgs', 'threadId']),
      getNestedValue(raw, ['toolArgs', 'thread_id']),
      getNestedValue(raw, ['tool_args', 'threadId']),
      getNestedValue(raw, ['tool_args', 'thread_id']),
      getNestedValue(raw, ['result', 'meta', 'threadId']),
      getNestedValue(raw, ['meta', 'threadId']),
      raw.threadId,
      raw.thread_id,
    ], null);
  }

  function extractCompanionSessionId(raw) {
    return pickFirst([
      raw.sessionId,
      raw.session_id,
      getNestedValue(raw, ['result', 'data', 'session_id']),
      getNestedValue(raw, ['result', 'data', 'sessionId']),
      getNestedValue(raw, ['result', 'meta', 'sessionId']),
      getNestedValue(raw, ['meta', 'sessionId']),
    ], null);
  }

  function buildCompanionToolMessageId(raw, index) {
    var sequence = typeof raw.sequence === 'number' && Number.isFinite(raw.sequence)
      ? String(raw.sequence)
      : null;
    if (sequence) {
      return [
        'tool-sequence',
        extractCompanionThreadId(raw) || 'thread',
        extractCompanionSessionId(raw) || 'session',
        sequence,
      ].join(':');
    }
    return pickFirst([raw.id, raw.eventId], 'message-' + index);
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

  function maybeParseJson(value) {
    if (typeof value !== 'string') return value;
    var trimmed = value.trim();
    if (!trimmed) return value;
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      return value;
    }
  }

  function isRendererPayloadShape(contentType, value) {
    if (!contentType || !value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    if (contentType === 'structured_data') {
      return Array.isArray(value.tables);
    }
    if (contentType === 'rich_content') {
      return !!(
        Object.prototype.hasOwnProperty.call(value, 'body') ||
        Object.prototype.hasOwnProperty.call(value, 'title') ||
        Object.prototype.hasOwnProperty.call(value, 'tables') ||
        Object.prototype.hasOwnProperty.call(value, 'suggestions') ||
        Object.prototype.hasOwnProperty.call(value, 'citations')
      );
    }
    return false;
  }

  function isReviewRequiredMeta(value) {
    return !!(
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.reviewRequired === true
    );
  }

  function shouldInlineRendererPayload(contentType, meta, sessionId) {
    if (contentType !== 'rich_content' && contentType !== 'structured_data') {
      return false;
    }
    if (sessionId) {
      return false;
    }
    return !isReviewRequiredMeta(meta);
  }

  function extractRendererToolPayload(raw, toolName) {
    if (!raw || typeof raw !== 'object' || !toolName) return null;

    var normalizedToolName = String(toolName || '').trim();
    var rawResultData = maybeParseJson(extractToolResultData(raw));
    var rawResultMeta = maybeParseJson(extractToolResultMeta(raw));
    var rawToolArgs = maybeParseJson(raw.toolArgs || raw.tool_args || null);

    if (normalizedToolName === 'push_content' || normalizedToolName === 'push_review') {
      var envelope = rawResultData && typeof rawResultData === 'object' && !Array.isArray(rawResultData)
        ? rawResultData
        : null;
      if (!envelope) return null;

      var contentType = pickFirst([
        envelope.tool_name,
        envelope.toolName,
        envelope.contentType,
        envelope.content_type,
      ], null);
      if (!contentType) return null;

      var data = maybeParseJson(envelope.data);
      var meta = maybeParseJson(envelope.meta);
      var toolArgs = maybeParseJson(envelope.tool_args || envelope.toolArgs || rawToolArgs);
      if (normalizedToolName === 'push_review') {
        meta = Object.assign({}, (meta && typeof meta === 'object' && !Array.isArray(meta)) ? meta : {}, {
          reviewRequired: true,
        });
      }

      if (!isRendererPayloadShape(contentType, data) && isRendererPayloadShape(contentType, envelope)) {
        data = envelope;
      }
      if (!isRendererPayloadShape(contentType, data)) return null;

      return {
        toolName: contentType,
        resultContentType: contentType,
        resultData: data,
        resultMeta: meta || rawResultMeta || null,
        toolArgs: (toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs)) ? toolArgs : (rawToolArgs || null),
      };
    }

    if (normalizedToolName !== 'rich_content' && normalizedToolName !== 'structured_data') {
      return null;
    }

    var directData = rawResultData;
    if (!isRendererPayloadShape(normalizedToolName, directData) && isRendererPayloadShape(normalizedToolName, raw)) {
      directData = raw;
    }
    if (!isRendererPayloadShape(normalizedToolName, directData)) {
      return null;
    }

    return {
      toolName: normalizedToolName,
      resultContentType: normalizedToolName,
      resultData: directData,
      resultMeta: rawResultMeta,
      toolArgs: (rawToolArgs && typeof rawToolArgs === 'object' && !Array.isArray(rawToolArgs)) ? rawToolArgs : null,
    };
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

  function buildLegacyArtifactKey(raw, index, contentType) {
    var threadId = extractCompanionThreadId(raw);
    if (!threadId || !contentType) return null;
    if (typeof raw.sequence === 'number' && Number.isFinite(raw.sequence)) {
      return ['tribex-ai-result', threadId, 'sequence', String(raw.sequence)].join(':');
    }
    var itemId = pickFirst([raw.toolCallId, raw.id, raw.eventId], 'artifact-' + index);
    return ['tribex-ai-result', threadId, 'legacy', itemId].join(':');
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

  function normalizeWorkspaceFile(raw, index) {
    raw = raw || {};
    var relativePath = pickFirst([raw.relativePath, raw.relative_path, raw.path, raw.name], 'file-' + index);
    return {
      id: pickFirst([raw.id, raw.fileId, raw.file_id], relativePath),
      relativePath: relativePath,
      name: String(relativePath || '').split('/').pop() || relativePath,
      bucketName: pickFirst([raw.bucketName, raw.bucket_name], null),
      objectKey: pickFirst([raw.objectKey, raw.object_key], null),
      contentType: pickFirst([raw.contentType, raw.content_type, raw.mimeType, raw.mime_type], null),
      sizeBytes: Number(pickFirst([raw.sizeBytes, raw.size_bytes, raw.size], 0)) || 0,
      checksum: pickFirst([raw.checksum, raw.etag], null),
      source: pickFirst([raw.source], null),
      syncState: pickFirst([raw.syncState, raw.sync_state, raw.status], null),
      metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
      uploadedAt: normalizeTimestamp(pickFirst([raw.uploadedAt, raw.uploaded_at], null)),
      lastSyncedAt: normalizeTimestamp(pickFirst([raw.lastSyncedAt, raw.last_synced_at], null)),
      lastModifiedAt: normalizeTimestamp(pickFirst([raw.lastModifiedAt, raw.last_modified_at, raw.updatedAt, raw.updated_at], null)),
      createdAt: normalizeTimestamp(pickFirst([raw.createdAt, raw.created_at], null)),
      raw: raw,
    };
  }

  function normalizeWorkspaceFileEnvelope(raw) {
    raw = raw || {};
    var file = raw.file ? normalizeWorkspaceFile(raw.file, 0) : null;
    return {
      environment: raw.environment || null,
      file: file,
      download: raw.download || null,
      upload: raw.upload || null,
      expiresAt: normalizeTimestamp(pickFirst([raw.expiresAt, raw.expires_at], null)),
      raw: raw,
    };
  }

  function normalizeWorkspaceFileBatch(raw) {
    raw = raw || {};
    return {
      environment: raw.environment || null,
      batch: raw.batch || null,
      items: extractArray(raw, ['items', 'files']).map(function (item, index) {
        var file = item.file ? normalizeWorkspaceFile(item.file, index) : null;
        return Object.assign({}, item, {
          file: file,
          relativePath: pickFirst([item.relativePath, item.relative_path, file && file.relativePath], 'file-' + index),
          upload: item.upload || null,
        });
      }),
      raw: raw,
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

  function normalizeThreadPersona(raw) {
    raw = raw || {};
    var key = pickFirst([raw.key, raw.personaKey], null);
    if (!key) return null;
    return {
      id: pickFirst([raw.id, raw.personaReleaseId, raw.releaseId], key),
      key: key,
      displayName: pickFirst([raw.displayName, raw.name, raw.title, key], key),
      releaseVersion: pickFirst([raw.releaseVersion, raw.version], null),
      agentClass: pickFirst([raw.agentClass], null),
      toolPolicySummary: raw.toolPolicySummary || null,
    };
  }

  function normalizeThreadSummary(raw, project, index) {
    raw = raw || {};
    var id = pickFirst([raw.id, raw.threadId], 'thread-' + index);
    var messageActivityAt = normalizeTimestamp(pickFirst([
      raw.messageActivityAt,
      raw.message_activity_at,
      raw.latestMessageAt,
      raw.latest_message_at,
      raw.lastMessageAt,
      raw.last_message_at,
      raw.lastActivityAt,
      raw.last_activity_at,
      raw.createdAt,
      raw.created_at,
    ], null));
    return {
      id: id,
      projectId: pickFirst([raw.projectId, project && project.id], null),
      workspaceId: pickFirst([raw.workspaceId, project && project.workspaceId], null),
      organizationId: pickFirst([raw.organizationId, raw.orgId, project && project.organizationId], null),
      title: pickFirst([raw.title, raw.name], 'Untitled thread'),
      preview: pickFirst([raw.preview, raw.summary, raw.lastMessagePreview, stringifyContent(raw.lastMessage)], ''),
      hydrateState: pickFirst([raw.hydrateState, raw.status, raw.state], null),
      messageActivityAt: messageActivityAt,
      lastActivityAt: messageActivityAt,
      workspaceName: pickFirst([raw.workspaceName, project && project.workspaceName], null),
      projectName: pickFirst([raw.projectName, project && project.name], null),
      personaReleaseId: pickFirst([raw.personaReleaseId], null),
      persona: normalizeThreadPersona(raw.persona),
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
      var toolName = pickFirst([raw.toolName, raw.tool_name, raw.name], 'tool');
      var rendererPayload = extractRendererToolPayload(raw, toolName);
      var toolArgs = rendererPayload ? rendererPayload.toolArgs : (raw.toolArgs || raw.tool_args || null);
      var resultData = rendererPayload ? rendererPayload.resultData : extractToolResultData(raw);
      var resultMeta = rendererPayload ? rendererPayload.resultMeta : extractToolResultMeta(raw);
      var resultContentType = rendererPayload
        ? rendererPayload.resultContentType
        : pickFirst([
          raw.resultContentType,
          raw.contentType,
          raw.content_type,
          toolName,
        ], null);
      var sessionId = extractCompanionSessionId(raw);
      var inlineDisplay = shouldInlineRendererPayload(
        resultContentType,
        resultMeta,
        sessionId
      );
      return {
        id: buildCompanionToolMessageId(raw, index),
        role: 'tool',
        toolName: rendererPayload ? rendererPayload.toolName : toolName,
        status: pickFirst([raw.status, raw.state], 'success'),
        summary: deriveToolSummary(raw),
        detail: deriveToolDetail(raw),
        toolArgs: toolArgs,
        resultData: resultData,
        resultMeta: resultMeta,
        resultContentType: resultContentType,
        artifactKey: resultData && !inlineDisplay
          ? buildLegacyArtifactKey(raw, index, resultContentType)
          : null,
        sessionId: sessionId,
        inlineDisplay: inlineDisplay,
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
    var messageActivityAt = normalizeTimestamp(pickFirst([
      thread.messageActivityAt,
      thread.message_activity_at,
      raw.messageActivityAt,
      raw.message_activity_at,
      thread.latestMessageAt,
      thread.latest_message_at,
      raw.latestMessageAt,
      raw.latest_message_at,
      thread.lastMessageAt,
      thread.last_message_at,
      raw.lastMessageAt,
      raw.last_message_at,
      thread.lastActivityAt,
      thread.last_activity_at,
      raw.lastActivityAt,
      raw.last_activity_at,
      thread.createdAt,
      thread.created_at,
      raw.createdAt,
      raw.created_at,
    ], null));
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
      organizationId: pickFirst([thread.organizationId, raw.organizationId, raw.orgId, project.organizationId, workspace.organizationId], null),
      title: pickFirst([thread.title, thread.name], 'Untitled thread'),
      status: pickFirst([thread.status, thread.state, raw.status], null),
      hydrateState: pickFirst([thread.hydrateState, raw.hydrateState], null),
      preview: pickFirst([thread.preview, thread.summary], ''),
      projectName: pickFirst([thread.projectName, project.name], null),
      workspaceName: pickFirst([thread.workspaceName, workspace.name], null),
      personaReleaseId: pickFirst([thread.personaReleaseId], null),
      persona: normalizeThreadPersona(raw.persona || thread.persona),
      personaRelease: raw.personaRelease || thread.personaRelease || null,
      personaTestRun: raw.personaTestRun || thread.personaTestRun || null,
      messageActivityAt: messageActivityAt,
      lastActivityAt: messageActivityAt,
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
  var runtimeOverridesByThread = {};
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

  function isRuntimeRendererToolPart(part) {
    if (!part || typeof part !== 'object') return false;
    var type = typeof part.type === 'string' ? part.type.toLowerCase() : '';
    var toolName = typeof part.toolName === 'string' ? part.toolName.toLowerCase() : '';
    return (
      type === 'tool-rich_content' ||
      type === 'tool-structured_data' ||
      toolName === 'rich_content' ||
      toolName === 'structured_data'
    );
  }

  function extractRuntimeRendererMarkers(part) {
    if (!isRuntimeRendererToolPart(part)) return [];
    var input = part.input && typeof part.input === 'object' ? part.input : {};
    var output = part.output && typeof part.output === 'object' ? part.output : {};
    var markers = [];

    function pushMarker(value) {
      if (typeof value !== 'string') return;
      var trimmed = value.trim();
      if (!trimmed) return;
      markers.push(trimmed);
    }

    function pushBodyMarkers(value) {
      if (typeof value !== 'string') return;
      value.split(/\r?\n/).map(function (line) {
        return line.trim();
      }).filter(function (line) {
        return line && /[A-Za-z0-9]/.test(line) && line.length >= 12;
      }).slice(0, 3).forEach(pushMarker);
    }

    function pushTitleMarkers(value) {
      if (typeof value !== 'string') return;
      var trimmed = value.trim();
      if (!trimmed) return;
      markers.push(trimmed);
      markers.push('# ' + trimmed);
      markers.push('## ' + trimmed);
      markers.push('### ' + trimmed);
    }

    var body = typeof input.body === 'string'
      ? input.body
      : (typeof output.body === 'string' ? output.body : '');
    if (body) {
      pushBodyMarkers(body);
    }

    pushTitleMarkers(input.title);
    pushTitleMarkers(output.title);

    return markers.filter(Boolean);
  }

  function findRuntimeRendererEchoIndex(text, parts) {
    if (!text || !Array.isArray(parts) || !parts.some(isRuntimeRendererToolPart)) {
      return -1;
    }

    var indexes = [];

    parts.forEach(function (part) {
      extractRuntimeRendererMarkers(part).forEach(function (marker) {
        var markerIndex = text.indexOf(marker);
        if (markerIndex >= 0) {
          indexes.push(markerIndex);
        }
      });
    });

    if (!indexes.length) return -1;
    return Math.min.apply(Math, indexes);
  }

  function compactRuntimeAssistantText(parts) {
    var text = extractRuntimeText(parts);
    if (!text || !Array.isArray(parts) || !parts.some(isRuntimeRendererToolPart)) {
      return text;
    }

    var echoIndex = findRuntimeRendererEchoIndex(text, parts);
    if (echoIndex === 0) {
      return '';
    }
    if (echoIndex > 0) {
      var prefix = text.slice(0, echoIndex).trim();
      if (prefix) return prefix;
    }
    return text.trim();
  }

  function normalizeRuntimeUiMessage(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var role = pickFirst([raw.role], null);
    var text = role === 'assistant'
      ? compactRuntimeAssistantText(raw.parts)
      : extractRuntimeText(raw.parts);
    if ((role !== 'user' && role !== 'assistant') || !text) {
      return null;
    }

    return {
      id: pickFirst([raw.id], 'runtime-message-' + index),
      role: role,
      content: text,
      turnId: pickFirst([
        raw.turnId,
        raw.turn_id,
        raw.metadata && raw.metadata.turnId,
        raw.metadata && raw.metadata.turn_id,
      ], null),
      turnOrdinal: pickFirst([
        raw.turnOrdinal,
        raw.turn_ordinal,
        raw.metadata && raw.metadata.turnOrdinal,
        raw.metadata && raw.metadata.turn_ordinal,
      ], null),
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
      messageActivityAt: latest && latest.createdAt ? latest.createdAt : null,
      lastActivityAt: latest && latest.createdAt ? latest.createdAt : null,
    };
  }

  function normalizeRelayRealtime(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var streamUrl = typeof raw.streamUrl === 'string' ? raw.streamUrl.trim() : '';
    var responseUrl = typeof raw.responseUrl === 'string' ? raw.responseUrl.trim() : '';
    var token = typeof raw.token === 'string' ? raw.token.trim() : '';
    var tokenExpiresAt = Number(raw.tokenExpiresAt || raw.token_expires_at || 0);
    if (!streamUrl || !responseUrl || !token || !Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= 0) {
      return null;
    }
    return {
      streamUrl: streamUrl,
      responseUrl: responseUrl,
      token: token,
      tokenExpiresAt: tokenExpiresAt,
    };
  }

  function normalizeRuntimeRelay(raw) {
    var relay = raw && typeof raw === 'object' ? Object.assign({}, raw) : {};
    relay.realtime = normalizeRelayRealtime(relay.realtime);
    return relay;
  }

  function hasUsableRealtimeRelay(envelope) {
    var realtime = envelope && envelope.relay ? envelope.relay.realtime : null;
    if (!realtime) return false;
    return Date.now() / 1000 < Number(realtime.tokenExpiresAt || 0);
  }

  function normalizeRuntimeSessionEnvelope(raw) {
    raw = raw || {};
    return {
      thread: raw.thread || null,
      project: raw.project || null,
      workspace: raw.workspace || null,
      persona: normalizeThreadPersona(raw.persona),
      packageManifest: raw.packageManifest || null,
      runtimeSession: raw.runtimeSession || null,
      runtimeMessages: raw.runtimeMessages || null,
      companionSession: raw.companionSession || null,
      relay: normalizeRuntimeRelay(raw.relay),
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
    var override = runtimeOverridesByThread[threadId] || null;
    var requestBody = Object.assign(
      {},
      override && override.runtimeSessionBody && typeof override.runtimeSessionBody === 'object'
        ? override.runtimeSessionBody
        : {},
      options && options.body && typeof options.body === 'object'
        ? options.body
        : {},
    );

    return requestVariants('POST', [
      {
        path: '/threads/' + encodeURIComponent(threadId) + '/runtime-session',
        body: requestBody,
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

  function prepareAgentRuntime(threadId, envelope) {
    return buildLocalRelayCatalog(envelope).then(function (catalog) {
      if (hasUsableRealtimeRelay(envelope)) {
        envelope.relay = envelope.relay || {};
        envelope.relay.catalog = catalog;
        return connectAgentRuntime(threadId, envelope).then(function () {
          return envelope;
        });
      }

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
  }

  function ensureAgentRuntime(threadId, options) {
    return ensureRuntimeSession(threadId, options).then(function (envelope) {
      return prepareAgentRuntime(threadId, envelope);
    });
  }

  function syncThreadRuntime(threadId, options) {
    return ensureRuntimeSession(threadId, options).then(function (envelope) {
      var bootstrapTranscript = normalizeRuntimeTranscript(threadId, envelope.runtimeMessages);
      if (bootstrapTranscript.rawRuntimeMessages.length) {
        return bootstrapTranscript;
      }

      return prepareAgentRuntime(threadId, envelope).then(function (preparedEnvelope) {
        return getCloudflareBridge().getMessages({
          threadId: threadId,
          connection: preparedEnvelope.runtimeSession && preparedEnvelope.runtimeSession.connection,
        }).then(function (messages) {
          var liveTranscript = normalizeRuntimeTranscript(threadId, messages);
          if (
            !liveTranscript.rawRuntimeMessages.length &&
            bootstrapTranscript.rawRuntimeMessages.length
          ) {
            return bootstrapTranscript;
          }
          return liveTranscript;
        });
      }).catch(function (error) {
        if (bootstrapTranscript.rawRuntimeMessages.length) {
          return bootstrapTranscript;
        }
        throw error;
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
    var projectName = String(name || '').trim() || 'General';
    return requestVariants('POST', [
      {
        path: '/workspaces/' + encodeURIComponent(workspace.id) + '/projects',
        body: {
          name: projectName,
          title: projectName,
          projectName: projectName,
        },
      },
    ]).then(function (raw) {
      var project = normalizeProject(raw.project || raw, workspace, 0);
      if (!project.name || project.name === 'Project') {
        project.name = projectName;
      }
      return project;
    });
  }

  function renameProject(workspace, projectId, name) {
    var projectName = String(name || '').trim() || 'Project';
    return requestVariants('PATCH', [
      {
        path: '/projects/' + encodeURIComponent(projectId),
        body: {
          name: projectName,
        },
      },
    ]).then(function (raw) {
      var project = normalizeProject(raw.project || raw, workspace, 0);
      if (!project.name || project.name === 'Project') {
        project.name = projectName;
      }
      return project;
    });
  }

  function fetchThreads(project) {
    return requestCandidates('GET', [
      '/projects/' + encodeURIComponent(project.id) + '/threads',
    ]).then(function (raw) {
      var payloadProject = raw && raw.project ? normalizeProject(raw.project, {
        id: project.workspaceId,
        organizationId: project.organizationId,
        name: project.workspaceName,
      }, 0) : project;
      return extractArray(raw, ['threads', 'items', 'results']).map(function (item, index) {
        return normalizeThreadSummary(item, payloadProject, index);
      });
    });
  }

  function fetchProjectThreadPersonas(projectId) {
    return requestCandidates('GET', [
      '/projects/' + encodeURIComponent(projectId) + '/thread-personas',
    ]).then(function (raw) {
      return extractArray(raw, ['personas', 'threadPersonas', 'personaReleases', 'items', 'results']).map(function (item) {
        return normalizeThreadPersona(item);
      }).filter(Boolean);
    });
  }

  function fetchThread(threadId) {
    return requestCandidates('GET', [
      '/threads/' + encodeURIComponent(threadId),
    ]).then(normalizeThreadDetail);
  }

  function createThread(projectId, title, personaKey) {
    var threadTitle = String(title || 'New chat').trim() || 'New chat';
    return requestVariants('POST', [
      {
        path: '/projects/' + encodeURIComponent(projectId) + '/threads',
        body: {
          title: threadTitle,
          personaKey: String(personaKey || '').trim(),
        },
      },
    ]).then(function (raw) {
      var summary = normalizeThreadSummary(raw.thread || raw, { id: projectId }, 0);
      if (!summary.title || summary.title === 'Untitled thread') summary.title = threadTitle;
      return summary;
    });
  }

  function renameThread(threadId, title) {
    var threadTitle = String(title || 'Thread').trim() || 'Thread';
    return requestVariants('PATCH', [
      {
        path: '/threads/' + encodeURIComponent(threadId),
        body: {
          title: threadTitle,
        },
      },
    ]).then(function (raw) {
      var detail = normalizeThreadDetail(raw);
      if (!detail.title || detail.title === 'Untitled thread') {
        detail.title = threadTitle;
      }
      return detail;
    });
  }

  function buildSmokePrompt(smokeKey) {
    void smokeKey;
    return 'Please verify that the currently loaded rule and skill bundle is wired correctly for this workspace. Use the available validation tool to confirm the exact loaded rule and skill basenames, then summarize the result briefly for the operator.';
  }

  function sendMessage(threadId, prompt, options) {
    return ensureAgentRuntime(threadId, {
      forceRefresh: options && options.forceRuntimeRefresh === false ? false : true,
    }).then(function (envelope) {
      var override = runtimeOverridesByThread[threadId] || {};
      return getCloudflareBridge().startTurn({
        threadId: threadId,
        connection: envelope.runtimeSession && envelope.runtimeSession.connection,
        relayBridge: envelope.relay && envelope.relay.bridge ? envelope.relay.bridge : null,
        relayCatalog: envelope.relay && envelope.relay.catalog ? envelope.relay.catalog : null,
        prompt: prompt,
        validationProfile: options && options.validationProfile ? options.validationProfile : null,
        personaOverride: override.personaOverride || null,
        personaTestRunId: override.personaTestRunId || null,
        telemetryToken: override.telemetryToken || null,
        turnId: options && options.turnId ? options.turnId : null,
        messageId: options && options.messageId ? options.messageId : null,
        waitForStable: options && options.waitForStable === false ? false : undefined,
      });
    });
  }

  function configureThreadRuntime(threadId, config) {
    if (!threadId) return null;
    runtimeOverridesByThread[threadId] = Object.assign(
      {},
      runtimeOverridesByThread[threadId] || {},
      config || {},
    );
    return runtimeOverridesByThread[threadId];
  }

  function clearThreadRuntimeConfig(threadId) {
    if (!threadId) return;
    delete runtimeOverridesByThread[threadId];
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

  function listWorkspaceFiles(workspaceId, prefix) {
    var query = prefix ? { prefix: prefix } : null;
    return requestCandidates('GET', [
      '/workspaces/' + encodeURIComponent(workspaceId) + '/user-sandbox/files',
    ], null, query).then(function (raw) {
      return {
        environment: raw && raw.environment ? raw.environment : null,
        files: extractArray(raw, ['files', 'items', 'results']).map(normalizeWorkspaceFile),
      };
    });
  }

  function initWorkspaceFileUpload(workspaceId, fileInfo) {
    fileInfo = fileInfo || {};
    return requestVariants('POST', [
      {
        path: '/workspaces/' + encodeURIComponent(workspaceId) + '/user-sandbox/files',
        body: {
          relativePath: fileInfo.relativePath,
          contentType: fileInfo.contentType || null,
          sizeBytes: fileInfo.sizeBytes || 0,
          source: fileInfo.source || 'mcpviews-file-browser',
          metadata: fileInfo.metadata || {},
        },
      },
    ]).then(normalizeWorkspaceFileEnvelope);
  }

  function createWorkspaceFileBatch(workspaceId, files, metadata) {
    return requestVariants('POST', [
      {
        path: '/workspaces/' + encodeURIComponent(workspaceId) + '/user-sandbox/file-batches',
        body: {
          source: 'mcpviews-folder-upload',
          metadata: metadata || {},
          files: (files || []).map(function (file) {
            return {
              relativePath: file.relativePath,
              contentType: file.contentType || null,
              sizeBytes: file.sizeBytes || 0,
              checksum: file.checksum || null,
              source: file.source || 'mcpviews-file-browser',
              metadata: file.metadata || {},
            };
          }),
        },
      },
    ]).then(normalizeWorkspaceFileBatch);
  }

  function getWorkspaceFileBatch(workspaceId, batchId) {
    return requestCandidates('GET', [
      '/workspaces/' + encodeURIComponent(workspaceId) + '/user-sandbox/file-batches/' + encodeURIComponent(batchId),
    ]).then(normalizeWorkspaceFileBatch);
  }

  function finalizeWorkspaceFileBatch(workspaceId, batchId) {
    return requestVariants('POST', [
      {
        path: '/workspaces/' + encodeURIComponent(workspaceId) + '/user-sandbox/file-batches/' + encodeURIComponent(batchId) + '/finalize',
      },
    ]).then(normalizeWorkspaceFileBatch);
  }

  function getWorkspaceFile(workspaceId, fileId) {
    return requestCandidates('GET', [
      '/workspaces/' + encodeURIComponent(workspaceId) + '/user-sandbox/files/' + encodeURIComponent(fileId),
    ]).then(normalizeWorkspaceFileEnvelope);
  }

  function deleteWorkspaceFile(workspaceId, fileId) {
    return requestVariants('DELETE', [
      {
        path: '/workspaces/' + encodeURIComponent(workspaceId) + '/user-sandbox/files/' + encodeURIComponent(fileId),
      },
    ]);
  }

  function uploadWorkspaceFileToSignedUrl(upload, file) {
    var url = upload && upload.url ? upload.url : upload;
    if (!url) return Promise.reject(new Error('Upload URL is unavailable.'));
    return fetch(url, {
      method: 'POST',
      headers: file && file.type ? { 'content-type': file.type } : undefined,
      body: file,
    }).then(function (response) {
      if (!response.ok) {
        return response.text().catch(function () { return response.statusText; }).then(function (detail) {
          throw new Error('Upload failed (' + response.status + '): ' + (detail || response.statusText));
        });
      }
      return response.json().catch(function () {
        return { ok: true };
      });
    });
  }

  function fetchSignedFileBytes(download) {
    var url = download && download.url ? download.url : download;
    if (!url) return Promise.reject(new Error('Download URL is unavailable.'));
    return fetch(url, { method: 'GET' }).then(function (response) {
      if (!response.ok) {
        return response.text().catch(function () { return response.statusText; }).then(function (detail) {
          throw new Error('Download failed (' + response.status + '): ' + (detail || response.statusText));
        });
      }
      return response.arrayBuffer().then(function (buffer) {
        return {
          bytes: new Uint8Array(buffer),
          contentType: response.headers.get('content-type') || null,
          contentDisposition: response.headers.get('content-disposition') || null,
        };
      });
    });
  }

  function bytesToBase64(bytes) {
    var binary = '';
    var chunkSize = 0x8000;
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function triggerByteDownload(filename, bytes, contentType) {
    var safeName = filename || 'download';
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core.invoke('save_binary_file', {
        filename: safeName,
        contentBase64: bytesToBase64(bytes),
      }).catch(browserDownload);
    }
    return browserDownload();

    function browserDownload() {
      var blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      return Promise.resolve(true);
    }
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

  function startRealtimeRelayStream(streamId, relaySessionId, realtime) {
    return invoke('start_first_party_ai_realtime_relay_stream', {
      streamId: streamId,
      relaySessionId: relaySessionId,
      streamUrl: realtime && realtime.streamUrl ? realtime.streamUrl : '',
      responseUrl: realtime && realtime.responseUrl ? realtime.responseUrl : '',
      token: realtime && realtime.token ? realtime.token : '',
      tokenExpiresAt: realtime && realtime.tokenExpiresAt ? Math.floor(Number(realtime.tokenExpiresAt)) : 0,
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
    clearThreadRuntimeConfig: clearThreadRuntimeConfig,
    createCompanionSession: createCompanionSession,
    createProject: createProject,
    createWorkspace: createWorkspace,
    createThread: createThread,
    createWorkspaceFileBatch: createWorkspaceFileBatch,
    buildSmokePrompt: buildSmokePrompt,
    configureThreadRuntime: configureThreadRuntime,
    deleteWorkspaceFile: deleteWorkspaceFile,
    fetchPackages: fetchPackages,
    fetchSignedFileBytes: fetchSignedFileBytes,
    fetchSession: fetchSession,
    fetchOrganizations: fetchOrganizations,
    fetchProjects: fetchProjects,
    fetchProjectThreadPersonas: fetchProjectThreadPersonas,
    fetchRuntimeSession: fetchRuntimeSession,
    fetchThread: fetchThread,
    fetchThreads: fetchThreads,
    fetchWorkspaces: fetchWorkspaces,
    finalizeWorkspaceFileBatch: finalizeWorkspaceFileBatch,
    getConfig: getConfig,
    getWorkspaceFile: getWorkspaceFile,
    getWorkspaceFileBatch: getWorkspaceFileBatch,
    ensureAgentRuntime: ensureAgentRuntime,
    ensureRuntimeSession: ensureRuntimeSession,
    initWorkspaceFileUpload: initWorkspaceFileUpload,
    listWorkspaceFiles: listWorkspaceFiles,
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
    renameProject: renameProject,
    renameThread: renameThread,
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
    startRealtimeRelayStream: startRealtimeRelayStream,
    stopCompanionStream: stopCompanionStream,
    stopDesktopPresenceHeartbeat: stopDesktopPresenceHeartbeat,
    stopDesktopRelayStream: stopDesktopRelayStream,
    syncThreadRuntime: syncThreadRuntime,
    triggerByteDownload: triggerByteDownload,
    uploadWorkspaceFileToSignedUrl: uploadWorkspaceFileToSignedUrl,
    verifyMagicLink: verifyMagicLink,
  };
})();
