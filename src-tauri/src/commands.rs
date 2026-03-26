use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

use crate::review::ReviewDecision;
use crate::session::PreviewSession;
use crate::state::AppState;

#[tauri::command]
pub fn get_sessions(state: State<Arc<AppState>>) -> Vec<PreviewSession> {
    let sessions = state.sessions.lock().unwrap();
    sessions.get_all()
}

#[tauri::command]
pub fn submit_decision(
    session_id: String,
    decision: String,
    operation_decisions: Option<HashMap<String, String>>,
    comments: Option<HashMap<String, String>>,
    modifications: Option<HashMap<String, String>>,
    additions: Option<serde_json::Value>,
    state: State<Arc<AppState>>,
) -> Result<(), String> {
    // Update session state
    {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            session.decided_at = Some(now);
            session.decision = Some(decision.clone());
            session.operation_decisions = operation_decisions.clone();
        }
    }

    // Resolve the pending review (unblocks the HTTP response)
    let overall_decision = if operation_decisions.is_some() && decision != "accept" && decision != "reject" {
        "partial".to_string()
    } else {
        decision
    };

    let review_decision = ReviewDecision {
        session_id: session_id.clone(),
        status: "decision_received".to_string(),
        decision: Some(overall_decision),
        operation_decisions,
        comments,
        modifications,
        additions,
    };

    let mut reviews = state.reviews.lock().unwrap();
    reviews.resolve(&session_id, review_decision);

    Ok(())
}

#[tauri::command]
pub fn dismiss_session(session_id: String, state: State<Arc<AppState>>) -> Result<(), String> {
    // Remove session
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.delete(&session_id);
    }

    // Dismiss any pending review
    {
        let mut reviews = state.reviews.lock().unwrap();
        reviews.dismiss(&session_id);
    }

    Ok(())
}

#[tauri::command]
pub fn get_health() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "status": "ok"
    })
}
