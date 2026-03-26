use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::Mutex as TokioMutex;
use tokio::time::Instant;

use crate::plugin::PluginRegistry;
use crate::review::ReviewState;
use crate::session::SessionStore;

pub struct AppState {
    pub sessions: Mutex<SessionStore>,
    pub reviews: Mutex<ReviewState>,
    /// Maps session_id -> (deadline, original_timeout_secs)
    pub review_deadlines: Mutex<HashMap<String, (Arc<TokioMutex<Instant>>, u64)>>,
    pub plugin_registry: Mutex<PluginRegistry>,
    pub http_client: reqwest::Client,
}

impl AppState {
    pub fn new() -> Self {
        let registry = PluginRegistry::load_plugins();
        Self {
            sessions: Mutex::new(SessionStore::new()),
            reviews: Mutex::new(ReviewState::new()),
            review_deadlines: Mutex::new(HashMap::new()),
            plugin_registry: Mutex::new(registry),
            http_client: reqwest::Client::new(),
        }
    }
}
