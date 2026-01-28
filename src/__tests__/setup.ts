import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock Tauri APIs globally for all tests
// These mocks prevent tests from trying to call actual Tauri IPC
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(() => ({
    onmessage: null,
  })),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
  }),
}));

// Mock window.matchMedia for components that may use it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
