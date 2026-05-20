# Hosted AI Thread Provider Contract

MCPViews can run its bundled AI workspace against a compatible hosted AI provider. The provider owns authentication, organizations, workspaces, projects, persisted threads, runtime sessions, and any durable sandbox storage. MCPViews owns the desktop shell, renderer host, local MCP tool catalog, review UI, and local relay bridge.

This contract documents the minimum HTTP API shape expected by the current compatibility client in `public/renderers/tribex-ai-client.js`. Internal command names still use `first_party_ai` and renderer files still use `tribex-ai-*` for compatibility with existing installations; those names are implementation details, not a provider lock-in.

For fully custom products, prefer the plugin system. Use this contract when you want your hosted inference harness to power the built-in MCPViews AI workspace.

## Configuration

Set a hosted AI provider base URL before launching MCPViews:

```bash
MCPVIEWS_AI_PROVIDER_BASE_URL="https://ai.example.com"
```

The value can also live in `~/.mcpviews/config.json` under the existing compatibility key:

```json
{
  "first_party_ai": {
    "base_url": "https://ai.example.com",
    "relay_base_url": "https://ai.example.com",
    "device_base_url": "https://ai.example.com"
  }
}
```

Generic environment variables take precedence over legacy aliases:

| Purpose | Preferred env var | Legacy aliases |
| --- | --- | --- |
| Control-plane base URL | `MCPVIEWS_AI_PROVIDER_BASE_URL` | `MCPVIEWS_FIRST_PARTY_AI_BASE_URL`, `PROPAASAI_BASE_URL` |
| Auth URL | `MCPVIEWS_AI_PROVIDER_AUTH_URL` | `MCPVIEWS_FIRST_PARTY_AI_AUTH_URL`, `PROPAASAI_AUTH_URL` |
| Token URL | `MCPVIEWS_AI_PROVIDER_TOKEN_URL` | `MCPVIEWS_FIRST_PARTY_AI_TOKEN_URL`, `PROPAASAI_TOKEN_URL` |
| Client ID | `MCPVIEWS_AI_PROVIDER_CLIENT_ID` | `MCPVIEWS_FIRST_PARTY_AI_CLIENT_ID`, `PROPAASAI_CLIENT_ID` |
| Relay base URL | `MCPVIEWS_AI_PROVIDER_RELAY_BASE_URL` | `MCPVIEWS_FIRST_PARTY_AI_RELAY_BASE_URL`, `PROPAASAI_RELAY_BASE_URL` |
| Device base URL | `MCPVIEWS_AI_PROVIDER_DEVICE_BASE_URL` | `MCPVIEWS_FIRST_PARTY_AI_DEVICE_BASE_URL`, `PROPAASAI_DEVICE_BASE_URL` |
| Relay token | `MCPVIEWS_AI_PROVIDER_RELAY_TOKEN` | `MCPVIEWS_FIRST_PARTY_AI_RELAY_TOKEN`, `PROPAASAI_RELAY_TOKEN` |
| Relay token expiry | `MCPVIEWS_AI_PROVIDER_RELAY_TOKEN_EXPIRES_AT` | `MCPVIEWS_FIRST_PARTY_AI_RELAY_TOKEN_EXPIRES_AT`, `PROPAASAI_RELAY_TOKEN_EXPIRES_AT` |
| Relay device ID | `MCPVIEWS_AI_PROVIDER_RELAY_DEVICE_ID` | `MCPVIEWS_FIRST_PARTY_AI_RELAY_DEVICE_ID`, `PROPAASAI_RELAY_DEVICE_ID` |

If your runtime websocket or relay API lives on a different origin than `MCPVIEWS_AI_PROVIDER_BASE_URL`, set `MCPVIEWS_AI_PROVIDER_DEVICE_BASE_URL` or `MCPVIEWS_AI_PROVIDER_RELAY_BASE_URL` to that origin so the desktop WebView content security policy allows the connection.

MCPViews stores provider cookies and relay tokens locally under `~/.mcpviews/auth/`. Do not ask users to place inference credentials, storage credentials, or Cloudflare API tokens in MCPViews.

## Authentication

The current workspace uses brokered email-code auth. Providers must support:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/get-session` | Return the signed-in user/session or `null`. |
| `POST` | `/api/auth/sign-in/email-code` | Send a 6-digit sign-in code to the submitted email. |
| `POST` | `/api/auth/email-code/verify` | Verify the submitted email/code pair and establish the session cookie. |
| `POST` | `/api/auth/sign-out` | Clear the provider session. |

`POST /api/auth/sign-in/email-code` receives:

```json
{
  "email": "user@example.com",
  "callbackURL": "/admin"
}
```

`POST /api/auth/email-code/verify` receives:

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

MCPViews persists cookies returned by these endpoints and fetches `/api/auth/get-session` after successful verification so the local auth state uses the provider's canonical session shape. Legacy magic-link verification can remain available for older providers during migration, but the current UI flow sends and verifies email codes.

## Navigator And Thread API

The AI navigator loads data in this order:

1. `GET /organizations`
2. `GET /packages`
3. `GET /organizations/:organizationId/workspaces`
4. `GET /workspaces/:workspaceId/projects`
5. `GET /projects/:projectId/threads`

The compatibility client accepts either top-level arrays or common wrappers such as `items` and `results`. Stable ids are required.

### Organizations

```json
{
  "organizations": [
    {
      "id": "org_123",
      "name": "Example Organization",
      "slug": "example",
      "role": "owner"
    }
  ]
}
```

### Packages

Packages are optional but recommended when providers offer workspace templates or persona bundles.

```json
{
  "packages": [
    {
      "key": "general",
      "name": "General Assistant",
      "version": "1.0.0",
      "lifecycle": "stable",
      "default": true
    }
  ]
}
```

### Workspaces And Projects

```json
{
  "workspaces": [
    {
      "id": "workspace_123",
      "organizationId": "org_123",
      "name": "Engineering",
      "packageKey": "general",
      "status": "ready"
    }
  ]
}
```

```json
{
  "projects": [
    {
      "id": "project_123",
      "workspaceId": "workspace_123",
      "organizationId": "org_123",
      "name": "Planning",
      "summary": "Shared AI planning work.",
      "lastActivityAt": "2026-05-02T18:00:00Z"
    }
  ]
}
```

Create and rename operations:

| Method | Path | Body |
| --- | --- | --- |
| `POST` | `/organizations/:organizationId/workspaces` | `{ "name": "New workspace", "packageKey": "general" }` |
| `POST` | `/workspaces/:workspaceId/projects` | `{ "name": "Planning", "title": "Planning", "projectName": "Planning" }` |
| `PATCH` | `/projects/:projectId` | `{ "name": "New project name" }` |

### Threads

```json
{
  "threads": [
    {
      "id": "thread_123",
      "projectId": "project_123",
      "workspaceId": "workspace_123",
      "organizationId": "org_123",
      "title": "Provider contract test",
      "preview": "Last visible message preview.",
      "lastActivityAt": "2026-05-02T18:00:00Z",
      "childThreads": []
    }
  ]
}
```

Thread detail is returned from `GET /threads/:threadId`:

```json
{
  "thread": {
    "id": "thread_123",
    "title": "Provider contract test",
    "messages": [
      {
        "id": "message_1",
        "role": "user",
        "content": "Summarize this workspace.",
        "createdAt": "2026-05-02T18:00:00Z"
      }
    ],
    "pendingHumanInputs": [],
    "activePause": null,
    "childThreads": []
  }
}
```

Create and rename operations:

| Method | Path | Body |
| --- | --- | --- |
| `POST` | `/projects/:projectId/threads` | `{ "title": "New chat", "personaKey": "general" }` |
| `PATCH` | `/threads/:threadId` | `{ "title": "Updated title" }` |

## Composer Skills And Human Input

Persona skills are optional. MCPViews tries the following paths and falls back to built-in local skills when they are unavailable:

| Method | Path |
| --- | --- |
| `GET` | `/threads/:threadId/skills` |
| `GET` | `/threads/:threadId/persona-skills` |
| `GET` | `/thread-skills?threadId=:threadId` |

Skill objects should include a stable `key`, display name, prompt/template text, and variable definitions. The composer sends:

- `displayPrompt`: user-visible prompt with skill chips summarized.
- `runtimePrompt`: expanded hidden instruction sent to the runtime.
- `skillInvocation`: structured skill metadata for persisted transcripts.

Connected email account lists are optional and must contain display-safe data only:

| Method | Path |
| --- | --- |
| `GET` | `/threads/:threadId/connected-email-accounts` |
| `GET` | `/threads/:threadId/email-accounts` |
| `GET` | `/email/accounts?threadId=:threadId` |

When a thread contains pending human input, MCPViews can submit the decision:

```http
POST /threads/:threadId/human-inputs/:inputId/decision
```

The body is the renderer decision payload, usually including fields such as `decision`, `decisions`, `comments`, and edited values.

Thread `activePause.tasks[]` entries can include `actionLabel` and `actionUrl` for external user steps such as OAuth or account connection. MCPViews renders non-terminal task actions only when `actionUrl` is an `http` or `https` URL, and opens the URL in the system browser when the native app is available.

## Runtime Session Contract

Before sending a message, MCPViews requests a runtime session:

```http
POST /threads/:threadId/runtime-session
```

The response should include a websocket runtime connection. Cloudflare Agents-style websocket transport is the first supported transport:

```json
{
  "runtimeSession": {
    "provider": "CLOUDFLARE_AGENTS",
    "transport": "DIRECT_CLIENT",
    "connection": {
      "transport": "websocket",
      "host": "https://agents.example.com",
      "agent": "WorkspaceAgent",
      "name": "thread_thread_123",
      "path": null,
      "query": {
        "token": "short-lived-runtime-token"
      }
    },
    "expiresAt": "2026-05-02T18:15:00Z",
    "instanceId": "thread_thread_123",
    "metadata": {}
  },
  "runtimeMessages": {
    "messages": []
  },
  "relay": {
    "realtime": {
      "streamUrl": "https://ai.example.com/api/desktop-relay/sessions/relay_123/events",
      "responseUrl": "https://ai.example.com/api/desktop-relay/sessions/relay_123/responses",
      "token": "short-lived-relay-token",
      "tokenExpiresAt": 1777745700
    }
  }
}
```

For local loopback runtimes, MCPViews probes `GET /__runtime-session-probe` with the runtime token when present, then falls back to `GET /healthz`.

Runtime transcript messages should use this shape:

```json
{
  "messages": [
    {
      "id": "runtime_message_1",
      "role": "assistant",
      "parts": [{ "type": "text", "text": "Done." }],
      "metadata": {
        "displayPrompt": "Optional user-visible prompt"
      },
      "createdAt": "2026-05-02T18:01:00Z"
    }
  ]
}
```

MCPViews filters hidden runtime messages when metadata includes `hiddenFromTranscript`, `hidden_from_transcript`, `hidden`, or `visibility: "internal"`.

## Desktop Relay Contract

The provider can let the hosted runtime call local MCP tools through the MCPViews desktop relay. MCPViews publishes a local tool catalog before starting a runtime turn.

Preferred realtime relay fields are returned in `POST /threads/:threadId/runtime-session` under `relay.realtime`:

```json
{
  "relay": {
    "realtime": {
      "streamUrl": "https://ai.example.com/api/desktop-relay/sessions/relay_123/events",
      "responseUrl": "https://ai.example.com/api/desktop-relay/sessions/relay_123/responses",
      "token": "short-lived-relay-token",
      "tokenExpiresAt": 1777745700
    }
  }
}
```

When realtime relay fields are absent, MCPViews uses the legacy catalog path:

```http
POST /api/desktop-relay/catalog
```

```json
{
  "relaySessionId": "relay_123",
  "connectors": [],
  "tools": []
}
```

Providers should treat relay tokens as short-lived bearer credentials. Tool request payloads must include a unique request id so MCPViews can deduplicate replayed tool calls.

## Optional Workspace File Browser

The file browser is optional. If unsupported, the rest of the AI workspace can still work.

Supported endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/workspaces/:workspaceId/user-sandbox/files` | List files. |
| `POST` | `/workspaces/:workspaceId/user-sandbox/files` | Create a signed upload target. |
| `GET` | `/workspaces/:workspaceId/user-sandbox/files/:fileId` | Return metadata and signed download URL. |
| `PATCH` | `/workspaces/:workspaceId/user-sandbox/files/:fileId` | Move or rename one file by updating `relativePath`. |
| `DELETE` | `/workspaces/:workspaceId/user-sandbox/files/:fileId` | Delete one file. |
| `POST` | `/workspaces/:workspaceId/user-sandbox/folders` | Create an empty folder marker. |
| `PATCH` | `/workspaces/:workspaceId/user-sandbox/folders` | Move a folder from `fromFolderPath` to `toFolderPath`. |
| `POST` | `/workspaces/:workspaceId/user-sandbox/file-batches` | Create folder/batch upload targets. |
| `GET` | `/workspaces/:workspaceId/user-sandbox/file-batches/:batchId` | Inspect batch state. |
| `POST` | `/workspaces/:workspaceId/user-sandbox/file-batches/:batchId/finalize` | Finalize a batch. |

Upload responses should include a short-lived signed `upload.url`; download responses should include a short-lived signed `download.url`. Durable storage credentials stay in the provider control plane.

Folder creation can return either folder metadata or a marker file. When marker files are included in `GET /workspaces/:workspaceId/user-sandbox/files`, set `metadata.isFolderMarker` to `true` and `metadata.folderPath` to the displayed folder path so MCPViews renders the marker as a folder and excludes it from preview, download, and delete file actions.

## Compatibility Notes

- The existing renderer key is `tribex_ai_thread`; keep it stable for now.
- The Tauri IPC commands are still named `first_party_ai_*`; providers do not call those directly.
- Providers should return JSON for API calls and use standard HTTP success/error codes.
- The compatibility client accepts both camelCase and snake_case for many fields, but new providers should prefer camelCase in examples and docs.
- A provider implementation can be much smaller than the full contract when it does not need packages, skills, connected accounts, pending human input, desktop relay, or workspace files.
