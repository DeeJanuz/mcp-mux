use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::{await_decision_for_transport, execute_push, store_push, AsyncAppState, ExecutePushResult};
use crate::session::PreviewSession;

pub(super) async fn call_push_content(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let mut arguments = arguments;
    if let Some(data) = arguments.get_mut("data") {
        super::strip_change_fields(data);
    }
    call_push_impl(arguments, state, false).await
}

pub(super) async fn call_direct_renderer_content(
    renderer_name: &str,
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let mut data = arguments;
    let meta = data.get("meta").cloned();
    let tool_args = data
        .get("toolArgs")
        .cloned()
        .or_else(|| data.get("tool_args").cloned());
    if let Some(object) = data.as_object_mut() {
        object.remove("meta");
        object.remove("toolArgs");
        object.remove("tool_args");
    }
    super::strip_change_fields(&mut data);
    super::validate_push_payload(renderer_name, &data)?;
    let warnings = super::collect_efficiency_warnings(renderer_name, &data);

    let result = execute_push(
        state,
        renderer_name.to_string(),
        tool_args,
        data,
        meta,
        false,
        120,
        None,
    )
    .await;

    match result {
        ExecutePushResult::Stored { session_id } => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&with_warnings(serde_json::json!({
                    "session_id": session_id,
                    "status": "stored"
                }), warnings)).unwrap()
            }]
        })),
        ExecutePushResult::Decision(resp) => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&resp).unwrap()
            }]
        })),
        ExecutePushResult::Pending { .. } => {
            unreachable!("execute_push never returns Pending directly")
        }
    }
}

pub(super) async fn call_push_review(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let params = super::extract_push_params(&arguments, true)?;
    let warnings = params.warnings.clone();
    let result = store_push(
        state,
        params.tool_name,
        None,
        params.data,
        params.meta,
        true,
        params.timeout,
        params.session_id,
    )
    .await;

    match result {
        ExecutePushResult::Pending { session_id } => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&with_warnings(serde_json::json!({
                    "session_id": session_id,
                    "status": "pending",
                    "message": "Review is displayed in the companion window. Call await_review with this session_id to wait for the user's decision. If your transport times out, call await_review again — the session persists."
                }), warnings)).unwrap()
            }]
        })),
        _ => unreachable!("store_push with review_required=true always returns Pending"),
    }
}

pub(super) async fn call_await_review(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let session_id = arguments
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: session_id")?;

    let result = await_decision_for_transport(state, session_id).await;

    match result {
        ExecutePushResult::Decision(resp) => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&resp).unwrap()
            }]
        })),
        ExecutePushResult::Pending { session_id } => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&serde_json::json!({
                    "session_id": session_id,
                    "status": "pending",
                    "review_required": true,
                    "message": "Review is still pending. Call await_review again with the same session_id, or use push_check for a non-blocking status check."
                })).unwrap()
            }]
        })),
        _ => Err(format!("No pending review for session_id: {}", session_id)),
    }
}

async fn call_push_impl(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
    review_required: bool,
) -> Result<Value, String> {
    let params = super::extract_push_params(&arguments, review_required)?;
    let warnings = params.warnings.clone();

    let result = execute_push(
        state,
        params.tool_name,
        None,
        params.data,
        params.meta,
        review_required,
        params.timeout,
        params.session_id,
    )
    .await;

    match result {
        ExecutePushResult::Stored { session_id } => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&with_warnings(serde_json::json!({
                    "session_id": session_id,
                    "status": "stored"
                }), warnings)).unwrap()
            }]
        })),
        ExecutePushResult::Decision(resp) => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&resp).unwrap()
            }]
        })),
        ExecutePushResult::Pending { .. } => {
            unreachable!("execute_push never returns Pending directly")
        }
    }
}

fn with_warnings(mut payload: Value, warnings: Vec<String>) -> Value {
    if !warnings.is_empty() {
        if let Some(object) = payload.as_object_mut() {
            object.insert("warnings".to_string(), serde_json::json!(warnings));
        }
    }
    payload
}

pub(super) async fn call_push_check(
    arguments: Value,
    state: &Arc<TokioMutex<AsyncAppState>>,
) -> Result<Value, String> {
    let session_id = arguments
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or("Missing required parameter: session_id")?
        .to_string();

    let state_guard = state.lock().await;
    let sessions = state_guard.inner.sessions.lock().unwrap();

    let result = push_check_payload(&session_id, sessions.get(&session_id));

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&result).unwrap()
        }]
    }))
}

fn push_check_payload(session_id: &str, session: Option<&PreviewSession>) -> Value {
    match session {
        Some(session) => {
            let has_decision = session.decided_at.is_some();
            serde_json::json!({
                "session_id": session_id,
                "status": if has_decision { "decided" } else { "pending" },
                "review_required": session.review_required,
                "has_decision": has_decision,
                "decision": session.decision.clone(),
                "operation_decisions": session.operation_decisions.clone(),
                "comments": session.comments.clone(),
                "modifications": session.modifications.clone(),
                "additions": session.additions.clone(),
                "suggestion_decisions": session.suggestion_decisions.clone(),
                "table_decisions": session.table_decisions.clone(),
            })
        }
        None => {
            serde_json::json!({
                "session_id": session_id,
                "status": "not_found",
                "review_required": false,
                "has_decision": false,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(decided: bool) -> PreviewSession {
        PreviewSession {
            session_id: "review-1".to_string(),
            tool_name: "structured_data".to_string(),
            tool_args: serde_json::json!({}),
            content_type: "structured_data".to_string(),
            data: serde_json::json!({ "tables": [] }),
            meta: serde_json::json!({}),
            backend_callback: None,
            review_required: true,
            timeout_secs: Some(120),
            created_at: 1,
            decided_at: if decided { Some(2) } else { None },
            decision: if decided { Some("approved".to_string()) } else { None },
            operation_decisions: None,
            comments: None,
            modifications: None,
            additions: None,
            suggestion_decisions: None,
            table_decisions: None,
        }
    }

    #[test]
    fn push_check_payload_returns_pending_without_waiting() {
        let session = session(false);
        let payload = push_check_payload("review-1", Some(&session));
        assert_eq!(payload["status"], "pending");
        assert_eq!(payload["review_required"], true);
        assert_eq!(payload["has_decision"], false);
    }

    #[test]
    fn push_check_payload_replays_completed_decision() {
        let session = session(true);
        let payload = push_check_payload("review-1", Some(&session));
        assert_eq!(payload["status"], "decided");
        assert_eq!(payload["decision"], "approved");
        assert_eq!(payload["has_decision"], true);
    }
}
