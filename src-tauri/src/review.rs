use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDecision {
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

pub struct ReviewState {
    pending: HashMap<String, oneshot::Sender<ReviewDecision>>,
}

impl ReviewState {
    pub fn new() -> Self {
        Self {
            pending: HashMap::new(),
        }
    }

    /// Register a pending review, returns a receiver to await the decision
    pub fn add_pending(&mut self, session_id: String) -> oneshot::Receiver<ReviewDecision> {
        // Clean up any existing pending review for this session
        self.pending.remove(&session_id);

        let (tx, rx) = oneshot::channel();
        self.pending.insert(session_id, tx);
        rx
    }

    /// Resolve a pending review with a decision. Returns true if there was a pending review.
    pub fn resolve(&mut self, session_id: &str, decision: ReviewDecision) -> bool {
        if let Some(tx) = self.pending.remove(session_id) {
            let _ = tx.send(decision);
            true
        } else {
            false
        }
    }

    /// Dismiss a pending review (browser closed / timeout). Returns true if there was a pending review.
    pub fn dismiss(&mut self, session_id: &str) -> bool {
        if let Some(tx) = self.pending.remove(session_id) {
            let _ = tx.send(ReviewDecision {
                session_id: session_id.to_string(),
                status: "decision_received".to_string(),
                decision: Some("dismissed".to_string()),
                operation_decisions: None,
                comments: None,
                modifications: None,
                additions: None,
            });
            true
        } else {
            false
        }
    }

    pub fn has_pending(&self, session_id: &str) -> bool {
        self.pending.contains_key(session_id)
    }
}
