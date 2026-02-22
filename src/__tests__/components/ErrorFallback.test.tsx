import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ErrorBoundary } from "solid-js";
import ErrorFallback from "../../components/ErrorFallback";

describe("ErrorFallback", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render error message with section name", () => {
    render(() => (
      <ErrorFallback
        error={new Error("test error")}
        reset={() => {}}
        section="the sidebar"
      />
    ));
    expect(screen.getByText("Something went wrong in the sidebar")).toBeInTheDocument();
  });

  it("should render error detail", () => {
    render(() => (
      <ErrorFallback
        error={new Error("Connection failed")}
        reset={() => {}}
        section="the sidebar"
      />
    ));
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
  });

  it("should render retry button", () => {
    render(() => (
      <ErrorFallback
        error={new Error("test")}
        reset={() => {}}
        section="test"
      />
    ));
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("should call reset when retry is clicked", () => {
    const reset = vi.fn();
    render(() => (
      <ErrorFallback
        error={new Error("test")}
        reset={reset}
        section="test"
      />
    ));

    fireEvent.click(screen.getByText("Retry"));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("should have alert role for accessibility", () => {
    render(() => (
      <ErrorFallback
        error={new Error("test")}
        reset={() => {}}
        section="test"
      />
    ));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("ErrorBoundary integration", () => {
  afterEach(() => {
    cleanup();
  });

  const ThrowingComponent = () => {
    throw new Error("Component crashed");
  };

  it("should catch errors and render fallback", () => {
    // Suppress console.error for expected errors
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(() => (
      <ErrorBoundary
        fallback={(err, reset) => (
          <ErrorFallback error={err} reset={reset} section="the test area" />
        )}
      >
        <ThrowingComponent />
      </ErrorBoundary>
    ));

    expect(screen.getByText("Something went wrong in the test area")).toBeInTheDocument();
    expect(screen.getByText("Component crashed")).toBeInTheDocument();

    spy.mockRestore();
  });

  it("should render children when no error occurs", () => {
    render(() => (
      <ErrorBoundary
        fallback={(err, reset) => (
          <ErrorFallback error={err} reset={reset} section="test" />
        )}
      >
        <div>Healthy content</div>
      </ErrorBoundary>
    ));

    expect(screen.getByText("Healthy content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });
});
