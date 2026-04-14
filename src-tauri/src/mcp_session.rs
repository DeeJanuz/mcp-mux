use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use uuid::Uuid;

pub struct McpSession {
    pub tx: broadcast::Sender<String>,
    pub created_at: Instant,
}

pub struct McpSessionManager {
    sessions: HashMap<String, McpSession>,
}

#[cfg(test)]
impl McpSessionManager {
    /// Test helper: insert a session with a custom created_at timestamp
    fn create_session_with_created_at(
        &mut self,
        created_at: Instant,
    ) -> (String, broadcast::Receiver<String>) {
        let session_id = Uuid::new_v4().to_string();
        let (tx, rx) = broadcast::channel(64);
        self.sessions
            .insert(session_id.clone(), McpSession { tx, created_at });
        (session_id, rx)
    }
}

const SESSION_GRACE_PERIOD: Duration = Duration::from_secs(30);

impl McpSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Creates a new session, returns (session_id, receiver)
    pub fn create_session(&mut self) -> (String, broadcast::Receiver<String>) {
        let session_id = Uuid::new_v4().to_string();
        let (tx, rx) = broadcast::channel(64);
        self.sessions.insert(
            session_id.clone(),
            McpSession {
                tx,
                created_at: Instant::now(),
            },
        );
        (session_id, rx)
    }

    /// Get a receiver for an existing session (reconnect support)
    #[allow(dead_code)]
    pub fn subscribe(&self, session_id: &str) -> Option<broadcast::Receiver<String>> {
        self.sessions.get(session_id).map(|s| s.tx.subscribe())
    }

    /// Remove session explicitly
    pub fn remove_session(&mut self, session_id: &str) -> bool {
        self.sessions.remove(session_id).is_some()
    }

    /// Broadcast a notification to ALL active sessions
    pub fn broadcast(&self, notification_json: &str) {
        for session in self.sessions.values() {
            let _ = session.tx.send(notification_json.to_string());
        }
    }

    /// GC: remove sessions with no active receivers
    pub fn retain_active(&mut self) {
        let now = Instant::now();
        self.sessions.retain(|_, s| {
            s.tx.receiver_count() > 0 || now.duration_since(s.created_at) < SESSION_GRACE_PERIOD
        });
    }

    /// Check if a session exists
    pub fn has_session(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_session_returns_unique_ids() {
        let mut mgr = McpSessionManager::new();
        let (id1, _rx1) = mgr.create_session();
        let (id2, _rx2) = mgr.create_session();
        assert_ne!(id1, id2, "Session IDs must be unique");
        // Verify they are valid UUIDs
        assert!(uuid::Uuid::parse_str(&id1).is_ok());
        assert!(uuid::Uuid::parse_str(&id2).is_ok());
    }

    #[test]
    fn test_create_session_receiver_works() {
        let mut mgr = McpSessionManager::new();
        let (id, mut rx) = mgr.create_session();
        // Send via the internal sender
        let session = mgr.sessions.get(&id).unwrap();
        session.tx.send("hello".to_string()).unwrap();
        let msg = rx.try_recv().unwrap();
        assert_eq!(msg, "hello");
    }

    #[test]
    fn test_has_session_returns_true_for_existing() {
        let mut mgr = McpSessionManager::new();
        let (id, _rx) = mgr.create_session();
        assert!(mgr.has_session(&id));
    }

    #[test]
    fn test_has_session_returns_false_for_unknown() {
        let mgr = McpSessionManager::new();
        assert!(!mgr.has_session("nonexistent-id"));
    }

    #[test]
    fn test_subscribe_returns_none_for_unknown() {
        let mgr = McpSessionManager::new();
        assert!(mgr.subscribe("nonexistent-id").is_none());
    }

    #[test]
    fn test_subscribe_returns_receiver_for_existing() {
        let mut mgr = McpSessionManager::new();
        let (id, _rx) = mgr.create_session();
        let rx2 = mgr.subscribe(&id);
        assert!(rx2.is_some());
    }

    #[test]
    fn test_subscribe_receiver_gets_messages() {
        let mut mgr = McpSessionManager::new();
        let (id, _rx) = mgr.create_session();
        let mut rx2 = mgr.subscribe(&id).unwrap();
        // Send after subscribing
        mgr.sessions.get(&id).unwrap().tx.send("test-msg".to_string()).unwrap();
        assert_eq!(rx2.try_recv().unwrap(), "test-msg");
    }

    #[test]
    fn test_remove_session_returns_true_for_existing() {
        let mut mgr = McpSessionManager::new();
        let (id, _rx) = mgr.create_session();
        assert!(mgr.remove_session(&id));
        assert!(!mgr.has_session(&id));
    }

    #[test]
    fn test_remove_session_returns_false_for_unknown() {
        let mut mgr = McpSessionManager::new();
        assert!(!mgr.remove_session("nonexistent-id"));
    }

    #[test]
    fn test_broadcast_sends_to_all_sessions() {
        let mut mgr = McpSessionManager::new();
        let (_id1, mut rx1) = mgr.create_session();
        let (_id2, mut rx2) = mgr.create_session();
        let (_id3, mut rx3) = mgr.create_session();

        mgr.broadcast(r#"{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}"#);

        let expected = r#"{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}"#;
        assert_eq!(rx1.try_recv().unwrap(), expected);
        assert_eq!(rx2.try_recv().unwrap(), expected);
        assert_eq!(rx3.try_recv().unwrap(), expected);
    }

    #[test]
    fn test_broadcast_no_sessions_does_not_panic() {
        let mgr = McpSessionManager::new();
        mgr.broadcast("anything"); // Should not panic
    }

    #[test]
    fn test_retain_active_removes_sessions_with_no_receivers() {
        let mut mgr = McpSessionManager::new();
        let past = Instant::now() - Duration::from_secs(60);
        let (id1, rx1) = mgr.create_session_with_created_at(past);
        let (id2, _rx2) = mgr.create_session();

        // Drop receiver for session 1
        drop(rx1);

        mgr.retain_active();

        // id1 had its receiver dropped and is past grace period, so it should be removed
        assert!(!mgr.has_session(&id1));
        // id2 still has a live receiver
        assert!(mgr.has_session(&id2));
    }

    #[test]
    fn test_retain_active_keeps_sessions_with_subscribers() {
        let mut mgr = McpSessionManager::new();
        let (id, _rx1) = mgr.create_session();
        let _rx2 = mgr.subscribe(&id).unwrap();
        // Drop original receiver but keep the subscriber
        drop(_rx1);

        mgr.retain_active();
        assert!(mgr.has_session(&id));
    }

    #[test]
    fn test_retain_active_removes_all_when_no_receivers() {
        let mut mgr = McpSessionManager::new();
        let past = Instant::now() - Duration::from_secs(60);
        let (id1, rx1) = mgr.create_session_with_created_at(past);
        let (id2, rx2) = mgr.create_session_with_created_at(past);

        drop(rx1);
        drop(rx2);

        mgr.retain_active();
        assert!(!mgr.has_session(&id1));
        assert!(!mgr.has_session(&id2));
    }

    #[test]
    fn test_retain_active_keeps_session_within_grace_period() {
        let mut mgr = McpSessionManager::new();
        let (id, rx) = mgr.create_session(); // created_at = now, within 30s grace
        drop(rx);
        mgr.retain_active();
        assert!(mgr.has_session(&id)); // kept due to grace period
    }

    #[test]
    fn test_retain_active_removes_session_past_grace_period() {
        let mut mgr = McpSessionManager::new();
        let past = Instant::now() - Duration::from_secs(60);
        let (id, rx) = mgr.create_session_with_created_at(past);
        drop(rx);
        mgr.retain_active();
        assert!(!mgr.has_session(&id)); // removed: no receivers + past grace period
    }
}
