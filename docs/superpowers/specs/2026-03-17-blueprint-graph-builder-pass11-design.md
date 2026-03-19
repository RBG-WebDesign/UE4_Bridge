# Blueprint Graph Builder Pass 11 -- Higher-Level Generation Layer

**Date:** 2026-03-17
**Status:** Draft

---

## Goal

Add a `blueprint_build_from_description` MCP tool that takes a declarative description and generates the low-level JSON graph internally, then calls the existing `blueprint_build_from_json` C++ function.

This layer sits entirely in TypeScript. No C++ changes.

---

## Scope

### In scope

- New MCP tool: `blueprint_build_from_description`
- Pattern template library for common graph patterns
- Description-to-JSON translation using explicit pattern matching
- Reuse of existing `blueprint_build_from_json` pipeline

### Out of scope

- Natural language processing or LLM-assisted generation (future iteration)
- Custom node type discovery (uses the fixed set from Passes 1-10)
- Interactive graph editing (build-once, not incremental)
- Visual layout optimization (uses the existing linear NodePosX spacing)

---

## Decision Log

### Pattern templates over NLP

The first version uses explicit pattern templates, not open-ended text parsing. Each pattern is a function that takes parameters and returns a graph JSON object. This is deterministic, testable, and debuggable.

Future iterations could add LLM-assisted generation where the description is parsed by Claude into pattern calls, but the foundation must be solid template-based generation first.

### Tool placement

The tool lives in a new file `mcp-server/src/tools/blueprints.ts` alongside the existing `blueprint_build_from_json` tool. It shares the same `UnrealClient` and calls `blueprint_build_from_json` internally via the client.

### Description format

The description is a structured object, not free text:

```json
{
    "blueprint_path": "/Game/BP_Test",
    "description": {
        "pattern": "print_value",
        "params": {
            "source": "GetActorLocation.X",
            "label": "X Position"
        }
    }
}
```

Or a sequence of steps:

```json
{
    "blueprint_path": "/Game/BP_Test",
    "steps": [
        {"pattern": "on_begin_play"},
        {"pattern": "get_actor_location"},
        {"pattern": "break_vector"},
        {"pattern": "print_float", "params": {"pin": "X"}}
    ]
}
```

---

## Files Changed

```
mcp-server/src/tools/blueprints.ts  -- add blueprint_build_from_description tool
mcp-server/src/patterns/            -- new directory for pattern templates
mcp-server/src/patterns/index.ts    -- pattern registry
mcp-server/src/patterns/print.ts    -- print-related patterns
mcp-server/src/patterns/flow.ts     -- flow control patterns (if/loop)
mcp-server/src/patterns/actor.ts    -- actor operation patterns
```

No C++ or Python changes.

---

## Pattern Library (Initial Set)

### print_value

Prints a scalar value: source -> Conv_*ToString -> PrintString

Parameters:
- `value_node`: node ID that produces the value
- `value_pin`: pin name on the value node
- `value_type`: float, int, bool, vector (determines Conv function)

Generated graph fragment:
```json
{
    "nodes": [
        {"id": "conv_N",  "type": "CallFunction", "function": "Conv_FloatToString"},
        {"id": "print_N", "type": "CallFunction", "function": "PrintString"}
    ],
    "connections": [
        {"from": "{value_node}.{value_pin}", "to": "conv_N.InFloat"},
        {"from": "conv_N.ReturnValue",       "to": "print_N.InString"}
    ]
}
```

### get_actor_location

Gets the owning actor's location and breaks it into components.

Generated graph fragment:
```json
{
    "nodes": [
        {"id": "getLoc", "type": "CallFunction", "function": "K2_GetActorLocation"},
        {"id": "break",  "type": "CallFunction", "function": "BreakVector"}
    ],
    "connections": [
        {"from": "getLoc.ReturnValue", "to": "break.InVec"}
    ]
}
```

Exposes: `break.X`, `break.Y`, `break.Z` for downstream wiring.

### for_each_print

Iterates an array and prints each element.

Parameters:
- `array_source`: node.pin that produces the array
- `element_type`: type for conversion

### branch_on_condition

If/else with two exec paths.

Parameters:
- `condition_source`: node.pin that produces the bool
- `then_pattern`: pattern name for the true branch
- `else_pattern`: pattern name for the false branch

---

## Tool Definition

```typescript
{
    name: "blueprint_build_from_description",
    description: "Build a Blueprint graph from a high-level description using pattern templates",
    schema: z.object({
        blueprint_path: z.string(),
        steps: z.array(z.object({
            pattern: z.string(),
            params: z.record(z.any()).optional()
        })),
        clear_existing: z.boolean().default(true)
    }),
    handler: async (params) => {
        // 1. Resolve each step's pattern into graph fragments
        // 2. Merge fragments into a single graph JSON
        // 3. Auto-wire exec chain between steps
        // 4. Call blueprint_build_from_json with the merged graph
    }
}
```

---

## Test Plan

### Test 1 -- Print actor X position

```json
{
    "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
    "steps": [
        {"pattern": "on_begin_play"},
        {"pattern": "get_actor_location"},
        {"pattern": "print_float", "params": {"source_pin": "break.X"}}
    ]
}
```

Expected: generates a graph with BeginPlay -> GetActorLocation -> BreakVector -> Conv_FloatToString -> PrintString. Prints the actor's X position.

### Test 2 -- Pattern not found

```json
{
    "steps": [{"pattern": "nonexistent_pattern"}]
}
```

Expected: error: `Unknown pattern 'nonexistent_pattern'`. Lists available patterns.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Pattern combinatorics explode | Start with 4-5 patterns; add on demand |
| Node ID collisions between patterns | Use pattern-scoped prefixes (e.g., `print_0_conv`, `print_1_conv`) |
| Exec chain auto-wiring is fragile | Only auto-wire between pattern boundaries; within a pattern, wiring is explicit |
| Users expect NLP | Document clearly that this is template-based, not AI-driven |

---

## What This Unlocks

After Pass 11: common Blueprint patterns can be built with a single high-level call instead of manually constructing node/connection JSON. This reduces the boilerplate for the 80% case while the low-level `blueprint_build_from_json` remains available for the 20% that needs full control.
