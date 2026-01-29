//! General-purpose streaming command runner
//!
//! Provides a reusable way to run external commands and stream their
//! stdout/stderr output to the frontend in real-time via Tauri channels.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;

use tauri::ipc::Channel;

use crate::events::CommandEvent;

/// Configuration for a streaming command
pub struct StreamingCommand {
    pub program: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
}

/// Find a binary by checking common locations
/// This is necessary because macOS Launch Services doesn't include user PATH
fn find_binary(name: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    // Check common locations for user-installed binaries
    let candidates = [
        home.join(".local/bin").join(name),
        home.join(format!(".{}-repo/{}", name, name)), // e.g., ~/.ccms-repo/ccms
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
        PathBuf::from("/usr/bin").join(name),
    ];

    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }

    // Fall back to searching in nvm node path (for node-based tools)
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            versions.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
            if let Some(latest) = versions.first() {
                let bin_path = latest.path().join("bin").join(name);
                if bin_path.exists() {
                    return Some(bin_path);
                }
            }
        }
    }

    None
}

/// Resolve the program path - use absolute path if found, otherwise try as-is
fn resolve_program(program: &str) -> String {
    // If it's already an absolute path, use it
    if program.starts_with('/') {
        return program.to_string();
    }

    // Try to find the binary in common locations
    if let Some(path) = find_binary(program) {
        return path.to_string_lossy().to_string();
    }

    // Fall back to the program name (will rely on PATH)
    program.to_string()
}

/// Runs a command and streams output via the channel
///
/// This function:
/// 1. Spawns the process with piped stdout/stderr
/// 2. Creates threads to read stdout and stderr concurrently
/// 3. Emits events for each line of output
/// 4. Emits a completion event when done
pub fn run_streaming(
    cmd: StreamingCommand,
    command_id: String,
    channel: Channel<CommandEvent>,
) -> Result<(), String> {
    // Resolve the program path (finds binaries in common locations)
    let resolved_program = resolve_program(&cmd.program);
    eprintln!(
        "[STREAMING] Resolved '{}' to '{}'",
        cmd.program, resolved_program
    );

    // Emit started event
    let cmd_display = format!("{} {}", cmd.program, cmd.args.join(" "));
    channel
        .send(CommandEvent::Started {
            command_id: command_id.clone(),
            command: cmd_display.clone(),
        })
        .map_err(|e| format!("Failed to send started event: {}", e))?;

    // Build the command with resolved path
    let mut command = Command::new(&resolved_program);
    command.args(&cmd.args);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    // Set working directory if specified
    if let Some(ref dir) = cmd.working_dir {
        command.current_dir(dir);
    }

    // Spawn the process
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let error_msg = format!("Failed to spawn '{}': {}", cmd.program, e);
            let _ = channel.send(CommandEvent::Error {
                command_id,
                message: error_msg.clone(),
            });
            return Err(error_msg);
        }
    };

    // Take ownership of stdout and stderr
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    // Spawn thread for stdout
    let stdout_channel = channel.clone();
    let stdout_id = command_id.clone();
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = stdout_channel.send(CommandEvent::Stdout {
                        command_id: stdout_id.clone(),
                        line,
                    });
                }
                Err(e) => {
                    eprintln!("[STREAMING] Error reading stdout: {}", e);
                    break;
                }
            }
        }
    });

    // Spawn thread for stderr
    let stderr_channel = channel.clone();
    let stderr_id = command_id.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = stderr_channel.send(CommandEvent::Stderr {
                        command_id: stderr_id.clone(),
                        line,
                    });
                }
                Err(e) => {
                    eprintln!("[STREAMING] Error reading stderr: {}", e);
                    break;
                }
            }
        }
    });

    // Wait for reader threads to complete
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    // Wait for process to exit and get status
    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for process: {}", e))?;

    // Emit completion event
    channel
        .send(CommandEvent::Completed {
            command_id,
            exit_code: status.code().unwrap_or(-1),
            success: status.success(),
        })
        .map_err(|e| format!("Failed to send completed event: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_streaming_command_struct() {
        let cmd = StreamingCommand {
            program: "echo".to_string(),
            args: vec!["hello".to_string()],
            working_dir: None,
        };
        assert_eq!(cmd.program, "echo");
        assert_eq!(cmd.args, vec!["hello"]);
    }

    #[test]
    fn test_streaming_command_with_working_dir() {
        let cmd = StreamingCommand {
            program: "ls".to_string(),
            args: vec!["-la".to_string()],
            working_dir: Some("/tmp".to_string()),
        };
        assert_eq!(cmd.program, "ls");
        assert_eq!(cmd.working_dir, Some("/tmp".to_string()));
    }

    #[test]
    fn test_resolve_program_absolute_path() {
        // Absolute paths should be returned unchanged
        let result = resolve_program("/usr/bin/ls");
        assert_eq!(result, "/usr/bin/ls");
    }

    #[test]
    fn test_resolve_program_not_found_returns_original() {
        // If binary not found, returns original name (for PATH lookup)
        let result = resolve_program("nonexistent_binary_xyz");
        assert_eq!(result, "nonexistent_binary_xyz");
    }
}
