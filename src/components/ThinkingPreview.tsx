import { Component, createMemo, Show } from "solid-js";

interface ThinkingPreviewProps {
  content: string;
  expanded: boolean;
  isStreaming?: boolean;
  onToggle?: () => void;  // Callback for individual toggle button
}

const ThinkingPreview: Component<ThinkingPreviewProps> = (props) => {
  // In preview mode, show ~80 chars (roughly 1 line); in expanded mode, show all
  const displayContent = createMemo(() => {
    if (props.expanded) return props.content;

    const len = props.content.length;
    if (len <= 80) return props.content;
    return props.content.slice(0, 80);
  });

  const hasMore = () => !props.expanded && props.content.length > 80;

  return (
    <div
      class="thinking-block"
      classList={{
        expanded: props.expanded,
        preview: !props.expanded,
        streaming: props.isStreaming,
      }}
    >
      <div class="thinking-header">
        <span class="thinking-icon">...</span>
        <span class="thinking-label">Thinking</span>
        <Show when={props.onToggle}>
          <button
            class="thinking-toggle-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onToggle?.();
            }}
            title={props.expanded ? "Collapse" : "Expand"}
          >
            {props.expanded ? "−" : "+"}
          </button>
        </Show>
      </div>
      <div class="thinking-content">
        {displayContent()}
        <Show when={props.isStreaming}>
          <span class="thinking-cursor">|</span>
        </Show>
        <Show when={hasMore()}>
          <div class="thinking-fade" />
        </Show>
      </div>
    </div>
  );
};

export default ThinkingPreview;
