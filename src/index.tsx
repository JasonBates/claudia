/* @refresh reload */
import { render } from "solid-js/web";
import { StoreProvider } from "./lib/store";
import App from "./App";
import PlanViewer from "./components/PlanViewer";

// Check if this is a plan viewer window
const isPlanViewer = new URLSearchParams(window.location.search).has("plan-viewer");

render(
  () => isPlanViewer ? (
    <PlanViewer />
  ) : (
    <StoreProvider>
      <App />
    </StoreProvider>
  ),
  document.getElementById("root") as HTMLElement
);
