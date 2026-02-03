//! Window management commands
//!
//! Provides native window focus control to work around Tauri's incomplete
//! focus API exposure on macOS. This is needed for proper integration with
//! voice transcription apps like superwhisper that expect strong activation
//! signals from target applications.

/// Explicitly activate the application on macOS.
///
/// This calls NSApplication.activateIgnoringOtherApps(true) to send a strong
/// activation signal to macOS. Voice transcription apps like superwhisper
/// monitor for this signal to know when to hide their window after pasting.
///
/// On non-macOS platforms, this is a no-op.
#[tauri::command]
pub fn activate_app() {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;

        if let Some(mtm) = MainThreadMarker::new() {
            let app = NSApplication::sharedApplication(mtm);
            unsafe {
                let _: () = msg_send![&app, activateIgnoringOtherApps: true];
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // No-op on other platforms
    }
}
