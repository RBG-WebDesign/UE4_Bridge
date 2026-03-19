# Skill: build_blueprint_graph_from_schema

Populate a Blueprint's event graph from a JSON schema using BlueprintGraphBuilderLibrary.

## MCP command
```json
{
  "command": "blueprint_build_from_json",
  "params": {
    "blueprint_path": "/Game/Generated/Gameplay/BP_MyActor",
    "graph_json": {
      "nodes": [
        {
          "id": "BeginPlay",
          "type": "event",
          "event_name": "BeginPlay"
        },
        {
          "id": "Print",
          "type": "function_call",
          "function": "PrintString",
          "inputs": { "InString": "Hello World" }
        }
      ],
      "connections": [
        { "from": "BeginPlay", "from_pin": "exec", "to": "Print", "to_pin": "exec" }
      ]
    }
  }
}
```

## Python pipeline
```python
from generation.blueprint_generator import generate_blueprint
from generation.spec_schema import BlueprintSpec

spec = BlueprintSpec(
    name="BP_MyActor",
    parent_class="Actor",
    content_path="/Game/Generated",
    graph_json={
        "nodes": [...],
        "connections": [...]
    }
)
```

## Graph JSON schema (BlueprintGraphBuilder format)
See `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-design.md` for full spec.

Key node types:
- `event` -- BeginPlay, Tick, custom events
- `function_call` -- any Blueprint function
- `variable_get` / `variable_set` -- Blueprint variables
- `branch` -- if/else
- `sequence` -- execute multiple branches

## Availability check
```python
import unreal
has_lib = hasattr(unreal, "BlueprintGraphBuilderLibrary")
```

## Fallback
If BlueprintGraphBuilderLibrary is not available, skip graph population.
The Blueprint still exists with empty event graph.
