---
name: ue4-transaction-system
description: >
  How to use UE4's transaction system for undo/redo support in editor
  automation. Use whenever wrapping editor operations in transactions,
  implementing undo behavior, or debugging transaction scope issues.
---

# UE4 Transaction System

## Basics
UE4's editor has a built-in transaction system that records changes for undo/redo (Ctrl+Z / Ctrl+Y).

```python
import unreal

unreal.SystemLibrary.begin_transaction("Spawn Cube Actor")
# ... perform editor operations ...
unreal.SystemLibrary.end_transaction()
```

## Scope Rules
- **One transaction per logical operation.** If "spawn 5 actors" is one user action, wrap all 5 spawns in a single transaction.
- **Do not nest transactions.** UE4 does not support nested begin/end pairs properly.
- **Always end transactions.** A missing `end_transaction()` corrupts the undo stack.

## What is Transactable
These operations record undo state when wrapped in a transaction:
- Actor spawning / deletion
- Actor property changes (transform, components, parameters)
- Asset creation and modification
- Blueprint variable/component changes
- Material parameter changes

## What is NOT Transactable
- File system operations (saving files to disk)
- Console command execution
- Viewport camera position changes
- Editor preferences / settings changes

## Error Handling Pattern
```python
import unreal

def safe_transaction(description: str, operation):
    """Wraps an operation in a transaction with cleanup on failure."""
    unreal.SystemLibrary.begin_transaction(description)
    try:
        result = operation()
        unreal.SystemLibrary.end_transaction()
        return result
    except Exception as e:
        unreal.SystemLibrary.end_transaction()
        raise e
```

## MCP Server History Layer
The MCP server maintains its own operation history in `history.ts` that maps to UE4's transaction stack:
- Each MCP tool call that modifies state gets a history entry
- `undo` sends an undo command to UE4 and removes the history entry
- `checkpoint_create` saves the current level and records a snapshot
- `checkpoint_restore` loads the saved level state

The MCP history is a tracking layer on top of UE4's native undo, not a replacement.
