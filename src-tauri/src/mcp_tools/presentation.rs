use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::http_server::{await_decision, execute_push, store_push, AsyncAppState, ExecutePushResult};

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
                "text": serde_json::to_string(&serde_json::json!({
                    "session_id": session_id,
                    "status": "stored"
                })).unwrap()
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
    let result =
        store_push(state, params.tool_name, None, params.data, params.meta, true, params.timeout, None).await;

    match result {
        ExecutePushResult::Pending { session_id } => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&serde_json::json!({
                    "session_id": session_id,
                    "status": "pending",
                    "message": "Review is displayed in the companion window. Call await_review with this session_id to wait for the user's decision. If your transport times out, call await_review again — the session persists."
                })).unwrap()
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

    let result = await_decision(state, session_id).await;

    match result {
        ExecutePushResult::Decision(resp) => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&resp).unwrap()
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

    let result = execute_push(
        state,
        params.tool_name,
        None,
        params.data,
        params.meta,
        review_required,
        params.timeout,
        None,
    )
    .await;

    match result {
        ExecutePushResult::Stored { session_id } => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&serde_json::json!({
                    "session_id": session_id,
                    "status": "stored"
                })).unwrap()
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

    let result = match sessions.get(&session_id) {
        Some(session) => {
            let has_decision = session.decided_at.is_some();
            serde_json::json!({
                "session_id": session_id,
                "status": if has_decision { "decided" } else { "pending" },
                "review_required": session.review_required,
                "has_decision": has_decision,
                "decision": session.decision,
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
    };

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&result).unwrap()
        }]
    }))
}
