#!/usr/bin/env node
import { createServer } from "net";
import { spawn } from "child_process";

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
    server.listen(port);
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
  console.log(`Starting CT on port ${port}`);

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
      env: { ...process.env, CT_PORT: String(port) },
    }
  );

  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
