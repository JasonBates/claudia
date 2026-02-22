import { Component } from "solid-js";

interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
  section: string;
}

const ErrorFallback: Component<ErrorFallbackProps> = (props) => {
  return (
    <div class="error-fallback" role="alert">
      <div class="error-fallback-icon">⚠</div>
      <div class="error-fallback-message">
        Something went wrong in {props.section}
      </div>
      <div class="error-fallback-detail">{props.error.message}</div>
      <button
        class="error-fallback-retry"
        onClick={props.reset}
      >
        Retry
      </button>
    </div>
  );
};

export default ErrorFallback;
