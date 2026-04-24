use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

const SESSION_TTL: Duration = Duration::from_secs(30 * 60); // 30 minutes

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSession {
    pub session_id: String,
    pub tool_name: String,
    #[serde(default)]
    pub tool_args: serde_json::Value,
    pub content_type: String,
    pub data: serde_json::Value,
    #[serde(default)]
    pub meta: serde_json::Value,
    #[serde(default, skip_serializing, skip_deserializing)]
    pub backend_callback: Option<serde_json::Value>,
    #[serde(default)]
    pub review_required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_secs: Option<u64>,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_decisions: Option<HashMap<String, String>>,
}

fn take_backend_callback(
    map: &mut serde_json::Map<String, serde_json::Value>,
) -> Option<serde_json::Value> {
    map.remove("backendCallback")
        .or_else(|| map.remove("backend_callback"))
}

pub fn split_renderer_meta(
    meta: Option<serde_json::Value>,
) -> (serde_json::Value, Option<serde_json::Value>) {
    match meta {
        Some(serde_json::Value::Object(mut map)) => {
            let backend_callback = take_backend_callback(&mut map);
            (serde_json::Value::Object(map), backend_callback)
        }
        Some(_) | None => (serde_json::Value::Object(Default::default()), None),
    }
}

pub fn sanitize_renderer_meta(meta: serde_json::Value) -> serde_json::Value {
    split_renderer_meta(Some(meta)).0
}

impl PreviewSession {
    pub fn renderer_snapshot(&self) -> Self {
        let mut snapshot = self.clone();
        snapshot.meta = sanitize_renderer_meta(snapshot.meta);
        snapshot.backend_callback = None;
        snapshot
    }
}

struct SessionEntry {
    session: PreviewSession,
    inserted_at: Instant,
}

pub struct SessionStore {
    entries: HashMap<String, SessionEntry>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    pub fn set(&mut self, session: PreviewSession) {
        let id = session.session_id.clone();
        self.entries.insert(
            id,
            SessionEntry {
                session,
                inserted_at: Instant::now(),
            },
        );
    }

    pub fn get(&self, id: &str) -> Option<&PreviewSession> {
        self.entries.get(id).map(|e| &e.session)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut PreviewSession> {
        self.entries.get_mut(id).map(|e| &mut e.session)
    }

    pub fn get_all(&self) -> Vec<PreviewSession> {
        self.entries
            .values()
            .map(|e| e.session.renderer_snapshot())
            .collect()
    }

    pub fn delete(&mut self, id: &str) -> Option<PreviewSession> {
        self.entries.remove(id).map(|e| e.session)
    }

    /// Remove sessions older than TTL, return count removed
    pub fn gc(&mut self) -> usize {
        let before = self.entries.len();
        self.entries
            .retain(|_, e| e.inserted_at.elapsed() < SESSION_TTL);
        before - self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_renderer_meta_removes_backend_callback_secrets() {
        let (meta, callback) = split_renderer_meta(Some(serde_json::json!({
            "label": "Review",
            "backendCallback": {
                "url": "https://example.test/reviews/1",
                "token": "secret-token"
            }
        })));

        assert_eq!(meta["label"], "Review");
        assert!(meta.get("backendCallback").is_none());
        assert_eq!(
            callback.unwrap()["token"],
            serde_json::Value::String("secret-token".to_string())
        );
    }

    #[test]
    fn renderer_snapshot_does_not_serialize_backend_callback() {
        let session = PreviewSession {
            session_id: "session-1".to_string(),
            tool_name: "structured_data".to_string(),
            tool_args: serde_json::json!({}),
            content_type: "structured_data".to_string(),
            data: serde_json::json!({ "tables": [] }),
            meta: serde_json::json!({
                "reviewRequired": true,
                "backendCallback": {
                    "url": "https://example.test/reviews/1",
                    "token": "secret-token"
                }
            }),
            backend_callback: Some(serde_json::json!({
                "url": "https://example.test/reviews/1",
                "token": "secret-token"
            })),
            review_required: true,
            timeout_secs: Some(120),
            created_at: 1,
            decided_at: None,
            decision: None,
            operation_decisions: None,
        };

        let snapshot = session.renderer_snapshot();
        let serialized = serde_json::to_value(snapshot).unwrap();

        assert!(serialized.get("backendCallback").is_none());
        assert!(serialized.get("backend_callback").is_none());
        assert!(serialized["meta"].get("backendCallback").is_none());
        assert_eq!(serialized["meta"]["reviewRequired"], true);
    }
}
