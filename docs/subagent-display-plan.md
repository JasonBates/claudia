# Subagent Display Feature - Option C Implementation Plan

## Overview

This document outlines the full implementation plan for **Option C: Hierarchical + Progress Tracking** for subagent visualization in Claudia.

**Goal:** Display subagent activity with parent-child relationships, real-time progress tracking, and nested tool visualization.

**Estimated Effort:** 2-3 days

---

## Current State Analysis

### What We Have Now
- Task tools render as generic `ToolResult` components
- No distinction between Task and other tools
- No visibility into subagent lifecycle
- Tool results show raw output without hierarchy

### What the SDK Provides
| Available | Not Available |
|-----------|---------------|
| `parent_tool_use_id` on all events | Dedicated subagent start/end events |
| Tool invocation IDs | Progress percentage |
| Real-time stream events | Separate event channels per agent |
| Content block deltas | Automatic hierarchical grouping |

**Key insight:** All data for hierarchy is available via `parent_tool_use_id`, but we must build the grouping logic ourselves.

---

## Architecture Design

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude CLI (stream-json)                                       │
│    ↓                                                            │
│  stream_event with parent_tool_use_id                          │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│  sdk-bridge-v2.mjs                                              │
│    - Track activeSubagents Map                                  │
│    - Emit subagent_start / subagent_progress / subagent_end    │
│    - Preserve parent_tool_use_id in forwarded events           │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│  Rust Backend (events.rs, messaging.rs)                         │
│    - Add new ClaudeEvent variants for subagent lifecycle       │
│    - Forward to frontend via Tauri channel                     │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (SolidJS)                                             │
│    - useSubagentPanel hook tracks active subagents             │
│    - SubagentPanel component shows hierarchy                   │
│    - ToolResult enhanced for nested display                    │
└─────────────────────────────────────────────────────────────────┘
```

### Core Data Structures

```typescript
// src/lib/types.ts

interface SubagentState {
  id: string;                    // tool_use_id of the Task call
  agentType: string;             // "Explore", "Plan", "deep-research", etc.
  description: string;           // Short description from Task input
  prompt: string;                // Full prompt (truncated for display)
  status: "starting" | "running" | "complete" | "error";
  startTime: number;             // Unix timestamp
  duration?: number;             // Calculated on completion
  parentToolId: string | null;   // For nested subagents
  nestedTools: NestedToolState[];// Tools executed within this subagent
  result?: string;               // Final output (truncated)
}

interface NestedToolState {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "complete" | "error";
  startTime: number;
  duration?: number;
}

interface SubagentProgress {
  toolId: string;                // Which subagent this belongs to
  toolName: string;              // Current tool being executed
  toolCount: number;             // How many tools executed so far
}
```

---

## Implementation Phases

### Phase 1: Bridge Enhancement (4-6 hours)

**File:** `sdk-bridge-v2.mjs`

#### 1.1 Add Subagent State Tracking

```javascript
// Add to state section (around line 91)
let activeSubagents = new Map();  // tool_use_id -> subagentInfo
let subagentStack = [];           // Track nesting depth
```

#### 1.2 Detect Subagent Start

```javascript
// In handleStreamEvent, case "content_block_start"
if (event.content_block?.type === "tool_use") {
  const toolId = event.content_block.id;
  const toolName = event.content_block.name;
  currentToolId = toolId;

  // Detect Task (subagent) invocation
  if (toolName === "Task") {
    subagentStack.push(toolId);
    activeSubagents.set(toolId, {
      id: toolId,
      startTime: Date.now(),
      nestedToolCount: 0,
      status: "starting"
    });
    // Note: Full subagent info comes from tool_input
  }

  // Track nested tool within subagent
  const parentSubagent = subagentStack[subagentStack.length - 1];

  sendEvent("tool_start", {
    id: toolId,
    name: toolName,
    parent_tool_use_id: parentSubagent || null  // ADD THIS
  });
}
```

#### 1.3 Capture Subagent Details from tool_input

```javascript
// Add JSON accumulation for Task tools
let taskInputBuffer = "";

// In handleStreamEvent, case "content_block_delta"
if (event.delta?.type === "input_json_delta") {
  const currentSubagent = activeSubagents.get(currentToolId);
  if (currentSubagent) {
    taskInputBuffer += event.delta.partial_json;
    // Try to parse and extract subagent_type
    try {
      const parsed = JSON.parse(taskInputBuffer);
      if (parsed.subagent_type && currentSubagent.status === "starting") {
        currentSubagent.agentType = parsed.subagent_type;
        currentSubagent.description = parsed.description || "";
        currentSubagent.prompt = parsed.prompt || "";
        currentSubagent.status = "running";

        sendEvent("subagent_start", {
          id: currentToolId,
          agentType: parsed.subagent_type,
          description: parsed.description,
          prompt: parsed.prompt?.slice(0, 200)
        });
      }
    } catch { /* incomplete JSON */ }
  }

  sendEvent("tool_input", { json: event.delta.partial_json });
}
```

#### 1.4 Track Nested Tool Progress

```javascript
// When tool_start is emitted for non-Task tools within a subagent context
if (toolName !== "Task" && subagentStack.length > 0) {
  const parentSubagentId = subagentStack[subagentStack.length - 1];
  const subagent = activeSubagents.get(parentSubagentId);
  if (subagent) {
    subagent.nestedToolCount++;
    sendEvent("subagent_progress", {
      subagentId: parentSubagentId,
      toolName: toolName,
      toolCount: subagent.nestedToolCount
    });
  }
}
```

#### 1.5 Detect Subagent Completion

```javascript
// In case "tool_result" handling
case "tool_result":
  const toolId = currentToolId;

  // Check if this completes a subagent
  if (activeSubagents.has(toolId)) {
    const subagent = activeSubagents.get(toolId);
    subagent.status = "complete";
    subagent.duration = Date.now() - subagent.startTime;

    sendEvent("subagent_end", {
      id: toolId,
      agentType: subagent.agentType,
      duration: subagent.duration,
      toolCount: subagent.nestedToolCount,
      result: (msg.content || msg.output || "").slice(0, 500)
    });

    activeSubagents.delete(toolId);
    subagentStack.pop();
  }

  sendEvent("tool_result", {
    tool_use_id: toolId,
    stdout: msg.content || msg.output || "",
    stderr: msg.error || "",
    isError: !!msg.is_error
  });
  currentToolId = null;
  break;
```

#### 1.6 New Event Types Summary

| Event | Fields | When |
|-------|--------|------|
| `subagent_start` | id, agentType, description, prompt | Task tool input parsed |
| `subagent_progress` | subagentId, toolName, toolCount | Each nested tool starts |
| `subagent_end` | id, agentType, duration, toolCount, result | Task tool_result received |
| `tool_start` (enhanced) | id, name, parent_tool_use_id | Any tool starts |

---

### Phase 2: Rust Backend (2-3 hours)

**Files:** `src-tauri/src/events.rs`, `src-tauri/src/claude_process.rs`, `src-tauri/src/commands/messaging.rs`

#### 2.1 Add New Event Variants

```rust
// events.rs - Add to ClaudeEvent enum

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClaudeEvent {
    // ... existing variants ...

    SubagentStart {
        id: String,
        agent_type: String,
        description: String,
        prompt: String,
    },
    SubagentProgress {
        subagent_id: String,
        tool_name: String,
        tool_count: u32,
    },
    SubagentEnd {
        id: String,
        agent_type: String,
        duration: u64,
        tool_count: u32,
        result: String,
    },

    // Enhanced ToolStart
    ToolStart {
        id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
}
```

#### 2.2 Update Event Parsing

```rust
// claude_process.rs - Add to parse_bridge_message

"subagent_start" => {
    let id = json.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let agent_type = json.get("agentType").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let description = json.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let prompt = json.get("prompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Some(ClaudeEvent::SubagentStart { id, agent_type, description, prompt })
}

"subagent_progress" => {
    let subagent_id = json.get("subagentId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let tool_name = json.get("toolName").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let tool_count = json.get("toolCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    Some(ClaudeEvent::SubagentProgress { subagent_id, tool_name, tool_count })
}

"subagent_end" => {
    let id = json.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let agent_type = json.get("agentType").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let duration = json.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);
    let tool_count = json.get("toolCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let result = json.get("result").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Some(ClaudeEvent::SubagentEnd { id, agent_type, duration, tool_count, result })
}
```

#### 2.3 Update ToolStart Parsing

```rust
"tool_start" => {
    let id = json.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let name = json.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let parent_tool_use_id = json.get("parent_tool_use_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(ClaudeEvent::ToolStart { id, name, parent_tool_use_id })
}
```

---

### Phase 3: Frontend Hook (3-4 hours)

**File:** `src/hooks/useSubagentPanel.ts` (NEW)

```typescript
import { createSignal, Accessor } from "solid-js";
import type { SubagentState, SubagentProgress } from "../lib/types";

interface UseSubagentPanelOptions {
  onSubagentStart?: (subagent: SubagentState) => void;
  onSubagentEnd?: (subagent: SubagentState) => void;
}

export function useSubagentPanel(options: UseSubagentPanelOptions = {}) {
  // Active subagents (Map for O(1) lookup)
  const [activeSubagents, setActiveSubagents] = createSignal<Map<string, SubagentState>>(new Map());

  // Completed subagents (for history, limited to last 10)
  const [completedSubagents, setCompletedSubagents] = createSignal<SubagentState[]>([]);

  // Panel visibility
  const [showPanel, setShowPanel] = createSignal(false);
  const [panelExpanded, setPanelExpanded] = createSignal(true);

  // Handle subagent_start event
  const handleSubagentStart = (event: {
    id: string;
    agent_type: string;
    description: string;
    prompt: string;
  }) => {
    const subagent: SubagentState = {
      id: event.id,
      agentType: event.agent_type,
      description: event.description,
      prompt: event.prompt,
      status: "running",
      startTime: Date.now(),
      parentToolId: null,
      nestedTools: [],
    };

    setActiveSubagents(prev => {
      const next = new Map(prev);
      next.set(event.id, subagent);
      return next;
    });

    setShowPanel(true);
    options.onSubagentStart?.(subagent);
  };

  // Handle subagent_progress event
  const handleSubagentProgress = (event: {
    subagent_id: string;
    tool_name: string;
    tool_count: number;
  }) => {
    setActiveSubagents(prev => {
      const next = new Map(prev);
      const subagent = next.get(event.subagent_id);
      if (subagent) {
        subagent.nestedTools.push({
          id: `${event.subagent_id}-${event.tool_count}`,
          name: event.tool_name,
          input: {},
          status: "running",
          startTime: Date.now(),
        });
      }
      return next;
    });
  };

  // Handle subagent_end event
  const handleSubagentEnd = (event: {
    id: string;
    agent_type: string;
    duration: number;
    tool_count: number;
    result: string;
  }) => {
    setActiveSubagents(prev => {
      const next = new Map(prev);
      const subagent = next.get(event.id);

      if (subagent) {
        subagent.status = "complete";
        subagent.duration = event.duration;
        subagent.result = event.result;

        // Move to completed list
        setCompletedSubagents(completed => {
          const updated = [subagent, ...completed].slice(0, 10);
          return updated;
        });

        options.onSubagentEnd?.(subagent);
      }

      next.delete(event.id);
      return next;
    });

    // Hide panel if no active subagents
    setActiveSubagents(current => {
      if (current.size === 0) {
        setTimeout(() => setShowPanel(false), 2000); // Delay to show completion
      }
      return current;
    });
  };

  // Get active subagents as array (for rendering)
  const activeSubagentsList: Accessor<SubagentState[]> = () =>
    Array.from(activeSubagents().values());

  // Check if any subagent is active
  const hasActiveSubagents: Accessor<boolean> = () =>
    activeSubagents().size > 0;

  return {
    // State
    activeSubagents: activeSubagentsList,
    completedSubagents,
    hasActiveSubagents,
    showPanel,
    panelExpanded,

    // Actions
    setShowPanel,
    setPanelExpanded,

    // Event handlers (to be wired in App.tsx)
    handleSubagentStart,
    handleSubagentProgress,
    handleSubagentEnd,
  };
}
```

---

### Phase 4: Frontend Components (4-5 hours)

#### 4.1 SubagentPanel Component

**File:** `src/components/SubagentPanel.tsx` (NEW)

```tsx
import { Component, For, Show } from "solid-js";
import type { SubagentState } from "../lib/types";
import "./SubagentPanel.css";

interface SubagentPanelProps {
  activeSubagents: SubagentState[];
  completedSubagents: SubagentState[];
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}

const agentIcons: Record<string, string> = {
  "Explore": "🔍",
  "Plan": "📋",
  "deep-research": "🔬",
  "code-reviewer": "👀",
  "general-purpose": "🤖",
};

const SubagentItem: Component<{ subagent: SubagentState }> = (props) => {
  const elapsed = () => {
    if (props.subagent.duration) {
      return `${(props.subagent.duration / 1000).toFixed(1)}s`;
    }
    const ms = Date.now() - props.subagent.startTime;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const icon = () => agentIcons[props.subagent.agentType] || "🤖";

  return (
    <div class={`subagent-item subagent-${props.subagent.status}`}>
      <div class="subagent-header">
        <span class="subagent-icon">{icon()}</span>
        <span class="subagent-type">{props.subagent.agentType}</span>
        <span class="subagent-time">{elapsed()}</span>
        <Show when={props.subagent.status === "running"}>
          <span class="subagent-spinner">⟳</span>
        </Show>
        <Show when={props.subagent.status === "complete"}>
          <span class="subagent-check">✓</span>
        </Show>
      </div>
      <div class="subagent-description">
        {props.subagent.description || props.subagent.prompt?.slice(0, 80)}...
      </div>
      <Show when={props.subagent.nestedTools.length > 0}>
        <div class="subagent-tools">
          <span class="tool-count">{props.subagent.nestedTools.length} tools</span>
          <span class="tool-latest">
            Latest: {props.subagent.nestedTools[props.subagent.nestedTools.length - 1]?.name}
          </span>
        </div>
      </Show>
    </div>
  );
};

export const SubagentPanel: Component<SubagentPanelProps> = (props) => {
  return (
    <div class={`subagent-panel ${props.expanded ? 'expanded' : 'collapsed'}`}>
      <div class="subagent-panel-header" onClick={props.onToggleExpand}>
        <span class="panel-title">🤖 Subagents</span>
        <span class="panel-count">{props.activeSubagents.length} active</span>
        <button class="panel-close" onClick={(e) => { e.stopPropagation(); props.onClose(); }}>×</button>
      </div>

      <Show when={props.expanded}>
        <div class="subagent-panel-content">
          <Show when={props.activeSubagents.length > 0}>
            <div class="subagent-section">
              <div class="section-label">Active</div>
              <For each={props.activeSubagents}>
                {(subagent) => <SubagentItem subagent={subagent} />}
              </For>
            </div>
          </Show>

          <Show when={props.completedSubagents.length > 0}>
            <div class="subagent-section completed">
              <div class="section-label">Recent</div>
              <For each={props.completedSubagents.slice(0, 3)}>
                {(subagent) => <SubagentItem subagent={subagent} />}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
```

#### 4.2 SubagentPanel Styles

**File:** `src/components/SubagentPanel.css` (NEW)

```css
.subagent-panel {
  position: fixed;
  bottom: 80px;
  right: 20px;
  width: 320px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 100;
  overflow: hidden;
  transition: all 0.2s ease;
}

.subagent-panel.collapsed {
  width: 200px;
}

.subagent-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  cursor: pointer;
  user-select: none;
}

.panel-title {
  font-weight: 600;
  flex: 1;
}

.panel-count {
  font-size: 0.85em;
  color: var(--text-secondary);
}

.panel-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.2em;
  cursor: pointer;
  padding: 0 4px;
}

.subagent-panel-content {
  max-height: 400px;
  overflow-y: auto;
}

.subagent-section {
  padding: 8px;
}

.section-label {
  font-size: 0.75em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  padding: 0 4px;
}

.subagent-item {
  background: var(--bg-primary);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
}

.subagent-item.subagent-running {
  border-left: 3px solid var(--accent-blue);
}

.subagent-item.subagent-complete {
  border-left: 3px solid var(--accent-green);
  opacity: 0.8;
}

.subagent-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.subagent-icon {
  font-size: 1.1em;
}

.subagent-type {
  font-weight: 500;
  flex: 1;
}

.subagent-time {
  font-size: 0.85em;
  color: var(--text-secondary);
}

.subagent-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.subagent-check {
  color: var(--accent-green);
}

.subagent-description {
  font-size: 0.85em;
  color: var(--text-secondary);
  line-height: 1.4;
}

.subagent-tools {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 0.8em;
  color: var(--text-tertiary);
}

.tool-count {
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
}
```

---

### Phase 5: Integration (2-3 hours)

#### 5.1 Wire Up Event Handlers

**File:** `src/lib/event-handlers.ts`

```typescript
// Add to EventHandlerDeps interface
setSubagentStart: (event: any) => void;
setSubagentProgress: (event: any) => void;
setSubagentEnd: (event: any) => void;

// Add to createEventHandler switch statement
case "subagent_start":
  deps.setSubagentStart(event);
  break;
case "subagent_progress":
  deps.setSubagentProgress(event);
  break;
case "subagent_end":
  deps.setSubagentEnd(event);
  break;
```

#### 5.2 Wire Up in App.tsx

```typescript
// Import new hook
import { useSubagentPanel } from "./hooks/useSubagentPanel";

// In App component
const subagentPanel = useSubagentPanel({
  onSubagentStart: (subagent) => {
    console.log("Subagent started:", subagent.agentType);
  },
  onSubagentEnd: (subagent) => {
    console.log("Subagent completed:", subagent.agentType, subagent.duration);
  },
});

// Add to event handler deps
const eventHandler = createEventHandler({
  // ... existing deps ...
  setSubagentStart: subagentPanel.handleSubagentStart,
  setSubagentProgress: subagentPanel.handleSubagentProgress,
  setSubagentEnd: subagentPanel.handleSubagentEnd,
});

// Render panel
<Show when={subagentPanel.showPanel()}>
  <SubagentPanel
    activeSubagents={subagentPanel.activeSubagents()}
    completedSubagents={subagentPanel.completedSubagents()}
    expanded={subagentPanel.panelExpanded()}
    onToggleExpand={() => subagentPanel.setPanelExpanded(p => !p)}
    onClose={() => subagentPanel.setShowPanel(false)}
  />
</Show>
```

#### 5.3 Update Types

**File:** `src/lib/types.ts`

```typescript
// Add new types
export interface SubagentState {
  id: string;
  agentType: string;
  description: string;
  prompt: string;
  status: "starting" | "running" | "complete" | "error";
  startTime: number;
  duration?: number;
  parentToolId: string | null;
  nestedTools: NestedToolState[];
  result?: string;
}

export interface NestedToolState {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "complete" | "error";
  startTime: number;
  duration?: number;
}
```

#### 5.4 Update Tauri Types

**File:** `src/lib/tauri.ts`

```typescript
// Add to ClaudeEvent type
| { type: "subagent_start"; id: string; agent_type: string; description: string; prompt: string }
| { type: "subagent_progress"; subagent_id: string; tool_name: string; tool_count: number }
| { type: "subagent_end"; id: string; agent_type: string; duration: number; tool_count: number; result: string }
```

---

### Phase 6: Testing (2-3 hours)

#### 6.1 Unit Tests for Hook

**File:** `src/__tests__/useSubagentPanel.test.ts`

```typescript
import { createRoot } from "solid-js";
import { useSubagentPanel } from "../hooks/useSubagentPanel";

describe("useSubagentPanel", () => {
  test("tracks subagent lifecycle", () => {
    createRoot((dispose) => {
      const panel = useSubagentPanel();

      // Start a subagent
      panel.handleSubagentStart({
        id: "tool_123",
        agent_type: "Explore",
        description: "Find files",
        prompt: "Search the codebase",
      });

      expect(panel.activeSubagents().length).toBe(1);
      expect(panel.hasActiveSubagents()).toBe(true);

      // Progress
      panel.handleSubagentProgress({
        subagent_id: "tool_123",
        tool_name: "Glob",
        tool_count: 1,
      });

      expect(panel.activeSubagents()[0].nestedTools.length).toBe(1);

      // Complete
      panel.handleSubagentEnd({
        id: "tool_123",
        agent_type: "Explore",
        duration: 5000,
        tool_count: 3,
        result: "Found 5 files",
      });

      expect(panel.activeSubagents().length).toBe(0);
      expect(panel.completedSubagents().length).toBe(1);

      dispose();
    });
  });
});
```

#### 6.2 Rust Tests

**File:** `src-tauri/src/events.rs` (add tests)

```rust
#[test]
fn parse_subagent_start() {
    let event = parse(json!({
        "type": "subagent_start",
        "id": "tool_123",
        "agentType": "Explore",
        "description": "Find files",
        "prompt": "Search..."
    }));
    assert!(matches!(
        event,
        Some(ClaudeEvent::SubagentStart { id, agent_type, .. })
        if id == "tool_123" && agent_type == "Explore"
    ));
}
```

---

## Delivery Checklist

### Phase 1: Bridge (Day 1 Morning)
- [ ] Add subagent state tracking variables
- [ ] Detect Task tool invocation
- [ ] Parse Task input for agentType
- [ ] Emit subagent_start event
- [ ] Track nested tool progress
- [ ] Emit subagent_progress events
- [ ] Detect subagent completion
- [ ] Emit subagent_end event
- [ ] Add parent_tool_use_id to tool_start

### Phase 2: Rust Backend (Day 1 Afternoon)
- [ ] Add SubagentStart event variant
- [ ] Add SubagentProgress event variant
- [ ] Add SubagentEnd event variant
- [ ] Update ToolStart with parent_tool_use_id
- [ ] Add parsing for new events
- [ ] Write unit tests

### Phase 3: Frontend Hook (Day 2 Morning)
- [ ] Create useSubagentPanel hook
- [ ] Implement state management
- [ ] Add event handlers
- [ ] Export from hooks/index.ts
- [ ] Write unit tests

### Phase 4: Frontend Components (Day 2 Afternoon)
- [ ] Create SubagentPanel component
- [ ] Create SubagentItem component
- [ ] Add CSS styles
- [ ] Handle expand/collapse
- [ ] Show active vs completed

### Phase 5: Integration (Day 3 Morning)
- [ ] Update EventHandlerDeps
- [ ] Update createEventHandler
- [ ] Wire up in App.tsx
- [ ] Update types.ts
- [ ] Update tauri.ts

### Phase 6: Testing (Day 3 Afternoon)
- [ ] Manual testing with real subagents
- [ ] Edge cases (parallel subagents, nested)
- [ ] Performance check
- [ ] Polish UI animations

---

## Future Enhancements (Out of Scope)

1. **Timeline View** - Gantt-style visualization of concurrent subagents
2. **Nested Tree View** - Indented display of parent-child tool relationships
3. **Cost Tracking** - Show token usage per subagent
4. **Persistence** - Save subagent history across sessions
5. **Filtering** - Filter by agent type or status

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Event ordering issues | Use tool_use_id as primary key, not timestamps |
| Missing events | Handle graceful degradation - show "unknown" agent type |
| Performance with many subagents | Limit active display to 5, completed to 10 |
| UI clutter | Collapsible panel, auto-hide when inactive |

---

## Success Metrics

1. Task tools show "Running..." with agent type instead of generic loading
2. Users can see what tool a subagent is currently executing
3. Completion shows duration and tool count
4. No regression in existing tool display functionality
