# Persona Skill Composer

The MCPViews AI thread composer supports one persona skill per user message. Skills are loaded from the active thread/persona through the control plane, with `/email-analysis` available as the built-in first skill.

## User-Facing Behavior

- Type `/` in the composer to filter persona skills, press Enter to insert the first match, or use the Skills picker under the prompt.
- Selecting a skill inserts a visible `/skill-key` chip at the cursor location.
- Skill variables render as compact sub-chips under the prompt. The user can click a variable chip to edit it in place.
- V1 variable types are:
  - `email_account_multi_select`
  - `datetime`

## Email Analysis

`/email-analysis` uses these variables:

- `inboxes`: multi-select connected email accounts, defaulting to all connected accounts.
- `date_start`: datetime, defaulting to now minus 24 hours.
- `date_end`: datetime, defaulting to now.

Connected email account options are fetched as safe display data only: account id, provider, email address, display label, and status. Backend-only credentials and tokens must never be returned to the renderer.

## Runtime Contract

Skill sends split the user-visible transcript from the runtime instruction:

- `displayPrompt`: clean user-facing message plus skill and variable chip summary.
- `runtimePrompt`: hidden expanded skill prompt with variable substitutions.
- `skillInvocation`: structured metadata containing the skill key, variable values, and selected account display data.

The local optimistic UI and refreshed runtime transcripts render `displayPrompt`. The Cloudflare runtime receives `runtimePrompt` as the message text, with `displayPrompt` and `skillInvocation` stored in runtime message metadata so hydrated transcripts stay clean.

When no skill is selected, the composer preserves the existing plain prompt behavior.
