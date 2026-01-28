# Subagent Tracking and Visualization - Deep Research

> Comprehensive research on best practices for tracking, displaying, and managing AI sub-agents in desktop applications.

*Research conducted: 2026-01-28*

---

## Executive Summary

This research synthesizes patterns from leading AI agent frameworks (LangGraph, CrewAI, AutoGen, OpenAI Swarm) and observability platforms (LangSmith, AgentOps, Phoenix/Arize, AgentPrism) to identify best practices for subagent visualization in desktop applications.

**Key Findings:**
1. Use `parent_tool_use_id` as the primary correlation key for hierarchy
2. Combine multiple visualization types (Tree + Timeline + Details)
3. Emit synthetic lifecycle events (start/progress/end) since frameworks don't provide them
4. AgentPrism offers production-ready open-source React components
5. Progressive disclosure prevents information overload while maintaining detail access

---

## 1. Tracking Hierarchical Agent Execution

### How Frameworks Handle Parent-Child Relationships

| Framework | Coordination Pattern | Key Mechanism |
|-----------|---------------------|---------------|
| **LangGraph** | State graphs | Typed state flows between nodes, supervision pattern |
| **CrewAI** | Hierarchical process | Manager agent with explicit task delegation |
| **AutoGen** | Conversational | Message passing via `ConversableAgent` |
| **OpenAI Swarm** | Explicit handoffs | Handoff functions control agent transfers |

#### LangGraph Approach
- State graphs where agent execution occurs at nodes
- Typed state flows between nodes
- Supervision pattern: manager coordinates specialists
- Clear audit trail of delegation decisions

#### CrewAI Approach
- `Process.hierarchical` mode with central manager
- Manager analyzes tasks, delegates, validates results
- Explicit checkpoints for routing decisions
- Built-in retry and strategy adjustment

#### AutoGen Approach
- Conversational agents with `ConversableAgent` class
- Agents communicate via message passing
- Auto-reply functions determine routing
- Supports static and dynamic conversation patterns

#### OpenAI Swarm Approach
- Explicit handoff functions control transfers
- Agent A returns response OR handoff to Agent B
- Centralized delegation logic (not scattered in tool calls)
- Most debuggable due to explicit control flow

### Recommended Data Structures

```typescript
interface AgentSpan {
  spanId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  parentSpanId?: string;      // Links to parent agent's span
  childSpanIds: string[];     // Links to child agent spans
  startTime: number;
  endTime?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  statusMessage?: string;
  metadata: Record<string, any>;
}

interface ToolCall {
  toolId: string;
  toolName: string;
  spanId: string;             // Which agent span this belongs to
  startTime: number;
  endTime?: number;
  input: Record<string, any>;
  output?: any;
  error?: string;
}

interface ExecutionTrace {
  traceId: string;
  rootAgentId: string;
  startTime: number;
  endTime?: number;
  spans: AgentSpan[];
  toolCalls: ToolCall[];
  messages: Array<{
    timestamp: number;
    fromAgentId: string;
    toAgentId?: string;
    content: string;
    type: 'task_assignment' | 'result_report' | 'error_notification';
  }>;
}
```

### Event Patterns for Lifecycle Tracking

Key events to emit:

| Event Type | Purpose | Key Data |
|------------|---------|----------|
| `agent_created` | Agent instantiated | role, tools, system prompt |
| `agent_initialized` | Ready to begin work | agent_id |
| `task_assigned` | Parent delegates to child | task context, parent_id |
| `agent_thinking` | Reasoning in progress | partial content |
| `tool_invoked` | External tool called | tool name, inputs |
| `tool_completed` | Tool finished | outputs, duration |
| `agent_result` | Final output ready | content, tokens |
| `agent_error` | Failure occurred | error type, recovery action |
| `agent_cancelled` | Interrupted | reason |
| `agent_completed` | Work finished | duration, resource usage |

---

## 2. Displaying Agent Activity in Real-Time

### UI Pattern 1: Tree View

**Best for:** Showing hierarchical structure

```
📦 Root Orchestrator          [running] 12.3s
├── 🔍 Explore Agent          [complete] 4.2s
│   ├── Glob tool             [complete] 0.1s
│   ├── Read tool             [complete] 0.3s
│   └── Grep tool             [complete] 0.2s
├── 📋 Plan Agent             [running] 3.1s
│   └── Write tool            [running] 2.8s
└── 🧪 Test Agent             [pending]
```

**Implementation features:**
- Progressive disclosure (collapse/expand subtrees)
- Color-code by status (blue=running, green=complete, red=failed, yellow=waiting)
- Icons indicate agent role
- Duration display updates in real-time
- Summary info for collapsed sections

**Recommended libraries:**
- React: MUI X Tree View, KendoReact TreeView
- SolidJS: Custom implementation with `<For>` and recursion

### UI Pattern 2: Timeline/Gantt View

**Best for:** Showing temporal relationships and identifying bottlenecks

```
Time:    0s      2s      4s      6s      8s
         |-------|-------|-------|-------|
Root     ████████████████████████████████████
Explore  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░
Plan             ████████████████░░░░░░░░░░░░
Test                             ████████████
```

**What it reveals:**
- Parallel vs sequential execution
- Bottlenecks (long bars blocking others)
- Idle time between agents
- Which agents consumed most wall-clock time

**Implementation considerations:**
- Handle multiple time scales (root=hours, children=seconds)
- Zoom controls for focusing on regions
- Real-time bar extension without visual jumps
- Debounce updates (100-200ms) to avoid excessive redraws

### UI Pattern 3: Nested Tool Visualization

**Best for:** Understanding what an agent actually did

Options:
1. **Table view** - Columns: tool name, start time, duration, status, expandable params/results
2. **Flow diagram** - Tools connected by arrows showing data flow (can get cluttered)
3. **Combined** - Summary timeline + drill-down to tool details

**For parallel tool execution:**
- Align tools vertically with start/end times marked
- Instantly shows parallelization vs serialization

### UI Pattern 4: Real-Time Status Indicators

| Status | Visual Treatment |
|--------|------------------|
| Running | Animated spinner (⟳), blue border |
| Waiting | Hourglass icon, yellow border |
| Complete | Checkmark (✓), green border |
| Failed | X mark (✗), red border |
| Cancelled | Dashed circle, gray border |

Additional indicators:
- Duration counter (updates every second)
- Progress bar (if agent reports progress)
- Token usage gauge
- Error callouts (immediate, prominent)

### Real-Time Update Mechanism

**Server-Sent Events (SSE)** - simpler, sufficient for most cases:
```javascript
const eventSource = new EventSource('/agent-events');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  updateAgentState(data);
};
```

**WebSockets** - only if bidirectional needed:
- Use when frontend sends commands (cancel, pause, adjust)
- More infrastructure complexity

---

## 3. Managing Agent Lifecycles

### Cancellation Pattern

```typescript
class AgentExecutor {
  private abortController: AbortController | null = null;

  async executeAgent(agentId: string): Promise<void> {
    this.abortController = new AbortController();

    try {
      await this.agent.run({
        signal: this.abortController.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        await this.cleanup(agentId);  // Graceful cleanup
      } else {
        throw error;  // Real error
      }
    }
  }

  cancelAgent(): void {
    this.abortController?.abort();
  }
}
```

**Cancellation levels:**
1. **Agent level** - Stop accepting new work, in-flight may complete
2. **Tool level** - Interrupt long-running calls, clean up resources
3. **System level** - Graceful shutdown with timeout, then force-kill

### Graceful Shutdown Pattern

```typescript
class AgentServer {
  private shutdownTimeout = 30000; // 30 seconds
  private runningAgents = new Map<string, AgentExecutor>();

  async handleShutdown(): Promise<void> {
    console.log('Shutdown signal received');

    // 1. Stop accepting new requests
    this.acceptingRequests = false;

    // 2. Wait for completion OR timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Shutdown timeout')),
        this.shutdownTimeout)
    );

    try {
      await Promise.race([
        Promise.all(
          Array.from(this.runningAgents.values())
            .map(agent => agent.waitForCompletion())
        ),
        timeoutPromise
      ]);
    } catch (error) {
      if (error.message === 'Shutdown timeout') {
        // 3. Force-terminate remaining agents
        for (const agent of this.runningAgents.values()) {
          agent.cancel();
        }
      }
    }

    // 4. Clean up resources
    await this.cleanup();
  }
}
```

### Memory Management

**Problem sources:**
- Unbounded conversation history
- Unbounded caches
- Circular references
- Unclosed file handles

**Solutions:**

```typescript
class MemoryManagedAgent {
  private conversationHistory: Message[] = [];
  private maxHistoryTokens = 75000;
  private cache = new LRUCache(1000);

  async addMessage(message: Message): Promise<void> {
    this.conversationHistory.push(message);

    const totalTokens = this.countTokens(this.conversationHistory);
    if (totalTokens > this.maxHistoryTokens) {
      await this.compressHistory();
    }
  }

  private async compressHistory(): Promise<void> {
    const recentMessages = this.conversationHistory.slice(-10);
    const olderMessages = this.conversationHistory.slice(0, -10);

    const summary = await this.llm.generateSummary(olderMessages);

    this.conversationHistory = [
      { role: 'system', content: `Earlier conversation summary: ${summary}` },
      ...recentMessages
    ];
  }
}
```

### Heartbeat Pattern for Stuck Detection

```typescript
class AgentWithHeartbeat {
  private lastHeartbeat = Date.now();
  private heartbeatInterval = 5000; // 5 seconds

  async run(): Promise<void> {
    const heartbeatTimer = setInterval(() => {
      this.emitHeartbeat();
    }, this.heartbeatInterval);

    try {
      await this.doWork();
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private emitHeartbeat(): void {
    this.lastHeartbeat = Date.now();
    this.emit('heartbeat', { agentId: this.id, timestamp: this.lastHeartbeat });
  }
}

// Monitor side
function detectStuckAgents(agents: Agent[], stuckThreshold = 15000): Agent[] {
  const now = Date.now();
  return agents.filter(agent =>
    now - agent.lastHeartbeat > stuckThreshold
  );
}
```

---

## 4. Existing Implementations to Learn From

### LangSmith
**Strengths:**
- Automatic trace capture with LangChain/LangGraph
- Interactive hierarchical tree visualization
- Prebuilt dashboards (latency, errors, breakdowns)
- Custom dashboard API for specific metrics

**Key pattern:** Spans with parent references create queryable graph structure

### AgentOps
**Strengths:**
- **Session replay** - time-travel debugging
- DAG visualization of agent relationships
- Point-in-time state inspection
- Automatic instrumentation

**Key pattern:** Replay enables debugging edge cases by seeing exactly what happened

### Phoenix/Arize
**Strengths:**
- OpenTelemetry-based (standard compliant)
- Multimodal support (voice, images, text)
- Interactive waterfall views
- Per-span latency breakdown

**Key pattern:** Trace zoom feature expands subtrace across full timeline

### AgentPrism (Open Source - Recommended)
**Strengths:**
- React component library, no vendor lock-in
- Four visualization types built-in
- shadcn-style distribution (copy source code)
- Real-time cost tracking

**Components:**
1. **Tree View** - hierarchical with collapse/expand
2. **Timeline View** - Gantt-style with status colors
3. **Details Panel** - inputs, outputs, cost breakdown
4. **Sequence Diagram** - step-by-step replay

**GitHub:** https://github.com/evilmartians/agent-prism

### LangGraph Studio
**Strengths:**
- IDE for agent development
- Graph Mode (workflows) + Chat Mode (conversations)
- **Interrupt functionality** - pause, inspect, modify, resume
- Hot-reload for instant testing

**Key pattern:** Visual debugging with state modification capabilities

---

## 5. UX Patterns for Observability

### Progressive Disclosure (Critical Pattern)

**Layer 1 - Summary:**
- Agent name, status icon, duration
- Total tool count (not individual tools)
- Error indicator (not details)

**Layer 2 - Detail (on click):**
- Individual tool calls with timing
- Parameters and results
- Messages between agents
- Resource usage

**Layer 3 - Deep Inspection (on demand):**
- Complete serialized inputs/outputs
- Full error stack traces
- Token-by-token breakdown

**Implementation:** Remember expanded state across sessions

### Coordinated Multi-View Pattern

```
┌─────────────────────────┬─────────────────────────┐
│                         │                         │
│  Tree View              │  Details Panel          │
│  (hierarchy)            │  (selected item)        │
│                         │                         │
├─────────────────────────┴─────────────────────────┤
│                                                   │
│  Timeline View (temporal relationships)           │
│                                                   │
├───────────────────────────────────────────────────┤
│  Message Log (agent-to-agent communication)       │
└───────────────────────────────────────────────────┘
```

**Interaction:** Click in any view highlights related items in all others

### Real-Time Dashboard Metrics

**System Health:**
- Agents running/waiting/completed
- Error rate (with trend)
- Average execution time
- Throughput (agents/minute)

**Cost Metrics:**
- Total tokens consumed
- Estimated cost ($)
- Tokens per agent
- Expensive agents highlighted

**Performance:**
- P50, P95, P99 latency
- Slowest agents
- Most frequently called tools

**Error Tracking:**
- Error rate trend
- Most common error types
- Highest failure rate agents
- Recent error messages

---

## 6. Recommended Architecture for Claudia

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Claudia Desktop (Tauri)                                │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ SubagentPanel│  │ TimelineView │  │ DetailsPanel │  │
│  │ (tree view)  │  │ (Gantt)      │  │ (selected)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│          │                 │                 │          │
│          └─────────────────┼─────────────────┘          │
│                            │                            │
│                   ┌────────▼────────┐                   │
│                   │ useSubagentPanel│                   │
│                   │ (state mgmt)    │                   │
│                   └────────┬────────┘                   │
└────────────────────────────┼────────────────────────────┘
                             │ Events
                    ┌────────▼────────┐
                    │ Rust Backend    │
                    │ (Tauri)         │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ sdk-bridge-v2   │
                    │ (Node.js)       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Claude Code CLI │
                    └─────────────────┘
```

### Event Flow

1. **Claude CLI** emits `tool_use` with `name: "Task"`
2. **Bridge** detects Task, tracks in `activeSubagents` Map
3. **Bridge** parses `tool_input` to extract `subagent_type`
4. **Bridge** emits `subagent_start` event
5. **Bridge** tracks nested tool calls, emits `subagent_progress`
6. **Bridge** detects `tool_result` for Task, emits `subagent_end`
7. **Rust backend** forwards events via Tauri channel
8. **Frontend** hook updates state, components re-render

### Performance Optimizations

| Technique | Purpose |
|-----------|---------|
| Event batching (100-200ms) | Reduce network overhead |
| Virtual scrolling | Handle deep hierarchies |
| Web workers | Offload parsing/filtering |
| Debounced UI updates | Prevent excessive redraws |
| State compression | Store transitions, compute on demand |

---

## 7. Key Recommendations for Implementation

### Must Have
1. ✅ Track `parent_tool_use_id` for hierarchy correlation
2. ✅ Emit synthetic lifecycle events (subagent_start/progress/end)
3. ✅ Tree view with progressive disclosure
4. ✅ Status indicators with real-time updates
5. ✅ Graceful cancellation with cleanup

### Should Have
1. Timeline/Gantt view for temporal analysis
2. Token/cost tracking per subagent
3. Coordinated multi-view interaction
4. Heartbeat-based stuck detection

### Nice to Have
1. Session replay for debugging
2. Sequence diagram view
3. Custom dashboard metrics
4. Persistent trace storage

---

## Sources

- LangSmith Documentation - https://docs.langchain.com/langsmith
- AgentOps Documentation - https://docs.ag2.ai
- Phoenix/Arize Documentation - https://arize.com/docs/phoenix
- AgentPrism (Evil Martians) - https://github.com/evilmartians/agent-prism
- LangGraph Studio - https://mem0.ai/blog/visual-ai-agent-debugging-langgraph-studio
- CrewAI Hierarchical Process - https://docs.crewai.com/learn/hierarchical-process
- AutoGen Multi-Agent - https://microsoft.github.io/autogen
- OpenAI Swarm - https://galileo.ai/blog/openai-swarm-framework-multi-agents
- Anthropic Context Engineering - https://anthropic.com/engineering/effective-context-engineering-for-ai-agents
