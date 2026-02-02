# Security Model

This document describes the security architecture of Claudia.

## IPC Security

Permission requests flow between the Claude bridge process and the Tauri frontend via file-based IPC. The secure IPC system in `src-tauri/src/commands/secure_ipc.rs` provides:

| Control | Implementation |
|---------|----------------|
| Private directory | `~/Library/Application Support/com.jasonbates.claudia/ipc` with `0700` permissions |
| File permissions | All IPC files created with `0600` (owner read/write only) |
| Atomic writes | Temp file + rename prevents partial reads |
| Owner verification | Checks file UID matches process UID before reading |
| Permission verification | Rejects files with group/world permissions |

### Why File Permissions Instead of Cryptographic Signing

A reviewer might suggest adding HMAC/nonce authentication to IPC files. We intentionally chose file permissions because:

1. **Session secrets don't survive app reloads** - Users frequently restart the app, and secrets would be lost
2. **External hooks need access** - Conductor hooks read/write permission files and can't share session secrets
3. **Equivalent security for the threat model** - An attacker who can bypass Unix file permissions (0600/0700) already has root access, at which point no userspace security measure helps

This is a deliberate design decision, not an oversight.

## Tool Permissions

All tool execution requires explicit user approval:

1. Claude CLI spawns with `--permission-prompt-tool stdio`
2. Bridge receives `control_request` for each tool invocation
3. Request forwarded to UI as `permission_request` event
4. User approves/denies in the frontend
5. Response sent back to Claude CLI

No tools execute without user consent.
