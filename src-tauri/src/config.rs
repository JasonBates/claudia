use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub anthropic_api_key: Option<String>,
    #[serde(default)]
    pub default_working_dir: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_content_margin")]
    pub content_margin: u32,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default)]
    pub color_scheme: Option<String>,
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_content_margin() -> u32 {
    16
}

fn default_font_family() -> String {
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif".to_string()
}

fn default_font_size() -> u32 {
    16
}

impl Config {
    /// Returns the global config path (~/.config/claudia/config.json)
    pub fn global_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("claudia")
            .join("config.json")
    }

    /// Returns the local config path for a working directory ({dir}/.claudia/config.json)
    pub fn local_path(working_dir: &str) -> PathBuf {
        PathBuf::from(working_dir)
            .join(".claudia")
            .join("config.json")
    }

    /// Returns the config path to use, checking local first then global
    pub fn path(working_dir: Option<&str>) -> PathBuf {
        // Check for local config first
        if let Some(dir) = working_dir {
            let local_path = Self::local_path(dir);
            if local_path.exists() {
                return local_path;
            }
        }

        // Fall back to global config
        Self::global_path()
    }

    pub fn load(working_dir: Option<&str>) -> Result<Self, String> {
        let path = Self::path(working_dir);

        if !path.exists() {
            return Ok(Self::default());
        }

        let contents =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;

        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse config: {}", e))
    }

    /// Save to the appropriate config location (local if exists, otherwise global)
    pub fn save(&self, working_dir: Option<&str>) -> Result<(), String> {
        let path = Self::path(working_dir);
        self.save_to_path(&path)
    }

    /// Save to the local config path for a specific directory
    pub fn save_local(&self, working_dir: &str) -> Result<(), String> {
        let path = Self::local_path(working_dir);
        self.save_to_path(&path)
    }

    /// Save to the global config path
    pub fn save_global(&self) -> Result<(), String> {
        let path = Self::global_path();
        self.save_to_path(&path)
    }

    fn save_to_path(&self, path: &PathBuf) -> Result<(), String> {
        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        let contents = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        fs::write(path, contents).map_err(|e| format!("Failed to write config: {}", e))
    }

    pub fn working_dir(&self) -> PathBuf {
        self.default_working_dir
            .as_ref()
            .map(|s| {
                if s.starts_with("~") {
                    dirs::home_dir()
                        .unwrap_or_default()
                        .join(&s[2..])
                } else {
                    PathBuf::from(s)
                }
            })
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_default_provides_dark_theme() {
        // Note: Config::default() uses Rust's Default trait (empty string)
        // The "dark" default only applies during serde deserialization
        let json = "{}";
        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.theme, "dark");
    }

    #[test]
    fn working_dir_expands_tilde() {
        let config = Config {
            default_working_dir: Some("~/Code/repos".to_string()),
            ..Default::default()
        };

        let dir = config.working_dir();

        // Should not start with ~
        assert!(!dir.to_string_lossy().starts_with("~"));
        // Should contain the rest of the path
        assert!(dir.to_string_lossy().contains("Code/repos"));
    }

    #[test]
    fn working_dir_handles_absolute_path() {
        let config = Config {
            default_working_dir: Some("/tmp/test".to_string()),
            ..Default::default()
        };

        let dir = config.working_dir();

        assert_eq!(dir, PathBuf::from("/tmp/test"));
    }

    #[test]
    fn working_dir_defaults_when_none() {
        let config = Config {
            default_working_dir: None,
            ..Default::default()
        };

        let dir = config.working_dir();

        // Should return home directory or "."
        assert!(dir.exists() || dir == PathBuf::from("."));
    }

    #[test]
    fn config_serializes_correctly() {
        let config = Config {
            anthropic_api_key: Some("test-key".to_string()),
            default_working_dir: Some("/test".to_string()),
            theme: "light".to_string(),
            ..Default::default()
        };

        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("\"anthropic_api_key\":\"test-key\""));
        assert!(json.contains("\"default_working_dir\":\"/test\""));
        assert!(json.contains("\"theme\":\"light\""));
    }

    #[test]
    fn config_deserializes_with_defaults() {
        let json = "{}";
        let config: Config = serde_json::from_str(json).unwrap();

        assert!(config.anthropic_api_key.is_none());
        assert!(config.default_working_dir.is_none());
        assert_eq!(config.theme, "dark"); // default value
    }
}
