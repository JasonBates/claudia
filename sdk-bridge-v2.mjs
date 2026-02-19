#!/usr/bin/env node
/**
 * Claude Code Bridge with Real Streaming
 *
 * Uses CLI with --include-partial-messages for streaming text chunks.
 * Maintains persistent session via --input-format stream-json.
 *
 * Interrupt Handling:
 * - When user presses Escape, we receive {"type":"interrupt"}
 * - We close stdin to Claude (most reliable way to stop generation)
 * - Claude exits, and we IMMEDIATELY respawn (using setImmediate)
 * - The bridge stays running, so next message is fast
 */

import { spawn } from "child_process";
import * as readline from "readline";
import * as fs from "fs";
import { writeFileSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { tmpdir, homedir, userInfo } from "os";
import { fileURLToPath } from "url";

// Debug logging control - set CLAUDIA_DEBUG=1 to enable
const DEBUG_ENABLED = process.env.CLAUDIA_DEBUG === "1";

// Handle EPIPE errors gracefully - parent may close the pipe
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Parent closed stdout, exit gracefully
    process.exit(0);
  }
  // Re-throw other errors
  throw err;
});

// Find binary in common locations (PATH not available in bundled app)
function findBinary(name) {
  const home = homedir();
  const candidates = [
    join(home, ".local/bin", name),
    join(home, ".nvm/versions/node/v22.16.0/bin", name),
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return name; // fallback to PATH
}

// Get timezone (already descriptive: "Europe/London", "America/Chicago", etc.)
function getTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Format current date/time for prompt injection
function getDateTimePrefix() {
  const now = new Date();
  return now.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_FILE = join(tmpdir(), "claude-bridge-debug.log");

// Buffered async debug logging - only active when CLAUDIA_DEBUG=1
let debugBuffer = [];
let debugTimer = null;

function flushDebugLog() {
  if (debugBuffer.length > 0) {
    fs.appendFile(LOG_FILE, debugBuffer.join(""), () => {});
    debugBuffer = [];
  }
  debugTimer = null;
}

function debugLog(prefix, data) {
  if (!DEBUG_ENABLED) return;

  const timestamp = new Date().toISOString();
  const msg = `[${timestamp}] [${prefix}] ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\n`;
  debugBuffer.push(msg);

  // Flush periodically, not on every call
  if (!debugTimer) {
    debugTimer = setTimeout(flushDebugLog, 100);
  }
}

// Clear log on start (only if debug enabled)
if (DEBUG_ENABLED) {
  writeFileSync(LOG_FILE, `=== Bridge started at ${new Date().toISOString()} ===\n`);
}

// Non-blocking stdout write (EPIPE handled globally)
function sendEvent(type, data = {}) {
  const msg = JSON.stringify({ type, ...data }) + '\n';
  debugLog("SEND", { type, ...data });
  process.stdout.write(msg);
}

async function main() {
  const inputRl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  // Claude CLI path and timezone (detected once at startup)
  const claudePath = findBinary("claude");
  const userTimezone = getTimezone();
  debugLog("TIMEZONE", userTimezone);
  debugLog("CLAUDE_PATH", claudePath);

  // State managed across respawns
  let claude = null;
  let claudeRl = null;
  let currentSessionId = null;
  let readySent = false;
  let isInterrupting = false;
  let pendingMessages = [];  // Queue messages during respawn
  let isWarmingUp = false;   // Suppress events during warmup
  let currentToolId = null;  // Track current tool ID for tool_result matching
  let currentToolName = null; // Track current tool name for subagent detection

  // Subagent tracking state
  let activeSubagents = new Map();  // tool_use_id -> subagentInfo
  let bgAgentMap = new Map();       // SDK agentId -> tool_use_id (for task_notification matching)
  let mainResultSent = false;       // True after main conversation result is handled
  let completedBgAgents = new Map(); // tool_use_id -> {taskId, agentType, duration, toolCount} for bg result merge
  let bgTaskStateByTool = new Map(); // tool_use_id -> bg task lifecycle state
  let bgFinalizedResultKeys = new Set(); // dedupe keys for exactly-once bg_task_result emission
  let bgFinalizedResultSources = new Map(); // key -> source of finalization
  let bgOutputFileMap = new Map();  // taskId -> output file path
  let bgOutputFileByTool = new Map(); // tool_use_id -> output file path
  let bgOutputRootHints = new Set(); // directories that contain task output files
  let bgOutputRootScanCache = []; // discovered task output directories
  let bgOutputRootScanAt = 0;
  let bgOrphanFallbackTimers = new Map(); // taskId -> timeout handle for task-only fallbacks
  let bgOutputRecoveryInFlight = new Set(); // recoveryKey strings for dedupe
  let safetyNetTimer = null;        // setTimeout ref for bg agent safety net
  let lastBgActivityAt = 0;         // Last time bg/subagent state changed
  // No stack - use Map ordering for oldest-first attribution
  let taskInputBuffer = "";         // Accumulate JSON for Task tool input parsing

  // Early done tracking — send done on message_stop instead of waiting for CLI result.
  // The CLI holds the result message while bg agents are running, causing a 6+ second
  // streaming timeout delay. By sending done on message_stop, we unblock the user immediately.
  let lastStopReason = null;        // stop_reason from most recent message_delta
  let pendingCliResultAcks = [];    // Timestamps of late CLI result messages to suppress (sent early done)

  // Buffer limits to prevent unbounded memory growth
  const MAX_TASK_INPUT_SIZE = 1024 * 1024;  // 1MB limit for task input buffer
  const MAX_PENDING_MESSAGES = 100;          // Max queued messages during respawn
  const BG_RESULT_FALLBACK_DELAY_MS = 3500;  // Wait for structured bg result before fallback file recovery
  const BG_OUTPUT_ROOT_SCAN_CACHE_MS = 10000;
  const BG_OUTPUT_FILE_RESOLVE_RETRY_MS = 700;
  const BG_OUTPUT_FILE_RESOLVE_MAX_ATTEMPTS = 10;
  const MAX_BG_FINALIZED_KEYS = 2000;        // Prevent unbounded dedupe key growth
  const PENDING_CLI_RESULT_TTL_MS = 15000;   // Default TTL when no background tasks are pending
  const PENDING_CLI_RESULT_BG_TTL_MS = 20 * 60 * 1000; // Keep acks longer while bg tasks are active
  const MAX_PENDING_CLI_RESULT_ACKS = 50;    // Bound queue growth if CLI emits unmatched done events

  // Domains allowed through the sandbox network proxy
  const SANDBOX_ALLOWED_DOMAINS = [
    "github.com",
    "api.github.com",
    "*.githubusercontent.com",
    "registry.npmjs.org",
    "*.npmjs.org",
    "pypi.org",
    "files.pythonhosted.org",
    "bun.sh",
    "formulae.brew.sh",
    "*.ghcr.io",
  ];

  // Build Claude args - optionally resume a session
  function buildClaudeArgs(resumeSessionId = null) {
    const settings = { alwaysThinkingEnabled: true };

    // Enable SDK sandbox when CLAUDIA_SANDBOX is set
    // Note: SDK sandbox restricts both file writes AND outbound network.
    // The SDK always initializes allowedDomains as [], which triggers
    // needsNetworkRestriction. We pass explicit allowedDomains so common
    // dev domains work through the sandbox network proxy.
    if (process.env.CLAUDIA_SANDBOX === "1") {
      debugLog("SANDBOX", "Sandbox mode enabled");
      settings.sandbox = {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        network: {
          allowedDomains: SANDBOX_ALLOWED_DOMAINS,
        },
      };
    }

    const args = [
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--model", "opus",
      "--verbose",
      // Permission handling via control_request events in the stream protocol
      // --permission-prompt-tool stdio enables the control protocol for tool permissions
      // See handlePermissionRequestEvent in event-handlers.ts
      "--permission-prompt-tool", "stdio",
      "--permission-mode", "default",
      "--settings", JSON.stringify(settings),
      "--append-system-prompt", `User's timezone: ${userTimezone}`
    ];

    // Resume session if provided (e.g., after interrupt)
    // Or from environment variable (e.g., app startup with --resume)
    const sessionToResume = resumeSessionId || process.env.CLAUDE_RESUME_SESSION;
    if (sessionToResume) {
      debugLog("RESUME", `Resuming session: ${sessionToResume}`);
      args.push("--resume", sessionToResume);
    }

    return args;
  }

  // Deduplicate nested tool progress so parallel parsing paths
  // (stream_event + assistant message) don't double count.
  function emitSubagentProgress(subagentId, toolId, toolName, toolDetail = "") {
    const subagent = activeSubagents.get(subagentId);
    if (!subagent) return;

    if (!subagent.seenNestedToolIds) {
      subagent.seenNestedToolIds = new Set();
    }

    if (toolId && subagent.seenNestedToolIds.has(toolId)) {
      debugLog("SUBAGENT_PROGRESS_DEDUPED", { subagentId, toolId, toolName });
      return;
    }

    if (toolId) {
      subagent.seenNestedToolIds.add(toolId);
    }

    subagent.nestedToolCount++;
    sendEvent("subagent_progress", {
      subagentId,
      toolName,
      toolId,
      toolDetail,
      toolCount: subagent.nestedToolCount
    });
    debugLog("SUBAGENT_PROGRESS", {
      subagentId,
      toolName,
      toolDetail,
      toolCount: subagent.nestedToolCount
    });
  }

  function scheduleSubagentSafetyNet(reason) {
    const SAFETY_NET_IDLE_MS = 120000; // Fire only after this long with no bg activity
    const hasPendingBg = activeSubagents.size > 0 || completedBgAgents.size > 0;

    if (!hasPendingBg) {
      if (safetyNetTimer) {
        clearTimeout(safetyNetTimer);
        safetyNetTimer = null;
      }
      return;
    }

    lastBgActivityAt = Date.now();

    if (safetyNetTimer) return;

    const arm = (delayMs) => {
      debugLog("SUBAGENT_DEFERRED_SAFETY_NET", {
        reason,
        delayMs,
        active: activeSubagents.size,
        completedAwaitingMerge: completedBgAgents.size,
        ids: [...activeSubagents.keys()]
      });

      safetyNetTimer = setTimeout(() => {
        safetyNetTimer = null;

        const pendingCount = activeSubagents.size + completedBgAgents.size;
        if (pendingCount === 0) return;

        const idleForMs = Date.now() - lastBgActivityAt;
        if (idleForMs < SAFETY_NET_IDLE_MS) {
          const remainingMs = SAFETY_NET_IDLE_MS - idleForMs;
          debugLog("SUBAGENT_SAFETY_NET_RESCHEDULE", {
            reason,
            idleForMs,
            remainingMs,
            pendingCount
          });
          arm(remainingMs);
          return;
        }

        if (activeSubagents.size > 0) {
          debugLog("SUBAGENT_SAFETY_NET_FIRING", { remaining: activeSubagents.size, ids: [...activeSubagents.keys()] });
          for (const [id, info] of activeSubagents) {
            const duration = Date.now() - info.startTime;
            sendEvent("subagent_end", {
              id,
              agentType: info.agentType || "unknown",
              duration,
              toolCount: info.nestedToolCount,
              result: ""
            });
            debugLog("SUBAGENT_END_SAFETY_NET", { id, agentType: info.agentType, duration });
          }
          activeSubagents.clear();
          bgAgentMap.clear();
          completedBgAgents.clear();
          for (const state of bgTaskStateByTool.values()) {
            if (state.fallbackTimer) {
              clearTimeout(state.fallbackTimer);
            }
          }
          bgTaskStateByTool.clear();
          bgFinalizedResultKeys.clear();
          bgFinalizedResultSources.clear();
          bgOutputFileMap.clear();
          bgOutputFileByTool.clear();
          bgOutputRootHints.clear();
          bgOutputRootScanCache = [];
          bgOutputRootScanAt = 0;
          for (const timer of bgOrphanFallbackTimers.values()) {
            clearTimeout(timer);
          }
          bgOrphanFallbackTimers.clear();
          bgOutputRecoveryInFlight.clear();
        } else if (completedBgAgents.size > 0) {
          // If bg result payloads never arrive, avoid leaking stale merge state.
          debugLog("SUBAGENT_SAFETY_NET_CLEARING_STALE_BG_RESULTS", { count: completedBgAgents.size });
          for (const state of bgTaskStateByTool.values()) {
            if (state.fallbackTimer) {
              clearTimeout(state.fallbackTimer);
            }
          }
          completedBgAgents.clear();
          bgTaskStateByTool.clear();
          bgFinalizedResultKeys.clear();
          bgFinalizedResultSources.clear();
          bgAgentMap.clear();
          bgOutputFileMap.clear();
          bgOutputFileByTool.clear();
          bgOutputRootHints.clear();
          bgOutputRootScanCache = [];
          bgOutputRootScanAt = 0;
          for (const timer of bgOrphanFallbackTimers.values()) {
            clearTimeout(timer);
          }
          bgOrphanFallbackTimers.clear();
          bgOutputRecoveryInFlight.clear();
        }
      }, delayMs);
    };

    arm(SAFETY_NET_IDLE_MS);
  }

  function prunePendingCliResultAcks(now = Date.now()) {
    if (pendingCliResultAcks.length === 0) return;
    const hasPendingBackground = activeSubagents.size > 0 || completedBgAgents.size > 0;
    const ttlMs = hasPendingBackground ? PENDING_CLI_RESULT_BG_TTL_MS : PENDING_CLI_RESULT_TTL_MS;
    const before = pendingCliResultAcks.length;
    pendingCliResultAcks = pendingCliResultAcks.filter((createdAt) =>
      now - createdAt <= ttlMs
    );
    if (pendingCliResultAcks.length !== before) {
      debugLog("PENDING_CLI_RESULT_ACKS_PRUNED", {
        before,
        after: pendingCliResultAcks.length,
        ttlMs,
        hasPendingBackground
      });
    }
  }

  function enqueuePendingCliResultAck() {
    prunePendingCliResultAcks();
    pendingCliResultAcks.push(Date.now());
    while (pendingCliResultAcks.length > MAX_PENDING_CLI_RESULT_ACKS) {
      pendingCliResultAcks.shift();
    }
    return pendingCliResultAcks.length;
  }

  function consumePendingCliResultAck() {
    prunePendingCliResultAcks();
    if (pendingCliResultAcks.length === 0) return false;
    pendingCliResultAcks.shift();
    return true;
  }

  function normalizeAgentId(value) {
    if (typeof value !== "string") return "";
    return value.trim().replace(/^['"`]+|['"`]+$/g, "");
  }

  function extractBackgroundAgentId(resultText) {
    if (typeof resultText !== "string" || resultText.length === 0) return null;

    const normalizedText = resultText
      .replace(/\\n/g, "\n")
      .replace(/\\\//g, "/");

    const patterns = [
      /agentId\s*[:=]\s*`?["']?([^\s\\`"'(),\]}]+)/i,
      /"agentId"\s*:\s*"([^"]+)"/i,
      /agent_id\s*[:=]\s*`?["']?([^\s\\`"'(),\]}]+)/i,
    ];

    for (const pattern of patterns) {
      const match = normalizedText.match(pattern);
      if (match && match[1]) {
        const id = normalizeAgentId(match[1]);
        if (id) return id;
      }
    }

    return null;
  }

  function toBgResultKey(taskId, toolUseId) {
    const normalizedTaskId = normalizeAgentId(taskId);
    if (normalizedTaskId) {
      return `task:${normalizedTaskId.toLowerCase()}`;
    }
    if (toolUseId) {
      return `tool:${toolUseId}`;
    }
    return "";
  }

  function createBgTaskState(toolUseId) {
    return {
      toolUseId,
      taskId: "",
      outputFile: "",
      phase: "active", // active | awaiting_result | finalized
      agentType: "unknown",
      duration: 0,
      toolCount: 0,
      summary: "",
      fallbackTimer: null
    };
  }

  function getOrCreateBgTaskState(toolUseId) {
    if (!toolUseId) return null;
    let state = bgTaskStateByTool.get(toolUseId);
    if (!state) {
      state = createBgTaskState(toolUseId);
      bgTaskStateByTool.set(toolUseId, state);
    }
    return state;
  }

  function clearBgResultFallbackTimer(toolUseId) {
    if (!toolUseId) return;
    const state = bgTaskStateByTool.get(toolUseId);
    if (state?.fallbackTimer) {
      clearTimeout(state.fallbackTimer);
      state.fallbackTimer = null;
    }
  }

  function isBgResultFinalized(taskId, toolUseId) {
    const key = toBgResultKey(taskId, toolUseId);
    if (!key) return false;
    return bgFinalizedResultKeys.has(key);
  }

  function getBgResultFinalizedSource(taskId, toolUseId) {
    const key = toBgResultKey(taskId, toolUseId);
    if (!key) return null;
    return bgFinalizedResultSources.get(key) || null;
  }

  function addBgFinalizedResultKey(key, source) {
    if (!key) return;
    bgFinalizedResultKeys.add(key);
    bgFinalizedResultSources.set(key, source || "unknown");

    while (bgFinalizedResultKeys.size > MAX_BG_FINALIZED_KEYS) {
      const oldest = bgFinalizedResultKeys.values().next().value;
      if (!oldest) break;
      bgFinalizedResultKeys.delete(oldest);
      bgFinalizedResultSources.delete(oldest);
    }
  }

  function markBgResultFinalized(taskId, toolUseId, source = "unknown") {
    const key = toBgResultKey(taskId, toolUseId);
    if (key) {
      addBgFinalizedResultKey(key, source);
    }
    if (toolUseId) {
      const state = bgTaskStateByTool.get(toolUseId);
      if (state?.taskId) {
        const taskKey = toBgResultKey(state.taskId, null);
        if (taskKey) {
          addBgFinalizedResultKey(taskKey, source);
        }
      }
      if (state) {
        state.phase = "finalized";
      }
    }
  }

  function rememberBgAgentMapping(agentId, toolUseId) {
    const normalized = normalizeAgentId(agentId);
    if (!normalized || !toolUseId) return;
    const alreadyMappedToSameTool =
      bgAgentMap.get(normalized) === toolUseId ||
      bgAgentMap.get(normalized.toLowerCase()) === toolUseId;

    const state = getOrCreateBgTaskState(toolUseId);
    if (state) {
      state.taskId = normalized;
    }

    bgAgentMap.set(normalized, toolUseId);
    bgAgentMap.set(normalized.toLowerCase(), toolUseId);

    const shortId = normalized.split("-")[0];
    if (shortId && shortId !== normalized) {
      bgAgentMap.set(shortId, toolUseId);
      bgAgentMap.set(shortId.toLowerCase(), toolUseId);
    }

    const subagent = activeSubagents.get(toolUseId);
    if (subagent) {
      subagent.bgTaskId = normalized;
    }

    if (!alreadyMappedToSameTool) {
      sendEvent("bg_task_registered", {
        taskId: normalized,
        toolUseId,
        agentType: subagent?.agentType || "unknown",
        description: subagent?.description || ""
      });
    }
  }

  function extractBackgroundOutputFilePath(resultText) {
    if (typeof resultText !== "string" || resultText.length === 0) return null;

    const normalizedText = resultText
      .replace(/\\n/g, "\n")
      .replace(/\\\//g, "/");
    const match = normalizedText.match(/output_file\s*:\s*([^\s`"'(){}\[\]]+)/i);
    if (!match || !match[1]) return null;

    const outputPath = match[1].trim().replace(/^['"`]+|['"`]+$/g, "");
    return outputPath || null;
  }

  function extractTaskIdFromOutputFilePath(outputFile) {
    if (typeof outputFile !== "string" || outputFile.length === 0) return null;

    const fileName = basename(outputFile.trim());
    const directMatch = fileName.match(/^([^.\/\\]+)\.output$/i);
    if (directMatch?.[1]) return normalizeAgentId(directMatch[1]);

    const jsonlMatch = fileName.match(/^agent-([^.\/\\]+)\.jsonl$/i);
    if (jsonlMatch?.[1]) return normalizeAgentId(jsonlMatch[1]);

    return null;
  }

  function rememberBgOutputFile(taskId, toolUseId, outputFile) {
    if (typeof outputFile !== "string" || outputFile.length === 0) return;

    const normalizedOutputFile = outputFile.trim();
    if (!normalizedOutputFile) return;

    const outputRoot = dirname(normalizedOutputFile);
    if (outputRoot && outputRoot !== "." && outputRoot !== "/") {
      bgOutputRootHints.add(outputRoot);
      while (bgOutputRootHints.size > 200) {
        const oldest = bgOutputRootHints.values().next().value;
        if (!oldest) break;
        bgOutputRootHints.delete(oldest);
      }
      bgOutputRootScanCache = [];
      bgOutputRootScanAt = 0;
    }

    if (toolUseId) {
      bgOutputFileByTool.set(toolUseId, normalizedOutputFile);
      const state = getOrCreateBgTaskState(toolUseId);
      if (state) {
        state.outputFile = normalizedOutputFile;
      }
    }

    const normalizedTaskId = normalizeAgentId(taskId) || extractTaskIdFromOutputFilePath(normalizedOutputFile);
    if (!normalizedTaskId) return;

    bgOutputFileMap.set(normalizedTaskId, normalizedOutputFile);
    bgOutputFileMap.set(normalizedTaskId.toLowerCase(), normalizedOutputFile);

    const shortId = normalizedTaskId.split("-")[0];
    if (shortId && shortId !== normalizedTaskId) {
      bgOutputFileMap.set(shortId, normalizedOutputFile);
      bgOutputFileMap.set(shortId.toLowerCase(), normalizedOutputFile);
    }

    debugLog("BG_OUTPUT_FILE_REGISTERED", {
      taskId: normalizedTaskId,
      toolUseId,
      outputFile: normalizedOutputFile
    });
  }

  function refreshBgOutputRootScanCache() {
    const now = Date.now();
    if (now - bgOutputRootScanAt < BG_OUTPUT_ROOT_SCAN_CACHE_MS) {
      return bgOutputRootScanCache;
    }

    const roots = new Set();
    const addRootIfExists = (candidate) => {
      if (typeof candidate !== "string" || !candidate.trim()) return;
      const normalized = candidate.trim();
      if (roots.has(normalized)) return;
      try {
        if (existsSync(normalized)) {
          roots.add(normalized);
        }
      } catch {
        // Ignore filesystem probe errors.
      }
    };

    for (const hint of bgOutputRootHints) {
      addRootIfExists(hint);
    }

    const homeSlug = homedir().replace(/[\\/]/g, "-");
    try {
      const user = userInfo();
      if (user && typeof user.uid === "number") {
        addRootIfExists(join("/private/tmp", `claude-${user.uid}`, homeSlug, "tasks"));
        addRootIfExists(join("/tmp", `claude-${user.uid}`, homeSlug, "tasks"));
      }
    } catch {
      // userInfo may fail in restricted environments; skip.
    }

    const tmpBases = ["/private/tmp", "/tmp", tmpdir()];
    for (const base of tmpBases) {
      try {
        const claudeRoots = fs.readdirSync(base, { withFileTypes: true });
        for (const entry of claudeRoots) {
          if (!entry.isDirectory() || !entry.name.startsWith("claude-")) continue;
          const claudeRoot = join(base, entry.name);
          addRootIfExists(join(claudeRoot, homeSlug, "tasks"));
          try {
            const nested = fs.readdirSync(claudeRoot, { withFileTypes: true });
            for (const child of nested) {
              if (!child.isDirectory()) continue;
              addRootIfExists(join(claudeRoot, child.name, "tasks"));
            }
          } catch {
            // Ignore nested scan errors.
          }
        }
      } catch {
        // Ignore scan errors for non-existent/inaccessible bases.
      }
    }

    const projectsRoot = join(homedir(), ".claude", "projects");
    try {
      const projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true });
      for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory()) continue;
        const projectPath = join(projectsRoot, projectDir.name);
        addRootIfExists(join(projectPath, "subagents"));
        try {
          const sessions = fs.readdirSync(projectPath, { withFileTypes: true });
          for (const sessionDir of sessions) {
            if (!sessionDir.isDirectory()) continue;
            addRootIfExists(join(projectPath, sessionDir.name, "subagents"));
          }
        } catch {
          // Ignore per-project session scan errors.
        }
      }
    } catch {
      // Ignore missing ~/.claude/projects.
    }

    bgOutputRootScanCache = [...roots];
    bgOutputRootScanAt = now;
    return bgOutputRootScanCache;
  }

  function collectBgOutputFileCandidates(taskId, toolUseId) {
    const normalizedTaskId = normalizeAgentId(taskId);
    if (!normalizedTaskId) return [];

    const candidates = [];
    const seen = new Set();
    const pushCandidate = (candidate) => {
      if (typeof candidate !== "string") return;
      const normalized = candidate.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push(normalized);
    };

    if (toolUseId) {
      const byTool = bgOutputFileByTool.get(toolUseId);
      if (byTool) pushCandidate(byTool);
      const state = bgTaskStateByTool.get(toolUseId);
      if (state?.outputFile) pushCandidate(state.outputFile);
    }

    const shortId = normalizedTaskId.split("-")[0];
    const mapKeys = [
      normalizedTaskId,
      normalizedTaskId.toLowerCase(),
      shortId,
      shortId.toLowerCase()
    ];
    for (const key of mapKeys) {
      const mapped = bgOutputFileMap.get(key);
      if (mapped) pushCandidate(mapped);
    }

    const rootCandidates = refreshBgOutputRootScanCache();
    for (const root of rootCandidates) {
      const baseName = basename(root);
      if (baseName === "tasks") {
        pushCandidate(join(root, `${normalizedTaskId}.output`));
      } else if (baseName === "subagents") {
        pushCandidate(join(root, `agent-${normalizedTaskId}.jsonl`));
      } else {
        pushCandidate(join(root, `${normalizedTaskId}.output`));
        pushCandidate(join(root, `agent-${normalizedTaskId}.jsonl`));
      }
    }

    return candidates;
  }

  function inferBgOutputFile(taskId, toolUseId) {
    const normalizedTaskId = normalizeAgentId(taskId);
    if (!normalizedTaskId) return null;

    const candidates = collectBgOutputFileCandidates(normalizedTaskId, toolUseId);
    for (const candidate of candidates) {
      try {
        if (!existsSync(candidate)) continue;
        rememberBgOutputFile(normalizedTaskId, toolUseId, candidate);
        debugLog("BG_OUTPUT_FILE_INFERRED", {
          taskId: normalizedTaskId,
          toolUseId,
          outputFile: candidate
        });
        return candidate;
      } catch {
        // Ignore probe errors.
      }
    }

    return null;
  }

  function resolveBgOutputFile(taskId, toolUseId) {
    if (toolUseId) {
      const byToolId = bgOutputFileByTool.get(toolUseId);
      if (byToolId) return byToolId;
    }

    const normalized = normalizeAgentId(taskId);
    if (!normalized) return null;

    const lower = normalized.toLowerCase();
    const shortId = normalized.split("-")[0];
    const shortLower = shortId.toLowerCase();

    const mapped = (
      bgOutputFileMap.get(normalized) ||
      bgOutputFileMap.get(lower) ||
      bgOutputFileMap.get(shortId) ||
      bgOutputFileMap.get(shortLower) ||
      null
    );
    if (mapped) return mapped;

    return inferBgOutputFile(normalized, toolUseId);
  }

  function hasToolPermissionDenied(text) {
    if (typeof text !== "string" || !text) return false;
    return /Permission to use [^\n]+ has been denied/i.test(text);
  }

  function isLikelyInterimAssistantText(text) {
    if (typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    const normalized = trimmed.toLowerCase();
    const isShort = normalized.length < 220;

    if (isShort && normalized.endsWith(":")) {
      return true;
    }

    if (
      isShort &&
      /^(i(?:'|’)ll|i will|let me|now let me|i apologize|first[, ]|next[, ])\b/.test(normalized)
    ) {
      return true;
    }

    if (isShort && /\blet me\b/.test(normalized) && !normalized.includes("\n")) {
      return true;
    }

    return false;
  }

  function messageHasToolUse(content) {
    if (!Array.isArray(content)) return false;
    return content.some(
      (block) => block && typeof block === "object" && block.type === "tool_use"
    );
  }

  function extractTaskOutputFromText(text, expectedTaskId = "") {
    if (typeof text !== "string" || !text.includes("<task_id>")) {
      return "";
    }

    const parsedTaskOutput = extractTaskOutputResult(text);
    if (!parsedTaskOutput || parsedTaskOutput.status !== "completed") {
      return "";
    }

    const normalizedExpectedTaskId = normalizeAgentId(expectedTaskId);
    if (
      normalizedExpectedTaskId &&
      parsedTaskOutput.taskId &&
      normalizeAgentId(parsedTaskOutput.taskId) !== normalizedExpectedTaskId
    ) {
      return "";
    }

    return (parsedTaskOutput.output || text || "").trim();
  }

  function getToolResultTextCandidates(parsedLine) {
    const textCandidates = [];
    const pushCandidate = (value) => {
      if (typeof value === "string" && value.trim()) {
        textCandidates.push(value.trim());
      }
    };

    pushCandidate(parsedLine?.result);

    const toolUseResult = parsedLine?.toolUseResult;
    if (typeof toolUseResult === "string") {
      pushCandidate(toolUseResult);
    } else if (toolUseResult && typeof toolUseResult === "object") {
      pushCandidate(toolUseResult.result);
      pushCandidate(toolUseResult.output);
      pushCandidate(toolUseResult.stderr);
      pushCandidate(toolUseResult.message);
    }

    const messageContent = parsedLine?.message?.content;
    if (Array.isArray(messageContent)) {
      for (const block of messageContent) {
        if (!block || typeof block !== "object") continue;
        if (block.type !== "tool_result") continue;

        const content = block.content;
        if (typeof content === "string") {
          pushCandidate(content);
        } else if (Array.isArray(content)) {
          for (const part of content) {
            if (
              part &&
              typeof part === "object" &&
              part.type === "text" &&
              typeof part.text === "string"
            ) {
              pushCandidate(part.text);
            }
          }
        } else if (content && typeof content === "object") {
          try {
            pushCandidate(JSON.stringify(content));
          } catch {
            // Ignore non-serializable content.
          }
        }
      }
    }

    return textCandidates;
  }

  function extractAssistantTextFromContent(content) {
    if (typeof content === "string") {
      return content.trim();
    }

    if (!Array.isArray(content)) {
      return "";
    }

    const textBlocks = [];
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim()
      ) {
        textBlocks.push(block.text.trim());
      }
    }

    return textBlocks.join("\n\n").trim();
  }

  function extractTaskResultFromOutputFile(rawOutput, expectedTaskId = "") {
    if (typeof rawOutput !== "string") {
      return { result: "", sawPermissionDenied: false, sawTerminalRecord: false };
    }
    const trimmed = rawOutput.trim();
    if (!trimmed) {
      return { result: "", sawPermissionDenied: false, sawTerminalRecord: false };
    }

    const lines = trimmed.split(/\r?\n/);
    let sawPermissionDenied = false;
    let sawTerminalRecord = false;
    let parsedAnyLine = false;
    const parsedEntries = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const parsed = JSON.parse(line);
        parsedAnyLine = true;
        parsedEntries.push(parsed);
      } catch {
        // Not JSONL entry; continue scanning.
      }
    }

    for (let i = parsedEntries.length - 1; i >= 0; i--) {
      const parsed = parsedEntries[i];

      const textCandidates = getToolResultTextCandidates(parsed);
      for (const candidate of textCandidates) {
        if (hasToolPermissionDenied(candidate)) {
          sawPermissionDenied = true;
        }
        const taskOutput = extractTaskOutputFromText(candidate, expectedTaskId);
        if (taskOutput) {
          return {
            result: taskOutput,
            sawPermissionDenied,
            sawTerminalRecord: true
          };
        }
      }

      if (parsed?.type === "result" && typeof parsed?.result === "string" && parsed.result.trim()) {
        return {
          result: parsed.result.trim(),
          sawPermissionDenied,
          sawTerminalRecord: true
        };
      }
    }

    if (parsedEntries.length > 0) {
      const hasAssistantToolUseAfter = new Array(parsedEntries.length).fill(false);
      let seenAssistantToolUse = false;
      for (let i = parsedEntries.length - 1; i >= 0; i--) {
        hasAssistantToolUseAfter[i] = seenAssistantToolUse;
        const message = parsedEntries[i]?.message;
        if (message?.role === "assistant" && messageHasToolUse(message.content)) {
          seenAssistantToolUse = true;
        }
      }

      for (let i = parsedEntries.length - 1; i >= 0; i--) {
        const message = parsedEntries[i]?.message;
        if (message?.role !== "assistant") continue;
        if (messageHasToolUse(message.content)) continue;
        if (hasAssistantToolUseAfter[i]) continue;

        const assistantText = extractAssistantTextFromContent(message.content);
        if (!assistantText) continue;
        if (isLikelyInterimAssistantText(assistantText)) continue;

        return {
          result: assistantText,
          sawPermissionDenied,
          sawTerminalRecord: true
        };
      }
    }

    const inlineTaskOutput = extractTaskOutputFromText(trimmed, expectedTaskId);
    if (inlineTaskOutput) {
      return {
        result: inlineTaskOutput,
        sawPermissionDenied,
        sawTerminalRecord: true
      };
    }

    if (!parsedAnyLine) {
      if (hasToolPermissionDenied(trimmed)) {
        sawPermissionDenied = true;
      }
      return {
        result: trimmed,
        sawPermissionDenied,
        sawTerminalRecord: true
      };
    }

    return {
      result: "",
      sawPermissionDenied,
      sawTerminalRecord
    };
  }

  function rememberAsyncLaunchMetadata(resultText, toolUseId) {
    const agentId = extractBackgroundAgentId(resultText);
    const outputFile = extractBackgroundOutputFilePath(resultText);
    const derivedTaskId = agentId || extractTaskIdFromOutputFilePath(outputFile || "");

    if (toolUseId) {
      const state = getOrCreateBgTaskState(toolUseId);
      if (state) {
        state.phase = "active";
        if (derivedTaskId) {
          state.taskId = derivedTaskId;
        }
        if (outputFile) {
          state.outputFile = outputFile;
        }
      }
    }

    if (derivedTaskId && toolUseId) {
      rememberBgAgentMapping(derivedTaskId, toolUseId);
    }
    if (outputFile) {
      rememberBgOutputFile(derivedTaskId || "", toolUseId, outputFile);
    }

    return {
      agentId: derivedTaskId || null,
      outputFile: outputFile || null
    };
  }

  function resolveBgToolUseId(taskId) {
    const normalized = normalizeAgentId(taskId);
    if (!normalized) return null;

    const lower = normalized.toLowerCase();
    const shortId = normalized.split("-")[0];
    const shortLower = shortId.toLowerCase();

    return (
      bgAgentMap.get(normalized) ||
      bgAgentMap.get(lower) ||
      bgAgentMap.get(shortId) ||
      bgAgentMap.get(shortLower) ||
      null
    );
  }

  function clearBgMappingsForTool(toolUseId) {
    clearBgResultFallbackTimer(toolUseId);
    for (const [key, value] of bgAgentMap) {
      if (value === toolUseId) {
        bgAgentMap.delete(key);
      }
    }

    const outputFile = bgOutputFileByTool.get(toolUseId);
    if (outputFile) {
      bgOutputFileByTool.delete(toolUseId);
      for (const [key, value] of bgOutputFileMap) {
        if (value === outputFile) {
          bgOutputFileMap.delete(key);
        }
      }
    }

    bgTaskStateByTool.delete(toolUseId);
    completedBgAgents.delete(toolUseId);
  }

  function clearBgMappingsForTask(taskId) {
    const normalized = normalizeAgentId(taskId);
    if (!normalized) return;

    const shortId = normalized.split("-")[0];
    const taskKeys = [normalized, normalized.toLowerCase(), shortId, shortId.toLowerCase()];
    for (const key of taskKeys) {
      bgAgentMap.delete(key);
      bgOutputFileMap.delete(key);
      const finalizedKey = `task:${key}`;
      bgFinalizedResultKeys.delete(finalizedKey);
      bgFinalizedResultSources.delete(finalizedKey);
    }

    const timer = bgOrphanFallbackTimers.get(normalized);
    if (timer) {
      clearTimeout(timer);
      bgOrphanFallbackTimers.delete(normalized);
    }
  }

  function extractTaskOutputResult(resultText) {
    if (typeof resultText !== "string" || !resultText.includes("<task_id>")) return null;

    const taskIdMatch = resultText.match(/<task_id>\s*([^<\s]+)\s*<\/task_id>/i);
    if (!taskIdMatch || !taskIdMatch[1]) return null;

    const statusMatch = resultText.match(/<status>\s*([^<]+)\s*<\/status>/i);
    const outputMatch = resultText.match(/<output>\s*([\s\S]*?)\s*<\/output>/i);

    return {
      taskId: normalizeAgentId(taskIdMatch[1]),
      status: (statusMatch?.[1] || "").trim().toLowerCase(),
      output: (outputMatch?.[1] || "").trim()
    };
  }

  function emitBgTaskResultOnce({
    taskId,
    toolUseId,
    result,
    status = "completed",
    source = "unknown"
  }) {
    const normalizedTaskId = normalizeAgentId(taskId);
    const resolvedToolUseId = toolUseId || resolveBgToolUseId(normalizedTaskId);
    const state = resolvedToolUseId ? getOrCreateBgTaskState(resolvedToolUseId) : null;

    if (state && normalizedTaskId && !state.taskId) {
      state.taskId = normalizedTaskId;
    }

    const finalTaskId = normalizedTaskId || state?.taskId || "";
    const dedupeTaskId = finalTaskId || normalizedTaskId;
    const finalizedSource = getBgResultFinalizedSource(dedupeTaskId, resolvedToolUseId);
    const canOverrideNoOutput =
      finalizedSource === "no-output-fallback" && source === "task-output";
    if (finalizedSource && !canOverrideNoOutput) {
      debugLog("BG_TASK_RESULT_DUPLICATE_SKIPPED", {
        taskId: dedupeTaskId,
        toolUseId: resolvedToolUseId,
        finalizedSource,
        source
      });
      return false;
    }
    if (canOverrideNoOutput) {
      debugLog("BG_TASK_RESULT_OVERRIDE_NO_OUTPUT", {
        taskId: dedupeTaskId,
        toolUseId: resolvedToolUseId,
        source
      });
    }

    const mergedResult = (result || "").slice(0, 10000);
    if (!mergedResult) {
      return false;
    }

    const preserved = resolvedToolUseId ? completedBgAgents.get(resolvedToolUseId) : null;
    const active = resolvedToolUseId ? activeSubagents.get(resolvedToolUseId) : null;
    const agentType =
      state?.agentType ||
      preserved?.agentType ||
      active?.agentType ||
      "unknown";
    const duration =
      state?.duration ||
      preserved?.duration ||
      (active ? Date.now() - active.startTime : 0);
    const toolCount =
      state?.toolCount ||
      preserved?.toolCount ||
      active?.nestedToolCount ||
      0;

    sendEvent("bg_task_result", {
      taskId: finalTaskId,
      toolUseId: resolvedToolUseId || undefined,
      result: mergedResult,
      status: status || "completed",
      agentType,
      duration,
      toolCount
    });

    markBgResultFinalized(finalTaskId, resolvedToolUseId, source);

    if (resolvedToolUseId) {
      activeSubagents.delete(resolvedToolUseId);
      clearBgMappingsForTool(resolvedToolUseId);
      if (finalTaskId) {
        const orphanTimer = bgOrphanFallbackTimers.get(finalTaskId);
        if (orphanTimer) {
          clearTimeout(orphanTimer);
          bgOrphanFallbackTimers.delete(finalTaskId);
        }
      }
    } else if (finalTaskId) {
      clearBgMappingsForTask(finalTaskId);
    }

    scheduleSubagentSafetyNet("bg-task-result-finalized");

    debugLog("BG_TASK_RESULT_EMITTED", {
      taskId: finalTaskId,
      toolUseId: resolvedToolUseId,
      source,
      status,
      resultLen: mergedResult.length
    });
    return true;
  }

  function scheduleBgResultFallback(toolUseId, taskId = "") {
    if (!toolUseId) return;
    const state = getOrCreateBgTaskState(toolUseId);
    if (!state) return;

    if (state.fallbackTimer) return;
    if (isBgResultFinalized(taskId || state.taskId, toolUseId)) return;

    state.fallbackTimer = setTimeout(() => {
      state.fallbackTimer = null;

      if (isBgResultFinalized(taskId || state.taskId, toolUseId)) {
        return;
      }
      if (!completedBgAgents.has(toolUseId)) {
        return;
      }

      const effectiveTaskId = normalizeAgentId(taskId) || state.taskId || "";
      const outputFile = resolveBgOutputFile(effectiveTaskId, toolUseId);
      if (!outputFile) {
        debugLog("BG_RESULT_FALLBACK_DEFERRED_OUTPUT_DISCOVERY", {
          taskId: effectiveTaskId,
          toolUseId
        });
      }

      recoverBgResultFromOutputFile({
        taskId: effectiveTaskId,
        toolUseId,
        outputFile: outputFile || ""
      });
    }, BG_RESULT_FALLBACK_DELAY_MS);
  }

  function scheduleBgOrphanFallback(taskId) {
    const normalizedTaskId = normalizeAgentId(taskId);
    if (!normalizedTaskId) return;

    if (bgOrphanFallbackTimers.has(normalizedTaskId)) return;
    if (isBgResultFinalized(normalizedTaskId, null)) return;

    const timer = setTimeout(() => {
      bgOrphanFallbackTimers.delete(normalizedTaskId);

      if (isBgResultFinalized(normalizedTaskId, null)) {
        return;
      }

      const outputFile = resolveBgOutputFile(normalizedTaskId, null);
      if (!outputFile) {
        debugLog("BG_ORPHAN_FALLBACK_DEFERRED_OUTPUT_DISCOVERY", { taskId: normalizedTaskId });
      }

      recoverBgResultFromOutputFile({
        taskId: normalizedTaskId,
        toolUseId: null,
        outputFile: outputFile || ""
      });
    }, BG_RESULT_FALLBACK_DELAY_MS);

    bgOrphanFallbackTimers.set(normalizedTaskId, timer);
  }

  function mergeTaskOutputIntoSubagent(taskOutput, fallbackText = "") {
    if (!taskOutput?.taskId) return false;

    const mergedResult = (taskOutput.output || fallbackText || "").trim();
    return emitBgTaskResultOnce({
      taskId: taskOutput.taskId,
      toolUseId: resolveBgToolUseId(taskOutput.taskId),
      result: mergedResult,
      status: taskOutput.status || "completed",
      source: "task-output"
    });
  }

  function buildNoOutputCapturedResult(state, sawPermissionDenied = false) {
    const summary = (state?.summary || "").trim();
    const reason = sawPermissionDenied
      ? "Background task completed, but permissions prevented capturing final output."
      : "Background task completed, but no deterministic final output was captured.";
    if (!summary) return reason;
    return `${reason}\n\nCompletion summary: ${summary}`;
  }

  function recoverBgResultFromOutputFile({
    taskId,
    toolUseId,
    outputFile
  }) {
    const normalizedTaskId = normalizeAgentId(taskId) || extractTaskIdFromOutputFilePath(outputFile) || "";
    const recoveryKey = `${toolUseId || "unknown"}:${normalizedTaskId || "unknown"}:${outputFile || "discover"}`;
    if (bgOutputRecoveryInFlight.has(recoveryKey)) return;
    bgOutputRecoveryInFlight.add(recoveryKey);

    const MAX_ATTEMPTS = BG_OUTPUT_FILE_RESOLVE_MAX_ATTEMPTS;
    const RETRY_DELAY_MS = BG_OUTPUT_FILE_RESOLVE_RETRY_MS;
    let lastFileSignature = "";
    let sawPermissionDenied = false;
    let resolvedOutputFile = (typeof outputFile === "string" && outputFile.trim())
      ? outputFile.trim()
      : "";

    const attemptRead = (attempt) => {
      // Result already merged via normal paths; no fallback needed.
      if (toolUseId && !completedBgAgents.has(toolUseId)) {
        bgOutputRecoveryInFlight.delete(recoveryKey);
        return;
      }
      if (isBgResultFinalized(normalizedTaskId, toolUseId)) {
        bgOutputRecoveryInFlight.delete(recoveryKey);
        return;
      }

      if (!resolvedOutputFile) {
        resolvedOutputFile = resolveBgOutputFile(normalizedTaskId, toolUseId) || "";
      }

      if (!resolvedOutputFile) {
        if (attempt < MAX_ATTEMPTS) {
          setTimeout(() => attemptRead(attempt + 1), RETRY_DELAY_MS);
          return;
        }
        debugLog("BG_OUTPUT_FILE_UNRESOLVED", {
          taskId: normalizedTaskId,
          toolUseId,
          attempts: attempt
        });
        const state = toolUseId ? getOrCreateBgTaskState(toolUseId) : null;
        const merged = emitBgTaskResultOnce({
          taskId: normalizedTaskId,
          toolUseId: toolUseId || resolveBgToolUseId(normalizedTaskId),
          result: buildNoOutputCapturedResult(state, sawPermissionDenied),
          status: "completed_no_output",
          source: "no-output-fallback"
        });
        debugLog("BG_OUTPUT_FILE_NO_OUTPUT_FINALIZED_AFTER_UNRESOLVED", {
          taskId: normalizedTaskId,
          toolUseId,
          attempts: attempt,
          merged
        });
        bgOutputRecoveryInFlight.delete(recoveryKey);
        return;
      }

      const currentOutputFile = resolvedOutputFile;
      fs.stat(currentOutputFile, (statError, stats) => {
        if (statError) {
          if (statError.code === "ENOENT" || statError.code === "ENOTDIR") {
            resolvedOutputFile = "";
          }
          if (attempt < MAX_ATTEMPTS) {
            setTimeout(() => attemptRead(attempt + 1), RETRY_DELAY_MS);
            return;
          }
          debugLog("BG_OUTPUT_FILE_STAT_FAILED", {
            taskId: normalizedTaskId,
            toolUseId,
            outputFile: currentOutputFile,
            code: statError.code,
            message: statError.message
          });
          const state = toolUseId ? getOrCreateBgTaskState(toolUseId) : null;
          const merged = emitBgTaskResultOnce({
            taskId: normalizedTaskId,
            toolUseId: toolUseId || resolveBgToolUseId(normalizedTaskId),
            result: buildNoOutputCapturedResult(state, sawPermissionDenied),
            status: "completed_no_output",
            source: "no-output-fallback"
          });
          debugLog("BG_OUTPUT_FILE_NO_OUTPUT_FINALIZED_AFTER_STAT_FAILURE", {
            taskId: normalizedTaskId,
            toolUseId,
            outputFile: currentOutputFile,
            attempts: attempt,
            merged
          });
          bgOutputRecoveryInFlight.delete(recoveryKey);
          return;
        }

        const signature = `${stats.size}:${Math.floor(stats.mtimeMs)}`;
        if (attempt < MAX_ATTEMPTS && (!lastFileSignature || signature !== lastFileSignature)) {
          lastFileSignature = signature;
          setTimeout(() => attemptRead(attempt + 1), RETRY_DELAY_MS);
          return;
        }

        fs.readFile(currentOutputFile, "utf8", (error, outputText) => {
          if (error) {
            if (error.code === "ENOENT" || error.code === "ENOTDIR") {
              resolvedOutputFile = "";
            }
            if (attempt < MAX_ATTEMPTS) {
              setTimeout(() => attemptRead(attempt + 1), RETRY_DELAY_MS);
              return;
            }
            debugLog("BG_OUTPUT_FILE_READ_FAILED", {
              taskId: normalizedTaskId,
              toolUseId,
              outputFile: currentOutputFile,
              code: error.code,
              message: error.message
            });
            const state = toolUseId ? getOrCreateBgTaskState(toolUseId) : null;
            const merged = emitBgTaskResultOnce({
              taskId: normalizedTaskId,
              toolUseId: toolUseId || resolveBgToolUseId(normalizedTaskId),
              result: buildNoOutputCapturedResult(state, sawPermissionDenied),
              status: "completed_no_output",
              source: "no-output-fallback"
            });
            debugLog("BG_OUTPUT_FILE_NO_OUTPUT_FINALIZED_AFTER_READ_FAILURE", {
              taskId: normalizedTaskId,
              toolUseId,
              outputFile: currentOutputFile,
              attempts: attempt,
              merged
            });
            bgOutputRecoveryInFlight.delete(recoveryKey);
            return;
          }

          // Result arrived while this file read was in-flight.
          if (toolUseId && !completedBgAgents.has(toolUseId)) {
            bgOutputRecoveryInFlight.delete(recoveryKey);
            return;
          }
          if (isBgResultFinalized(normalizedTaskId, toolUseId)) {
            bgOutputRecoveryInFlight.delete(recoveryKey);
            return;
          }

          const extraction = extractTaskResultFromOutputFile(outputText || "", normalizedTaskId);
          sawPermissionDenied = sawPermissionDenied || !!extraction.sawPermissionDenied;

          if (!extraction.result) {
            if (attempt < MAX_ATTEMPTS) {
              setTimeout(() => attemptRead(attempt + 1), RETRY_DELAY_MS);
              return;
            }
            const state = toolUseId ? getOrCreateBgTaskState(toolUseId) : null;
            const noOutputResult = buildNoOutputCapturedResult(state, sawPermissionDenied);
            const merged = emitBgTaskResultOnce({
              taskId: normalizedTaskId,
              toolUseId: toolUseId || resolveBgToolUseId(normalizedTaskId),
              result: noOutputResult,
              status: "completed_no_output",
              source: "no-output-fallback"
            });
            debugLog("BG_OUTPUT_FILE_EMPTY_TERMINAL_RESULT", {
              taskId: normalizedTaskId,
              toolUseId,
              outputFile: currentOutputFile,
              attempts: attempt,
              sawPermissionDenied,
              merged
            });
            bgOutputRecoveryInFlight.delete(recoveryKey);
            return;
          }

          const merged = emitBgTaskResultOnce({
            taskId: normalizedTaskId,
            toolUseId: toolUseId || resolveBgToolUseId(normalizedTaskId),
            result: extraction.result,
            status: "completed",
            source: "output-file-fallback"
          });

          debugLog("BG_OUTPUT_FILE_RESULT", {
            taskId: normalizedTaskId,
            toolUseId,
            outputFile: currentOutputFile,
            merged,
            resultLen: extraction.result.length
          });
          bgOutputRecoveryInFlight.delete(recoveryKey);
        });
      });
    };

    attemptRead(1);
  }

  function handleStreamEvent(event, sessionId, suppressUiStream = false) {
    if (!event) return;

    // Suppress streaming events during warmup
    if (isWarmingUp) {
      debugLog("WARMUP", `Suppressing stream event: ${event.type}`);
      return;
    }

    debugLog("STREAM_EVENT", {
      type: event.type,
      delta: event.delta?.type,
      hasContentBlock: !!event.content_block,
      suppressUiStream
    });

    switch (event.type) {
      case "content_block_start":
        if (event.content_block?.type === "tool_use") {
          const toolId = event.content_block.id;
          const toolName = event.content_block.name;
          currentToolId = toolId;  // Track for tool_result matching
          currentToolName = toolName;  // Track for subagent detection

          // Detect Task (subagent) invocation
          if (toolName === "Task") {
            taskInputBuffer = "";  // Reset buffer for new Task
            activeSubagents.set(toolId, {
              id: toolId,
              startTime: Date.now(),
              nestedToolCount: 0,
              seenNestedToolIds: new Set(),
              status: "starting",
              agentType: null,
              description: null,
              prompt: null
            });
            getOrCreateBgTaskState(toolId);
            debugLog("SUBAGENT_DETECTED", { toolId, activeCount: activeSubagents.size });
            scheduleSubagentSafetyNet("subagent-detected");
            if (!suppressUiStream) {
              sendEvent("tool_start", {
                id: toolId,
                name: toolName,
                parent_tool_use_id: null
              });
            }
          } else {
            // Non-Task tool - check if it's running inside a subagent context
            // Find the OLDEST active subagent in "running" status (input fully received)
            let parentSubagentId = null;
            let oldestStartTime = Infinity;
            for (const [id, info] of activeSubagents) {
              if (info.status === "running" && info.startTime < oldestStartTime) {
                oldestStartTime = info.startTime;
                parentSubagentId = id;
              }
            }

            if (parentSubagentId) {
              emitSubagentProgress(parentSubagentId, toolId, toolName);
            }

            if (!suppressUiStream) {
              sendEvent("tool_start", {
                id: toolId,
                name: toolName,
                parent_tool_use_id: parentSubagentId
              });
            }
          }
        }
        // Handle thinking block start
        if (event.content_block?.type === "thinking" && !suppressUiStream) {
          sendEvent("thinking_start", { index: event.index });
        }
        break;

      case "content_block_delta":
        if (event.delta?.type === "text_delta" && !suppressUiStream) {
          // Stream text chunk to UI
          sendEvent("text_delta", { text: event.delta.text });
        }
        if (event.delta?.type === "input_json_delta") {
          // Tool input streaming
          if (!suppressUiStream) {
            sendEvent("tool_input", { json: event.delta.partial_json });
          }

          // Accumulate JSON for Task tools to extract subagent details
          if (currentToolName === "Task" && currentToolId) {
            const subagent = activeSubagents.get(currentToolId);
            if (subagent && subagent.status === "starting") {
              // Enforce buffer size limit
              if (taskInputBuffer.length < MAX_TASK_INPUT_SIZE) {
                taskInputBuffer += event.delta.partial_json;
              }
              // Try to parse accumulated JSON to extract subagent details
              try {
                const parsed = JSON.parse(taskInputBuffer);
                if (parsed.subagent_type) {
                  subagent.agentType = parsed.subagent_type;
                  subagent.description = parsed.description || "";
                  subagent.prompt = parsed.prompt || "";
                  subagent.status = "running";

                  const bgState = getOrCreateBgTaskState(currentToolId);
                  if (bgState) {
                    bgState.agentType = parsed.subagent_type || "unknown";
                  }

                  sendEvent("subagent_start", {
                    id: currentToolId,
                    agentType: parsed.subagent_type,
                    description: parsed.description || "",
                    prompt: (parsed.prompt || "").slice(0, 200)
                  });
                  debugLog("SUBAGENT_START", {
                    id: currentToolId,
                    agentType: parsed.subagent_type,
                    description: parsed.description
                  });
                }
              } catch {
                // JSON incomplete, keep accumulating
              }
            }
          }
        }
        // Handle thinking delta
        if (event.delta?.type === "thinking_delta" && !suppressUiStream) {
          sendEvent("thinking_delta", { thinking: event.delta.thinking });
        }
        break;

      case "content_block_stop":
        if (!suppressUiStream) {
          sendEvent("block_end", {});
        }
        break;

      case "message_delta":
        lastStopReason = event.delta?.stop_reason || null;
        if (event.delta?.stop_reason === "tool_use" && !suppressUiStream) {
          sendEvent("tool_pending", {});
        }
        break;

      case "message_stop":
        // When streaming is complete and the turn is ending (not tool_use),
        // send done immediately to unblock the user. The CLI holds the result
        // message while background agents are running, causing the Rust main
        // loop to hit its streaming timeout (6 seconds). By sending done here,
        // the main loop breaks instantly.
        if (lastStopReason === "end_turn" && !suppressUiStream) {
          sendEvent("done", {});
          const pendingCliResults = enqueuePendingCliResultAck();
          debugLog("EARLY_DONE", {
            pendingCliResults,
            activeSubagents: activeSubagents.size,
            reason: "message_stop with end_turn"
          });
        }
        lastStopReason = null;
        break;

      case "message_start":
        // Extract token usage from message_start - fires at START of each response
        // This gives us real-time context size before any streaming content
        if (event.message?.usage && !suppressUiStream) {
          const usage = event.message.usage;
          // Context = input + cache_read + cache_creation
          // cache_creation = tokens being cached for first time (not yet in cache_read)
          // On subsequent requests, these move from cache_creation to cache_read
          const inputTokens = (usage.input_tokens || 0) +
                              (usage.cache_read_input_tokens || 0) +
                              (usage.cache_creation_input_tokens || 0);
          debugLog("MESSAGE_START_USAGE", {
            input_tokens: usage.input_tokens,
            cache_creation: usage.cache_creation_input_tokens,
            cache_read: usage.cache_read_input_tokens,
            total: inputTokens
          });
          sendEvent("context_update", {
            inputTokens: inputTokens,
            rawInputTokens: usage.input_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
            cacheWrite: usage.cache_creation_input_tokens || 0
          });
        }
        break;
    }
  }

  // Spawn Claude CLI process - optionally resume a session
  function spawnClaude(resumeSessionId = null) {
    debugLog("SPAWN", resumeSessionId
      ? `Starting Claude process (resuming ${resumeSessionId.slice(0,8)}...)`
      : "Starting Claude process...");

    // Clean up old readline if exists
    if (claudeRl) {
      debugLog("SPAWN", "Closing old readline interface");
      claudeRl.close();
      claudeRl = null;
    }

    // Reset state for new process
    readySent = false;
    isInterrupting = false;
    pendingCliResultAcks = [];
    lastStopReason = null;

    claude = spawn(claudePath, buildClaudeArgs(resumeSessionId), {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MAX_THINKING_TOKENS: "10000"
      }
    });

    debugLog("SPAWN", `Claude PID: ${claude.pid}`);

    // Parse Claude's output
    claudeRl = readline.createInterface({ input: claude.stdout });

    claudeRl.on("line", (line) => {
      debugLog("CLAUDE_RAW", line.slice(0, 500));

      if (!line.trim()) return;

      try {
        const msg = JSON.parse(line);
        debugLog("CLAUDE_PARSED", { type: msg.type, subtype: msg.subtype, hasEvent: !!msg.event });

        switch (msg.type) {
          case "system":
            if (msg.subtype === "init" && !readySent) {
              // Store session ID for subsequent messages
              currentSessionId = msg.session_id;
              debugLog("SESSION_ID", currentSessionId);
              sendEvent("ready", {
                sessionId: msg.session_id,
                model: msg.model,
                tools: msg.tools?.length || 0
              });
              readySent = true;

              // Send any pending messages that were queued during respawn
              sendPendingMessages();
            } else if (msg.subtype === "hook_response" && !readySent) {
              // When resuming a session, Claude CLI doesn't send "init" - it sends hooks instead.
              // Extract session_id from the SessionStart hook response to send a ready event.
              if (msg.hook_event === "SessionStart" && msg.outcome === "success" && msg.session_id) {
                currentSessionId = msg.session_id;
                debugLog("SESSION_ID_FROM_HOOK", currentSessionId);
                sendEvent("ready", {
                  sessionId: msg.session_id,
                  model: "opus",  // Model info not available in hook response
                  tools: 0        // Tool count not available in hook response
                });
                readySent = true;

                // Send any pending messages
                sendPendingMessages();
              }
            } else if (msg.subtype === "status") {
              // Forward status updates (e.g., "compacting")
              if (msg.status) {
                sendEvent("status", { message: msg.status === "compacting" ? "Compacting conversation..." : msg.status });
              }
            } else if (msg.subtype === "compact_boundary") {
              // Compaction completed - send notification with token counts
              const metadata = msg.compact_metadata || {};
              debugLog("COMPACT_BOUNDARY", metadata);
              const preTokens = metadata.pre_tokens || 0;
              const postTokens = metadata.post_tokens || metadata.summary_tokens || 0;
              sendEvent("status", {
                message: "compaction_complete",
                isCompaction: true,
                preTokens: preTokens,
                postTokens: postTokens
              });
            } else if (msg.subtype === "task_started") {
              const sdkAgentId = normalizeAgentId(msg.task_id);
              const toolUseId = msg.tool_use_id || resolveBgToolUseId(sdkAgentId);

              if (sdkAgentId && toolUseId) {
                rememberBgAgentMapping(sdkAgentId, toolUseId);
              }

              const state = toolUseId ? getOrCreateBgTaskState(toolUseId) : null;
              if (state) {
                state.phase = "active";
                if (sdkAgentId) {
                  state.taskId = sdkAgentId;
                }
              }

              const resolvedOutputFile = resolveBgOutputFile(
                sdkAgentId || state?.taskId || "",
                toolUseId || null
              );
              if (state && resolvedOutputFile && !state.outputFile) {
                state.outputFile = resolvedOutputFile;
              }

              debugLog("BG_TASK_STARTED", {
                taskId: sdkAgentId,
                toolUseId,
                taskType: msg.task_type || "",
                hasOutputFile: !!resolvedOutputFile
              });
            } else if (msg.subtype === "task_notification" && msg.status === "completed") {
              // Background agent completed — map SDK agentId back to tool_use_id
              const sdkAgentId = normalizeAgentId(msg.task_id);
              const toolUseId = msg.tool_use_id || resolveBgToolUseId(sdkAgentId);
              if (sdkAgentId && toolUseId) {
                rememberBgAgentMapping(sdkAgentId, toolUseId);
              }

              const state = toolUseId ? getOrCreateBgTaskState(toolUseId) : null;
              if (state && sdkAgentId && !state.taskId) {
                state.taskId = sdkAgentId;
              }

              const subagent = toolUseId ? activeSubagents.get(toolUseId) : null;
              const duration = subagent
                ? (Date.now() - subagent.startTime)
                : (state?.duration || 0);
              const agentType = subagent?.agentType || state?.agentType || "unknown";
              const toolCount = subagent?.nestedToolCount || state?.toolCount || 0;
              const completionSummary = msg.summary || "";
              const completionOutputFile = typeof msg.output_file === "string"
                ? msg.output_file.trim()
                : "";

              if (completionOutputFile) {
                rememberBgOutputFile(sdkAgentId || state?.taskId || "", toolUseId, completionOutputFile);
              }

              if (state) {
                state.phase = "awaiting_result";
                state.agentType = agentType;
                state.duration = duration;
                state.toolCount = toolCount;
                state.summary = completionSummary;
                if (completionOutputFile && !state.outputFile) {
                  state.outputFile = completionOutputFile;
                }
              }

              const finalizedAlready = isBgResultFinalized(sdkAgentId || state?.taskId || "", toolUseId);
              if (!finalizedAlready) {
                sendEvent("bg_task_completed", {
                  taskId: sdkAgentId || "",
                  toolUseId: toolUseId || undefined,
                  agentType,
                  duration,
                  toolCount,
                  summary: completionSummary
                });
              }

              if (toolUseId && !finalizedAlready) {
                completedBgAgents.set(toolUseId, {
                  taskId: sdkAgentId,
                  agentType,
                  duration,
                  toolCount
                });
                scheduleSubagentSafetyNet("task-notification-completed");
                debugLog("BG_TASK_NOTIFY_COMPLETED", {
                  taskId: sdkAgentId,
                  toolUseId,
                  hasActiveSubagent: activeSubagents.has(toolUseId)
                });
              } else {
                debugLog("SUBAGENT_TASK_NOTIFY_UNMATCHED", {
                  taskId: sdkAgentId,
                  activeSubagents: [...activeSubagents.keys()],
                  mappedAgents: [...bgAgentMap.keys()]
                });
              }

              if (!finalizedAlready) {
                if (toolUseId) {
                  scheduleBgResultFallback(toolUseId, sdkAgentId || state?.taskId || "");
                } else if (sdkAgentId) {
                  scheduleBgOrphanFallback(sdkAgentId);
                }
              } else {
                if (toolUseId) {
                  activeSubagents.delete(toolUseId);
                  completedBgAgents.delete(toolUseId);
                  clearBgMappingsForTool(toolUseId);
                }
                debugLog("BG_TASK_NOTIFICATION_IGNORED_AFTER_FINAL", {
                  taskId: sdkAgentId,
                  toolUseId
                });
              }
            }
            break;

          case "stream_event":
            // After main result is sent, Claude may continue emitting extra synthesis text
            // while background tasks complete. Keep processing stream events for internal
            // state tracking, but optionally suppress user-visible deltas.
            handleStreamEvent(
              msg.event,
              msg.session_id,
              mainResultSent && (completedBgAgents.size > 0 || activeSubagents.size > 0)
            );
            break;

          case "assistant":
            // Check for nested tool calls from subagents
            // Claude CLI provides parent_tool_use_id in the message to identify which subagent
            // spawned this tool call - use it for correct attribution
            if (msg.message?.content && Array.isArray(msg.message.content)) {
              // Use parent_tool_use_id from message for correct subagent attribution
              const parentSubagentId = msg.parent_tool_use_id;

              for (const block of msg.message.content) {
                if (block.type === "tool_use") {
                  // Skip Task tools - they create new subagents, not nested tool calls
                  if (block.name === "Task") {
                    debugLog("SKIPPING_TASK_AS_NESTED", { toolId: block.id });
                    continue;
                  }

                  // Only track as nested if we have a valid parent subagent
                  if (parentSubagentId && activeSubagents.has(parentSubagentId)) {
                    // Extract a short description from tool input
                    let toolDetail = "";
                    const input = block.input || {};
                    if (block.name === "Bash" && input.description) {
                      toolDetail = input.description;
                    } else if (block.name === "Bash" && input.command) {
                      toolDetail = input.command.slice(0, 50) + (input.command.length > 50 ? "..." : "");
                    } else if (block.name === "Glob" && input.pattern) {
                      toolDetail = input.pattern;
                    } else if (block.name === "Grep" && input.pattern) {
                      toolDetail = `"${input.pattern}"`;
                    } else if (block.name === "Read" && input.file_path) {
                      toolDetail = input.file_path.split("/").pop(); // Just filename
                    } else if (block.name === "Edit" && input.file_path) {
                      toolDetail = input.file_path.split("/").pop();
                    } else if (block.name === "Write" && input.file_path) {
                      toolDetail = input.file_path.split("/").pop();
                    } else if (block.name === "WebFetch" && input.url) {
                      toolDetail = new URL(input.url).hostname;
                    } else if (block.name === "WebSearch" && input.query) {
                      toolDetail = `"${input.query.slice(0, 40)}"`;
                    }
                    emitSubagentProgress(parentSubagentId, block.id, block.name, toolDetail);
                  }
                }
              }
            }
            break;

          case "user":
            // Tool result embedded in user message (e.g., WebSearch results)
            debugLog("USER_MSG", { hasContent: !!msg.message?.content, isArray: Array.isArray(msg.message?.content) });
            if (msg.message?.content && Array.isArray(msg.message.content)) {
              for (const item of msg.message.content) {
                debugLog("USER_CONTENT_ITEM", { type: item.type, hasContent: !!item.content });
                if (item.type === "tool_result") {
                  debugLog("TOOL_RESULT_FROM_USER", { toolUseId: item.tool_use_id, contentLength: item.content?.length });

                  // Check if this completes a subagent (Task tool)
                  const completedToolId = item.tool_use_id;
                  const resultText = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
                  const isAsyncLaunch = resultText.includes("Async agent launched successfully");

                  if (isAsyncLaunch) {
                    const launchInfo = rememberAsyncLaunchMetadata(resultText, completedToolId);
                    scheduleSubagentSafetyNet("subagent-async-launched-from-user");
                    if (completedToolId && activeSubagents.has(completedToolId)) {
                      debugLog("SUBAGENT_ASYNC_LAUNCHED_FROM_USER", {
                        id: completedToolId,
                        agentId: launchInfo.agentId,
                        outputFile: launchInfo.outputFile
                      });
                    } else {
                      debugLog("SUBAGENT_ASYNC_LAUNCH_UNTRACKED_FROM_USER", {
                        id: completedToolId,
                        agentId: launchInfo.agentId,
                        outputFile: launchInfo.outputFile
                      });
                    }
                  }

                  if (completedToolId && activeSubagents.has(completedToolId) && !isAsyncLaunch) {
                    const subagent = activeSubagents.get(completedToolId);
                    subagent.status = "complete";
                    const duration = Date.now() - subagent.startTime;

                    sendEvent("subagent_end", {
                      id: completedToolId,
                      agentType: subagent.agentType || "unknown",
                      duration: duration,
                      toolCount: subagent.nestedToolCount,
                      result: resultText.slice(0, 10000)
                    });
                    debugLog("SUBAGENT_END_FROM_USER", {
                      id: completedToolId,
                      agentType: subagent.agentType,
                      duration,
                      toolCount: subagent.nestedToolCount
                    });

                    activeSubagents.delete(completedToolId);
                    clearBgMappingsForTool(completedToolId);
                    scheduleSubagentSafetyNet("subagent-complete-from-user");
                  }

                  // TaskOutput tool results include <task_id> and <output>. Merge them directly
                  // into the corresponding subagent so each background agent reports back reliably.
                  const taskOutput = extractTaskOutputResult(resultText);
                  if (taskOutput && taskOutput.status === "completed") {
                    mergeTaskOutputIntoSubagent(taskOutput, resultText);
                  }

                  sendEvent("tool_result", {
                    tool_use_id: item.tool_use_id,
                    stdout: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
                    stderr: "",
                    isError: item.is_error || false
                  });
                }
              }
            }
            // Legacy format
            if (msg.tool_use_result) {
              sendEvent("tool_result", {
                stdout: msg.tool_use_result.stdout?.slice(0, 500),
                stderr: msg.tool_use_result.stderr?.slice(0, 200),
                isError: msg.tool_use_result.is_error
              });
            }
            break;

          case "tool_result":
            // Standalone tool result - tool completed successfully
            // Use tool_use_id from message if available (more reliable for parallel tools)
            const completedToolId = msg.tool_use_id || currentToolId;
            debugLog("TOOL_RESULT_STANDALONE", { msgToolUseId: msg.tool_use_id, currentToolId, completedToolId });

            // Check if this completes a subagent (Task tool)
            if (activeSubagents.has(completedToolId)) {
              const resultText = (msg.content || msg.output || "");
              const isAsyncLaunch = resultText.includes("Async agent launched successfully");

              // Background agents return "Async agent launched successfully" immediately.
              // Don't mark as complete — keep in activeSubagents so the real completion
              // (arriving later via background pump) fires a proper subagent_end.
              if (isAsyncLaunch) {
                const launchInfo = rememberAsyncLaunchMetadata(resultText, completedToolId);
                scheduleSubagentSafetyNet("subagent-async-launched");
                debugLog("SUBAGENT_ASYNC_LAUNCHED", {
                  id: completedToolId,
                  agentId: launchInfo.agentId,
                  outputFile: launchInfo.outputFile
                });
              } else {
                const subagent = activeSubagents.get(completedToolId);
                subagent.status = "complete";
                const duration = Date.now() - subagent.startTime;

                sendEvent("subagent_end", {
                  id: completedToolId,
                  agentType: subagent.agentType || "unknown",
                  duration: duration,
                  toolCount: subagent.nestedToolCount,
                  result: resultText.slice(0, 10000)
                });
                debugLog("SUBAGENT_END", {
                  id: completedToolId,
                  agentType: subagent.agentType,
                  duration,
                  toolCount: subagent.nestedToolCount
                });

                activeSubagents.delete(completedToolId);
                clearBgMappingsForTool(completedToolId);
                scheduleSubagentSafetyNet("subagent-complete-standalone");
              }
            } else {
              const standaloneResultText = (msg.content || msg.output || "");
              if (standaloneResultText.includes("Async agent launched successfully")) {
                const launchInfo = rememberAsyncLaunchMetadata(standaloneResultText, completedToolId);
                scheduleSubagentSafetyNet("subagent-async-launched-untracked");
                debugLog("SUBAGENT_ASYNC_LAUNCH_UNTRACKED", {
                  id: completedToolId,
                  agentId: launchInfo.agentId,
                  outputFile: launchInfo.outputFile
                });
              }
            }

            // Merge TaskOutput payloads that carry concrete task_id/output info.
            const standaloneResultText = (msg.content || msg.output || "");
            const standaloneTaskOutput = extractTaskOutputResult(standaloneResultText);
            if (standaloneTaskOutput && standaloneTaskOutput.status === "completed") {
              mergeTaskOutputIntoSubagent(standaloneTaskOutput, standaloneResultText);
            }

            // Include currentToolId so frontend can match result to tool
            sendEvent("tool_result", {
              tool_use_id: completedToolId,
              stdout: msg.content || msg.output || "",
              stderr: msg.error || "",
              isError: !!msg.is_error
            });
            currentToolId = null;  // Clear after use
            currentToolName = null;  // Clear tool name
            break;

          case "control_request":
            // Handle permission requests via control protocol
            if (msg.request?.subtype === "can_use_tool") {
              const requestId = msg.request_id;
              const toolName = msg.request.tool_name || "unknown";
              const toolInput = msg.request.input || {};

              debugLog("CONTROL_REQUEST", { requestId, toolName, toolInput });

              // Handle AskUserQuestion separately - it needs question/answer flow
              if (toolName === "AskUserQuestion") {
                sendEvent("ask_user_question", {
                  requestId,
                  questions: toolInput.questions || []
                });
              } else {
                sendEvent("permission_request", {
                  requestId,
                  toolName,
                  toolInput,
                  description: `Allow ${toolName}?`
                });
              }
            }
            break;

          case "result":
            // Skip result/done during warmup (but end warmup)
            if (isWarmingUp) {
              debugLog("WARMUP", "Warmup complete, suppressing result event");
              isWarmingUp = false;
              break;
            }

            // Suppress late CLI MAIN result when we already sent early done on message_stop.
            // This must happen before bg-agent handling. Ack entries self-expire
            // so unmatched done events can't leak suppression into later turns.
            if (consumePendingCliResultAck()) {
              mainResultSent = true;  // Enable bg agent result handling
              debugLog("LATE_CLI_RESULT_SUPPRESSED", {
                cost: msg.total_cost_usd,
                duration: msg.duration_ms,
                remaining: pendingCliResultAcks.length
              });
              scheduleSubagentSafetyNet("late-main-result-suppressed");
              break;
            }

            // Bg agent turn result — only merge deterministic TaskOutput payloads.
            // Never attribute generic result text to a background task.
            const resultText = msg.result || "";
            const taskOutput = extractTaskOutputResult(resultText);
            if (
              taskOutput &&
              taskOutput.status === "completed" &&
              (completedBgAgents.size > 0 ||
                activeSubagents.size > 0 ||
                !!resolveBgToolUseId(taskOutput.taskId))
            ) {
              mergeTaskOutputIntoSubagent(taskOutput, resultText);
              break;
            }

            if (completedBgAgents.size > 0) {
              debugLog("BG_AGENT_RESULT_WAITING_FOR_DETERMINISTIC_SOURCE", {
                pendingCompletedCount: completedBgAgents.size,
                resultLen: resultText.length,
                cost: msg.total_cost_usd,
                duration: msg.duration_ms
              });
              break;
            }

            if (mainResultSent) {
              debugLog("RESULT_SKIPPED_AFTER_MAIN", { cost: msg.total_cost_usd, duration: msg.duration_ms });
              break;
            }
            mainResultSent = true;

            // Extract token usage
            const usage = msg.usage || {};
            // Context = input + cache_read + cache_creation (consistent with message_start)
            // Note: Frontend uses context_update for display, this is just for consistency
            const inputTokens = (usage.input_tokens || 0) +
                                (usage.cache_read_input_tokens || 0) +
                                (usage.cache_creation_input_tokens || 0);
            const outputTokens = usage.output_tokens || 0;

            // Set a delayed safety net for bg agents in case task_notification never arrives.
            // task_notification events arrive after result and complete agents individually.
            scheduleSubagentSafetyNet("main-result-received");

            // Note: Rust expects camelCase, then serializes to TypeScript as snake_case
            sendEvent("result", {
              content: msg.result?.slice(0, 1000),
              cost: msg.total_cost_usd,
              duration: msg.duration_ms,
              turns: msg.num_turns,
              isError: msg.is_error,
              inputTokens,
              outputTokens,
              cacheRead: usage.cache_read_input_tokens || 0,
              cacheWrite: usage.cache_creation_input_tokens || 0
            });
            sendEvent("done", {});
            break;
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    // Handle stderr
    claude.stderr.on("data", (data) => {
      const str = data.toString();
      debugLog("CLAUDE_STDERR", str.slice(0, 500));
      if (str.includes("error") || str.includes("Error")) {
        sendEvent("error", { message: str.slice(0, 500) });
      }
    });

    // Handle Claude process exit - IMMEDIATELY respawn if interrupted
    claude.on("close", (code) => {
      debugLog("CLAUDE_CLOSE", { code, isInterrupting, sessionId: currentSessionId });

      if (isInterrupting) {
        // Interrupted - respawn immediately, resuming the same session
        // This preserves conversation context after interrupt
        const sessionToResume = currentSessionId;
        debugLog("RESPAWN", `Respawning Claude with --resume ${sessionToResume?.slice(0,8)}...`);
        sendEvent("interrupted", {});
        setImmediate(() => {
          spawnClaude(sessionToResume);
        });
      } else {
        // Normal exit - close the bridge
        sendEvent("closed", { code });
        process.exit(code || 0);
      }
    });

    claude.on("error", (err) => {
      debugLog("CLAUDE_ERROR", err.message);
      sendEvent("error", { message: err.message });
    });
  }

  // Send pending messages that were queued during respawn
  function sendPendingMessages() {
    if (pendingMessages.length > 0) {
      debugLog("PENDING", `Sending ${pendingMessages.length} pending messages`);
      for (const msg of pendingMessages) {
        debugLog("PENDING_SEND", msg);
        claude.stdin.write(msg);
      }
      pendingMessages = [];
    }
  }

  // Send a user message to Claude
  // Supports both plain text and JSON-prefixed multimodal messages
  function sendUserMessage(content) {
    // Inject current date/time with each message
    const dateTime = getDateTimePrefix();

    let messageContent;

    // Check for JSON-prefixed message (multimodal with images)
    // Format: __JSON__{"content":[{type:"image",...},{type:"text",...}]}
    if (content.startsWith("__JSON__")) {
      try {
        const jsonData = JSON.parse(content.slice(8)); // Remove "__JSON__" prefix

        // jsonData.content is array of content blocks
        // Prepend date/time to the text block(s)
        messageContent = jsonData.content.map(block => {
          if (block.type === "text") {
            return { ...block, text: `[${dateTime}] ${block.text}` };
          }
          return block;
        });

        debugLog("MULTIMODAL", `Sending ${messageContent.length} content blocks (${messageContent.filter(b => b.type === "image").length} images)`);
      } catch (e) {
        debugLog("MULTIMODAL_ERROR", `Failed to parse JSON content: ${e.message}`);
        // Fallback to plain text
        messageContent = `[${dateTime}] ${content}`;
      }
    } else {
      // Plain text (existing behavior)
      // Don't add timestamp to slash commands - CLI needs "/" at start
      // Trim leading whitespace for slash command detection and sending
      const trimmed = content.trimStart();
      if (trimmed.startsWith("/")) {
        messageContent = trimmed;
      } else {
        messageContent = `[${dateTime}] ${content}`;
      }
    }

    // Reset only turn-local flags. Keep cross-turn pending/bg state so late
    // events from background agents are still correlated correctly.
    mainResultSent = false;
    lastStopReason = null;

    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: messageContent },
      session_id: currentSessionId,
      parent_tool_use_id: null
    }) + "\n";

    // Log truncated version (images are large)
    const logMsg = msg.length > 500 ? msg.slice(0, 500) + `... (${msg.length} bytes total)` : msg;
    debugLog("CLAUDE_STDIN", logMsg);

    // Only queue if Claude process isn't available (during respawn)
    // Note: We must NOT queue based on readySent - Claude needs to receive
    // a message first before it outputs the init event
    if (!claude || !claude.stdin || !claude.stdin.writable) {
      debugLog("QUEUE", "Queueing message - Claude process not ready");
      // Enforce queue limit - drop oldest if full
      if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
        pendingMessages.shift();
        debugLog("QUEUE", "Queue full, dropped oldest message");
      }
      pendingMessages.push(msg);
    } else {
      claude.stdin.write(msg);
    }
  }

  // Handle interrupt - kill Claude process to stop generation immediately
  function handleInterrupt() {
    if (!claude || isInterrupting) return;

    debugLog("INTERRUPT", "Killing Claude process to interrupt");
    isInterrupting = true;

    // Kill the process - stdin.end() doesn't stop Claude fast enough
    // The close handler will respawn automatically
    claude.kill('SIGTERM');
  }

  // Initial spawn
  spawnClaude();

  // Warmup: Send a /status command to trigger Claude's init immediately
  // This way Claude is ready by the time the user types their first message
  setTimeout(() => {
    if (claude && claude.stdin.writable) {
      debugLog("WARMUP", "Sending /status to trigger Claude init");
      isWarmingUp = true;
      const warmupMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: "/status" },
        session_id: currentSessionId,
        parent_tool_use_id: null
      }) + "\n";
      claude.stdin.write(warmupMsg);
    }
  }, 100);

  // Forward user input to Claude
  inputRl.on("line", (line) => {
    debugLog("INPUT_RAW", line);
    const input = line.trim();
    if (!input) return;

    // Check for interrupt signal
    if (input.startsWith("{")) {
      try {
        const parsed = JSON.parse(input);

        // Handle interrupt
        if (parsed.type === "interrupt") {
          debugLog("INTERRUPT_RECEIVED", parsed);
          handleInterrupt();
          return;
        }

        // Handle permission response (control_response)
        if (parsed.type === "control_response") {
          debugLog("CONTROL_RESPONSE_FROM_UI", parsed);

          // Send control_response to Claude - format matches SDK's internal structure:
          // { type: "control_response", response: { subtype: "success", request_id, response: {...} } }
          // The inner response must match canUseTool callback return format:
          // For "allow": { behavior: "allow", updatedInput: {...} }
          // For "deny": { behavior: "deny", message: "..." }
          // When denying with feedback (e.g., plan iteration), use the message from the UI
          const permissionResponse = parsed.allow
            ? { behavior: "allow", updatedInput: parsed.tool_input || {} }
            : { behavior: "deny", message: parsed.message || "User denied permission" };

          const msg = JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: parsed.request_id,
              response: permissionResponse
            }
          }) + "\n";

          debugLog("CLAUDE_STDIN", msg);
          if (claude && claude.stdin.writable) {
            claude.stdin.write(msg);
          }
          return;
        }

        // Handle AskUserQuestion response
        if (parsed.type === "question_response") {
          debugLog("QUESTION_RESPONSE_FROM_UI", parsed);

          // Send control_response with answers in the format AskUserQuestion expects:
          // { behavior: "allow", updatedInput: { questions: [...], answers: {...} } }
          const msg = JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: parsed.request_id,
              response: {
                behavior: "allow",
                updatedInput: {
                  questions: parsed.questions,
                  answers: parsed.answers
                }
              }
            }
          }) + "\n";

          debugLog("CLAUDE_STDIN", msg);
          if (claude && claude.stdin.writable) {
            claude.stdin.write(msg);
          }
          return;
        }

        // Handle AskUserQuestion cancellation
        if (parsed.type === "question_cancel") {
          debugLog("QUESTION_CANCEL_FROM_UI", parsed);

          // Send control_response with deny to let Claude continue
          const msg = JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: parsed.request_id,
              response: {
                behavior: "deny",
                message: "User cancelled the question"
              }
            }
          }) + "\n";

          debugLog("CLAUDE_STDIN", msg);
          if (claude && claude.stdin.writable) {
            claude.stdin.write(msg);
          }
          return;
        }
      } catch (e) {
        // Not JSON, treat as regular message
      }
    }

    // Handle JSON-encoded messages from Rust (preserves newlines)
    // Format: __MSG__{"text":"..."}
    if (input.startsWith("__MSG__")) {
      try {
        const jsonData = JSON.parse(input.slice(7)); // Remove "__MSG__" prefix
        const text = jsonData.text;
        debugLog("MSG_DECODED", `Decoded message with ${text.split('\n').length} lines`);

        // Check if the decoded text is a JSON control message (control_response, etc.)
        // These need to be handled specially, not sent as user messages
        try {
          const innerParsed = JSON.parse(text);
          if (innerParsed.type === "control_response") {
            debugLog("CONTROL_RESPONSE_FROM_MSG", innerParsed);
            // Handle control_response - format for Claude SDK
            const permissionResponse = innerParsed.allow
              ? { behavior: "allow", updatedInput: innerParsed.tool_input || {} }
              : { behavior: "deny", message: innerParsed.message || "User denied permission" };

            const msg = JSON.stringify({
              type: "control_response",
              response: {
                subtype: "success",
                request_id: innerParsed.request_id,
                response: permissionResponse
              }
            }) + "\n";

            debugLog("CLAUDE_STDIN_FROM_MSG", msg);
            if (claude && claude.stdin.writable) {
              claude.stdin.write(msg);
            }
            return;
          }

          if (innerParsed.type === "question_response") {
            debugLog("QUESTION_RESPONSE_FROM_MSG", innerParsed);
            const msg = JSON.stringify({
              type: "control_response",
              response: {
                subtype: "success",
                request_id: innerParsed.request_id,
                response: {
                  behavior: "allow",
                  updatedInput: {
                    questions: innerParsed.questions,
                    answers: innerParsed.answers
                  }
                }
              }
            }) + "\n";

            if (claude && claude.stdin.writable) {
              claude.stdin.write(msg);
            }
            return;
          }

          if (innerParsed.type === "question_cancel") {
            debugLog("QUESTION_CANCEL_FROM_MSG", innerParsed);
            const msg = JSON.stringify({
              type: "control_response",
              response: {
                subtype: "success",
                request_id: innerParsed.request_id,
                response: {
                  behavior: "deny",
                  message: "User cancelled the question"
                }
              }
            }) + "\n";

            if (claude && claude.stdin.writable) {
              claude.stdin.write(msg);
            }
            return;
          }
          // Other JSON messages can fall through to be sent as user messages
        } catch (innerE) {
          // Not JSON, continue to send as user message
        }

        // Handle /sandbox locally (CLI doesn't support it in stream-json mode)
        if (text.trim().toLowerCase() === "/sandbox") {
          const isEnabled = process.env.CLAUDIA_SANDBOX === "1";
          const domains = isEnabled ? SANDBOX_ALLOWED_DOMAINS : [];
          let status = isEnabled
            ? `Sandbox: **enabled**\n\nFile writes restricted to working directory.\nNetwork proxy active with ${domains.length} allowed domain(s):\n${domains.map(d => `- ${d}`).join("\n")}`
            : "Sandbox: **disabled**\n\nNo file write or network restrictions.";
          status += "\n\nToggle in Settings (takes effect on next session).";
          sendEvent("text_delta", { text: status });
          sendEvent("result", { content: status });
          sendEvent("done", {});
          return;
        }

        sendEvent("processing", { prompt: text });
        sendUserMessage(text);
        return;
      } catch (e) {
        debugLog("MSG_DECODE_ERROR", `Failed to parse: ${e.message}`);
        // Fall through to treat as regular input
      }
    }

    // Handle slash commands
    if (input.startsWith("/")) {
      const [cmd, ...args] = input.slice(1).split(" ");
      debugLog("SLASH_CMD", { cmd, args });

      // Local-only commands (don't forward to CLI)
      switch (cmd.toLowerCase()) {
        case "exit":
        case "quit":
          sendEvent("status", { message: "Exiting..." });
          if (claude) claude.kill();
          process.exit(0);
          return;
        case "help":
          sendEvent("status", {
            message: "Commands: /compact, /clear, /cost, /model, /status, /config, /memory, /review, /doctor, /exit"
          });
          return;
        case "clear":
          // Handle /clear locally by generating a new session ID
          // This makes the CLI treat subsequent messages as a new conversation
          // without needing to restart the process
          debugLog("CLEAR", "Generating new session ID to clear context");
          if (safetyNetTimer) {
            clearTimeout(safetyNetTimer);
            safetyNetTimer = null;
          }
          for (const state of bgTaskStateByTool.values()) {
            if (state.fallbackTimer) {
              clearTimeout(state.fallbackTimer);
            }
          }
          for (const timer of bgOrphanFallbackTimers.values()) {
            clearTimeout(timer);
          }
          activeSubagents.clear();
          completedBgAgents.clear();
          bgTaskStateByTool.clear();
          bgFinalizedResultKeys.clear();
          bgFinalizedResultSources.clear();
          bgAgentMap.clear();
          bgOutputFileMap.clear();
          bgOutputFileByTool.clear();
          bgOutputRootHints.clear();
          bgOutputRootScanCache = [];
          bgOutputRootScanAt = 0;
          bgOrphanFallbackTimers.clear();
          bgOutputRecoveryInFlight.clear();

          currentSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          debugLog("CLEAR", `New session ID: ${currentSessionId}`);
          sendEvent("status", { message: "Context cleared" });
          sendEvent("ready", {
            sessionId: currentSessionId,
            model: "opus",
            tools: 0  // Will be updated on next message
          });
          readySent = true;  // Mark ready as sent for the new session
          sendEvent("done", {});
          return;
      }

      // All other slash commands: send as user message to CLI
      // This works for: /compact, /cost, /model, /status, /config, /memory, /review, /doctor, etc.
      debugLog("SLASH_CMD_FORWARD", input);
      const slashMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: input },
        session_id: currentSessionId,
        parent_tool_use_id: null
      }) + "\n";
      debugLog("CLAUDE_SLASH", slashMsg);
      if (claude && claude.stdin.writable) {
        claude.stdin.write(slashMsg);
      }
      return;
    }

    sendEvent("processing", { prompt: input });
    sendUserMessage(input);
  });

  inputRl.on("close", () => {
    if (claude && claude.stdin) {
      claude.stdin.end();
    }
  });

  process.on("SIGINT", () => {
    if (claude) claude.kill();
    process.exit(0);
  });
}

main().catch((e) => {
  sendEvent("error", { message: e.message });
  process.exit(1);
});
