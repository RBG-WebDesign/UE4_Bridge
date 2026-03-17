---
name: bridge-http-protocol
description: >
  The HTTP protocol between the MCP server and the UE4 Python listener.
  Use whenever defining new endpoints, changing request/response formats,
  or debugging communication issues between the two layers.
---

# Bridge HTTP Protocol

## Connection
- **URL:** `http://localhost:8080`
- **Method:** POST
- **Content-Type:** `application/json`
- **Timeout:** 30 seconds (configurable in unreal-client.ts)

## Request Format
```json
{
  "command": "command_name",
  "params": {
    "key": "value"
  }
}
```

- `command` (string, required): The command to execute. Maps to a handler function.
- `params` (object, optional): Parameters for the command. Defaults to `{}`.

## Response Format
```json
{
  "success": true,
  "data": {
    "key": "value"
  },
  "error": "only present when success is false"
}
```

- `success` (boolean): Whether the command executed without errors.
- `data` (object): The result payload. Structure varies by command.
- `error` (string, conditional): Human-readable error message. Only present when `success` is `false`.

## Error Codes (HTTP Level)
| Status | Meaning |
|--------|---------|
| 200 | Command executed (check `success` for result) |
| 400 | Malformed request (bad JSON, missing command) |
| 404 | Unknown command |
| 500 | Internal error (unhandled exception in handler) |

Note: A 200 with `"success": false` is normal. It means the command ran but the operation failed (e.g., actor not found).

## Special Commands
| Command | Purpose |
|---------|---------|
| `ping` | Health check. Returns engine version, project name. |
| `python_proxy` | Executes arbitrary Python code. Params: `{"code": "..."}` |
| `begin_transaction` | Starts a UE4 undo transaction. Params: `{"description": "..."}` |
| `end_transaction` | Ends the current UE4 undo transaction. |
| `undo` | Triggers Ctrl+Z in the editor. |
| `redo` | Triggers Ctrl+Y in the editor. |

## Idempotency
Commands should be idempotent where possible:
- `actor_spawn` with a unique name does not create duplicates if the actor already exists
- `actor_modify` sets absolute values, not relative deltas
- `material_apply` replaces the material at a slot, does not append

## Timeout Behavior
If the listener does not respond within the timeout:
1. The MCP server returns an error to Claude Code
2. No retry is attempted automatically
3. The operation may or may not have executed on the UE4 side
4. Claude can use `test_connection` to check if the listener is alive
