# Workspace File Browser

MCPViews can browse the active hosted AI provider workspace sandbox from the AI workspace UI. The desktop app does not need direct storage credentials; it only talks to the configured provider control plane and uses short-lived signed worker URLs returned by the sandbox file routes.

## MCPViews Configuration

Set the hosted AI provider control-plane URL and sign in through MCPViews:

```bash
MCPVIEWS_AI_PROVIDER_BASE_URL="https://ai.example.com"
```

You can also set `first_party_ai.base_url` in `~/.mcpviews/config.json`; the key name remains for compatibility with existing installs. Legacy `MCPVIEWS_FIRST_PARTY_AI_BASE_URL` and `PROPAASAI_BASE_URL` variables still work, but new providers should document the generic `MCPVIEWS_AI_PROVIDER_*` variables from [Hosted AI Thread Provider Contract](./hosted-ai-provider-contract.md). Use the AI workspace footer's sign-out action to clear the local session, relay token, and bundled hosted AI workspace plugin tokens before switching accounts. Do not put storage access keys, provider API tokens, or Cloudflare API tokens in MCPViews.

Native signed file download fallback only fetches trusted origins: the configured provider, relay, or device base URL origins, loopback HTTP origins for local development, and first-party `tribexai.com` subdomains when the configured provider is also under `tribexai.com`. If signed worker URLs are served from a separate origin, set `MCPVIEWS_AI_PROVIDER_DEVICE_BASE_URL` or `MCPVIEWS_AI_PROVIDER_RELAY_BASE_URL` to that origin.

## Provider / Worker Configuration

The hosted provider deployment owns the durable storage configuration. A bring-your-own Cloudflare setup can use variables like these on the control plane:

```bash
CLOUDFLARE_AGENTS_WORKER_URL="https://your-agents-worker.example.workers.dev"
CLOUDFLARE_R2_API_TOKEN="<api token with R2 bucket and temp credential permissions>"
CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID="<parent R2 access key id>"
CLOUDFLARE_R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
CLOUDFLARE_R2_TEMP_CREDENTIAL_TTL_SECONDS="900"
RUNTIME_SESSION_SECRET="<shared long secret>"
WORKSPACE_STORAGE_MASTER_KEY="<long key-wrapping secret>"
```

The Cloudflare Agents worker needs the matching runtime secret and control-plane URL:

```bash
RUNTIME_SESSION_SECRET="<same shared long secret>"
AI_PROVIDER_CONTROL_PLANE_URL="https://ai.example.com"
```

If the worker uses a local R2 binding for development, configure `USER_WORKSPACE_FILES_BUCKET_NAME` and `USER_WORKSPACE_FILES_LOCAL_BUCKET` in the worker environment. In hosted R2 mode, the provider mints temporary scoped credentials and the worker mounts the requested bucket/prefix for each signed operation.

## Supported Browser Actions

- List active workspace files.
- Create empty folders through `POST /workspaces/:workspaceId/user-sandbox/folders`.
- Upload single or multiple files through `POST /workspaces/:workspaceId/user-sandbox/files`.
- Upload folders through `POST /workspaces/:workspaceId/user-sandbox/file-batches`.
- Inspect metadata and preview text, JSON, CSV, Markdown, and image files.
- Download individual files through signed worker URLs. Native Tauri builds first try the direct WebView fetch and then fall back to a trusted-origin native fetch for signed `/__sandbox/workspace-file` downloads when the WebView blocks the request.
- Download folders as client-built zip files.
- Move individual files through `PATCH /workspaces/:workspaceId/user-sandbox/files/:fileId`.
- Move folders through `PATCH /workspaces/:workspaceId/user-sandbox/folders`.
- Delete individual files.

The browser renders provider folder markers as folders instead of user files. Folder marker files should set `metadata.isFolderMarker` to `true` and include `metadata.folderPath`. Folder deletion is intentionally not part of the first version.
