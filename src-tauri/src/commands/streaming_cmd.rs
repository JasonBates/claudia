//! External command streaming for running arbitrary commands with output streaming

use tauri::ipc::Channel;

use super::cmd_debug_log;
use crate::events::CommandEvent;
use crate::streaming::{self, StreamingCommand};

/// Run an external command with streaming output
/// Returns a command_id that can be used to track the command
#[tauri::command]
pub async fn run_streaming_command(
    program: String,
    args: Vec<String>,
    working_dir: Option<String>,
    channel: Channel<CommandEvent>,
) -> Result<String, String> {
    let command_id = uuid::Uuid::new_v4().to_string();
    cmd_debug_log(
        "STREAM",
        &format!(
            "Starting streaming command: {} {:?} (id: {})",
            program, args, command_id
        ),
    );

    let cmd = StreamingCommand {
        program: program.clone(),
        args: args.clone(),
        working_dir,
    };

    let id = command_id.clone();
    tokio::task::spawn_blocking(move || streaming::run_streaming(cmd, id, channel))
        .await
        .map_err(|e| {
            cmd_debug_log("STREAM", &format!("Task join error: {}", e));
            format!("Task join error: {}", e)
        })??;

    cmd_debug_log(
        "STREAM",
        &format!("Streaming command completed: {}", command_id),
    );
    Ok(command_id)
}
