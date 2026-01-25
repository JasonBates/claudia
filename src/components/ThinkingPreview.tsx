import { Component, createMemo, Show } from "solid-js";

interface ThinkingPreviewProps {
  content: string;
  expanded: boolean;
  isStreaming?: boolean;
  onToggle?: () => void;  // Callback for individual toggle button
}

const ThinkingPreview: Component<ThinkingPreviewProps> = (props) => {
  // In preview mode, show first ~500 chars (roughly 3-5 lines); in expanded mode, show all
  const displayContent = createMemo(() => {
    if (props.expanded) return props.content;

    const len = props.content.length;
    if (len <= 500) return props.content;
    return props.content.slice(0, 500);
  });

  const hasMore = () => !props.expanded && props.content.length > 500;

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
        <Show when={props.onToggle && !props.isStreaming}>
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
