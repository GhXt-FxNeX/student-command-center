// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod commands;
mod companion;
mod db;
mod journal;
mod logging;
mod models;
mod spotify;

use commands::{
    ai as ai_commands, analytics, backup, calendar, companion as companion_commands, courses,
    data_management, exams, finance, journal as journal_commands, planner, settings,
    spotify as spotify_commands, study, tasks,
};

fn main() {
    // First: after this, a startup failure (unwritable data folder, database that won't
    // open) is written to <data folder>/logs/scc.log, and on Windows — where a release
    // build has no console — shown in a message box instead of the app silently never
    // appearing. See logging.rs.
    logging::init();
    let pool = db::init_pool();
    logging::note(&format!(
        "Student Command Center {} started on {}/{}; data folder: {}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        db::app_data_dir().display()
    ));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            logging::mark_ready();
            Ok(())
        })
        .manage(pool)
        .manage(journal::session::JournalSession::new())
        .invoke_handler(tauri::generate_handler![
            tasks::list_tasks,
            tasks::create_task,
            tasks::update_task,
            tasks::set_task_status,
            tasks::duplicate_task,
            tasks::delete_task,
            settings::get_settings,
            settings::update_settings,
            courses::list_courses,
            courses::create_course,
            courses::update_course,
            courses::delete_course,
            courses::list_subjects,
            courses::create_subject,
            courses::update_subject,
            courses::delete_subject,
            courses::list_weekly_schedule,
            courses::set_weekly_schedule_day,
            courses::remove_weekly_schedule_day,
            companion_commands::get_companion_state,
            companion_commands::get_companion_manifest,
            companion_commands::rename_companion,
            companion_commands::inspect_custom_companion_zip,
            companion_commands::get_custom_companion_draft,
            companion_commands::save_custom_companion_pack,
            companion_commands::discard_custom_companion_draft,
            companion_commands::delete_custom_companion_pack,
            companion_commands::activate_custom_companion,
            companion_commands::revert_to_default_companion,
            companion_commands::get_custom_companion_status,
            companion_commands::get_companion_collection,
            companion_commands::switch_active_companion,
            study::create_study_session,
            study::complete_pomodoro_session,
            calendar::get_calendar_range,
            analytics::get_study_stats,
            analytics::check_study_goals,
            finance::list_categories,
            finance::create_category,
            finance::update_category,
            finance::delete_category,
            finance::reorder_categories,
            finance::list_transactions,
            finance::create_transaction,
            finance::update_transaction,
            finance::delete_transaction,
            finance::get_finance_summary,
            finance::get_finance_stats,
            exams::list_exams,
            exams::create_exam,
            exams::update_exam,
            exams::delete_exam,
            exams::get_exam_stats,
            ai_commands::has_ai_api_key,
            ai_commands::set_ai_api_key,
            ai_commands::delete_ai_api_key,
            ai_commands::get_provider_statuses,
            ai_commands::test_ai_connection,
            ai_commands::get_ai_usage_stats,
            planner::list_schedule_blocks,
            planner::create_schedule_block,
            planner::update_schedule_block,
            planner::set_schedule_block_completed,
            planner::delete_schedule_block,
            planner::generate_plan,
            planner::reoptimize_plan,
            backup::get_backup_size_estimate,
            backup::export_backup,
            backup::inspect_backup,
            backup::import_backup,
            data_management::reset_saved_data,
            data_management::reset_demo_data,
            data_management::generate_demo_data,
            spotify_commands::spotify_get_status,
            spotify_commands::spotify_connect,
            spotify_commands::spotify_disconnect,
            spotify_commands::spotify_get_playlists,
            spotify_commands::spotify_get_saved_tracks,
            spotify_commands::spotify_get_saved_albums,
            spotify_commands::spotify_get_saved_shows,
            spotify_commands::spotify_get_playback_state,
            spotify_commands::spotify_play,
            spotify_commands::spotify_pause,
            spotify_commands::spotify_play_track,
            spotify_commands::spotify_play_context,
            spotify_commands::spotify_next_track,
            spotify_commands::spotify_previous_track,
            spotify_commands::spotify_set_volume,
            journal_commands::journal_status,
            journal_commands::journal_setup_password,
            journal_commands::journal_unlock,
            journal_commands::journal_lock,
            journal_commands::journal_set_auto_lock,
            journal_commands::journal_change_password,
            journal_commands::journal_list_entries,
            journal_commands::journal_get_entry,
            journal_commands::journal_save_entry,
            journal_commands::journal_update_entry_meta,
            journal_commands::journal_delete_entry,
            journal_commands::journal_delete_all,
            journal_commands::journal_storage_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Student Command Center");
}
