#!/usr/bin/env node
import { createServer } from "net";
import { spawn } from "child_process";
import { basename } from "path";

const BASE_PORT = 1420;
const MAX_PORT = 1500;

// Common ports to skip
const SKIP_PORTS = new Set([
  1433, // SQL Server
  1434, // SQL Server Browser
  1521, // Oracle DB
  1433, // MySQL (sometimes)
]);

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    // Bind to localhost explicitly (same as Vite)
    server.listen(port, "localhost");
  });
}

async function findAvailablePort() {
  for (let port = BASE_PORT; port < MAX_PORT; port++) {
    if (SKIP_PORTS.has(port)) continue;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports found (tried ${BASE_PORT}-${MAX_PORT - 1})`);
}

async function main() {
  const port = await findAvailablePort();
  const worktree = basename(process.cwd());
  console.log(`Starting CT on port ${port} (worktree: ${worktree})`);

  const child = spawn(
    "npx",
    [
      "tauri",
      "dev",
      "--config",
      JSON.stringify({ build: { devUrl: `http://localhost:${port}` } }),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, CT_PORT: String(port), CT_WORKTREE: worktree },
    }
  );

  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
