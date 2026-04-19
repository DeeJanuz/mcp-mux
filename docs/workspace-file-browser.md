# Workspace File Browser

MCPViews can browse the active ProPaasAI workspace sandbox from the AI workspace UI. The desktop app does not need direct Cloudflare R2 credentials; it only talks to the configured ProPaasAI control plane and uses short-lived signed worker URLs returned by the sandbox file routes.

## MCPViews Configuration

Set the normal first-party AI control-plane URL and sign in through MCPViews:

```bash
MCPVIEWS_FIRST_PARTY_AI_BASE_URL="https://your-propaasai.example.com"
```

You can also set `first_party_ai.base_url` in `~/.mcpviews/config.json`. Do not put R2 access keys or Cloudflare API tokens in MCPViews.

## ProPaasAI / Worker Configuration

The hosted ProPaasAI deployment owns the durable storage configuration. A bring-your-own Cloudflare setup needs these variables on the control plane:

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
TRIBEX_CONTROL_PLANE_URL="https://your-propaasai.example.com"
```

If the worker uses a local R2 binding for development, configure `USER_WORKSPACE_FILES_BUCKET_NAME` and `USER_WORKSPACE_FILES_LOCAL_BUCKET` in the worker environment. In hosted R2 mode, ProPaasAI mints temporary scoped credentials and the worker mounts the requested bucket/prefix for each signed operation.

## Supported Browser Actions

- List active workspace files.
- Upload single or multiple files through `POST /workspaces/:workspaceId/user-sandbox/files`.
- Upload folders through `POST /workspaces/:workspaceId/user-sandbox/file-batches`.
- Inspect metadata and preview text, JSON, CSV, Markdown, and image files.
- Download individual files through signed worker URLs.
- Download folders as client-built zip files.
- Delete individual files.

Folder deletion is intentionally not part of the first version.
