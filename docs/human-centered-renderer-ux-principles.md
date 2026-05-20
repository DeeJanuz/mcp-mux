# Human-Centered Renderer UX Principles

This standard applies to MCPViews renderers that turn platform workflows into user-facing tools. It is written for operational users who are capable in their domain but should not need to understand implementation details such as object IDs, storage paths, hashes, approval tokens, or API endpoints.

## Persona Baseline

Design the default path for a non-technical manager completing a real business task under time pressure. The interface should make the next step obvious, keep platform plumbing out of the critical path, and reserve raw diagnostics for support.

## Core Rules

1. No manual IDs, approval tokens, hashes, or durable storage paths in the default flow.
2. File and folder actions use browser-style pickers, breadcrumbs, search, and "New folder" by name.
3. Each step has one obvious next action.
4. Lay tasks out left to right and top to bottom.
5. No critical path should be deeper than three clicks into a submenu or modal.
6. Keep raw JSON, endpoint names, object IDs, hashes, and trace diagnostics under support details.
7. Prefer human labels, counts, previews, and summaries over platform record shapes.
8. Let the system generate safe defaults when it has enough context.
9. Preserve advanced details for support and auditability without making them required knowledge.
10. Make destructive or externally visible actions reviewable and explicit.

## Flow Model

Renderers should use a guided task flow when the user is assembling an outcome across multiple platform objects:

1. Choose the thing being worked on.
2. Choose or create the source material.
3. Refine or filter the working set.
4. Preview the result in plain language.
5. Run a low-risk test.
6. Approve the final action.
7. Show status and recovery options.

The stepper should communicate progress and readiness. The current step owns the primary action, while secondary actions stay nearby but visually quieter.

## File And Folder Interaction

Never require a user to type a storage path. Use a file-manager style surface with:

- A folder list or breadcrumb trail.
- Search or filtering for files.
- A "New folder" action that asks only for a folder name.
- A clear selected destination before save.
- A rename field for the file being saved.

Internally, renderers may still persist normalized paths and artifact refs, but those values belong in support details or metadata.

## Approval Interaction

Approval tokens are machine credentials. Users should approve by reading a clear review summary and clicking an approve/reject control. The backend should receive callback proof from the review system and mint any send/apply tokens internally.

## Support Details

Support details may include IDs, hashes, raw JSON, endpoint responses, and request diagnostics. They should be collapsed by default and labeled for troubleshooting, not presented as normal controls.

## Evidence Base

This standard follows widely adopted usability principles: recognition over recall, visibility of system status, error prevention, progressive disclosure, plain-language mapping between user intent and system action, and consistency with familiar file-browser patterns.
