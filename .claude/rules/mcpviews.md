<!-- mcpviews-rules-version: 5 -->
# MCPViews Rules

## Renderer Selection

When displaying content in MCPViews, choose the renderer based on data shape:

- **rich_content**: Prose, explanations, diagrams (mermaid), code blocks, simple markdown tables (<10 rows), inline edit suggestions, embedded tables, plugin citations. Default choice. Use `push_review` when content includes suggestions or embedded table changes for user review.
- **structured_data**: Standalone tabular data with sort/filter/expand needs, hierarchical rows, or proposed changes requiring accept/reject review. Use `push_review` for change approval workflows. For batch MCP actions (2+ mutations), structured_data with `push_review` is mandatory.

Plugin tool output routes through `rich_content` with transformation rules defined in the plugin manifest. When uncertain, default to `rich_content`. Only use `structured_data` when the data is genuinely tabular and NOT embedded within a document.

## rich_content_usage

CALLER RESTRICTION: ONLY the main/coordinator agent may call push_content, push_review, and push_check. Sub-agents and background agents must NEVER call these tools — they return results to the coordinator, which decides what to push.

When to push (main agent only):
- Detailed explanations that benefit from structured formatting, diagrams, or tables
- Plan summaries for human review
- Architecture, data flows, system diagrams, API designs, database schemas
- Implementation plans with structural decisions
- Document reviews with inline edit suggestions (push_review)
- Combined prose + tabular data reviews (push_review)

Keep your chat response concise (context, next steps, decisions needed). The detailed explanation with mermaid diagrams, tables, and formatted markdown goes to push_content.

### Inline edit suggestions

Use `push_review` with `suggestions` object + `{{suggest:id=X}}` markers in body to propose text changes. Each suggestion gets accept/reject toggles and a comment button. Multiline values render as block-level diffs.

### Embedded tables

Use ` ```structured_data:tableId``` ` fenced blocks in body + `tables` array to embed interactive tables. Tables support full structured_data features (sort, filter, accept/reject, cell editing).

### Plugin citations

Use `[label](cite:plugin:SOURCE:TYPE:ID)` links to reference plugin entities. Clicking opens a slideout that lazy-fetches full data via companion proxy. Include metadata in `data.citations.plugin`.
