mod engine;
mod importer;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(engine::ReviewControl::default()))
        .invoke_handler(tauri::generate_handler![
            engine::analyze_game,
            engine::cancel_review,
            importer::import_remote
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Chess Review System");
}
