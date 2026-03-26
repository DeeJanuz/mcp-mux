use axum::{
    extract::{Extension, Json},
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;
use tower_http::cors::{Any, CorsLayer};

use crate::mcp;
use crate::session::PreviewSession;
use crate::state::AppState;

/// Shared state wrapper for async axum handlers (needs tokio::Mutex, not std::Mutex)
pub struct AsyncAppState {
    pub inner: Arc<AppState>,
    pub app_handle: AppHandle,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    pub tool_name: String,
    #[serde(default)]
    pub tool_args: Option<serde_json::Value>,
    pub result: PushResult,
    #[serde(default)]
    pub review_required: Option<bool>,
    #[serde(default)]
    pub open_browser: Option<bool>,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PushResult {
    pub data: serde_json::Value,
    #[serde(default)]
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResponse {
    pub session_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_decisions: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifications: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    version: String,
    port: u16,
    uptime_seconds: u64,
    started_at: String,
}

/// Detect content type from tool name (mirrors companion ws-handler.ts logic)
fn detect_content_type(tool_name: &str) -> String {
    match tool_name {
        "search_codebase" | "vector_search" => "search_results".to_string(),
        "get_code_units" => "code_units".to_string(),
        "get_document" => "document_preview".to_string(),
        "write_document" | "propose_actions" => "document_diff".to_string(),
        "get_data_schema" => "data_schema".to_string(),
        "manage_data_draft" => "data_draft_diff".to_string(),
        "get_dependencies" => "dependencies".to_string(),
        "get_file_content" => "file_content".to_string(),
        "get_module_overview" => "module_overview".to_string(),
        "get_analysis_stats" => "analysis_stats".to_string(),
        "get_business_concepts" | "manage_knowledge_entries" => "knowledge_dex".to_string(),
        "get_column_context" => "column_context".to_string(),
        "rich_content" | "push_to_companion" => "rich_content".to_string(),
        _ => "rich_content".to_string(),
    }
}

/// Result of executing a push operation
pub enum ExecutePushResult {
    Stored { session_id: String },
    Decision(PushResponse),
}

/// Core push logic shared by HTTP `/api/push` and MCP `push_content`/`push_review` tools
pub async fn execute_push(
    state: &Arc<TokioMutex<AsyncAppState>>,
    tool_name: String,
    tool_args: Option<serde_json::Value>,
    data: serde_json::Value,
    meta: Option<serde_json::Value>,
    review_required: bool,
    timeout_secs: u64,
    session_id: Option<String>,
) -> ExecutePushResult {
    let session_id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let content_type = detect_content_type(&tool_name);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let session = PreviewSession {
        session_id: session_id.clone(),
        tool_name,
        tool_args: tool_args.unwrap_or(serde_json::Value::Object(Default::default())),
        content_type,
        data,
        meta: meta.unwrap_or(serde_json::Value::Object(Default::default())),
        review_required,
        created_at: now,
        decided_at: None,
        decision: None,
        operation_decisions: None,
    };

    let state_guard = state.lock().await;

    // Single-session: clear existing sessions
    {
        let mut sessions = state_guard.inner.sessions.lock().unwrap();
        sessions.clear();
        sessions.set(session.clone());
    }

    // Emit to WebView
    let _ = state_guard.app_handle.emit("push_preview", &session);

    // Show and focus the window
    if let Some(window) = state_guard.app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    if review_required {
        let rx = {
            let mut reviews = state_guard.inner.reviews.lock().unwrap();
            reviews.add_pending(session_id.clone())
        };

        // Set up resettable deadline
        let deadline = Arc::new(TokioMutex::new(
            tokio::time::Instant::now() + Duration::from_secs(timeout_secs),
        ));
        {
            let mut deadlines = state_guard.inner.review_deadlines.lock().unwrap();
            deadlines.insert(session_id.clone(), (deadline.clone(), timeout_secs));
        }
        drop(state_guard);

        // Resettable timeout loop
        let mut rx = rx;
        let result = loop {
            let current_deadline = *deadline.lock().await;
            tokio::select! {
                decision = &mut rx => {
                    break decision.ok();
                }
                _ = tokio::time::sleep_until(current_deadline) => {
                    let now = tokio::time::Instant::now();
                    let dl = *deadline.lock().await;
                    if dl > now {
                        continue; // deadline was bumped by heartbeat
                    }
                    break None; // truly expired
                }
            }
        };

        // Clean up deadline entry
        {
            let state_guard = state.lock().await;
            let mut deadlines = state_guard.inner.review_deadlines.lock().unwrap();
            deadlines.remove(&session_id);
        }

        match result {
            Some(decision) => ExecutePushResult::Decision(PushResponse {
                session_id: decision.session_id,
                status: decision.status,
                decision: decision.decision,
                operation_decisions: decision.operation_decisions,
                comments: decision.comments,
                modifications: decision.modifications,
                additions: decision.additions,
            }),
            None => {
                // Timeout or channel dropped
                let state_guard = state.lock().await;
                let mut reviews = state_guard.inner.reviews.lock().unwrap();
                reviews.dismiss(&session_id);
                ExecutePushResult::Decision(PushResponse {
                    session_id,
                    status: "decision_received".to_string(),
                    decision: Some("dismissed".to_string()),
                    operation_decisions: None,
                    comments: None,
                    modifications: None,
                    additions: None,
                })
            }
        }
    } else {
        drop(state_guard);
        ExecutePushResult::Stored { session_id }
    }
}

static START_TIME: std::sync::OnceLock<(std::time::Instant, String)> = std::sync::OnceLock::new();

fn get_start_info() -> &'static (std::time::Instant, String) {
    START_TIME.get_or_init(|| {
        (
            std::time::Instant::now(),
            chrono::Utc::now().to_rfc3339(),
        )
    })
}

async fn health_handler() -> impl IntoResponse {
    let (start_instant, started_at) = get_start_info();
    Json(HealthResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        port: 4200,
        uptime_seconds: start_instant.elapsed().as_secs(),
        started_at: started_at.clone(),
    })
}

async fn push_handler(
    Extension(state): Extension<Arc<TokioMutex<AsyncAppState>>>,
    Json(push_req): Json<PushRequest>,
) -> impl IntoResponse {
    let review_required = push_req.review_required.unwrap_or(false);
    let timeout_secs = push_req.timeout.unwrap_or(120);

    let result = execute_push(
        &state,
        push_req.tool_name,
        push_req.tool_args,
        push_req.result.data,
        push_req.result.meta,
        review_required,
        timeout_secs,
        push_req.session_id,
    )
    .await;

    match result {
        ExecutePushResult::Stored { session_id } => (
            StatusCode::CREATED,
            Json(PushResponse {
                session_id,
                status: "stored".to_string(),
                decision: None,
                operation_decisions: None,
                comments: None,
                modifications: None,
                additions: None,
            }),
        ),
        ExecutePushResult::Decision(resp) => {
            let status_code = if resp.decision.as_deref() == Some("dismissed") {
                StatusCode::REQUEST_TIMEOUT
            } else {
                StatusCode::OK
            };
            (status_code, Json(resp))
        }
    }
}

#[derive(Debug, Deserialize)]
struct HeartbeatRequest {
    session_id: Option<String>,
}

async fn heartbeat_handler(
    Extension(state): Extension<Arc<TokioMutex<AsyncAppState>>>,
    body: axum::body::Bytes,
) -> StatusCode {
    let req: HeartbeatRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    let session_id = match req.session_id {
        Some(id) => id,
        None => return StatusCode::BAD_REQUEST,
    };
    let state_guard = state.lock().await;
    let entry = {
        let deadlines = state_guard.inner.review_deadlines.lock().unwrap();
        deadlines.get(&session_id).cloned()
    };
    drop(state_guard);
    match entry {
        Some((deadline, timeout_secs)) => {
            let mut dl = deadline.lock().await;
            *dl = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
            StatusCode::OK
        }
        None => StatusCode::NOT_FOUND,
    }
}

async fn mcp_endpoint(
    Extension(state): Extension<Arc<TokioMutex<AsyncAppState>>>,
    body: String,
) -> (StatusCode, Json<serde_json::Value>) {
    let (status, value) = mcp::mcp_handler(state, body).await;
    (status, Json(value))
}

pub async fn start_http_server(app_state: Arc<AppState>, app_handle: AppHandle) {
    eprintln!("[mcp-mux] Starting HTTP server on :4200");
    let _ = get_start_info(); // Initialize start time

    let async_state = Arc::new(TokioMutex::new(AsyncAppState {
        inner: app_state.clone(),
        app_handle,
    }));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/api/push", post(push_handler))
        .route("/api/heartbeat", post(heartbeat_handler))
        .route("/mcp", post(mcp_endpoint))
        .layer(cors)
        .layer(Extension(async_state));

    // Start GC task
    let gc_state = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let mut sessions = gc_state.sessions.lock().unwrap();
            sessions.gc();
            drop(sessions);
            // Clean up stale deadlines
            let mut deadlines = gc_state.review_deadlines.lock().unwrap();
            let reviews = gc_state.reviews.lock().unwrap();
            deadlines.retain(|id, _| reviews.has_pending(id));
        }
    });

    match tokio::net::TcpListener::bind("0.0.0.0:4200").await {
        Ok(listener) => {
            eprintln!("[mcp-mux] HTTP server listening on :4200");
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[mcp-mux] HTTP server error: {}", e);
            }
        }
        Err(e) => {
            eprintln!("[mcp-mux] Failed to bind to port 4200: {}", e);
        }
    }
}
