import { Component, Show } from "solid-js";

interface PlanningBannerProps {
  planFile?: string | null;
}

const PlanningBanner: Component<PlanningBannerProps> = (props) => {
  // Extract just the filename from the full path
  const fileName = () => {
    if (!props.planFile) return null;
    const parts = props.planFile.split("/");
    return parts[parts.length - 1];
  };

  return (
    <div class="planning-banner">
      <span class="planning-icon">📋</span>
      <span class="planning-text">Planning Mode</span>
      <Show when={fileName()}>
        <span class="planning-file">{fileName()}</span>
      </Show>
    </div>
  );
};

export default PlanningBanner;
