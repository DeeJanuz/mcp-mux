use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::AsyncAppState;

const DATASET_TTL: Duration = Duration::from_secs(30 * 60);
const DEFAULT_SOURCE_ID: &str = "default";
const LARGE_INLINE_ROW_WARNING_THRESHOLD: usize = 200;
const MAX_REFERENCE_FILE_BYTES: u64 = 2 * 1024 * 1024;
const REFERENCE_ROOTS_ENV: &str = "MCPVIEWS_DATASET_REFERENCE_ROOTS";

#[derive(Debug, Clone)]
struct DatasetSource {
    id: String,
    title: Option<String>,
    kind: String,
    columns: Vec<Value>,
    rows: Vec<Value>,
    structured_rows: bool,
    source_ref: Option<Value>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct DatasetEntry {
    dataset_id: String,
    query_token: String,
    title: Option<String>,
    sources: HashMap<String, DatasetSource>,
    source_order: Vec<String>,
    warnings: Vec<String>,
    inserted_at: Instant,
    ttl: Duration,
}

#[derive(Debug, Default)]
pub struct DatasetStore {
    entries: HashMap<String, DatasetEntry>,
}

impl DatasetStore {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    pub fn register(&mut self, arguments: Value) -> Result<Value, String> {
        self.gc();

        let object = arguments
            .as_object()
            .ok_or("register_dataset arguments must be a JSON object.".to_string())?;
        let dataset_id = string_field(object, &["dataset_id", "datasetId"])
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let query_token = uuid::Uuid::new_v4().to_string();
        let title = string_field(object, &["title", "name"]);
        let ttl = object
            .get("ttl_seconds")
            .or_else(|| object.get("ttlSeconds"))
            .and_then(Value::as_u64)
            .map(Duration::from_secs)
            .unwrap_or(DATASET_TTL);

        let mut sources = collect_sources(object)?;
        if sources.is_empty() {
            if let Some(existing) = self.entries.get(&dataset_id) {
                return Ok(summary_for_entry(existing));
            }
            return Err("register_dataset requires rows, data, tables, graphs, or sources with inline seed data.".to_string());
        }

        let mut source_order = Vec::new();
        let mut source_map = HashMap::new();
        let mut warnings = Vec::new();
        for source in sources.drain(..) {
            if source.rows.len() > LARGE_INLINE_ROW_WARNING_THRESHOLD {
                warnings.push(format!(
                    "Source `{}` registered {} inline rows. Use dataRef in renderer payloads to avoid repeating them.",
                    source.id,
                    source.rows.len()
                ));
            }
            warnings.extend(source.warnings.clone());
            source_order.push(source.id.clone());
            source_map.insert(source.id.clone(), source);
        }

        let entry = DatasetEntry {
            dataset_id: dataset_id.clone(),
            query_token,
            title,
            sources: source_map,
            source_order,
            warnings,
            inserted_at: Instant::now(),
            ttl,
        };
        let summary = summary_for_entry(&entry);
        self.entries.insert(dataset_id, entry);
        Ok(summary)
    }

    pub fn query(&mut self, arguments: Value) -> Result<Value, String> {
        self.gc();

        let object = arguments
            .as_object()
            .ok_or("Dataset query arguments must be a JSON object.".to_string())?;
        let dataset_id = string_field(object, &["dataset_id", "datasetId"])
            .ok_or("Dataset query requires dataset_id.".to_string())?;
        let entry = self.entries.get(&dataset_id).ok_or(format!(
            "Dataset `{}` was not found or has expired.",
            dataset_id
        ))?;
        let query_token = string_field(object, &["query_token", "queryToken", "token"])
            .ok_or("Dataset query requires query_token.".to_string())?;
        if query_token != entry.query_token {
            return Err("Dataset query requires a valid query_token.".to_string());
        }
        let source_id = string_field(object, &["source_id", "sourceId"])
            .or_else(|| entry.source_order.first().cloned())
            .unwrap_or_else(|| DEFAULT_SOURCE_ID.to_string());
        let source = entry.sources.get(&source_id).ok_or(format!(
            "Dataset `{}` has no source `{}`.",
            dataset_id, source_id
        ))?;
        let recipe = string_field(object, &["recipe"]).unwrap_or_else(|| "select_rows".to_string());
        let params = object
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let mut result = run_recipe(source, &recipe, &params)?;
        let offset = integer_field(object, &["offset"])
            .or_else(|| integer_field_map(&params, &["offset"]))
            .unwrap_or(0) as usize;
        let limit = integer_field(object, &["limit", "pageSize", "page_size"])
            .or_else(|| integer_field_map(&params, &["limit", "pageSize", "page_size"]))
            .map(|value| value as usize);
        let total_row_count = result.rows.len();
        if offset > 0 || limit.is_some() {
            let end = limit
                .map(|limit| offset.saturating_add(limit))
                .unwrap_or(total_row_count)
                .min(total_row_count);
            result.rows = if offset < total_row_count {
                result.rows[offset..end].to_vec()
            } else {
                Vec::new()
            };
        }

        let row_count = result.rows.len();
        Ok(serde_json::json!({
            "dataset_id": entry.dataset_id,
            "source_id": source.id,
            "recipe": recipe,
            "columns": result.columns,
            "rows": result.rows,
            "row_count": row_count,
            "total_row_count": total_row_count,
            "warnings": result.warnings,
        }))
    }

    pub fn gc(&mut self) -> usize {
        let before = self.entries.len();
        self.entries
            .retain(|_, entry| entry.inserted_at.elapsed() < entry.ttl);
        before - self.entries.len()
    }
}

struct RecipeResult {
    columns: Vec<Value>,
    rows: Vec<Value>,
    warnings: Vec<String>,
}

pub async fn call_register_dataset(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let summary = {
        let state_guard = state.lock().await;
        let mut datasets = state_guard.inner.datasets.lock().unwrap();
        datasets.register(arguments)?
    };

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&summary).unwrap()
        }]
    }))
}

pub async fn query_dataset(
    state: &Arc<TokioMutex<AsyncAppState>>,
    arguments: Value,
) -> Result<Value, String> {
    let state_guard = state.lock().await;
    let mut datasets = state_guard.inner.datasets.lock().unwrap();
    datasets.query(arguments)
}

fn collect_sources(object: &Map<String, Value>) -> Result<Vec<DatasetSource>, String> {
    let mut sources = Vec::new();

    if let Some(source_values) = object.get("sources").and_then(Value::as_array) {
        for (index, source_value) in source_values.iter().enumerate() {
            let (source_object, compatibility_warning) =
                source_object_from_value(source_value, index)?;
            let mut expanded_sources =
                sources_from_object(&source_object, &format!("source_{}", index + 1))?;
            if let (Some(warning), Some(first_source)) =
                (compatibility_warning, expanded_sources.first_mut())
            {
                first_source.warnings.push(warning);
            }
            sources.extend(expanded_sources);
        }
    }

    if let Some(tables) = object.get("tables").and_then(Value::as_array) {
        for (index, table) in tables.iter().enumerate() {
            if let Some(table_object) = table.as_object() {
                sources.push(source_from_table(
                    table_object,
                    &format!("table_{}", index + 1),
                )?);
            }
        }
    }

    if let Some(graphs) = object.get("graphs").and_then(Value::as_array) {
        for (index, graph) in graphs.iter().enumerate() {
            if let Some(graph_object) = graph.as_object() {
                sources.push(source_from_graph(
                    graph_object,
                    &format!("graph_{}", index + 1),
                )?);
            }
        }
    }

    if sources.is_empty() {
        if let Some(source) = source_from_top_level(object)? {
            sources.push(source);
        }
    }

    Ok(sources)
}

fn source_object_from_value(
    source_value: &Value,
    index: usize,
) -> Result<(Map<String, Value>, Option<String>), String> {
    if let Some(source_object) = source_value.as_object() {
        return Ok((source_object.clone(), None));
    }

    let Some(source_text) = source_value.as_str() else {
        return Err(format!(
            "register_dataset.sources[{}] must be an object.",
            index
        ));
    };
    let parsed: Value = serde_json::from_str(source_text).map_err(|err| {
        format!(
            "register_dataset.sources[{}] must be an object. The value was a string, but it was not valid JSON: {}.",
            index, err
        )
    })?;
    let Some(source_object) = parsed.as_object() else {
        return Err(format!(
            "register_dataset.sources[{}] must be an object. The stringified JSON parsed to {} instead.",
            index,
            value_kind(&parsed)
        ));
    };
    Ok((
        source_object.clone(),
        Some(format!(
            "register_dataset.sources[{}] was stringified JSON and was parsed automatically. Pass source objects directly to avoid wasted output tokens.",
            index
        )),
    ))
}

fn sources_from_object(
    object: &Map<String, Value>,
    fallback_id: &str,
) -> Result<Vec<DatasetSource>, String> {
    if let Some(sources) = sources_from_markdown_reference(object, fallback_id)? {
        return Ok(sources);
    }
    Ok(vec![source_from_object(object, fallback_id)?])
}

fn source_from_object(
    object: &Map<String, Value>,
    fallback_id: &str,
) -> Result<DatasetSource, String> {
    if let Some(table) = object.get("table").and_then(Value::as_object) {
        let mut source = source_from_table(table, fallback_id)?;
        source.id = string_field(object, &["id", "source_id", "sourceId"]).unwrap_or(source.id);
        source.kind =
            string_field(object, &["kind", "type"]).unwrap_or_else(|| "table".to_string());
        source.source_ref = source_reference(object);
        return Ok(source);
    }

    if let Some(graph) = object.get("graph").and_then(Value::as_object) {
        let mut source = source_from_graph(graph, fallback_id)?;
        source.id = string_field(object, &["id", "source_id", "sourceId"]).unwrap_or(source.id);
        source.kind =
            string_field(object, &["kind", "type"]).unwrap_or_else(|| "graph".to_string());
        source.source_ref = source_reference(object);
        return Ok(source);
    }

    let id = string_field(object, &["id", "source_id", "sourceId"])
        .unwrap_or_else(|| fallback_id.to_string());
    let title = string_field(object, &["title", "name"]);
    let kind = string_field(object, &["kind", "type"]).unwrap_or_else(|| "inline".to_string());
    let (columns, rows) = columns_rows_from_object(object)?;
    let source_ref = source_reference(object);
    let mut warnings = Vec::new();
    if rows.is_empty() && source_ref.is_some() {
        warnings.push(format!(
            "Source `{}` registered a reference only; V1 renderer recipes can render only inline seed data.",
            id
        ));
    }
    let structured_rows = rows.iter().any(is_structured_row);
    Ok(DatasetSource {
        id,
        title,
        kind,
        columns: normalize_columns(columns, &rows, structured_rows),
        rows,
        structured_rows,
        source_ref,
        warnings,
    })
}

fn source_from_top_level(object: &Map<String, Value>) -> Result<Option<DatasetSource>, String> {
    let has_rows = object.contains_key("rows")
        || object
            .get("data")
            .and_then(Value::as_object)
            .is_some_and(|data| data.contains_key("rows"));
    if !has_rows {
        return Ok(None);
    }
    let id = string_field(object, &["source_id", "sourceId", "id"])
        .unwrap_or_else(|| DEFAULT_SOURCE_ID.to_string());
    let title = string_field(object, &["title", "name"]);
    let (columns, rows) = columns_rows_from_object(object)?;
    let structured_rows = rows.iter().any(is_structured_row);
    Ok(Some(DatasetSource {
        id,
        title,
        kind: "inline".to_string(),
        columns: normalize_columns(columns, &rows, structured_rows),
        rows,
        structured_rows,
        source_ref: None,
        warnings: Vec::new(),
    }))
}

fn source_from_table(
    object: &Map<String, Value>,
    fallback_id: &str,
) -> Result<DatasetSource, String> {
    let id = string_field(object, &["id"]).unwrap_or_else(|| fallback_id.to_string());
    let title = string_field(object, &["name", "title"]);
    let columns = object
        .get("columns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let rows = object
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(DatasetSource {
        id,
        title,
        kind: "table".to_string(),
        columns: normalize_columns(columns, &rows, true),
        rows,
        structured_rows: true,
        source_ref: None,
        warnings: Vec::new(),
    })
}

fn source_from_graph(
    object: &Map<String, Value>,
    fallback_id: &str,
) -> Result<DatasetSource, String> {
    let id = string_field(object, &["id"]).unwrap_or_else(|| fallback_id.to_string());
    let title = string_field(object, &["title", "name"]);
    let data = object
        .get("data")
        .and_then(Value::as_object)
        .ok_or(format!(
            "Graph source `{}` must include data.columns and data.rows.",
            id
        ))?;
    let columns = data
        .get("columns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let rows = data
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(DatasetSource {
        id,
        title,
        kind: "graph".to_string(),
        columns: normalize_columns(columns, &rows, false),
        rows,
        structured_rows: false,
        source_ref: None,
        warnings: Vec::new(),
    })
}

fn sources_from_markdown_reference(
    object: &Map<String, Value>,
    fallback_id: &str,
) -> Result<Option<Vec<DatasetSource>>, String> {
    let kind = string_field(object, &["kind", "type", "extract"])
        .map(|value| normalize_kind(&value))
        .unwrap_or_default();
    let path = reference_path(object);
    let is_markdown_json = matches!(
        kind.as_str(),
        "markdown_json_blocks" | "markdown_json" | "json_blocks"
    );
    let is_markdown_table = matches!(
        kind.as_str(),
        "markdown_table" | "markdown_tables" | "markdown_pipe_table" | "markdown_pipe_tables"
    );
    let is_markdown_all = matches!(kind.as_str(), "markdown" | "markdown_sections");

    if !is_markdown_json && !is_markdown_table && !is_markdown_all {
        return Ok(None);
    }

    let path = path.ok_or(format!(
        "register_dataset source `{}` with kind `{}` requires a local path or file:// uri.",
        fallback_id, kind
    ))?;
    let path = validate_reference_path(&path)?;
    let content = read_reference_text(&path)?;
    let source_ref = source_reference(object);
    let mut sources = Vec::new();

    if is_markdown_json || is_markdown_all {
        sources.extend(markdown_json_block_sources(
            &content,
            object,
            fallback_id,
            source_ref.clone(),
        )?);
    }
    if is_markdown_table || is_markdown_all {
        sources.extend(markdown_table_sources(
            &content,
            object,
            fallback_id,
            source_ref,
        )?);
    }

    if sources.is_empty() {
        return Err(format!(
            "register_dataset source `{}` found no matching markdown data in `{}`.",
            fallback_id,
            path.display()
        ));
    }

    Ok(Some(apply_reference_id_options(sources, object)))
}

fn markdown_json_block_sources(
    content: &str,
    object: &Map<String, Value>,
    fallback_id: &str,
    source_ref: Option<Value>,
) -> Result<Vec<DatasetSource>, String> {
    let heading_filter = heading_filter(object);
    let mut sources = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut block_heading: Option<String> = None;
    let mut block = String::new();
    let mut in_json_block = false;

    for line in content.lines() {
        if !in_json_block {
            if let Some(heading) = markdown_heading(line) {
                current_heading = Some(heading);
                continue;
            }
        }

        let trimmed = line.trim();
        if in_json_block {
            if trimmed.starts_with("```") {
                let title = block_heading
                    .clone()
                    .unwrap_or_else(|| fallback_id.to_string());
                if heading_matches(&heading_filter, &title) {
                    let value: Value = serde_json::from_str(block.trim()).map_err(|err| {
                        format!("Could not parse markdown JSON block `{}`: {}.", title, err)
                    })?;
                    let id = sanitize_id(&title, sources.len());
                    sources.push(source_from_json_value(
                        value,
                        id,
                        Some(title),
                        "markdown_json_block",
                        source_ref.clone(),
                    )?);
                }
                block.clear();
                block_heading = None;
                in_json_block = false;
            } else {
                block.push_str(line);
                block.push('\n');
            }
            continue;
        }

        if trimmed == "```json" || trimmed.starts_with("```json ") {
            in_json_block = true;
            block_heading = current_heading.clone();
            block.clear();
        }
    }

    if in_json_block {
        return Err("Unclosed markdown JSON block in register_dataset source.".to_string());
    }

    Ok(sources)
}

fn markdown_table_sources(
    content: &str,
    object: &Map<String, Value>,
    fallback_id: &str,
    source_ref: Option<Value>,
) -> Result<Vec<DatasetSource>, String> {
    let heading_filter = heading_filter(object);
    let lines = content.lines().collect::<Vec<_>>();
    let mut sources = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut index = 0;

    while index < lines.len() {
        if let Some(heading) = markdown_heading(lines[index]) {
            current_heading = Some(heading);
            index += 1;
            continue;
        }

        if is_markdown_table_start(&lines, index) {
            let title = current_heading
                .clone()
                .unwrap_or_else(|| fallback_id.to_string());
            let mut table_lines = Vec::new();
            while index < lines.len() && lines[index].trim_start().starts_with('|') {
                table_lines.push(lines[index]);
                index += 1;
            }
            if heading_matches(&heading_filter, &title) {
                let id = sanitize_id(&title, sources.len());
                sources.push(source_from_markdown_table_lines(
                    &table_lines,
                    id,
                    Some(title),
                    source_ref.clone(),
                )?);
            }
            continue;
        }

        index += 1;
    }

    Ok(sources)
}

fn source_from_json_value(
    value: Value,
    id: String,
    title: Option<String>,
    kind: &str,
    source_ref: Option<Value>,
) -> Result<DatasetSource, String> {
    let (columns, rows) = match value {
        Value::Array(rows) => (Vec::new(), rows),
        Value::Object(object) => {
            let (columns, rows) = columns_rows_from_object(&object)?;
            if rows.is_empty() {
                (columns, vec![Value::Object(object)])
            } else {
                (columns, rows)
            }
        }
        other => (Vec::new(), vec![other]),
    };
    let structured_rows = rows.iter().any(is_structured_row);
    Ok(DatasetSource {
        id,
        title,
        kind: kind.to_string(),
        columns: normalize_columns(columns, &rows, structured_rows),
        rows,
        structured_rows,
        source_ref,
        warnings: Vec::new(),
    })
}

fn source_from_markdown_table_lines(
    lines: &[&str],
    id: String,
    title: Option<String>,
    source_ref: Option<Value>,
) -> Result<DatasetSource, String> {
    if lines.len() < 2 {
        return Err(format!(
            "Markdown table source `{}` must include a header and separator row.",
            id
        ));
    }
    let headers = parse_markdown_table_row(lines[0]);
    let columns = headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            serde_json::json!({
                "id": sanitize_id(header, index),
                "name": header,
                "change": Value::Null,
            })
        })
        .collect::<Vec<_>>();
    let rows = lines
        .iter()
        .skip(2)
        .filter_map(|line| {
            let cells = parse_markdown_table_row(line);
            if cells.is_empty() {
                return None;
            }
            let mut row = Map::new();
            for (index, header) in headers.iter().enumerate() {
                row.insert(
                    sanitize_id(header, index),
                    Value::String(cells.get(index).cloned().unwrap_or_default()),
                );
            }
            Some(Value::Object(row))
        })
        .collect::<Vec<_>>();

    Ok(DatasetSource {
        id,
        title,
        kind: "markdown_table".to_string(),
        columns: normalize_columns(columns, &rows, false),
        rows,
        structured_rows: false,
        source_ref,
        warnings: Vec::new(),
    })
}

fn apply_reference_id_options(
    mut sources: Vec<DatasetSource>,
    object: &Map<String, Value>,
) -> Vec<DatasetSource> {
    let source_id = string_field(object, &["id", "source_id", "sourceId"]);
    let id_prefix = string_field(object, &["id_prefix", "idPrefix"]);

    if sources.len() == 1 {
        if let Some(source_id) = source_id {
            sources[0].id = source_id;
        }
        return sources;
    }

    let prefix = id_prefix.or(source_id);
    if let Some(prefix) = prefix {
        let prefix = sanitize_id(&prefix, 0);
        for source in &mut sources {
            source.id = format!("{}_{}", prefix, source.id);
        }
    }

    sources
}

fn reference_path(object: &Map<String, Value>) -> Option<PathBuf> {
    let raw_path = string_field(object, &["path"]).or_else(|| {
        string_field(object, &["uri"])
            .and_then(|uri| uri.strip_prefix("file://").map(ToString::to_string))
    })?;
    let expanded = if raw_path == "~" {
        std::env::var("HOME").ok().map(PathBuf::from)?
    } else if let Some(rest) = raw_path.strip_prefix("~/") {
        std::env::var("HOME").ok().map(PathBuf::from)?.join(rest)
    } else {
        PathBuf::from(raw_path)
    };
    Some(expanded)
}

fn allowed_reference_roots() -> Vec<PathBuf> {
    let mut roots = std::env::var_os(REFERENCE_ROOTS_ENV)
        .map(|value| {
            std::env::split_paths(&value)
                .filter(|path| !path.as_os_str().is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    roots.push(mcpviews_shared::cache_dir().join("dataset-references"));
    roots
}

fn validate_reference_path(path: &Path) -> Result<PathBuf, String> {
    let canonical_path = fs::canonicalize(path).map_err(|err| {
        format!(
            "Could not resolve dataset reference `{}`: {}.",
            path.display(),
            err
        )
    })?;
    if !canonical_path.is_file() {
        return Err(format!(
            "Dataset reference `{}` must be a regular file.",
            canonical_path.display()
        ));
    }

    let allowed_roots = allowed_reference_roots()
        .into_iter()
        .filter_map(|root| fs::canonicalize(root).ok())
        .collect::<Vec<_>>();
    if allowed_roots
        .iter()
        .any(|root| canonical_path.starts_with(root))
    {
        return Ok(canonical_path);
    }

    Err(format!(
        "Dataset reference `{}` is outside the allowed roots. Move the file under `{}` or set {} to one or more trusted directories.",
        canonical_path.display(),
        mcpviews_shared::cache_dir().join("dataset-references").display(),
        REFERENCE_ROOTS_ENV
    ))
}

fn read_reference_text(path: &PathBuf) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "Could not read dataset reference `{}`: {}.",
            path.display(),
            err
        )
    })?;
    if metadata.len() > MAX_REFERENCE_FILE_BYTES {
        return Err(format!(
            "Dataset reference `{}` is {} bytes; maximum supported size is {} bytes.",
            path.display(),
            metadata.len(),
            MAX_REFERENCE_FILE_BYTES
        ));
    }
    fs::read_to_string(path).map_err(|err| {
        format!(
            "Could not read dataset reference `{}` as UTF-8 text: {}.",
            path.display(),
            err
        )
    })
}

fn markdown_heading(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let marker_len = trimmed.chars().take_while(|ch| *ch == '#').count();
    if marker_len == 0 || marker_len >= trimmed.len() {
        return None;
    }
    let rest = trimmed.get(marker_len..)?.trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.trim_matches('#').trim().to_string())
    }
}

fn is_markdown_table_start(lines: &[&str], index: usize) -> bool {
    if index + 1 >= lines.len() {
        return false;
    }
    lines[index].trim_start().starts_with('|') && is_markdown_table_separator(lines[index + 1])
}

fn is_markdown_table_separator(line: &str) -> bool {
    let cells = parse_markdown_table_row(line);
    !cells.is_empty()
        && cells.iter().all(|cell| {
            let trimmed = cell.trim();
            trimmed.len() >= 3
                && trimmed.chars().all(|ch| matches!(ch, '-' | ':' | ' '))
                && trimmed.chars().any(|ch| ch == '-')
        })
}

fn parse_markdown_table_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_string())
        .collect()
}

fn heading_filter(object: &Map<String, Value>) -> Vec<String> {
    let mut headings = Vec::new();
    if let Some(heading) = string_field(object, &["heading", "section"]) {
        headings.push(normalize_heading(&heading));
    }
    for key in ["headings", "sections"] {
        if let Some(values) = object.get(key).and_then(Value::as_array) {
            headings.extend(
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(normalize_heading),
            );
        }
    }
    headings
}

fn heading_matches(filter: &[String], heading: &str) -> bool {
    filter.is_empty()
        || filter
            .iter()
            .any(|candidate| candidate == &normalize_heading(heading))
}

fn normalize_heading(value: &str) -> String {
    sanitize_id(value, 0)
}

fn normalize_kind(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['-', ' '], "_")
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn columns_rows_from_object(
    object: &Map<String, Value>,
) -> Result<(Vec<Value>, Vec<Value>), String> {
    if let Some(data) = object.get("data").and_then(Value::as_object) {
        let columns = data
            .get("columns")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let rows = data
            .get("rows")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        return Ok((columns, rows));
    }

    let columns = object
        .get("columns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let rows = object
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok((columns, rows))
}

fn source_reference(object: &Map<String, Value>) -> Option<Value> {
    let mut reference = Map::new();
    for key in ["path", "uri", "url", "manifest", "reference"] {
        if let Some(value) = object.get(key) {
            reference.insert(key.to_string(), value.clone());
        }
    }
    if reference.is_empty() {
        None
    } else {
        Some(Value::Object(reference))
    }
}

fn normalize_columns(columns: Vec<Value>, rows: &[Value], structured_rows: bool) -> Vec<Value> {
    let mut normalized = if columns.is_empty() {
        infer_columns(rows, structured_rows)
    } else {
        columns
    };

    for (index, column) in normalized.iter_mut().enumerate() {
        match column {
            Value::String(name) => {
                let id = sanitize_id(name, index);
                *column = serde_json::json!({
                    "id": id,
                    "name": name,
                    "change": Value::Null,
                });
            }
            Value::Object(map) => {
                if !map.contains_key("id") {
                    let fallback = map.get("name").and_then(Value::as_str).unwrap_or("column");
                    map.insert(
                        "id".to_string(),
                        Value::String(sanitize_id(fallback, index)),
                    );
                }
                if !map.contains_key("name") {
                    let fallback = map
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("Column")
                        .to_string();
                    map.insert("name".to_string(), Value::String(fallback));
                }
                if structured_rows && !map.contains_key("change") {
                    map.insert("change".to_string(), Value::Null);
                }
            }
            _ => {
                *column = serde_json::json!({
                    "id": format!("column_{}", index + 1),
                    "name": format!("Column {}", index + 1),
                    "change": Value::Null,
                });
            }
        }
    }

    normalized
}

fn infer_columns(rows: &[Value], structured_rows: bool) -> Vec<Value> {
    let Some(first) = rows.iter().find_map(Value::as_object) else {
        return Vec::new();
    };
    let keys: Vec<String> = if structured_rows {
        first
            .get("cells")
            .and_then(Value::as_object)
            .map(|cells| cells.keys().cloned().collect())
            .unwrap_or_default()
    } else {
        first
            .keys()
            .filter(|key| key.as_str() != "children")
            .cloned()
            .collect()
    };
    keys.into_iter()
        .enumerate()
        .map(|(index, key)| {
            serde_json::json!({
                "id": if key.trim().is_empty() { format!("column_{}", index + 1) } else { key.clone() },
                "name": titleize(&key),
                "change": Value::Null,
            })
        })
        .collect()
}

fn run_recipe(
    source: &DatasetSource,
    recipe: &str,
    params: &Map<String, Value>,
) -> Result<RecipeResult, String> {
    match recipe {
        "select_rows" | "selectRows" => Ok(select_rows(source, params)),
        "review_rows" | "reviewRows" => Ok(review_rows(source)),
        "count_by" | "countBy" => count_by(source, params),
        "group_sum" | "groupSum" => group_sum(source, params),
        "trend" => trend(source, params),
        "heatmap_by_pair" | "heatmapByPair" => heatmap_by_pair(source, params),
        "funnel_from_counts" | "funnelFromCounts" => funnel_from_counts(source, params),
        "waterfall_from_deltas" | "waterfallFromDeltas" => waterfall_from_deltas(source, params),
        other => Err(format!("Unsupported dataset recipe `{}`.", other)),
    }
}

fn select_rows(source: &DatasetSource, params: &Map<String, Value>) -> RecipeResult {
    let columns_filter = params
        .get("columns")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if columns_filter.is_empty() {
        return RecipeResult {
            columns: source.columns.clone(),
            rows: source.rows.clone(),
            warnings: source.warnings.clone(),
        };
    }

    let columns = source
        .columns
        .iter()
        .filter(|column| {
            column
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| columns_filter.iter().any(|candidate| candidate == id))
        })
        .cloned()
        .collect::<Vec<_>>();
    let rows = source
        .rows
        .iter()
        .map(|row| project_row(row, &columns_filter, source.structured_rows))
        .collect();

    RecipeResult {
        columns,
        rows,
        warnings: source.warnings.clone(),
    }
}

fn review_rows(source: &DatasetSource) -> RecipeResult {
    let columns = normalize_columns(source.columns.clone(), &source.rows, true);
    if source.structured_rows {
        let rows = source
            .rows
            .iter()
            .enumerate()
            .map(|(index, row)| normalize_structured_row(row, index))
            .collect();
        return RecipeResult {
            columns,
            rows,
            warnings: source.warnings.clone(),
        };
    }

    let column_ids = columns
        .iter()
        .filter_map(|column| {
            column
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .collect::<Vec<_>>();
    let rows = source
        .rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let mut cells = Map::new();
            for column_id in &column_ids {
                cells.insert(
                    column_id.clone(),
                    serde_json::json!({
                        "value": row_value(row, column_id).cloned().unwrap_or(Value::Null),
                        "change": Value::Null,
                    }),
                );
            }
            serde_json::json!({
                "id": row_id(row, index),
                "cells": cells,
                "children": [],
            })
        })
        .collect();

    RecipeResult {
        columns,
        rows,
        warnings: source.warnings.clone(),
    }
}

fn count_by(source: &DatasetSource, params: &Map<String, Value>) -> Result<RecipeResult, String> {
    let field = required_param(params, &["field", "groupBy", "group_by"])?;
    let label = titleize(&field);
    let mut groups: BTreeMap<String, usize> = BTreeMap::new();
    for row in &source.rows {
        let key = string_key(row_value(row, &field));
        *groups.entry(key).or_insert(0) += 1;
    }
    let rows = groups
        .into_iter()
        .map(|(key, count)| serde_json::json!({ field.clone(): key, "count": count }))
        .collect();
    Ok(RecipeResult {
        columns: vec![
            serde_json::json!({ "id": field, "name": label }),
            serde_json::json!({ "id": "count", "name": "Count", "type": "number" }),
        ],
        rows,
        warnings: source.warnings.clone(),
    })
}

fn group_sum(source: &DatasetSource, params: &Map<String, Value>) -> Result<RecipeResult, String> {
    let group_field = required_param(params, &["groupBy", "group_by", "field"])?;
    let value_field = required_param(params, &["value", "valueField", "value_field"])?;
    let output_field = string_field_map(params, &["outputField", "output_field"])
        .unwrap_or_else(|| "value".to_string());
    let mut groups: BTreeMap<String, f64> = BTreeMap::new();
    for row in &source.rows {
        let key = string_key(row_value(row, &group_field));
        let value = row_value(row, &value_field)
            .and_then(number_value)
            .unwrap_or(0.0);
        *groups.entry(key).or_insert(0.0) += value;
    }
    let rows = groups
        .into_iter()
        .map(|(key, value)| serde_json::json!({ group_field.clone(): key, output_field.clone(): value }))
        .collect();
    Ok(RecipeResult {
        columns: vec![
            serde_json::json!({ "id": group_field, "name": titleize(&group_field) }),
            serde_json::json!({ "id": output_field, "name": titleize(&value_field), "type": "number" }),
        ],
        rows,
        warnings: source.warnings.clone(),
    })
}

fn trend(source: &DatasetSource, params: &Map<String, Value>) -> Result<RecipeResult, String> {
    let x_field = required_param(
        params,
        &[
            "x",
            "date",
            "dateField",
            "date_field",
            "groupBy",
            "group_by",
        ],
    )?;
    let y_field = required_param(params, &["y", "value", "valueField", "value_field"])?;
    let mut groups: BTreeMap<String, f64> = BTreeMap::new();
    for row in &source.rows {
        let key = string_key(row_value(row, &x_field));
        let value = row_value(row, &y_field)
            .and_then(number_value)
            .unwrap_or(0.0);
        *groups.entry(key).or_insert(0.0) += value;
    }
    let rows = groups
        .into_iter()
        .map(|(key, value)| serde_json::json!({ x_field.clone(): key, y_field.clone(): value }))
        .collect();
    Ok(RecipeResult {
        columns: vec![
            serde_json::json!({ "id": x_field, "name": titleize(&x_field), "type": "date" }),
            serde_json::json!({ "id": y_field, "name": titleize(&y_field), "type": "number" }),
        ],
        rows,
        warnings: source.warnings.clone(),
    })
}

fn heatmap_by_pair(
    source: &DatasetSource,
    params: &Map<String, Value>,
) -> Result<RecipeResult, String> {
    let x_field = required_param(params, &["x", "xField", "x_field"])?;
    let y_field = required_param(params, &["y", "yField", "y_field"])?;
    let value_field = string_field_map(params, &["value", "valueField", "value_field"]);
    let output_field = value_field.clone().unwrap_or_else(|| "count".to_string());
    let mut groups: BTreeMap<(String, String), f64> = BTreeMap::new();
    for row in &source.rows {
        let x = string_key(row_value(row, &x_field));
        let y = string_key(row_value(row, &y_field));
        let value = value_field
            .as_deref()
            .and_then(|field| row_value(row, field))
            .and_then(number_value)
            .unwrap_or(1.0);
        *groups.entry((x, y)).or_insert(0.0) += value;
    }
    let rows = groups
        .into_iter()
        .map(|((x, y), value)| serde_json::json!({ x_field.clone(): x, y_field.clone(): y, output_field.clone(): value }))
        .collect();
    Ok(RecipeResult {
        columns: vec![
            serde_json::json!({ "id": x_field, "name": titleize(&x_field) }),
            serde_json::json!({ "id": y_field, "name": titleize(&y_field) }),
            serde_json::json!({ "id": output_field, "name": titleize(&output_field), "type": "number" }),
        ],
        rows,
        warnings: source.warnings.clone(),
    })
}

fn funnel_from_counts(
    source: &DatasetSource,
    params: &Map<String, Value>,
) -> Result<RecipeResult, String> {
    if let Some(stages) = params.get("stages").and_then(Value::as_array) {
        let rows = stages
            .iter()
            .filter_map(|stage| {
                let object = stage.as_object()?;
                let label = string_field(object, &["label", "stage", "name"])?;
                let count = object
                    .get("count")
                    .or_else(|| object.get("value"))
                    .and_then(number_value)
                    .unwrap_or(0.0);
                Some(serde_json::json!({ "stage": label, "count": count }))
            })
            .collect();
        return Ok(RecipeResult {
            columns: vec![
                serde_json::json!({ "id": "stage", "name": "Stage" }),
                serde_json::json!({ "id": "count", "name": "Count", "type": "number" }),
            ],
            rows,
            warnings: source.warnings.clone(),
        });
    }

    let stage_field = string_field_map(
        params,
        &[
            "stage",
            "stageField",
            "stage_field",
            "label",
            "labelField",
            "label_field",
        ],
    )
    .unwrap_or_else(|| "stage".to_string());
    let count_field = string_field_map(
        params,
        &[
            "count",
            "countField",
            "count_field",
            "value",
            "valueField",
            "value_field",
        ],
    )
    .unwrap_or_else(|| "count".to_string());
    Ok(RecipeResult {
        columns: vec![
            serde_json::json!({ "id": stage_field.clone(), "name": titleize(&stage_field) }),
            serde_json::json!({ "id": count_field.clone(), "name": titleize(&count_field), "type": "number" }),
        ],
        rows: source
            .rows
            .iter()
            .map(|row| {
                serde_json::json!({
                    stage_field.clone(): row_value(row, &stage_field).cloned().unwrap_or(Value::Null),
                    count_field.clone(): row_value(row, &count_field).cloned().unwrap_or(Value::Null),
                })
            })
            .collect(),
        warnings: source.warnings.clone(),
    })
}

fn waterfall_from_deltas(
    source: &DatasetSource,
    params: &Map<String, Value>,
) -> Result<RecipeResult, String> {
    let label_field = string_field_map(params, &["label", "labelField", "label_field"])
        .unwrap_or_else(|| "label".to_string());
    let value_field = string_field_map(
        params,
        &[
            "value",
            "valueField",
            "value_field",
            "delta",
            "deltaField",
            "delta_field",
        ],
    )
    .unwrap_or_else(|| "value".to_string());
    Ok(RecipeResult {
        columns: vec![
            serde_json::json!({ "id": label_field.clone(), "name": titleize(&label_field) }),
            serde_json::json!({ "id": value_field.clone(), "name": titleize(&value_field), "type": "number" }),
        ],
        rows: source
            .rows
            .iter()
            .map(|row| {
                serde_json::json!({
                    label_field.clone(): row_value(row, &label_field).cloned().unwrap_or(Value::Null),
                    value_field.clone(): row_value(row, &value_field).cloned().unwrap_or(Value::Null),
                })
            })
            .collect(),
        warnings: source.warnings.clone(),
    })
}

fn project_row(row: &Value, columns: &[String], structured_rows: bool) -> Value {
    if structured_rows {
        let mut next = normalize_structured_row(row, 0);
        if let Some(cells) = next.get_mut("cells").and_then(Value::as_object_mut) {
            cells.retain(|key, _| columns.iter().any(|column| column == key));
        }
        return next;
    }

    let mut map = Map::new();
    for column in columns {
        if let Some(value) = row_value(row, column) {
            map.insert(column.clone(), value.clone());
        }
    }
    Value::Object(map)
}

fn normalize_structured_row(row: &Value, index: usize) -> Value {
    let Some(object) = row.as_object() else {
        return serde_json::json!({
            "id": format!("row_{}", index + 1),
            "cells": {},
            "children": [],
        });
    };
    let mut next = object.clone();
    if !next.contains_key("id") {
        next.insert(
            "id".to_string(),
            Value::String(format!("row_{}", index + 1)),
        );
    }
    if !next.contains_key("cells") {
        next.insert("cells".to_string(), Value::Object(Map::new()));
    }
    if !next.contains_key("children") {
        next.insert("children".to_string(), Value::Array(Vec::new()));
    }
    Value::Object(next)
}

fn summary_for_entry(entry: &DatasetEntry) -> Value {
    let sources = entry
        .source_order
        .iter()
        .filter_map(|id| entry.sources.get(id))
        .map(summary_for_source)
        .collect::<Vec<_>>();
    let row_count: usize = entry.sources.values().map(|source| source.rows.len()).sum();
    serde_json::json!({
        "dataset_id": entry.dataset_id,
        "query_token": entry.query_token,
        "title": entry.title,
        "status": "registered",
        "source_count": entry.sources.len(),
        "row_count": row_count,
        "sources": sources,
        "warnings": entry.warnings,
    })
}

fn summary_for_source(source: &DatasetSource) -> Value {
    serde_json::json!({
        "source_id": source.id,
        "title": source.title,
        "kind": source.kind,
        "row_count": source.rows.len(),
        "column_count": source.columns.len(),
        "columns": source.columns.iter().map(column_summary).collect::<Vec<_>>(),
        "hash": hash_value(&serde_json::json!({
            "columns": source.columns,
            "rows": source.rows,
            "source_ref": source.source_ref,
        })),
        "warnings": source.warnings,
    })
}

fn column_summary(column: &Value) -> Value {
    serde_json::json!({
        "id": column.get("id").cloned().unwrap_or(Value::Null),
        "name": column.get("name").cloned().unwrap_or(Value::Null),
        "type": column.get("type").cloned().unwrap_or(Value::Null),
    })
}

fn hash_value(value: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(serde_json::to_vec(value).unwrap_or_default());
    let digest = hasher.finalize();
    format!("{:x}", digest)
}

fn row_value<'a>(row: &'a Value, field: &str) -> Option<&'a Value> {
    let object = row.as_object()?;
    if let Some(value) = object.get(field) {
        return Some(value);
    }
    object
        .get("cells")
        .and_then(Value::as_object)
        .and_then(|cells| cells.get(field))
        .and_then(|cell| {
            cell.get("value")
                .or_else(|| if cell.is_object() { None } else { Some(cell) })
        })
}

fn row_id(row: &Value, index: usize) -> String {
    row.as_object()
        .and_then(|object| object.get("id").or_else(|| object.get("_id")))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("row_{}", index + 1))
}

fn is_structured_row(row: &Value) -> bool {
    row.get("cells").is_some()
}

fn number_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64().filter(|value| value.is_finite()),
        Value::String(text) => text
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite()),
        _ => None,
    }
}

fn string_key(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn required_param(params: &Map<String, Value>, names: &[&str]) -> Result<String, String> {
    string_field_map(params, names)
        .ok_or(format!("Dataset recipe requires parameter `{}`.", names[0]))
}

fn string_field(object: &Map<String, Value>, names: &[&str]) -> Option<String> {
    string_field_map(object, names)
}

fn string_field_map(object: &Map<String, Value>, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(text) = object.get(*name).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn integer_field(object: &Map<String, Value>, names: &[&str]) -> Option<u64> {
    integer_field_map(object, names)
}

fn integer_field_map(object: &Map<String, Value>, names: &[&str]) -> Option<u64> {
    for name in names {
        if let Some(value) = object.get(*name).and_then(Value::as_u64) {
            return Some(value);
        }
    }
    None
}

fn sanitize_id(value: &str, index: usize) -> String {
    let id = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if id.is_empty() {
        format!("column_{}", index + 1)
    } else {
        id
    }
}

fn titleize(value: &str) -> String {
    let text = value
        .replace(['_', '-'], " ")
        .split_whitespace()
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        "Value".to_string()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    static REFERENCE_ROOTS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn query_token(summary: &Value) -> String {
        summary["query_token"].as_str().unwrap().to_string()
    }

    fn with_reference_root<T>(root: &std::path::Path, f: impl FnOnce() -> T) -> T {
        let lock = REFERENCE_ROOTS_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock.lock().unwrap();
        let old_value = std::env::var_os(REFERENCE_ROOTS_ENV);
        std::env::set_var(REFERENCE_ROOTS_ENV, root);
        let result = f();
        if let Some(value) = old_value {
            std::env::set_var(REFERENCE_ROOTS_ENV, value);
        } else {
            std::env::remove_var(REFERENCE_ROOTS_ENV);
        }
        result
    }

    #[test]
    fn allowed_reference_roots_ignores_empty_env_entries() {
        let lock = REFERENCE_ROOTS_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock.lock().unwrap();
        let old_value = std::env::var_os(REFERENCE_ROOTS_ENV);
        std::env::set_var(REFERENCE_ROOTS_ENV, "");

        let roots = allowed_reference_roots();

        if let Some(value) = old_value {
            std::env::set_var(REFERENCE_ROOTS_ENV, value);
        } else {
            std::env::remove_var(REFERENCE_ROOTS_ENV);
        }

        assert!(roots.iter().all(|root| !root.as_os_str().is_empty()));
    }

    #[test]
    fn registers_inline_rows_and_returns_schema_summary() {
        let mut store = DatasetStore::new();
        let result = store
            .register(serde_json::json!({
                "dataset_id": "risk",
                "rows": [
                    { "rule": "Cap", "score": 2 },
                    { "rule": "Liquidity", "score": 3 }
                ]
            }))
            .unwrap();

        assert_eq!(result["dataset_id"], "risk");
        assert!(result["query_token"].as_str().unwrap().len() > 20);
        assert_eq!(result["row_count"], 2);
        assert_eq!(result["sources"][0]["columns"][0]["id"], "rule");
    }

    #[test]
    fn group_sum_recipe_aggregates_rows() {
        let mut store = DatasetStore::new();
        let summary = store
            .register(serde_json::json!({
                "dataset_id": "risk",
                "rows": [
                    { "rule": "Cap", "score": 2 },
                    { "rule": "Cap", "score": 5 },
                    { "rule": "Liquidity", "score": 3 }
                ]
            }))
            .unwrap();
        let token = query_token(&summary);

        let result = store
            .query(serde_json::json!({
                "dataset_id": "risk",
                "query_token": token,
                "recipe": "group_sum",
                "params": { "groupBy": "rule", "value": "score" }
            }))
            .unwrap();

        assert_eq!(result["rows"][0]["rule"], "Cap");
        assert_eq!(result["rows"][0]["value"], 7.0);
        assert_eq!(result["rows"][1]["rule"], "Liquidity");
    }

    #[test]
    fn review_rows_converts_raw_rows_to_structured_rows() {
        let mut store = DatasetStore::new();
        let summary = store
            .register(serde_json::json!({
                "dataset_id": "tasks",
                "rows": [{ "action": "create", "target": "Decision" }]
            }))
            .unwrap();
        let token = query_token(&summary);

        let result = store
            .query(serde_json::json!({
                "dataset_id": "tasks",
                "query_token": token,
                "recipe": "review_rows"
            }))
            .unwrap();

        assert_eq!(result["columns"][0]["change"], Value::Null);
        assert_eq!(result["rows"][0]["id"], "row_1");
        assert_eq!(result["rows"][0]["cells"]["action"]["value"], "create");
    }

    #[test]
    fn missing_dataset_returns_error() {
        let mut store = DatasetStore::new();
        let err = store
            .query(serde_json::json!({
                "dataset_id": "missing",
                "recipe": "select_rows"
            }))
            .unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn query_requires_valid_query_token() {
        let mut store = DatasetStore::new();
        store
            .register(serde_json::json!({
                "dataset_id": "risk",
                "rows": [{ "rule": "Cap" }]
            }))
            .unwrap();

        let missing = store
            .query(serde_json::json!({
                "dataset_id": "risk",
                "recipe": "select_rows"
            }))
            .unwrap_err();
        assert!(missing.contains("query_token"));

        let wrong = store
            .query(serde_json::json!({
                "dataset_id": "risk",
                "query_token": "not-the-token",
                "recipe": "select_rows"
            }))
            .unwrap_err();
        assert!(wrong.contains("valid query_token"));
    }

    #[test]
    fn register_dataset_parses_stringified_source_objects_with_warning() {
        let mut store = DatasetStore::new();
        let source = serde_json::json!({
            "id": "risk",
            "columns": [{ "id": "rule", "name": "Rule" }],
            "rows": [{ "rule": "Cap" }]
        })
        .to_string();

        let result = store
            .register(serde_json::json!({
                "dataset_id": "stringified",
                "sources": [source]
            }))
            .unwrap();

        assert_eq!(result["dataset_id"], "stringified");
        assert_eq!(result["row_count"], 1);
        assert_eq!(result["sources"][0]["source_id"], "risk");
        assert!(result["warnings"][0]
            .as_str()
            .unwrap()
            .contains("stringified JSON"));
    }

    #[test]
    fn register_dataset_loads_markdown_json_blocks_from_local_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("findings.md");
        fs::write(
            &path,
            r#"# Findings

### Source Fact Compression

```json
[
  { "stage": "Rule evaluations", "count": 386 },
  { "stage": "Recommended evidence reviews", "count": 6 }
]
```

### Residual Risk Movement

```json
[
  { "driver": "Opening model risk", "risk_points": 272 },
  { "driver": "Resolved deviations", "risk_points": -80 }
]
```
"#,
        )
        .unwrap();

        let mut store = DatasetStore::new();
        let result = with_reference_root(dir.path(), || {
            store
                .register(serde_json::json!({
                    "dataset_id": "northstar",
                    "sources": [{
                        "kind": "markdown_json_blocks",
                        "path": path.to_string_lossy()
                    }]
                }))
                .unwrap()
        });
        let token = query_token(&result);

        assert_eq!(result["source_count"], 2);
        assert_eq!(result["sources"][0]["source_id"], "source_fact_compression");
        assert_eq!(result["sources"][0]["row_count"], 2);
        assert_eq!(result["sources"][1]["source_id"], "residual_risk_movement");

        let query = store
            .query(serde_json::json!({
                "dataset_id": "northstar",
                "query_token": token,
                "source_id": "source_fact_compression",
                "recipe": "funnel_from_counts"
            }))
            .unwrap();
        assert_eq!(query["rows"][0]["stage"], "Rule evaluations");
        assert_eq!(query["rows"][0]["count"], 386);
    }

    #[test]
    fn register_dataset_loads_markdown_table_section_from_local_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("findings.md");
        fs::write(
            &path,
            r#"# Findings

## Recommended Evidence Reviews

| Priority | Control question | Assigned reviewer |
| --- | --- | --- |
| P0 | Did the sector-cap exception receive approval? | Grace Holloway |
| P1 | Was the rebalance supported by evidence? | Alina Torres |
"#,
        )
        .unwrap();

        let mut store = DatasetStore::new();
        let summary = with_reference_root(dir.path(), || {
            store
                .register(serde_json::json!({
                    "dataset_id": "northstar",
                    "sources": [{
                        "id": "recommended_evidence_reviews",
                        "kind": "markdown_table",
                        "path": path.to_string_lossy(),
                        "heading": "Recommended Evidence Reviews"
                    }]
                }))
                .unwrap()
        });
        let token = query_token(&summary);

        let query = store
            .query(serde_json::json!({
                "dataset_id": "northstar",
                "query_token": token,
                "source_id": "recommended_evidence_reviews",
                "recipe": "review_rows"
            }))
            .unwrap();

        assert_eq!(query["rows"][0]["cells"]["priority"]["value"], "P0");
        assert_eq!(
            query["rows"][0]["cells"]["assigned_reviewer"]["value"],
            "Grace Holloway"
        );
    }

    #[test]
    fn register_dataset_rejects_markdown_reference_outside_allowed_roots() {
        let allowed_dir = tempfile::tempdir().unwrap();
        let blocked_dir = tempfile::tempdir().unwrap();
        let path = blocked_dir.path().join("findings.md");
        fs::write(
            &path,
            r#"# Findings

```json
[{ "stage": "Rule evaluations", "count": 1 }]
```
"#,
        )
        .unwrap();

        let mut store = DatasetStore::new();
        let err = with_reference_root(allowed_dir.path(), || {
            store
                .register(serde_json::json!({
                    "dataset_id": "blocked",
                    "sources": [{
                        "kind": "markdown_json_blocks",
                        "path": path.to_string_lossy()
                    }]
                }))
                .unwrap_err()
        });
        assert!(err.contains("outside the allowed roots"));
    }

    #[test]
    fn northstar_style_fixture_semantic_payload_is_smaller_and_equivalent() {
        let mut source_rows = Vec::new();
        let rules = [
            "Technology sector cap",
            "Managed futures allocation",
            "Quality compounder exposure",
            "Liquidity guardrail",
        ];
        let segments = ["portfolio", "model", "approval", "evidence"];
        for index in 0..64 {
            source_rows.push(serde_json::json!({
                "decision_id": format!("NS-{:03}", index + 1),
                "decision": format!("Rebalance sleeve {}", index + 1),
                "rule": rules[index % rules.len()],
                "segment": segments[index % segments.len()],
                "evidence": format!("prepared-findings.md#finding-{}", index + 1),
                "severity": if index % 7 == 0 { "P0" } else if index % 3 == 0 { "P1" } else { "P2" },
                "pressure": (index % 5) + 1,
                "delta": (index as i64 % 9) - 4
            }));
        }

        let register_payload = serde_json::json!({
            "dataset_id": "northstar-risk-control-2026-05",
            "rows": source_rows
        });

        let mut store = DatasetStore::new();
        let summary = store.register(register_payload.clone()).unwrap();
        let token = query_token(&summary);

        let hydrated_review_rows = store
            .query(serde_json::json!({
                "dataset_id": "northstar-risk-control-2026-05",
                "query_token": token.clone(),
                "recipe": "review_rows"
            }))
            .unwrap();
        let hydrated_rule_pressure = store
            .query(serde_json::json!({
                "dataset_id": "northstar-risk-control-2026-05",
                "query_token": token.clone(),
                "recipe": "group_sum",
                "params": { "groupBy": "rule", "value": "pressure" }
            }))
            .unwrap();

        let inline_renderer_payload = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Northstar Risk Control Report",
                "body": "Executive answer with embedded review table and graph.\n\n```structured_data:evidence_reviews\n```\n\n```universal_graph:rule_pressure\n```",
                "tables": [{
                    "id": "evidence_reviews",
                    "name": "Evidence Reviews",
                    "columns": hydrated_review_rows["columns"],
                    "rows": hydrated_review_rows["rows"]
                }],
                "graphs": [{
                    "id": "rule_pressure",
                    "title": "Rule Pressure",
                    "type": "bar",
                    "data": {
                        "columns": hydrated_rule_pressure["columns"],
                        "rows": hydrated_rule_pressure["rows"]
                    },
                    "encoding": { "x": "rule", "y": "value" }
                }]
            }
        });

        let semantic_renderer_payload = serde_json::json!({
            "tool_name": "rich_content",
            "data": {
                "title": "Northstar Risk Control Report",
                "body": "Executive answer with embedded review table and graph.\n\n```structured_data:evidence_reviews\n```\n\n```universal_graph:rule_pressure\n```",
                "tables": [{
                    "id": "evidence_reviews",
                    "name": "Evidence Reviews",
                    "dataRef": {
                        "dataset_id": "northstar-risk-control-2026-05",
                        "query_token": token.clone(),
                        "recipe": "review_rows"
                    }
                }],
                "graphs": [{
                    "id": "rule_pressure",
                    "title": "Rule Pressure",
                    "type": "bar",
                    "dataRef": {
                        "dataset_id": "northstar-risk-control-2026-05",
                        "query_token": token.clone(),
                        "recipe": "group_sum",
                        "params": { "groupBy": "rule", "value": "pressure" },
                        "sourceRecipe": "select_rows"
                    },
                    "encoding": { "x": "rule", "y": "value" }
                }]
            }
        });

        let html_preview = format!(
            "<!doctype html><html><head><title>Northstar Risk Control Report</title><style>:root{{--bg:#f8fafc;--fg:#0f172a;--muted:#64748b;--line:#cbd5e1;--accent:#2563eb;--warn:#b45309;}}body{{margin:0;font-family:Inter,Arial,sans-serif;background:var(--bg);color:var(--fg);}}main{{max-width:1180px;margin:0 auto;padding:32px;}}header{{display:flex;align-items:end;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:16px;}}.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0;}}.kpi{{border:1px solid var(--line);border-radius:8px;background:white;padding:14px;}}.kpi b{{display:block;font-size:24px;}}.toolbar{{display:flex;gap:8px;margin:16px 0;}}button,input,select{{border:1px solid var(--line);border-radius:6px;padding:8px;background:white;}}table{{width:100%;border-collapse:collapse;background:white;border:1px solid var(--line);}}th,td{{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;}}th{{position:sticky;top:0;background:#e2e8f0;}}.severity-P0{{color:#991b1b;font-weight:700;}}.severity-P1{{color:var(--warn);font-weight:600;}}.chart{{height:280px;border:1px solid var(--line);background:white;margin:18px 0;padding:16px;}}.bar{{height:28px;background:linear-gradient(90deg,var(--accent),#60a5fa);margin:8px 0;color:white;padding-left:8px;line-height:28px;border-radius:4px;}}.tooltip{{position:absolute;display:none;background:#0f172a;color:white;padding:8px;border-radius:6px;font-size:12px;max-width:280px;}}.review{{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;}}</style></head><body><main><header><div><h1>Northstar Risk Control Report</h1><p>Executive answer with a hand-authored table, chart, filters, tooltip behavior, and review controls.</p></div><span>2026-05</span></header><section class='kpis'><div class='kpi'><span>Rows</span><b>64</b></div><div class='kpi'><span>P0</span><b>10</b></div><div class='kpi'><span>Rules</span><b>4</b></div><div class='kpi'><span>Review SLA</span><b>24h</b></div></section><section class='toolbar'><input id='search' placeholder='Filter evidence rows'><select id='severity'><option>All severities</option><option>P0</option><option>P1</option><option>P2</option></select><button onclick='expandAll()'>Expand all</button><button onclick='exportRows()'>Export visible</button></section><section class='chart' id='chart'></section><table id='evidence'><thead><tr><th>Decision</th><th>Rule</th><th>Segment</th><th>Evidence</th><th>Severity</th><th>Pressure</th><th>Delta</th><th>Review</th></tr></thead><tbody>{}</tbody></table><div class='tooltip' id='tip'></div><script>const rulePressure = {}; const evidenceRows = {}; function renderChart(){{const max=Math.max(...rulePressure.map(r=>r.value));document.getElementById('chart').innerHTML=rulePressure.map(r=>`<div class='bar' style='width:${{Math.max(8,Math.round((r.value/max)*100))}}%'>${{r.rule}}: ${{r.value}}</div>`).join('');}}function applyFilters(){{const text=document.getElementById('search').value.toLowerCase();const sev=document.getElementById('severity').value;document.querySelectorAll('#evidence tbody tr').forEach((tr,i)=>{{const row=evidenceRows[i];const show=(!text||JSON.stringify(row).toLowerCase().includes(text))&&(sev==='All severities'||row.severity===sev);tr.style.display=show?'':'none';}});}}function showTip(event,row){{const tip=document.getElementById('tip');tip.textContent=row.evidence+' | '+row.rule+' | pressure '+row.pressure;tip.style.left=event.pageX+12+'px';tip.style.top=event.pageY+12+'px';tip.style.display='block';}}function hideTip(){{document.getElementById('tip').style.display='none';}}function mark(rowId,state){{console.log('review decision',rowId,state);}}function expandAll(){{document.querySelectorAll('details').forEach(d=>d.open=true);}}function exportRows(){{console.log('export',evidenceRows);}}document.getElementById('search').addEventListener('input',applyFilters);document.getElementById('severity').addEventListener('change',applyFilters);renderChart();</script></main></body></html>",
            register_payload["rows"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
                .map(|(index, row)| format!(
                    "<tr onmousemove='showTip(event,evidenceRows[{}])' onmouseleave='hideTip()'><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td class='severity-{}'>{}</td><td>{}</td><td>{}</td><td class='review'><button onclick=\"mark('{}','accept')\">Accept</button><button onclick=\"mark('{}','reject')\">Reject</button></td></tr>",
                    index,
                    row["decision"].as_str().unwrap(),
                    row["rule"].as_str().unwrap(),
                    row["segment"].as_str().unwrap(),
                    row["evidence"].as_str().unwrap(),
                    row["severity"].as_str().unwrap(),
                    row["severity"].as_str().unwrap(),
                    row["pressure"],
                    row["delta"],
                    row["decision_id"].as_str().unwrap(),
                    row["decision_id"].as_str().unwrap()
                ))
                .collect::<String>(),
            serde_json::to_string(&hydrated_rule_pressure["rows"]).unwrap(),
            serde_json::to_string(register_payload["rows"].as_array().unwrap()).unwrap()
        );

        let register_tokens = estimated_output_tokens(&register_payload);
        let semantic_tokens = register_tokens + estimated_output_tokens(&semantic_renderer_payload);
        let inline_tokens = estimated_output_tokens(&inline_renderer_payload);
        let html_tokens = (html_preview.len() + 3) / 4;

        assert_eq!(
            hydrated_review_rows["rows"],
            inline_renderer_payload["data"]["tables"][0]["rows"]
        );
        assert_eq!(
            hydrated_rule_pressure["rows"],
            inline_renderer_payload["data"]["graphs"][0]["data"]["rows"]
        );
        assert!(
            semantic_tokens < inline_tokens,
            "semantic register+render payload should be cheaper than inline renderer payload (semantic={}, inline={})",
            semantic_tokens,
            inline_tokens
        );
        assert!(
            semantic_tokens < html_tokens,
            "semantic register+render payload should be cheaper than hand-authored HTML preview (semantic={}, html={})",
            semantic_tokens,
            html_tokens
        );
    }

    fn estimated_output_tokens(value: &Value) -> usize {
        let bytes = serde_json::to_string(value).unwrap().len();
        (bytes + 3) / 4
    }
}
