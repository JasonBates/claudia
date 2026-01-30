import { Component, Show, For } from "solid-js";

interface NestedTool {
  name: string;
  input?: string;
}

interface PlanningToolProps {
  isLoading: boolean;
  nestedTools: NestedTool[];
  isReady: boolean;
}

// Format tool names for display
const formatToolName = (name: string): string => {
  if (name.startsWith("mcp__")) {
    const parts = name.slice(5).split("__");
    if (parts.length >= 2) {
      const server = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      const tool = parts.slice(1).join(" ").replace(/_/g, " ");
      return `${server}: ${tool}`;
    }
    return name.slice(5).replace(/_/g, " ");
  }
  return name;
};

const PlanningTool: Component<PlanningToolProps> = (props) => {
  // Show only the last 4 nested tools for activity display
  const recentTools = () => props.nestedTools.slice(-4);

  return (
    <div class="planning-tool" classList={{ complete: !props.isLoading }}>
      {/* Header */}
      <div class="planning-header">
        <Show when={props.isLoading} fallback={
          <span class="planning-check">✓</span>
        }>
          <span class="planning-spinner">◐</span>
        </Show>
        <span class="planning-title">PLAN</span>
        <span class="planning-status">
          {props.isLoading ? "Planning..." : "View plan in separate window"}
        </span>
      </div>

      {/* Nested tool activity (while loading) */}
      <Show when={props.isLoading && recentTools().length > 0}>
        <div class="planning-activity">
          <For each={recentTools()}>
            {(tool) => (
              <div class="planning-activity-line">
                <span class="activity-tool-name">{formatToolName(tool.name)}</span>
                <Show when={tool.input}>
                  <span class="activity-tool-detail">{tool.input}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Plan content shown in separate window */}
    </div>
  );
};

export default PlanningTool;
