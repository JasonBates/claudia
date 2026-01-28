//! Appearance and color scheme commands

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Information about an available color scheme
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorSchemeInfo {
    pub name: String,
    pub path: Option<String>,
    pub is_bundled: bool,
}

/// Color values for a scheme
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorSchemeColors {
    pub bg: String,
    pub bg_secondary: String,
    pub bg_tertiary: String,
    pub fg: String,
    pub fg_muted: String,
    pub accent: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub cyan: String,
    pub magenta: String,
    pub violet: String,
    pub border: String,
    pub user_bg: String,
    pub code_bg: String,
}

/// List available color schemes from bundled and user locations
#[tauri::command]
pub async fn list_color_schemes() -> Result<Vec<ColorSchemeInfo>, String> {
    let mut schemes = Vec::new();

    // Add bundled schemes
    let bundled = vec![
        "Solarized Dark",
        "Solarized Light",
        "Dracula",
        "Nord",
        "One Dark",
        "Gruvbox Dark",
    ];

    for name in bundled {
        schemes.push(ColorSchemeInfo {
            name: name.to_string(),
            path: None,
            is_bundled: true,
        });
    }

    // Scan user directories for .itermcolors files
    if let Some(home) = dirs::home_dir() {
        let search_paths = vec![
            home.join(".config/iterm2/colors"),
            home.join("Library/Application Support/iTerm2/DynamicProfiles"),
        ];

        for dir in search_paths {
            if dir.exists() {
                if let Ok(entries) = fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path
                            .extension()
                            .map(|e| e == "itermcolors")
                            .unwrap_or(false)
                        {
                            if let Some(name) = path.file_stem() {
                                schemes.push(ColorSchemeInfo {
                                    name: name.to_string_lossy().to_string(),
                                    path: Some(path.to_string_lossy().to_string()),
                                    is_bundled: false,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(schemes)
}

/// Get color values for a specific scheme
#[tauri::command]
pub async fn get_scheme_colors(name: String) -> Result<ColorSchemeColors, String> {
    // Check bundled schemes first
    if let Some(colors) = get_bundled_scheme(&name) {
        return Ok(colors);
    }

    // Otherwise, try to find and parse an .itermcolors file
    if let Some(home) = dirs::home_dir() {
        let search_paths = vec![
            home.join(".config/iterm2/colors"),
            home.join("Library/Application Support/iTerm2/DynamicProfiles"),
        ];

        for dir in search_paths {
            let file_path = dir.join(format!("{}.itermcolors", name));
            if file_path.exists() {
                return parse_itermcolors(&file_path);
            }
        }
    }

    Err(format!("Color scheme '{}' not found", name))
}

/// Get bundled scheme colors by name
fn get_bundled_scheme(name: &str) -> Option<ColorSchemeColors> {
    match name {
        "Solarized Dark" => Some(ColorSchemeColors {
            bg: "#002b36".to_string(),
            bg_secondary: "#073642".to_string(),
            bg_tertiary: "#001e26".to_string(),
            fg: "#93a1a1".to_string(),
            fg_muted: "#657b83".to_string(),
            accent: "#268bd2".to_string(),
            red: "#dc322f".to_string(),
            green: "#859900".to_string(),
            yellow: "#b58900".to_string(),
            blue: "#268bd2".to_string(),
            cyan: "#2aa198".to_string(),
            magenta: "#d33682".to_string(),
            violet: "#6c71c4".to_string(),
            border: "#0a4959".to_string(),
            user_bg: "#073642".to_string(),
            code_bg: "#001e26".to_string(),
        }),
        "Solarized Light" => Some(ColorSchemeColors {
            bg: "#fdf6e3".to_string(),
            bg_secondary: "#eee8d5".to_string(),
            bg_tertiary: "#fdf6e3".to_string(),
            fg: "#586e75".to_string(),
            fg_muted: "#839496".to_string(),
            accent: "#268bd2".to_string(),
            red: "#dc322f".to_string(),
            green: "#859900".to_string(),
            yellow: "#b58900".to_string(),
            blue: "#268bd2".to_string(),
            cyan: "#2aa198".to_string(),
            magenta: "#d33682".to_string(),
            violet: "#6c71c4".to_string(),
            border: "#d3cbb7".to_string(),
            user_bg: "#eee8d5".to_string(),
            code_bg: "#ffffff".to_string(), // White for better contrast with github-light theme
        }),
        "Dracula" => Some(ColorSchemeColors {
            bg: "#282a36".to_string(),
            bg_secondary: "#44475a".to_string(),
            bg_tertiary: "#21222c".to_string(),
            fg: "#f8f8f2".to_string(),
            fg_muted: "#6272a4".to_string(),
            accent: "#bd93f9".to_string(),
            red: "#ff5555".to_string(),
            green: "#50fa7b".to_string(),
            yellow: "#f1fa8c".to_string(),
            blue: "#8be9fd".to_string(),
            cyan: "#8be9fd".to_string(),
            magenta: "#ff79c6".to_string(),
            violet: "#bd93f9".to_string(),
            border: "#6272a4".to_string(),
            user_bg: "#44475a".to_string(),
            code_bg: "#21222c".to_string(),
        }),
        "Nord" => Some(ColorSchemeColors {
            bg: "#2e3440".to_string(),
            bg_secondary: "#3b4252".to_string(),
            bg_tertiary: "#242933".to_string(),
            fg: "#eceff4".to_string(),
            fg_muted: "#d8dee9".to_string(),
            accent: "#88c0d0".to_string(),
            red: "#bf616a".to_string(),
            green: "#a3be8c".to_string(),
            yellow: "#ebcb8b".to_string(),
            blue: "#81a1c1".to_string(),
            cyan: "#88c0d0".to_string(),
            magenta: "#b48ead".to_string(),
            violet: "#5e81ac".to_string(),
            border: "#4c566a".to_string(),
            user_bg: "#3b4252".to_string(),
            code_bg: "#242933".to_string(),
        }),
        "One Dark" => Some(ColorSchemeColors {
            bg: "#282c34".to_string(),
            bg_secondary: "#21252b".to_string(),
            bg_tertiary: "#1e2127".to_string(),
            fg: "#abb2bf".to_string(),
            fg_muted: "#5c6370".to_string(),
            accent: "#61afef".to_string(),
            red: "#e06c75".to_string(),
            green: "#98c379".to_string(),
            yellow: "#e5c07b".to_string(),
            blue: "#61afef".to_string(),
            cyan: "#56b6c2".to_string(),
            magenta: "#c678dd".to_string(),
            violet: "#c678dd".to_string(),
            border: "#3e4451".to_string(),
            user_bg: "#21252b".to_string(),
            code_bg: "#1e2127".to_string(),
        }),
        "Gruvbox Dark" => Some(ColorSchemeColors {
            bg: "#282828".to_string(),
            bg_secondary: "#3c3836".to_string(),
            bg_tertiary: "#1d2021".to_string(),
            fg: "#ebdbb2".to_string(),
            fg_muted: "#a89984".to_string(),
            accent: "#83a598".to_string(),
            red: "#fb4934".to_string(),
            green: "#b8bb26".to_string(),
            yellow: "#fabd2f".to_string(),
            blue: "#83a598".to_string(),
            cyan: "#8ec07c".to_string(),
            magenta: "#d3869b".to_string(),
            violet: "#d3869b".to_string(),
            border: "#504945".to_string(),
            user_bg: "#3c3836".to_string(),
            code_bg: "#1d2021".to_string(),
        }),
        _ => None,
    }
}

/// Darken a hex color by a factor (0.0-1.0)
fn darken_color(hex: &str, factor: f64) -> String {
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);

    let r = (r as f64 * (1.0 - factor)).round() as u8;
    let g = (g as f64 * (1.0 - factor)).round() as u8;
    let b = (b as f64 * (1.0 - factor)).round() as u8;

    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

/// Lighten a hex color by a factor (0.0-1.0)
fn lighten_color(hex: &str, factor: f64) -> String {
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);

    let r = (r as f64 + (255.0 - r as f64) * factor).round() as u8;
    let g = (g as f64 + (255.0 - g as f64) * factor).round() as u8;
    let b = (b as f64 + (255.0 - b as f64) * factor).round() as u8;

    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

/// Parse an .itermcolors file and extract color values
fn parse_itermcolors(path: &PathBuf) -> Result<ColorSchemeColors, String> {
    let contents = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Parse as plist
    let plist: plist::Dictionary = plist::from_reader_xml(contents.as_bytes())
        .map_err(|e| format!("Failed to parse plist: {}", e))?;

    // Helper to extract a color from the plist
    let get_color = |key: &str| -> Option<String> {
        let dict = plist.get(key)?.as_dictionary()?;
        let r = dict.get("Red Component")?.as_real()?;
        let g = dict.get("Green Component")?.as_real()?;
        let b = dict.get("Blue Component")?.as_real()?;

        // Convert 0.0-1.0 floats to hex
        let r_hex = (r * 255.0).round() as u8;
        let g_hex = (g * 255.0).round() as u8;
        let b_hex = (b * 255.0).round() as u8;

        Some(format!("#{:02x}{:02x}{:02x}", r_hex, g_hex, b_hex))
    };

    // Map iTerm2 color keys to our scheme
    // Background Color, Foreground Color, and ANSI colors (0-15)
    let bg = get_color("Background Color").unwrap_or_else(|| "#002b36".to_string());
    let bg_secondary = get_color("Ansi 0 Color").unwrap_or_else(|| "#073642".to_string());

    Ok(ColorSchemeColors {
        bg: bg.clone(),
        bg_secondary: bg_secondary.clone(),
        bg_tertiary: darken_color(&bg, 0.15),
        fg: get_color("Foreground Color").unwrap_or_else(|| "#93a1a1".to_string()),
        fg_muted: get_color("Ansi 8 Color").unwrap_or_else(|| "#657b83".to_string()),
        accent: get_color("Ansi 4 Color").unwrap_or_else(|| "#268bd2".to_string()),
        red: get_color("Ansi 1 Color").unwrap_or_else(|| "#dc322f".to_string()),
        green: get_color("Ansi 2 Color").unwrap_or_else(|| "#859900".to_string()),
        yellow: get_color("Ansi 3 Color").unwrap_or_else(|| "#b58900".to_string()),
        blue: get_color("Ansi 4 Color").unwrap_or_else(|| "#268bd2".to_string()),
        cyan: get_color("Ansi 6 Color").unwrap_or_else(|| "#2aa198".to_string()),
        magenta: get_color("Ansi 5 Color").unwrap_or_else(|| "#d33682".to_string()),
        violet: get_color("Ansi 13 Color").unwrap_or_else(|| "#6c71c4".to_string()),
        border: lighten_color(&bg, 0.15),
        user_bg: bg_secondary.clone(),
        code_bg: darken_color(&bg, 0.15),
    })
}
